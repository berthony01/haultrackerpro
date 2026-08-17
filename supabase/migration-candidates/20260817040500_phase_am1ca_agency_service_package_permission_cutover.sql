-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase AM-1C-A — Agency Service Package permission consumer cutover.
--
-- Scope: SERVICE PACKAGES ONLY. This is the first operational consumer of the
-- AM-1B Agency workspace permission contract.
--   * create/update package RPCs authorize through
--     public.current_user_has_agency_permission(_agency_id,'packages_manage')
--     instead of the broad public.is_agency_owner_or_admin gate.
--   * Authenticated workspace SELECT visibility of agency_service_packages
--     requires 'packages_view'.
--
-- 'packages_manage' does NOT imply 'packages_view'. The two permissions stay
-- independent: a manage-only member may create/update through the SECURITY
-- DEFINER RPCs but gains no direct table visibility.
--
-- Canonical Agency owner behavior is functionally unchanged because
-- current_user_has_agency_permission grants the canonical owner every
-- workspace permission implicitly. Role labels (agency_admin/agency_member)
-- grant nothing by themselves.
--
-- NOT CHANGED here: public.is_agency_owner_or_admin (retained for consumers
-- not yet cut over), the AM-1B resolver/getter/setter, public driver package
-- discovery via public.list_agency_packages_public, agency billing/plan
-- enforcement via assert_agency_limit, table grants, and every other Agency,
-- Driver Assistant, delegation, team, client-request, work-item, audit,
-- recruiter, Stripe or settlement surface.
--
-- Agency workspace permission does NOT grant driver-account access; driver
-- data still requires an exact driver-approved delegation.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Package mutation RPCs — authorization gate cutover only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agency_package(
  _agency_id uuid,
  _name text,
  _description text,
  _price_display_text text,
  _billing_frequency_display_text text,
  _included_services jsonb,
  _recommended_permissions jsonb,
  _sort_order integer DEFAULT 0
)
RETURNS public.agency_service_packages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _row public.agency_service_packages;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  -- AM-1C-A: exact permission gate. No role shortcut.
  IF NOT public.current_user_has_agency_permission(_agency_id, 'packages_manage') THEN
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
END $function$;

CREATE OR REPLACE FUNCTION public.update_agency_package(
  _id uuid,
  _name text,
  _description text,
  _price_display_text text,
  _billing_frequency_display_text text,
  _included_services jsonb,
  _recommended_permissions jsonb,
  _is_active boolean,
  _sort_order integer
)
RETURNS public.agency_service_packages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _row public.agency_service_packages; _old public.agency_service_packages;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _old FROM public.agency_service_packages WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Package not found' USING ERRCODE='42704'; END IF;
  -- AM-1C-A: exact permission gate. No role shortcut.
  IF NOT public.current_user_has_agency_permission(_old.agency_id, 'packages_manage') THEN
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
END $function$;

-- ---------------------------------------------------------------------------
-- B. Authenticated package SELECT RLS cutover
--    Replaces the two broad workspace policies with ONE deterministic
--    permission-gated policy. Mutations stay in SECURITY DEFINER RPCs, so no
--    INSERT/UPDATE/DELETE policy is added. Public driver discovery is
--    untouched.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS asp_member_select ON public.agency_service_packages;
DROP POLICY IF EXISTS asp_owner_admin_select ON public.agency_service_packages;

CREATE POLICY asp_packages_view_select
  ON public.agency_service_packages
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_agency_permission(agency_id, 'packages_view'));

COMMIT;
