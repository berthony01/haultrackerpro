
-- 1. Tighten plan_key constraint to agency-workspace plans only.
DO $$
DECLARE conname text;
BEGIN
  SELECT c.conname INTO conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'agency_entitlements'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%plan_key%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.agency_entitlements DROP CONSTRAINT %I', conname);
  END IF;
END$$;

UPDATE public.agency_entitlements
   SET plan_key = 'agency_starter'
 WHERE plan_key = 'assistant_free';

ALTER TABLE public.agency_entitlements
  ADD CONSTRAINT agency_entitlements_plan_key_check
  CHECK (plan_key IN ('agency_starter','agency_team','agency_growth'));

-- 2. Allow any active agency member to read their entitlement.
CREATE OR REPLACE FUNCTION public.get_agency_entitlement(_agency_id uuid)
RETURNS public.agency_entitlements
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.agency_entitlements; is_member boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.agency_members m
     WHERE m.agency_id = _agency_id
       AND m.member_user_id = auth.uid()
       AND m.status = 'active'
  ) INTO is_member;
  IF NOT is_member THEN RETURN NULL; END IF;
  SELECT * INTO result FROM public.agency_entitlements WHERE agency_id = _agency_id;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_agency_entitlement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agency_entitlement(uuid) TO authenticated;

DROP POLICY IF EXISTS "agency_entitlements_read_owner_admin" ON public.agency_entitlements;
DROP POLICY IF EXISTS "agency_entitlements_read_active_member" ON public.agency_entitlements;
CREATE POLICY "agency_entitlements_read_active_member"
ON public.agency_entitlements FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.agency_members m
     WHERE m.agency_id = agency_entitlements.agency_id
       AND m.member_user_id = auth.uid()
       AND m.status = 'active'
  )
);

-- 3. Plan default + label helpers (single source of truth in SQL,
--    must match src/lib/agencyPlans.ts).
CREATE OR REPLACE FUNCTION public._agency_plan_defaults(_plan_key text)
RETURNS TABLE(member_limit integer, active_client_limit integer, service_package_limit integer)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT
    CASE _plan_key WHEN 'agency_starter' THEN 2 WHEN 'agency_team' THEN 5 WHEN 'agency_growth' THEN 15 ELSE 2 END,
    CASE _plan_key WHEN 'agency_starter' THEN 5 WHEN 'agency_team' THEN 25 WHEN 'agency_growth' THEN 100 ELSE 5 END,
    CASE _plan_key WHEN 'agency_starter' THEN 3 WHEN 'agency_team' THEN 25 WHEN 'agency_growth' THEN 100 ELSE 3 END;
$$;
REVOKE ALL ON FUNCTION public._agency_plan_defaults(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._agency_plan_defaults(text) TO authenticated;

CREATE OR REPLACE FUNCTION public._agency_plan_label(_plan_key text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _plan_key
    WHEN 'agency_starter' THEN 'Agency Starter'
    WHEN 'agency_team'    THEN 'Agency Team'
    WHEN 'agency_growth'  THEN 'Agency Growth'
    ELSE 'Agency' END;
$$;
REVOKE ALL ON FUNCTION public._agency_plan_label(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._agency_plan_label(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_effective_agency_limits(_agency_id uuid)
RETURNS TABLE(
  plan_key text, status text,
  member_limit integer, active_client_limit integer, service_package_limit integer,
  has_entitlement_row boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ent public.agency_entitlements; defaults record;
BEGIN
  SELECT * INTO ent FROM public.agency_entitlements WHERE agency_id = _agency_id;
  IF NOT FOUND THEN
    SELECT * INTO defaults FROM public._agency_plan_defaults('agency_starter');
    RETURN QUERY SELECT 'agency_starter'::text, 'manual_beta'::text,
      defaults.member_limit, defaults.active_client_limit, defaults.service_package_limit, false;
    RETURN;
  END IF;
  SELECT * INTO defaults FROM public._agency_plan_defaults(ent.plan_key);
  RETURN QUERY SELECT ent.plan_key, ent.status,
    COALESCE(ent.member_limit, defaults.member_limit),
    COALESCE(ent.active_client_limit, defaults.active_client_limit),
    COALESCE(ent.service_package_limit, defaults.service_package_limit),
    true;
END $$;
REVOKE ALL ON FUNCTION public.get_effective_agency_limits(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_agency_limits(uuid) TO authenticated;

-- 4. assert_agency_limit: raises a friendly error when the action would
--    exceed the plan. Actions: create_service_package | invite_member | activate_client.
CREATE OR REPLACE FUNCTION public.assert_agency_limit(_agency_id uuid, _action text)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE lim record; used integer; plan_label text;
BEGIN
  SELECT * INTO lim FROM public.get_effective_agency_limits(_agency_id);
  plan_label := public._agency_plan_label(lim.plan_key);

  IF _action = 'create_service_package' THEN
    IF lim.service_package_limit IS NULL THEN RETURN; END IF;
    SELECT count(*) INTO used FROM public.agency_service_packages
      WHERE agency_id = _agency_id AND is_active = true;
    IF used >= lim.service_package_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % active service packages. Agency billing will be enabled in Phase 8 — contact support or stay in beta mode for now.',
        plan_label, lim.service_package_limit USING ERRCODE = 'P0001';
    END IF;

  ELSIF _action = 'invite_member' THEN
    IF lim.member_limit IS NULL THEN RETURN; END IF;
    SELECT count(*) INTO used FROM public.agency_members
      WHERE agency_id = _agency_id AND status IN ('pending','active');
    IF used >= lim.member_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % agency members. Agency billing will be enabled in Phase 8 — contact support or stay in beta mode for now.',
        plan_label, lim.member_limit USING ERRCODE = 'P0001';
    END IF;

  ELSIF _action = 'activate_client' THEN
    IF lim.active_client_limit IS NULL THEN RETURN; END IF;
    SELECT count(DISTINCT d.driver_user_id) INTO used FROM public.agency_delegation_requests d
      WHERE d.agency_id = _agency_id AND d.status = 'approved';
    IF used >= lim.active_client_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % active driver clients. Agency billing will be enabled in Phase 8 — contact support or stay in beta mode for now.',
        plan_label, lim.active_client_limit USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown agency limit action: %', _action USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_agency_limit(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_agency_limit(uuid, text) TO authenticated;

-- 5. Wire limit enforcement into mutation RPCs.

-- 5a. create_agency_package
CREATE OR REPLACE FUNCTION public.create_agency_package(
  _agency_id uuid, _name text, _description text,
  _price_display_text text, _billing_frequency_display_text text,
  _included_services jsonb, _recommended_permissions jsonb,
  _sort_order integer DEFAULT 0
) RETURNS public.agency_service_packages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _row public.agency_service_packages;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.is_agency_owner_or_admin(_agency_id, _uid) THEN
    RAISE EXCEPTION 'Only agency owner/admin can manage packages' USING ERRCODE='42501';
  END IF;
  IF _name IS NULL OR btrim(_name)='' THEN RAISE EXCEPTION 'Package name required' USING ERRCODE='22023'; END IF;

  PERFORM public.assert_agency_limit(_agency_id, 'create_service_package');

  INSERT INTO public.agency_service_packages
    (agency_id,name,description,price_display_text,billing_frequency_display_text,
     included_services,recommended_permissions,sort_order)
  VALUES (_agency_id, btrim(_name),
    NULLIF(btrim(coalesce(_description,'')),''),
    NULLIF(btrim(coalesce(_price_display_text,'')),''),
    NULLIF(btrim(coalesce(_billing_frequency_display_text,'')),''),
    COALESCE(_included_services,'[]'::jsonb),
    public.clean_assistant_permissions(_recommended_permissions),
    COALESCE(_sort_order,0))
  RETURNING * INTO _row;
  INSERT INTO public.agency_audit_log (actor_user_id, agency_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, _agency_id, 'package_created', 'agency_service_package', _row.id, jsonb_build_object('name', _row.name));
  RETURN _row;
END $$;
REVOKE ALL ON FUNCTION public.create_agency_package(uuid,text,text,text,text,jsonb,jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_agency_package(uuid,text,text,text,text,jsonb,jsonb,integer) TO authenticated;

-- 5b. update_agency_package: only enforce on inactive -> active transitions.
CREATE OR REPLACE FUNCTION public.update_agency_package(
  _id uuid, _name text, _description text,
  _price_display_text text, _billing_frequency_display_text text,
  _included_services jsonb, _recommended_permissions jsonb,
  _is_active boolean, _sort_order integer
) RETURNS public.agency_service_packages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _row public.agency_service_packages; _old public.agency_service_packages;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _old FROM public.agency_service_packages WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Package not found' USING ERRCODE='42704'; END IF;
  IF NOT public.is_agency_owner_or_admin(_old.agency_id, _uid) THEN
    RAISE EXCEPTION 'Only agency owner/admin can manage packages' USING ERRCODE='42501';
  END IF;

  IF COALESCE(_is_active, _old.is_active) = true AND _old.is_active = false THEN
    PERFORM public.assert_agency_limit(_old.agency_id, 'create_service_package');
  END IF;

  UPDATE public.agency_service_packages SET
    name = COALESCE(NULLIF(btrim(_name),''), name),
    description = NULLIF(btrim(coalesce(_description,'')),''),
    price_display_text = NULLIF(btrim(coalesce(_price_display_text,'')),''),
    billing_frequency_display_text = NULLIF(btrim(coalesce(_billing_frequency_display_text,'')),''),
    included_services = COALESCE(_included_services, included_services),
    recommended_permissions = public.clean_assistant_permissions(_recommended_permissions),
    is_active = COALESCE(_is_active, is_active),
    sort_order = COALESCE(_sort_order, sort_order)
  WHERE id = _id RETURNING * INTO _row;
  INSERT INTO public.agency_audit_log (actor_user_id, agency_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, _row.agency_id,
          CASE WHEN _old.is_active AND NOT _row.is_active THEN 'package_deactivated' ELSE 'package_updated' END,
          'agency_service_package', _row.id, jsonb_build_object('name', _row.name));
  RETURN _row;
END $$;
REVOKE ALL ON FUNCTION public.update_agency_package(uuid,text,text,text,text,jsonb,jsonb,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_agency_package(uuid,text,text,text,text,jsonb,jsonb,boolean,integer) TO authenticated;

-- 5c. invite_agency_member: only enforce for net-new emails.
CREATE OR REPLACE FUNCTION public.invite_agency_member(
  _agency_id uuid, _email text, _role public.agency_member_role DEFAULT 'agency_member'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _en text := lower(btrim(coalesce(_email,'')));
  _t text; _h text; _row public.agency_members; _exists boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agency_profiles ap WHERE ap.id=_agency_id AND ap.owner_user_id=_uid) THEN
    RAISE EXCEPTION 'Not your agency' USING ERRCODE='42501';
  END IF;
  IF _role='agency_owner' THEN RAISE EXCEPTION 'Cannot assign owner role' USING ERRCODE='22023'; END IF;
  IF _en='' OR _en !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE='22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id = _agency_id
       AND lower(invite_email) = _en
       AND status IN ('pending','active')
  ) INTO _exists;
  IF NOT _exists THEN
    PERFORM public.assert_agency_limit(_agency_id, 'invite_member');
  END IF;

  _t:=encode(gen_random_bytes(24),'hex'); _h:=encode(digest(_t,'sha256'),'hex');
  INSERT INTO public.agency_members(agency_id,invite_email,invite_token_hash,role,status)
  VALUES (_agency_id,_en,_h,_role,'pending')
  ON CONFLICT (agency_id, lower(invite_email)) WHERE status IN ('pending','active')
  DO UPDATE SET role=EXCLUDED.role, invite_token_hash=EXCLUDED.invite_token_hash,
                invited_at=now(), updated_at=now()
  RETURNING * INTO _row;
  RETURN jsonb_build_object('id',_row.id,'invite_token',_t,'invite_email',_row.invite_email);
END;$$;
REVOKE EXECUTE ON FUNCTION public.invite_agency_member(uuid,text,public.agency_member_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_agency_member(uuid,text,public.agency_member_role) TO authenticated;

-- 5d. driver_decide_delegation: enforce activate_client only when adding a NEW client.
CREATE OR REPLACE FUNCTION public.driver_decide_delegation(_id uuid, _approve boolean)
RETURNS public.agency_delegation_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _d public.agency_delegation_requests;
  _da public.driver_assistants;
  _email_norm text;
  _already_client boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _d FROM public.agency_delegation_requests WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delegation not found' USING ERRCODE='42704'; END IF;
  IF _d.driver_user_id <> _uid THEN RAISE EXCEPTION 'Only the driver can decide' USING ERRCODE='42501'; END IF;
  IF _d.status <> 'pending_driver_approval' THEN RAISE EXCEPTION 'Already decided' USING ERRCODE='22023'; END IF;

  IF NOT _approve THEN
    UPDATE public.agency_delegation_requests SET status='declined', decided_at=now() WHERE id=_id RETURNING * INTO _d;
    INSERT INTO public.agency_audit_log (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
    VALUES (_uid,_d.agency_id,_d.driver_user_id,_d.member_user_id,
            'delegation_declined_by_driver','agency_delegation_request',_d.id,'{}'::jsonb);
    RETURN _d;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id=_d.agency_id AND member_user_id=_d.member_user_id AND status='active'
  ) THEN RAISE EXCEPTION 'Agency member is no longer active' USING ERRCODE='22023'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.agency_delegation_requests
     WHERE agency_id = _d.agency_id
       AND driver_user_id = _d.driver_user_id
       AND status = 'approved'
       AND id <> _d.id
  ) INTO _already_client;

  IF NOT _already_client THEN
    PERFORM public.assert_agency_limit(_d.agency_id, 'activate_client');
  END IF;

  _email_norm := lower(btrim(_d.member_invite_email));

  INSERT INTO public.driver_assistants
    (driver_user_id, assistant_user_id, invite_email, status, permissions, accepted_at)
  VALUES (_uid, _d.member_user_id, _email_norm, 'active', _d.requested_permissions, now())
  ON CONFLICT (driver_user_id, lower(invite_email))
    WHERE status IN ('pending','active')
  DO UPDATE SET
    status='active',
    assistant_user_id=EXCLUDED.assistant_user_id,
    permissions=EXCLUDED.permissions,
    accepted_at=COALESCE(public.driver_assistants.accepted_at, now()),
    revoked_at=NULL,
    updated_at=now()
  RETURNING * INTO _da;

  UPDATE public.agency_delegation_requests SET status='approved', decided_at=now() WHERE id=_id RETURNING * INTO _d;

  IF _d.client_request_id IS NOT NULL THEN
    UPDATE public.agency_client_requests
       SET status='converted_to_client', decided_at=now(), decided_by_user_id=_uid
     WHERE id=_d.client_request_id;
  END IF;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES (_da.id, _uid, _d.member_user_id, 'delegation_approved', 'driver_assistants', _da.id,
          jsonb_build_object('agency_id', _d.agency_id, 'delegation_id', _d.id));

  INSERT INTO public.agency_audit_log (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid,_d.agency_id,_d.driver_user_id,_d.member_user_id,
          'delegation_approved_by_driver','agency_delegation_request',_d.id,
          jsonb_build_object('driver_assistants_id', _da.id));
  RETURN _d;
END $$;
REVOKE ALL ON FUNCTION public.driver_decide_delegation(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_decide_delegation(uuid,boolean) TO authenticated;
