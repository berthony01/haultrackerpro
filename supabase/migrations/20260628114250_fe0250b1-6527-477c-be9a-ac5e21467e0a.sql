
-- =====================================================================
-- Driver Assistants Phase 3 — Agency Workflow + Service Packaging
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE public.agency_client_request_status AS ENUM
    ('pending','approved','declined','cancelled','converted_to_client');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.agency_delegation_status AS ENUM
    ('pending_driver_approval','approved','declined','revoked','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.agency_work_item_type AS ENUM
    ('load_entry','expense_entry','fuel_entry','report_review',
     'monthly_closeout','document_followup','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.agency_work_item_status AS ENUM
    ('open','in_progress','waiting_on_driver','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.agency_work_item_priority AS ENUM ('low','normal','high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper
CREATE OR REPLACE FUNCTION public.is_agency_owner_or_admin(
  _agency_id uuid, _user_id uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.agency_profiles ap
             WHERE ap.id = _agency_id AND ap.owner_user_id = _user_id)
    OR EXISTS (SELECT 1 FROM public.agency_members am
                WHERE am.agency_id = _agency_id
                  AND am.member_user_id = _user_id
                  AND am.status = 'active'
                  AND am.role IN ('agency_owner','agency_admin'))
  );
$$;
REVOKE ALL ON FUNCTION public.is_agency_owner_or_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_agency_owner_or_admin(uuid, uuid) TO authenticated;

-- ---------- agency_service_packages ----------
CREATE TABLE IF NOT EXISTS public.agency_service_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text,
  price_display_text text,
  billing_frequency_display_text text,
  included_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asp_agency_idx ON public.agency_service_packages(agency_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_service_packages TO authenticated;
GRANT ALL ON public.agency_service_packages TO service_role;
ALTER TABLE public.agency_service_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY asp_member_select ON public.agency_service_packages
  FOR SELECT TO authenticated USING (public.is_agency_member(agency_id, auth.uid()));
CREATE POLICY asp_owner_admin_write ON public.agency_service_packages
  FOR ALL TO authenticated
  USING (public.is_agency_owner_or_admin(agency_id, auth.uid()))
  WITH CHECK (public.is_agency_owner_or_admin(agency_id, auth.uid()));
CREATE TRIGGER asp_updated_at BEFORE UPDATE ON public.agency_service_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- agency_client_requests ----------
CREATE TABLE IF NOT EXISTS public.agency_client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  selected_package_id uuid REFERENCES public.agency_service_packages(id) ON DELETE SET NULL,
  status public.agency_client_request_status NOT NULL DEFAULT 'pending',
  message text,
  preferred_contact_method text CHECK (preferred_contact_method IN ('email','phone','text','any') OR preferred_contact_method IS NULL),
  phone text,
  requested_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_member_user_id uuid,
  decided_at timestamptz,
  decided_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acr_agency_status_idx ON public.agency_client_requests(agency_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS acr_driver_idx ON public.agency_client_requests(driver_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS acr_assigned_idx ON public.agency_client_requests(assigned_member_user_id) WHERE assigned_member_user_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_client_requests TO authenticated;
GRANT ALL ON public.agency_client_requests TO service_role;
ALTER TABLE public.agency_client_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY acr_driver_self_select ON public.agency_client_requests
  FOR SELECT TO authenticated USING (driver_user_id = auth.uid());
CREATE POLICY acr_driver_insert_self ON public.agency_client_requests
  FOR INSERT TO authenticated WITH CHECK (driver_user_id = auth.uid());
CREATE POLICY acr_driver_cancel_own ON public.agency_client_requests
  FOR UPDATE TO authenticated USING (driver_user_id = auth.uid()) WITH CHECK (driver_user_id = auth.uid());
CREATE POLICY acr_agency_admin_all ON public.agency_client_requests
  FOR ALL TO authenticated
  USING (public.is_agency_owner_or_admin(agency_id, auth.uid()))
  WITH CHECK (public.is_agency_owner_or_admin(agency_id, auth.uid()));
CREATE POLICY acr_assigned_member_select ON public.agency_client_requests
  FOR SELECT TO authenticated USING (assigned_member_user_id = auth.uid());
CREATE TRIGGER acr_updated_at BEFORE UPDATE ON public.agency_client_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- agency_delegation_requests ----------
CREATE TABLE IF NOT EXISTS public.agency_delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  client_request_id uuid REFERENCES public.agency_client_requests(id) ON DELETE SET NULL,
  driver_user_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  member_invite_email text NOT NULL,
  requested_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.agency_delegation_status NOT NULL DEFAULT 'pending_driver_approval',
  created_by_user_id uuid NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS adr_driver_status_idx ON public.agency_delegation_requests(driver_user_id, status);
CREATE INDEX IF NOT EXISTS adr_agency_idx ON public.agency_delegation_requests(agency_id, status);
CREATE INDEX IF NOT EXISTS adr_member_idx ON public.agency_delegation_requests(member_user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_delegation_requests TO authenticated;
GRANT ALL ON public.agency_delegation_requests TO service_role;
ALTER TABLE public.agency_delegation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY adr_driver_select ON public.agency_delegation_requests
  FOR SELECT TO authenticated USING (driver_user_id = auth.uid());
CREATE POLICY adr_driver_update_own ON public.agency_delegation_requests
  FOR UPDATE TO authenticated USING (driver_user_id = auth.uid()) WITH CHECK (driver_user_id = auth.uid());
CREATE POLICY adr_agency_admin_all ON public.agency_delegation_requests
  FOR ALL TO authenticated
  USING (public.is_agency_owner_or_admin(agency_id, auth.uid()))
  WITH CHECK (public.is_agency_owner_or_admin(agency_id, auth.uid()));
CREATE POLICY adr_member_select ON public.agency_delegation_requests
  FOR SELECT TO authenticated USING (member_user_id = auth.uid());
CREATE TRIGGER adr_updated_at BEFORE UPDATE ON public.agency_delegation_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- agency_work_items ----------
CREATE TABLE IF NOT EXISTS public.agency_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  assigned_member_user_id uuid,
  client_request_id uuid REFERENCES public.agency_client_requests(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description text,
  type public.agency_work_item_type NOT NULL DEFAULT 'other',
  status public.agency_work_item_status NOT NULL DEFAULT 'open',
  priority public.agency_work_item_priority NOT NULL DEFAULT 'normal',
  due_date date,
  created_by_user_id uuid NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS awi_agency_status_idx ON public.agency_work_items(agency_id, status, due_date);
CREATE INDEX IF NOT EXISTS awi_member_idx ON public.agency_work_items(assigned_member_user_id, status) WHERE assigned_member_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awi_driver_idx ON public.agency_work_items(driver_user_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_work_items TO authenticated;
GRANT ALL ON public.agency_work_items TO service_role;
ALTER TABLE public.agency_work_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY awi_agency_admin_all ON public.agency_work_items
  FOR ALL TO authenticated
  USING (public.is_agency_owner_or_admin(agency_id, auth.uid()))
  WITH CHECK (public.is_agency_owner_or_admin(agency_id, auth.uid()));
CREATE POLICY awi_assigned_member_select ON public.agency_work_items
  FOR SELECT TO authenticated USING (assigned_member_user_id = auth.uid());
CREATE POLICY awi_assigned_member_update ON public.agency_work_items
  FOR UPDATE TO authenticated USING (assigned_member_user_id = auth.uid()) WITH CHECK (assigned_member_user_id = auth.uid());
CREATE POLICY awi_driver_waiting_select ON public.agency_work_items
  FOR SELECT TO authenticated USING (driver_user_id = auth.uid() AND status = 'waiting_on_driver');
CREATE TRIGGER awi_updated_at BEFORE UPDATE ON public.agency_work_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- agency_audit_log ----------
CREATE TABLE IF NOT EXISTS public.agency_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid,
  target_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aal_agency_idx ON public.agency_audit_log(agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aal_driver_idx ON public.agency_audit_log(driver_user_id, created_at DESC) WHERE driver_user_id IS NOT NULL;
GRANT SELECT, INSERT ON public.agency_audit_log TO authenticated;
GRANT ALL ON public.agency_audit_log TO service_role;
ALTER TABLE public.agency_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY aal_agency_admin_select ON public.agency_audit_log
  FOR SELECT TO authenticated USING (public.is_agency_owner_or_admin(agency_id, auth.uid()));
CREATE POLICY aal_driver_select_own ON public.agency_audit_log
  FOR SELECT TO authenticated USING (driver_user_id = auth.uid());

-- =====================================================================
-- RPCs
-- =====================================================================

CREATE OR REPLACE FUNCTION public.clean_assistant_permissions(_p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  _allowed text[] := ARRAY['manage_loads','manage_expenses','manage_fuel',
    'view_reports','export_reports','view_dashboard','manage_settings_limited'];
  _out jsonb := '{}'::jsonb; _k text;
BEGIN
  IF _p IS NULL THEN RETURN _out; END IF;
  FOREACH _k IN ARRAY _allowed LOOP
    IF COALESCE((_p ->> _k)::boolean, false) THEN
      _out := _out || jsonb_build_object(_k, true);
    END IF;
  END LOOP;
  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION public.clean_assistant_permissions(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clean_assistant_permissions(jsonb) TO authenticated;

-- Packages
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

CREATE OR REPLACE FUNCTION public.list_agency_packages_public(_agency_id uuid)
RETURNS SETOF public.agency_service_packages
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.agency_service_packages
   WHERE agency_id = _agency_id AND is_active = true
   ORDER BY sort_order ASC, created_at ASC;
$$;
REVOKE ALL ON FUNCTION public.list_agency_packages_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agency_packages_public(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_agency_public_view(_agency_id uuid)
RETURNS TABLE (id uuid, name text, description text, contact_email text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ap.id, ap.name, ap.description, ap.contact_email, ap.status::text
    FROM public.agency_profiles ap
   WHERE ap.id = _agency_id AND ap.status = 'active';
$$;
REVOKE ALL ON FUNCTION public.get_agency_public_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agency_public_view(uuid) TO authenticated;

-- Client requests
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
REVOKE ALL ON FUNCTION public.submit_agency_client_request(uuid,uuid,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_agency_client_request(uuid,uuid,text,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_agency_client_requests(_agency_id uuid)
RETURNS TABLE (
  id uuid, driver_user_id uuid, driver_email text, driver_name text,
  selected_package_id uuid, package_name text, status public.agency_client_request_status,
  message text, preferred_contact_method text, phone text,
  requested_permissions jsonb, assigned_member_user_id uuid,
  decided_at timestamptz, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.driver_user_id, u.email, p.display_name,
         r.selected_package_id, pk.name,
         r.status, r.message, r.preferred_contact_method, r.phone,
         r.requested_permissions, r.assigned_member_user_id,
         r.decided_at, r.created_at
    FROM public.agency_client_requests r
    LEFT JOIN auth.users u ON u.id = r.driver_user_id
    LEFT JOIN public.profiles p ON p.user_id = r.driver_user_id
    LEFT JOIN public.agency_service_packages pk ON pk.id = r.selected_package_id
   WHERE r.agency_id = _agency_id
     AND public.is_agency_owner_or_admin(_agency_id, auth.uid())
   ORDER BY r.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_agency_client_requests(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agency_client_requests(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_agency_client_requests()
RETURNS TABLE (
  id uuid, agency_id uuid, agency_name text,
  selected_package_id uuid, package_name text,
  status public.agency_client_request_status,
  message text, created_at timestamptz, decided_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.agency_id, ap.name,
         r.selected_package_id, pk.name,
         r.status, r.message, r.created_at, r.decided_at
    FROM public.agency_client_requests r
    JOIN public.agency_profiles ap ON ap.id = r.agency_id
    LEFT JOIN public.agency_service_packages pk ON pk.id = r.selected_package_id
   WHERE r.driver_user_id = auth.uid()
   ORDER BY r.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_my_agency_client_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_agency_client_requests() TO authenticated;

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
  IF _old.driver_user_id = _uid AND _status='cancelled' THEN NULL;
  ELSIF public.is_agency_owner_or_admin(_old.agency_id,_uid) THEN NULL;
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
REVOKE ALL ON FUNCTION public.set_agency_client_request_status(uuid,public.agency_client_request_status,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_agency_client_request_status(uuid,public.agency_client_request_status,uuid) TO authenticated;

-- Delegation
CREATE OR REPLACE FUNCTION public.create_agency_delegation_request(
  _client_request_id uuid, _member_user_id uuid, _requested_permissions jsonb
) RETURNS public.agency_delegation_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _req public.agency_client_requests; _mbr public.agency_members; _clean jsonb; _row public.agency_delegation_requests;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _req FROM public.agency_client_requests WHERE id=_client_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client request not found' USING ERRCODE='42704'; END IF;
  IF NOT public.is_agency_owner_or_admin(_req.agency_id,_uid) THEN
    RAISE EXCEPTION 'Only agency owner/admin can create delegation requests' USING ERRCODE='42501';
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
END $$;
REVOKE ALL ON FUNCTION public.create_agency_delegation_request(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_agency_delegation_request(uuid,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_pending_delegations()
RETURNS TABLE (
  id uuid, agency_id uuid, agency_name text,
  member_user_id uuid, member_email text, member_name text,
  requested_permissions jsonb, client_request_id uuid,
  package_name text, created_at timestamptz, status public.agency_delegation_status
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.agency_id, ap.name,
         d.member_user_id, d.member_invite_email, p.display_name,
         d.requested_permissions, d.client_request_id, pk.name,
         d.created_at, d.status
    FROM public.agency_delegation_requests d
    JOIN public.agency_profiles ap ON ap.id = d.agency_id
    LEFT JOIN public.profiles p ON p.user_id = d.member_user_id
    LEFT JOIN public.agency_client_requests r ON r.id = d.client_request_id
    LEFT JOIN public.agency_service_packages pk ON pk.id = r.selected_package_id
   WHERE d.driver_user_id = auth.uid()
   ORDER BY d.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_my_pending_delegations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_pending_delegations() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_agency_delegations(_agency_id uuid)
RETURNS SETOF public.agency_delegation_requests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.agency_delegation_requests
   WHERE agency_id=_agency_id
     AND public.is_agency_owner_or_admin(_agency_id, auth.uid())
   ORDER BY created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_agency_delegations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agency_delegations(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_decide_delegation(_id uuid, _approve boolean)
RETURNS public.agency_delegation_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _d public.agency_delegation_requests; _da public.driver_assistants; _email_norm text;
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

CREATE OR REPLACE FUNCTION public.list_agency_clients(_agency_id uuid)
RETURNS TABLE (
  driver_user_id uuid, driver_email text, driver_name text,
  member_user_id uuid, member_email text,
  package_id uuid, package_name text,
  last_activity_at timestamptz, delegation_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (d.driver_user_id)
         d.driver_user_id, u.email, p.display_name,
         d.member_user_id, d.member_invite_email,
         r.selected_package_id, pk.name,
         GREATEST(d.decided_at, d.updated_at), d.id
    FROM public.agency_delegation_requests d
    LEFT JOIN auth.users u ON u.id = d.driver_user_id
    LEFT JOIN public.profiles p ON p.user_id = d.driver_user_id
    LEFT JOIN public.agency_client_requests r ON r.id = d.client_request_id
    LEFT JOIN public.agency_service_packages pk ON pk.id = r.selected_package_id
   WHERE d.agency_id=_agency_id AND d.status='approved'
     AND public.is_agency_owner_or_admin(_agency_id, auth.uid())
   ORDER BY d.driver_user_id, d.decided_at DESC NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.list_agency_clients(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agency_clients(uuid) TO authenticated;

-- Work items
CREATE OR REPLACE FUNCTION public.create_agency_work_item(
  _agency_id uuid, _driver_user_id uuid, _title text, _description text,
  _type public.agency_work_item_type, _priority public.agency_work_item_priority,
  _assigned_member_user_id uuid, _client_request_id uuid, _due_date date
) RETURNS public.agency_work_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _row public.agency_work_items;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.is_agency_owner_or_admin(_agency_id,_uid) THEN
    RAISE EXCEPTION 'Only agency owner/admin can create work items' USING ERRCODE='42501';
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
END $$;
REVOKE ALL ON FUNCTION public.create_agency_work_item(uuid,uuid,text,text,public.agency_work_item_type,public.agency_work_item_priority,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_agency_work_item(uuid,uuid,text,text,public.agency_work_item_type,public.agency_work_item_priority,uuid,uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_agency_work_item(
  _id uuid, _status public.agency_work_item_status, _assigned_member_user_id uuid,
  _title text, _description text, _priority public.agency_work_item_priority, _due_date date
) RETURNS public.agency_work_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _old public.agency_work_items; _row public.agency_work_items; _is_admin boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _old FROM public.agency_work_items WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work item not found' USING ERRCODE='42704'; END IF;
  _is_admin := public.is_agency_owner_or_admin(_old.agency_id,_uid);
  IF NOT (_is_admin OR _old.assigned_member_user_id=_uid) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501';
  END IF;
  IF (_assigned_member_user_id IS DISTINCT FROM _old.assigned_member_user_id
      OR (NULLIF(btrim(coalesce(_title,'')),'') IS NOT NULL AND _title<>_old.title))
     AND NOT _is_admin THEN
    RAISE EXCEPTION 'Only agency owner/admin can reassign or rename' USING ERRCODE='42501';
  END IF;
  IF _assigned_member_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id=_old.agency_id AND member_user_id=_assigned_member_user_id AND status='active'
  ) THEN RAISE EXCEPTION 'Assigned member must be an active agency member' USING ERRCODE='22023'; END IF;
  UPDATE public.agency_work_items SET
    status=COALESCE(_status,status),
    assigned_member_user_id=COALESCE(_assigned_member_user_id,assigned_member_user_id),
    title=COALESCE(NULLIF(btrim(_title),''),title),
    description=COALESCE(NULLIF(btrim(coalesce(_description,'')),''),description),
    priority=COALESCE(_priority,priority),
    due_date=COALESCE(_due_date,due_date),
    completed_at=CASE WHEN _status='completed' THEN now() ELSE completed_at END
  WHERE id=_id RETURNING * INTO _row;
  INSERT INTO public.agency_audit_log (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid,_row.agency_id,_row.driver_user_id,_row.assigned_member_user_id,
          CASE
            WHEN _old.assigned_member_user_id IS DISTINCT FROM _row.assigned_member_user_id THEN 'work_item_assigned'
            WHEN _old.status IS DISTINCT FROM _row.status AND _row.status='completed' THEN 'work_item_completed'
            WHEN _old.status IS DISTINCT FROM _row.status THEN 'work_item_status_changed'
            ELSE 'work_item_updated'
          END,
          'agency_work_item',_row.id,
          jsonb_build_object('from_status',_old.status,'to_status',_row.status));
  RETURN _row;
END $$;
REVOKE ALL ON FUNCTION public.update_agency_work_item(uuid,public.agency_work_item_status,uuid,text,text,public.agency_work_item_priority,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_agency_work_item(uuid,public.agency_work_item_status,uuid,text,text,public.agency_work_item_priority,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_agency_work_items(
  _agency_id uuid, _status public.agency_work_item_status DEFAULT NULL,
  _driver_user_id uuid DEFAULT NULL, _assigned_member_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, agency_id uuid, driver_user_id uuid, driver_email text,
  assigned_member_user_id uuid, assigned_member_email text,
  client_request_id uuid, title text, description text,
  type public.agency_work_item_type, status public.agency_work_item_status,
  priority public.agency_work_item_priority, due_date date,
  created_at timestamptz, completed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.agency_id, w.driver_user_id, du.email,
         w.assigned_member_user_id, mu.email,
         w.client_request_id, w.title, w.description, w.type, w.status,
         w.priority, w.due_date, w.created_at, w.completed_at
    FROM public.agency_work_items w
    LEFT JOIN auth.users du ON du.id = w.driver_user_id
    LEFT JOIN auth.users mu ON mu.id = w.assigned_member_user_id
   WHERE w.agency_id=_agency_id
     AND (public.is_agency_owner_or_admin(_agency_id, auth.uid()) OR w.assigned_member_user_id=auth.uid())
     AND (_status IS NULL OR w.status=_status)
     AND (_driver_user_id IS NULL OR w.driver_user_id=_driver_user_id)
     AND (_assigned_member_user_id IS NULL OR w.assigned_member_user_id=_assigned_member_user_id)
   ORDER BY w.due_date NULLS LAST, w.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_agency_work_items(uuid,public.agency_work_item_status,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agency_work_items(uuid,public.agency_work_item_status,uuid,uuid) TO authenticated;

-- Audit readers
CREATE OR REPLACE FUNCTION public.list_agency_audit_log(_agency_id uuid, _limit integer DEFAULT 100)
RETURNS SETOF public.agency_audit_log
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.agency_audit_log
   WHERE agency_id=_agency_id
     AND public.is_agency_owner_or_admin(_agency_id, auth.uid())
   ORDER BY created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(_limit,100),500));
$$;
REVOKE ALL ON FUNCTION public.list_agency_audit_log(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agency_audit_log(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_driver_agency_audit_log(_limit integer DEFAULT 100)
RETURNS SETOF public.agency_audit_log
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.agency_audit_log
   WHERE driver_user_id=auth.uid()
   ORDER BY created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(_limit,100),500));
$$;
REVOKE ALL ON FUNCTION public.list_my_driver_agency_audit_log(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_driver_agency_audit_log(integer) TO authenticated;
