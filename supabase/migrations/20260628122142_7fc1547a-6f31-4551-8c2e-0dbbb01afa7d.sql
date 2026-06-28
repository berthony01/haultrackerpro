
-- =========================================================
-- Phase 3 SECURITY HARDENING: lock down direct table writes
-- =========================================================
-- All write paths for these three tables now flow through
-- SECURITY DEFINER RPCs that enforce workflow + approval rules.
-- SELECT policies are preserved so the UI can keep reading.
-- Service role retains full access by virtue of bypass.

-- ---------- agency_client_requests ----------
DROP POLICY IF EXISTS acr_agency_admin_all ON public.agency_client_requests;
DROP POLICY IF EXISTS acr_driver_cancel_own ON public.agency_client_requests;
DROP POLICY IF EXISTS acr_driver_insert_self ON public.agency_client_requests;

-- Read-only policies for admins (driver + assigned-member selects already exist)
CREATE POLICY acr_agency_admin_select ON public.agency_client_requests
  FOR SELECT TO authenticated
  USING (public.is_agency_owner_or_admin(agency_id, auth.uid()));

-- ---------- agency_delegation_requests ----------
DROP POLICY IF EXISTS adr_agency_admin_all ON public.agency_delegation_requests;
DROP POLICY IF EXISTS adr_driver_update_own ON public.agency_delegation_requests;

CREATE POLICY adr_agency_admin_select ON public.agency_delegation_requests
  FOR SELECT TO authenticated
  USING (public.is_agency_owner_or_admin(agency_id, auth.uid()));

-- ---------- agency_work_items ----------
DROP POLICY IF EXISTS awi_agency_admin_all ON public.agency_work_items;
DROP POLICY IF EXISTS awi_assigned_member_update ON public.agency_work_items;

CREATE POLICY awi_agency_admin_select ON public.agency_work_items
  FOR SELECT TO authenticated
  USING (public.is_agency_owner_or_admin(agency_id, auth.uid()));

-- =========================================================
-- update_agency_work_item: allow assigned-member status updates
-- without being treated as a reassignment when _assigned_member
-- is omitted (NULL). driver_user_id remains immutable.
-- =========================================================
CREATE OR REPLACE FUNCTION public.update_agency_work_item(
  _id uuid,
  _status public.agency_work_item_status,
  _assigned_member_user_id uuid,
  _title text,
  _description text,
  _priority public.agency_work_item_priority,
  _due_date date
) RETURNS public.agency_work_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _old public.agency_work_items;
  _row public.agency_work_items;
  _is_admin boolean;
  _is_assigned boolean;
  _reassigning boolean;
  _renaming boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _old FROM public.agency_work_items WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work item not found' USING ERRCODE='42704'; END IF;

  _is_admin    := public.is_agency_owner_or_admin(_old.agency_id, _uid);
  _is_assigned := (_old.assigned_member_user_id = _uid);

  IF NOT (_is_admin OR _is_assigned) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501';
  END IF;

  -- Treat NULL as "no change" so assigned members can patch status / due_date
  -- without inadvertently looking like a reassignment.
  _reassigning := (_assigned_member_user_id IS NOT NULL
                   AND _assigned_member_user_id IS DISTINCT FROM _old.assigned_member_user_id);
  _renaming    := (NULLIF(btrim(coalesce(_title,'')),'') IS NOT NULL
                   AND _title <> _old.title);

  IF (_reassigning OR _renaming) AND NOT _is_admin THEN
    RAISE EXCEPTION 'Only agency owner/admin can reassign or rename' USING ERRCODE='42501';
  END IF;

  IF _reassigning AND NOT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id=_old.agency_id
       AND member_user_id=_assigned_member_user_id
       AND status='active'
  ) THEN
    RAISE EXCEPTION 'Assigned member must be an active agency member' USING ERRCODE='22023';
  END IF;

  -- Re-verify the driver is still an approved client of this agency.
  IF NOT EXISTS (
    SELECT 1 FROM public.agency_delegation_requests
     WHERE agency_id=_old.agency_id
       AND driver_user_id=_old.driver_user_id
       AND status='approved'
  ) THEN
    RAISE EXCEPTION 'Driver is no longer an approved client of this agency' USING ERRCODE='42501';
  END IF;

  UPDATE public.agency_work_items SET
    status                  = COALESCE(_status, status),
    assigned_member_user_id = CASE WHEN _reassigning THEN _assigned_member_user_id
                                   ELSE assigned_member_user_id END,
    title                   = COALESCE(NULLIF(btrim(_title),''), title),
    description             = COALESCE(NULLIF(btrim(coalesce(_description,'')),''), description),
    priority                = COALESCE(_priority, priority),
    due_date                = COALESCE(_due_date, due_date),
    completed_at            = CASE WHEN _status='completed' THEN now() ELSE completed_at END
  WHERE id=_id RETURNING * INTO _row;

  INSERT INTO public.agency_audit_log
    (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, _row.agency_id, _row.driver_user_id, _row.assigned_member_user_id,
          CASE
            WHEN _old.assigned_member_user_id IS DISTINCT FROM _row.assigned_member_user_id THEN 'work_item_assigned'
            WHEN _old.status IS DISTINCT FROM _row.status AND _row.status='completed' THEN 'work_item_completed'
            WHEN _old.status IS DISTINCT FROM _row.status THEN 'work_item_status_changed'
            ELSE 'work_item_updated'
          END,
          'agency_work_item', _row.id,
          jsonb_build_object('from_status', _old.status, 'to_status', _row.status));
  RETURN _row;
END $function$;

-- =========================================================
-- revoke_agency_delegation: driver or agency admin can end
-- delegation. Also revokes the matching driver_assistants row.
-- =========================================================
CREATE OR REPLACE FUNCTION public.revoke_agency_delegation(_delegation_id uuid)
RETURNS public.agency_delegation_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _d public.agency_delegation_requests;
  _is_driver boolean;
  _is_admin boolean;
  _da public.driver_assistants;
  _email_norm text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _d FROM public.agency_delegation_requests WHERE id=_delegation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delegation not found' USING ERRCODE='42704'; END IF;

  _is_driver := (_d.driver_user_id = _uid);
  _is_admin  := public.is_agency_owner_or_admin(_d.agency_id, _uid);
  IF NOT (_is_driver OR _is_admin) THEN
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

REVOKE EXECUTE ON FUNCTION public.revoke_agency_delegation(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revoke_agency_delegation(uuid) TO authenticated;

-- =========================================================
-- revoke_assistant: sync matching agency_delegation_requests row.
-- =========================================================
CREATE OR REPLACE FUNCTION public.revoke_assistant(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.driver_assistants;
  _email_norm text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;

  UPDATE public.driver_assistants
     SET status='revoked', revoked_at=now(),
         invite_token_hash=NULL, updated_at=now()
   WHERE id=_id AND driver_user_id=_uid
  RETURNING * INTO _row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assistant not found' USING ERRCODE='P0002'; END IF;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES (_row.id, _uid, COALESCE(_row.assistant_user_id, _uid),
          'assistant_revoked', 'driver_assistants', _row.id, '{}'::jsonb);

  -- Sync any matching active/pending agency delegations.
  _email_norm := lower(btrim(coalesce(_row.invite_email, '')));
  UPDATE public.agency_delegation_requests d
     SET status='revoked', decided_at=COALESCE(decided_at, now())
   WHERE d.driver_user_id = _uid
     AND d.status IN ('approved','pending_driver_approval')
     AND (
       (_row.assistant_user_id IS NOT NULL AND d.member_user_id = _row.assistant_user_id)
       OR (_email_norm <> '' AND lower(coalesce(d.member_invite_email,'')) = _email_norm)
     );
END $function$;
