-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase AM-1C-D — Agency Delegations permission consumer cutover.
--
-- Delegations become the next AM-1B workspace permission consumer:
--   * `delegations_view`   -> broad Agency workspace visibility of delegation requests
--   * `delegations_manage` -> Agency-side creation and Agency-side revocation
--
-- `delegations_manage` does NOT imply `delegations_view`. Role labels
-- (`agency_admin` / `agency_member`) grant no delegation authority after this
-- cutover; the canonical Agency owner stays implicitly authorized inside
-- `current_user_has_agency_permission`.
--
-- Driver self-view, driver self-revoke and driver decision paths are untouched
-- and never require Agency workspace permission. Agency workspace permission
-- NEVER grants driver-account use: an exact driver-approved delegation and the
-- Driver Assistant permission model remain separate.

BEGIN;

-- ---------------------------------------------------------------------------
-- A) Broad Agency-side delegation listing -> `delegations_view`
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_agency_delegations(_agency_id uuid)
 RETURNS SETOF agency_delegation_requests
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.agency_delegation_requests
   WHERE agency_id=_agency_id
     AND public.current_user_has_agency_permission(_agency_id,'delegations_view')
   ORDER BY created_at DESC;
$function$;

-- ---------------------------------------------------------------------------
-- B) Agency-side delegation creation -> `delegations_manage`
--    Everything else (plan limit, allowed request statuses, active-member
--    validation, paid operational authority, permission cleaning, INSERT
--    payload, client-request transition/assignment, audit, return shape) is
--    preserved byte-for-byte in behavior.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agency_delegation_request(_client_request_id uuid, _member_user_id uuid, _requested_permissions jsonb)
 RETURNS agency_delegation_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE _uid uuid:=auth.uid(); _req public.agency_client_requests; _mbr public.agency_members; _clean jsonb; _row public.agency_delegation_requests; BEGIN IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF; SELECT * INTO _req FROM public.agency_client_requests WHERE id=_client_request_id; IF NOT FOUND THEN RAISE EXCEPTION 'Client request not found' USING ERRCODE='42704'; END IF; IF NOT public.current_user_has_agency_permission(_req.agency_id,'delegations_manage') THEN RAISE EXCEPTION 'Delegation management permission is required to create delegation requests' USING ERRCODE='42501'; END IF; PERFORM public.assert_agency_limit(_req.agency_id,'create_delegation_request'); IF _req.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'Cannot create delegation for a % client request',_req.status USING ERRCODE='22023'; END IF; SELECT * INTO _mbr FROM public.agency_members WHERE agency_id=_req.agency_id AND member_user_id=_member_user_id AND status='active'; IF NOT FOUND THEN RAISE EXCEPTION 'Selected member must be an active agency member with a verified account' USING ERRCODE='22023'; END IF; IF NOT public._agency_member_paid_operational_authority(_req.agency_id,_mbr.member_user_id) THEN RAISE EXCEPTION 'Selected member cannot take on client work under this agency plan' USING ERRCODE='22023'; END IF; _clean:=public.clean_assistant_permissions(_requested_permissions); INSERT INTO public.agency_delegation_requests(agency_id,client_request_id,driver_user_id,member_user_id,member_invite_email,requested_permissions,created_by_user_id) VALUES(_req.agency_id,_req.id,_req.driver_user_id,_mbr.member_user_id,_mbr.invite_email,_clean,_uid) RETURNING * INTO _row; UPDATE public.agency_client_requests SET status='approved',decided_at=now(),decided_by_user_id=_uid,assigned_member_user_id=_mbr.member_user_id WHERE id=_req.id AND status IN ('pending','approved'); INSERT INTO public.agency_audit_log(actor_user_id,agency_id,driver_user_id,target_user_id,action,entity_type,entity_id,metadata) VALUES(_uid,_req.agency_id,_req.driver_user_id,_mbr.member_user_id,'delegation_request_created','agency_delegation_request',_row.id,jsonb_build_object('client_request_id',_req.id,'permissions',_clean)); RETURN _row; END $function$;

-- ---------------------------------------------------------------------------
-- C) Revocation: Agency-side -> `delegations_manage`; driver self-revoke stays
--    an independent branch requiring no Agency workspace permission.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_agency_delegation(_delegation_id uuid)
 RETURNS agency_delegation_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _d public.agency_delegation_requests;
  _is_driver boolean;
  _can_manage_delegations boolean;
  _da public.driver_assistants;
  _email_norm text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _d FROM public.agency_delegation_requests WHERE id=_delegation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delegation not found' USING ERRCODE='42704'; END IF;

  -- Driver self-revoke is evaluated first and independently: it never consults
  -- Agency workspace permission.
  _is_driver := (_d.driver_user_id = _uid);
  _can_manage_delegations := public.current_user_has_agency_permission(_d.agency_id,'delegations_manage');
  IF NOT (_is_driver OR _can_manage_delegations) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501';
  END IF;

  IF _d.status = 'revoked' THEN RETURN _d; END IF;

  UPDATE public.agency_delegation_requests
     SET status='revoked', decided_at=COALESCE(decided_at, now())
   WHERE id=_delegation_id RETURNING * INTO _d;

  -- Sync the matching driver_assistants row (if it exists & is still active).
  _email_norm := lower(btrim(coalesce(_d.member_invite_email, '')));
  UPDATE public.driver_assistants
     SET status='revoked', revoked_at=now(), invite_token_hash=NULL, updated_at=now()
   WHERE driver_user_id = _d.driver_user_id
     AND status IN ('active','pending')
     AND (
       (_d.member_user_id IS NOT NULL AND assistant_user_id = _d.member_user_id)
       OR (_email_norm <> '' AND lower(invite_email) = _email_norm)
     )
   RETURNING * INTO _da;

  INSERT INTO public.agency_audit_log
    (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, _d.agency_id, _d.driver_user_id, _d.member_user_id,
          CASE WHEN _is_driver THEN 'delegation_revoked_by_driver'
               ELSE 'delegation_revoked_by_agency' END,
          'agency_delegation_request', _d.id,
          jsonb_build_object('synced_assistant_id', _da.id));

  IF _da.id IS NOT NULL THEN
    INSERT INTO public.assistant_audit_log
      (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
    VALUES (_da.id, _d.driver_user_id, COALESCE(_d.member_user_id, _da.assistant_user_id, _d.driver_user_id),
            'assistant_revoked', 'driver_assistants', _da.id,
            jsonb_build_object('agency_id', _d.agency_id, 'delegation_id', _d.id));
  END IF;

  RETURN _d;
END $function$;

-- ---------------------------------------------------------------------------
-- D) Delegation SELECT RLS: replace the role-label broad policy with the
--    `delegations_view` workspace-permission policy. The driver policy and the
--    narrow assigned-member policy are untouched. No DML policy is added and
--    no grant changes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS adr_agency_admin_select ON public.agency_delegation_requests;

CREATE POLICY adr_workspace_view_select
  ON public.agency_delegation_requests
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_agency_permission(agency_id,'delegations_view'));

COMMIT;
