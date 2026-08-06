-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- =====================================================================
-- Phase 1S-A2 — Agency paid-plan enforcement with beta grandfathering.
--
-- Defect being repaired:
--   1. public.agency_entitlements.status defaulted to 'manual_beta', so any
--      row inserted without an explicit status silently received open beta
--      access.
--   2. public.create_agency() inserted a 'manual_beta' Agency Starter
--      entitlement for every brand-new agency, granting paid-plan capacity
--      without any billing relationship.
--   3. public.get_effective_agency_limits() returned 'manual_beta' Starter
--      for a MISSING entitlement row, so absence of billing read as beta
--      access.
--
-- Behavior after this candidate:
--   * New agencies get a Starter *placeholder* in status 'cancelled'
--     (source 'manual', NULL overrides, no Stripe identity). The existing
--     agency checkout function fills stripe_customer_id and the webhook
--     upserts plan/status/source/subscription — unchanged.
--   * A missing entitlement row fails closed as Starter/'cancelled'.
--   * assert_agency_limit() blocks EVERY paid Agency Workspace action when
--     the effective status is 'cancelled' — the three numeric capacity
--     actions (create_service_package, invite_member, activate_client) and
--     the six non-numeric workflow actions (set_private_request_link,
--     submit_client_request, progress_client_request,
--     create_delegation_request, create_work_item, accept_member_invite) —
--     with one truthful message that is correct for both never-started and
--     previously cancelled billing.
--   * Public surfaces (slug resolution, public agency view, public package
--     listing) expose nothing for an unpaid agency, and the public package
--     listing additionally requires the agency profile itself to be active.
--   * Cleanup paths stay open while cancelled: clearing the slug, owner/admin
--     decline/cancel with no member assignment, and driver self-cancel with
--     no member assignment.
--   * The two existing production rows with status 'manual_beta' are
--     GRANDFATHERED: this candidate contains no UPDATE, DELETE, or backfill
--     of any kind and never rewrites an existing entitlement row.
--
-- Scope guarantees: no new table, no new column, no policy/RLS/index/trigger
-- change, no grant change (CREATE OR REPLACE preserves existing ACLs), no
-- Stripe change.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Column default: absence of an explicit status must fail closed.
-- ---------------------------------------------------------------------
ALTER TABLE public.agency_entitlements ALTER COLUMN status SET DEFAULT 'cancelled'::text;

-- ---------------------------------------------------------------------
-- 2. create_agency: placeholder entitlement is 'cancelled', not beta.
--    Authentication, idempotent existing-agency return, validations,
--    profile creation, and owner membership creation are preserved
--    exactly.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agency(
  _name text,
  _description text DEFAULT NULL::text,
  _contact_email text DEFAULT NULL::text
)
RETURNS public.agency_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.agency_profiles;
  _existing public.agency_profiles;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;

  -- Idempotent: if user already owns an agency, return it.
  SELECT * INTO _existing FROM public.agency_profiles
    WHERE owner_user_id = _uid LIMIT 1;
  IF FOUND THEN
    RETURN _existing;
  END IF;

  IF _name IS NULL OR length(btrim(_name)) < 2 OR length(_name) > 120 THEN
    RAISE EXCEPTION 'Agency name must be 2–120 characters' USING ERRCODE='22023';
  END IF;
  IF _contact_email IS NOT NULL AND btrim(_contact_email) <> ''
     AND lower(btrim(_contact_email)) !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid contact email' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.agency_profiles(owner_user_id, name, description, contact_email)
  VALUES (_uid, btrim(_name),
          NULLIF(btrim(coalesce(_description,'')),''),
          NULLIF(lower(btrim(coalesce(_contact_email,''))),''))
  RETURNING * INTO _row;

  INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, role, status, accepted_at)
  VALUES (_row.id, _uid,
          COALESCE((SELECT lower(email) FROM auth.users WHERE id = _uid),'owner@local'),
          'agency_owner','active', now());

  -- Placeholder only. No paid capacity until Stripe activates the plan.
  -- Overrides stay NULL so plan defaults always apply. ON CONFLICT DO
  -- NOTHING guarantees an existing entitlement row is never rewritten.
  INSERT INTO public.agency_entitlements
    (agency_id, plan_key, status, source,
     active_client_limit, member_limit, service_package_limit)
  VALUES (_row.id, 'agency_starter', 'cancelled', 'manual',
          NULL, NULL, NULL)
  ON CONFLICT (agency_id) DO NOTHING;

  RETURN _row;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. get_effective_agency_limits: a missing row fails closed.
--    Existing rows keep their exact current behavior (own plan/status,
--    explicit overrides falling back to plan defaults).
-- ---------------------------------------------------------------------
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
    -- Fail closed. A missing entitlement row is NOT beta access.
    SELECT * INTO defaults FROM public._agency_plan_defaults('agency_starter');
    RETURN QUERY SELECT 'agency_starter'::text, 'cancelled'::text,
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

-- ---------------------------------------------------------------------
-- 4. assert_agency_limit: one truthful billing-not-active block that is
--    correct for never-started AND previously cancelled billing.
--    manual_beta / active / trialing behavior is unchanged; all three
--    action counters and their ceilings are unchanged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_agency_limit(_agency_id uuid, _action text)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE lim record; used integer; plan_label text;
BEGIN
  SELECT * INTO lim FROM public.get_effective_agency_limits(_agency_id);
  plan_label := public._agency_plan_label(lim.plan_key);

  -- Phase 1S-A2: hard block before counting when billing is not active.
  -- Covers never-started placeholders and previously cancelled plans with
  -- the same truthful copy. Grandfathered manual_beta rows are unaffected.
  IF lim.status = 'cancelled' THEN
    RAISE EXCEPTION
      'Agency billing is not active. Start or restart your % plan from the Plan & Limits card to continue this action.',
      plan_label USING ERRCODE = 'P0001';
  END IF;

  IF _action = 'create_service_package' THEN
    IF lim.service_package_limit IS NULL THEN RETURN; END IF;
    SELECT count(*) INTO used FROM public.agency_service_packages
      WHERE agency_id = _agency_id AND is_active = true;
    IF used >= lim.service_package_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % active service packages. Upgrade your agency plan to add more.',
        plan_label, lim.service_package_limit USING ERRCODE = 'P0001';
    END IF;

  ELSIF _action = 'invite_member' THEN
    IF lim.member_limit IS NULL THEN RETURN; END IF;
    SELECT count(*) INTO used FROM public.agency_members
      WHERE agency_id = _agency_id AND status IN ('pending','active');
    IF used >= lim.member_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % agency members. Upgrade your agency plan to invite more.',
        plan_label, lim.member_limit USING ERRCODE = 'P0001';
    END IF;

  ELSIF _action = 'activate_client' THEN
    IF lim.active_client_limit IS NULL THEN RETURN; END IF;
    SELECT count(DISTINCT d.driver_user_id) INTO used FROM public.agency_delegation_requests d
      WHERE d.agency_id = _agency_id AND d.status = 'approved';
    IF used >= lim.active_client_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % active driver clients. Upgrade your agency plan to take on more.',
        plan_label, lim.active_client_limit USING ERRCODE = 'P0001';
    END IF;
  -- Phase 1S-A2-R1/R2: non-numeric paid Agency Workspace operations. These
  -- do not consume a countable seat/package/client slot, so for any
  -- non-cancelled entitlement they simply succeed. The cancelled block above
  -- already rejected them for unpaid or missing-row agencies.
  ELSIF _action IN (
    'set_private_request_link',
    'submit_client_request',
    'progress_client_request',
    'create_delegation_request',
    'create_work_item',
    'accept_member_invite'
  ) THEN
    RETURN;

  ELSE
    RAISE EXCEPTION 'Unknown agency limit action: %', _action USING ERRCODE = '22023';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. set_agency_slug: setting a private request link is a paid operation.
--    Clearing the slug stays available to a cancelled agency so it can
--    withdraw its public surface during cleanup.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_agency_slug(_agency_id uuid, _slug text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _uid uuid := auth.uid();
  _normalized text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  IF NOT public.is_agency_owner(_agency_id, _uid) THEN
    RAISE EXCEPTION 'Not the agency owner' USING ERRCODE='42501';
  END IF;
  _normalized := NULLIF(lower(trim(_slug)), '');
  IF _normalized IS NOT NULL THEN
    PERFORM public.assert_agency_limit(_agency_id, 'set_private_request_link');
  END IF;
  UPDATE public.agency_profiles
    SET slug = _normalized, updated_at = now()
  WHERE id = _agency_id;
  RETURN _normalized;
END $$;

-- ---------------------------------------------------------------------
-- 6. resolve_agency_slug: an unpaid agency must not resolve publicly.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_agency_slug(_slug text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT ap.id FROM public.agency_profiles ap
   WHERE ap.slug = lower(trim(_slug)) AND ap.status = 'active'
     AND (SELECT l.status FROM public.get_effective_agency_limits(ap.id) l)
         IN ('manual_beta','active','trialing','past_due')
   LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- 7. get_agency_public_view: same public-visibility allowlist.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_agency_public_view(_agency_id uuid)
RETURNS TABLE (id uuid, name text, description text, contact_email text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ap.id, ap.name, ap.description, ap.contact_email, ap.status::text
    FROM public.agency_profiles ap
   WHERE ap.id = _agency_id AND ap.status = 'active'
     AND (SELECT l.status FROM public.get_effective_agency_limits(ap.id) l)
         IN ('manual_beta','active','trialing','past_due');
$$;

-- ---------------------------------------------------------------------
-- 8. list_agency_packages_public: same public-visibility allowlist, plus an
--    independent requirement that the agency profile itself is active, so a
--    suspended agency exposes no packages regardless of entitlement status.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_agency_packages_public(_agency_id uuid)
RETURNS SETOF public.agency_service_packages
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.agency_service_packages
   WHERE agency_id = _agency_id AND is_active = true
     AND EXISTS (SELECT 1 FROM public.agency_profiles ap
                  WHERE ap.id = _agency_id AND ap.status = 'active')
     AND (SELECT l.status FROM public.get_effective_agency_limits(_agency_id) l)
         IN ('manual_beta','active','trialing','past_due')
   ORDER BY sort_order ASC, created_at ASC;
$$;


-- ---------------------------------------------------------------------
-- 9. submit_agency_client_request: intake into an unpaid agency is blocked.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_agency_client_request(
  _agency_id uuid, _selected_package_id uuid, _message text,
  _preferred_contact_method text, _phone text, _consent boolean
) RETURNS public.agency_client_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _row public.agency_client_requests; _rec jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(_consent,false) THEN RAISE EXCEPTION 'Consent required' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agency_profiles WHERE id=_agency_id AND status='active') THEN
    RAISE EXCEPTION 'Agency not available' USING ERRCODE='42704';
  END IF;
  PERFORM public.assert_agency_limit(_agency_id, 'submit_client_request');
  IF _selected_package_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agency_service_packages
     WHERE id=_selected_package_id AND agency_id=_agency_id AND is_active=true
  ) THEN RAISE EXCEPTION 'Selected package is not active' USING ERRCODE='22023'; END IF;
  SELECT public.clean_assistant_permissions(recommended_permissions) INTO _rec
    FROM public.agency_service_packages WHERE id = _selected_package_id;
  INSERT INTO public.agency_client_requests
    (agency_id, driver_user_id, selected_package_id, message,
     preferred_contact_method, phone, requested_permissions)
  VALUES (_agency_id, _uid, _selected_package_id,
     NULLIF(btrim(coalesce(_message,'')),''),
     NULLIF(btrim(coalesce(_preferred_contact_method,'')),''),
     NULLIF(btrim(coalesce(_phone,'')),''),
     COALESCE(_rec,'{}'::jsonb))
  RETURNING * INTO _row;
  INSERT INTO public.agency_audit_log (actor_user_id, agency_id, driver_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, _agency_id, _uid, 'client_request_submitted', 'agency_client_request', _row.id,
          jsonb_build_object('package_id', _selected_package_id));
  RETURN _row;
END $$;

-- ---------------------------------------------------------------------
-- 10. set_agency_client_request_status: positive progression and assignment
--     are paid operations. Driver self-cancel and owner/admin
--     decline/cancel remain available cleanup paths, but only when no member
--     assignment is attached — a self-cancel carrying an assignment must not
--     bypass the paid progression guard.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_agency_client_request_status(
  _id uuid, _status public.agency_client_request_status,
  _assigned_member_user_id uuid DEFAULT NULL
) RETURNS public.agency_client_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _row public.agency_client_requests; _old public.agency_client_requests;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _old FROM public.agency_client_requests WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE='42704'; END IF;
  IF _old.driver_user_id = _uid AND _status='cancelled' AND _assigned_member_user_id IS NULL THEN NULL;
  ELSIF public.is_agency_owner_or_admin(_old.agency_id,_uid) THEN
    IF _status NOT IN ('declined','cancelled') OR _assigned_member_user_id IS NOT NULL THEN
      PERFORM public.assert_agency_limit(_old.agency_id, 'progress_client_request');
    END IF;
  ELSE RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _assigned_member_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id=_old.agency_id AND member_user_id=_assigned_member_user_id AND status='active'
  ) THEN RAISE EXCEPTION 'Assigned member must be an active agency member' USING ERRCODE='22023'; END IF;
  UPDATE public.agency_client_requests SET
    status=_status,
    assigned_member_user_id=COALESCE(_assigned_member_user_id, assigned_member_user_id),
    decided_at=now(), decided_by_user_id=_uid
  WHERE id=_id RETURNING * INTO _row;
  INSERT INTO public.agency_audit_log (actor_user_id, agency_id, driver_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, _row.agency_id, _row.driver_user_id,
          'client_request_'||_status::text, 'agency_client_request', _row.id,
          jsonb_build_object('assigned_member_user_id', _row.assigned_member_user_id));
  RETURN _row;
END $$;

-- ---------------------------------------------------------------------
-- 11. create_agency_delegation_request: creating new delegated access is a
--     paid operation.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agency_delegation_request(_client_request_id uuid, _member_user_id uuid, _requested_permissions jsonb)
 RETURNS public.agency_delegation_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _req public.agency_client_requests; _mbr public.agency_members; _clean jsonb; _row public.agency_delegation_requests;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _req FROM public.agency_client_requests WHERE id=_client_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client request not found' USING ERRCODE='42704'; END IF;
  IF NOT public.is_agency_owner_or_admin(_req.agency_id,_uid) THEN
    RAISE EXCEPTION 'Only agency owner/admin can create delegation requests' USING ERRCODE='42501';
  END IF;
  PERFORM public.assert_agency_limit(_req.agency_id, 'create_delegation_request');
  IF _req.status NOT IN ('pending','approved') THEN
    RAISE EXCEPTION 'Cannot create delegation for a % client request' , _req.status USING ERRCODE='22023';
  END IF;
  SELECT * INTO _mbr FROM public.agency_members
   WHERE agency_id=_req.agency_id AND member_user_id=_member_user_id AND status='active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected member must be an active agency member with a verified account' USING ERRCODE='22023';
  END IF;
  _clean := public.clean_assistant_permissions(_requested_permissions);
  INSERT INTO public.agency_delegation_requests
    (agency_id, client_request_id, driver_user_id, member_user_id,
     member_invite_email, requested_permissions, created_by_user_id)
  VALUES (_req.agency_id, _req.id, _req.driver_user_id, _mbr.member_user_id,
          _mbr.invite_email, _clean, _uid)
  RETURNING * INTO _row;
  UPDATE public.agency_client_requests
     SET status='approved', decided_at=now(), decided_by_user_id=_uid,
         assigned_member_user_id=_mbr.member_user_id
   WHERE id=_req.id AND status IN ('pending','approved');
  INSERT INTO public.agency_audit_log (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, _req.agency_id, _req.driver_user_id, _mbr.member_user_id,
          'delegation_request_created', 'agency_delegation_request', _row.id,
          jsonb_build_object('client_request_id', _req.id, 'permissions', _clean));
  RETURN _row;
END $function$;

-- ---------------------------------------------------------------------
-- 12. create_agency_work_item: creating new work is a paid operation.
--     update_agency_work_item is intentionally NOT replaced, so a cancelled
--     agency can still finish work already in flight.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agency_work_item(_agency_id uuid, _driver_user_id uuid, _title text, _description text, _type public.agency_work_item_type, _priority public.agency_work_item_priority, _assigned_member_user_id uuid, _client_request_id uuid, _due_date date)
 RETURNS public.agency_work_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _row public.agency_work_items;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.is_agency_owner_or_admin(_agency_id,_uid) THEN
    RAISE EXCEPTION 'Only agency owner/admin can create work items' USING ERRCODE='42501';
  END IF;
  PERFORM public.assert_agency_limit(_agency_id, 'create_work_item');
  IF NOT EXISTS (
    SELECT 1 FROM public.agency_delegation_requests
     WHERE agency_id=_agency_id
       AND driver_user_id=_driver_user_id
       AND status='approved'
  ) THEN
    RAISE EXCEPTION 'Driver is not an approved client of this agency' USING ERRCODE='42501';
  END IF;
  IF _assigned_member_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id=_agency_id AND member_user_id=_assigned_member_user_id AND status='active'
  ) THEN RAISE EXCEPTION 'Assigned member must be an active agency member' USING ERRCODE='22023'; END IF;
  INSERT INTO public.agency_work_items
    (agency_id, driver_user_id, assigned_member_user_id, client_request_id,
     title, description, type, priority, due_date, created_by_user_id)
  VALUES (_agency_id,_driver_user_id,_assigned_member_user_id,_client_request_id,
          btrim(_title), NULLIF(btrim(coalesce(_description,'')),''),
          COALESCE(_type,'other'::public.agency_work_item_type),
          COALESCE(_priority,'normal'::public.agency_work_item_priority),
          _due_date,_uid)
  RETURNING * INTO _row;
  INSERT INTO public.agency_audit_log (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid,_agency_id,_driver_user_id,_assigned_member_user_id,
          'work_item_created','agency_work_item',_row.id,
          jsonb_build_object('title',_row.title,'type',_row.type,'priority',_row.priority));
  RETURN _row;
END $function$;

-- ---------------------------------------------------------------------
-- 13. accept_agency_invite: activating a pending seat expands paid team
--     capacity, so billing must be verified BEFORE the row is mutated.
--     Invite creation/resend, revocation, and listing are untouched.
--     The live identity, token hashing, email matching, success fields,
--     and invalid/not-addressed P0002 error are preserved exactly.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_agency_invite(_token text)
RETURNS public.agency_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _h text := encode(digest(coalesce(_token,''),'sha256'),'hex');
  _em text;
  _pending public.agency_members;
  _row public.agency_members;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT lower(email) INTO _em FROM auth.users WHERE id=_uid;

  SELECT * INTO _pending FROM public.agency_members
   WHERE invite_token_hash=_h AND status='pending' AND lower(invite_email)=_em
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite invalid or not addressed to your email' USING ERRCODE='P0002';
  END IF;

  PERFORM public.assert_agency_limit(_pending.agency_id, 'accept_member_invite');

  UPDATE public.agency_members SET member_user_id=_uid, status='active', accepted_at=now(),
         invite_token_hash=NULL, updated_at=now()
   WHERE id=_pending.id AND status='pending'
  RETURNING * INTO _row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite invalid or not addressed to your email' USING ERRCODE='P0002';
  END IF;

  RETURN _row;
END $function$;

INSERT INTO supabase_migrations.schema_migrations (version, name, created_by, idempotency_key, statements, rollback) VALUES ('20260806052000', '20260806052000_phase1s_a2_agency_paid_plan_enforcement', 'chatgpt-supervised@openai', 'phase1s-a2:20260806052000:a12d1c2d40a80c90208ce19dcca605caaea65303', NULL, NULL);
COMMIT;