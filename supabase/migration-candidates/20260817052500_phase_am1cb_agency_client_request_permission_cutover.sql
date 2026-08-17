-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase AM-1C-B — Agency Client Request permission consumer cutover.
--
-- Scope: CLIENT REQUESTS ONLY. This is the second operational consumer of the
-- AM-1B Agency workspace permission contract.
--   * Broad listing (public.list_agency_client_requests) requires
--     'client_requests_view'.
--   * Agency-side direct request workflow
--     (public.set_agency_client_request_status) requires
--     'client_requests_manage'.
--   * Broad authenticated SELECT visibility of agency_client_requests requires
--     'client_requests_view'.
--
-- 'client_requests_manage' does NOT imply 'client_requests_view'. The two
-- permissions stay independent.
--
-- Canonical Agency owner behavior is functionally unchanged because
-- current_user_has_agency_permission grants the canonical owner every
-- workspace permission implicitly. Role labels (agency_admin/agency_member)
-- grant nothing by themselves.
--
-- PRESERVED EXACTLY: the driver self-cancel branch (drivers never need Agency
-- workspace permission to cancel their own request), the narrow
-- acr_assigned_member_select policy (an assigned active member still reads only
-- their exact assigned request), acr_driver_self_select, assignment validation,
-- public._agency_member_paid_operational_authority, assert_agency_limit
-- (...,'progress_client_request'), UPDATE semantics, audit writes, error codes
-- and payload shapes.
--
-- NOT CHANGED here: public.submit_agency_client_request,
-- public.create_agency_delegation_request (delegation authorization is a later,
-- separate consumer cutover — client_requests_manage is NOT delegation
-- authority), public.is_agency_owner_or_admin, the AM-1B
-- resolver/getter/setter, the AM-1C-A package objects, and every other Agency,
-- Driver Assistant, work-item, client, audit, team, recruiter, Stripe or
-- settlement surface. No table grants change and no DML policy is added.
--
-- Agency workspace permission does NOT grant driver-account access; driver
-- data still requires an exact driver-approved delegation.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Broad client-request listing — authorization gate cutover only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_agency_client_requests(_agency_id uuid)
RETURNS TABLE(
  id uuid,
  driver_user_id uuid,
  driver_email text,
  driver_name text,
  selected_package_id uuid,
  package_name text,
  status agency_client_request_status,
  message text,
  preferred_contact_method text,
  phone text,
  requested_permissions jsonb,
  assigned_member_user_id uuid,
  decided_at timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
     AND public.current_user_has_agency_permission(_agency_id,'client_requests_view')
   ORDER BY r.created_at DESC;
$function$;

-- ---------------------------------------------------------------------------
-- B. Agency-side direct request workflow — authorization gate cutover only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_agency_client_request_status(
  _id uuid,
  _status agency_client_request_status,
  _assigned_member_user_id uuid DEFAULT NULL::uuid
)
RETURNS agency_client_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.agency_client_requests;
  _old public.agency_client_requests;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501';
  END IF;

  SELECT * INTO _old FROM public.agency_client_requests WHERE id=_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE='42704';
  END IF;

  -- Driver self-cancel stays first and independent of Agency workspace
  -- permission.
  IF _old.driver_user_id=_uid AND _status='cancelled' AND _assigned_member_user_id IS NULL THEN
    NULL;
  ELSIF public.current_user_has_agency_permission(_old.agency_id,'client_requests_manage') THEN
    IF _status NOT IN ('declined','cancelled') OR _assigned_member_user_id IS NOT NULL THEN
      PERFORM public.assert_agency_limit(_old.agency_id,'progress_client_request');
    END IF;
  ELSE
    RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501';
  END IF;

  IF _assigned_member_user_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.agency_members
     WHERE agency_id=_old.agency_id
       AND member_user_id=_assigned_member_user_id
       AND status='active'
  ) THEN
    RAISE EXCEPTION 'Assigned member must be an active agency member' USING ERRCODE='22023';
  END IF;

  IF _assigned_member_user_id IS NOT NULL AND NOT public._agency_member_paid_operational_authority(_old.agency_id,_assigned_member_user_id) THEN
    RAISE EXCEPTION 'Assigned member cannot take on client work under this agency plan' USING ERRCODE='22023';
  END IF;

  UPDATE public.agency_client_requests
     SET status=_status,
         assigned_member_user_id=COALESCE(_assigned_member_user_id,assigned_member_user_id),
         decided_at=now(),
         decided_by_user_id=_uid
   WHERE id=_id
   RETURNING * INTO _row;

  INSERT INTO public.agency_audit_log(actor_user_id,agency_id,driver_user_id,action,entity_type,entity_id,metadata)
  VALUES(_uid,_row.agency_id,_row.driver_user_id,'client_request_'||_status::text,'agency_client_request',_row.id,jsonb_build_object('assigned_member_user_id',_row.assigned_member_user_id));

  RETURN _row;
END
$function$;

-- ---------------------------------------------------------------------------
-- C. Broad authenticated SELECT visibility cutover
--    acr_assigned_member_select and acr_driver_self_select are preserved
--    untouched. No DML policy is added.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS acr_agency_admin_select ON public.agency_client_requests;

CREATE POLICY acr_workspace_view_select
  ON public.agency_client_requests
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_agency_permission(agency_id,'client_requests_view'));

COMMIT;
