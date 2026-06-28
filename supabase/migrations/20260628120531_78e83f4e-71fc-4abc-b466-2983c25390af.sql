
-- =========================================================
-- Phase 3 cleanup: tighten delegation + work item RPCs
-- =========================================================

-- 1) list_my_pending_delegations: only true pending rows
CREATE OR REPLACE FUNCTION public.list_my_pending_delegations()
 RETURNS TABLE(id uuid, agency_id uuid, agency_name text, member_user_id uuid, member_email text, member_name text, requested_permissions jsonb, client_request_id uuid, package_name text, created_at timestamp with time zone, status public.agency_delegation_status)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     AND d.status = 'pending_driver_approval'
   ORDER BY d.created_at DESC;
$function$;

-- 2) create_agency_delegation_request: reject declined/cancelled/converted client requests
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

-- 3) create_agency_work_item: driver must be an approved client of the agency
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

-- 4) update_agency_work_item: re-verify approved-client status on reassign;
--    driver_user_id is not changeable through this RPC (signature has no
--    _driver_user_id), so reassignment cannot point at an unrelated driver.
CREATE OR REPLACE FUNCTION public.update_agency_work_item(_id uuid, _status public.agency_work_item_status, _assigned_member_user_id uuid, _title text, _description text, _priority public.agency_work_item_priority, _due_date date)
 RETURNS public.agency_work_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Re-verify the work item's driver is still an approved client. Prevents
  -- a stale work item from being mutated against a driver whose delegation
  -- was revoked or never approved.
  IF NOT EXISTS (
    SELECT 1 FROM public.agency_delegation_requests
     WHERE agency_id=_old.agency_id
       AND driver_user_id=_old.driver_user_id
       AND status='approved'
  ) THEN
    RAISE EXCEPTION 'Driver is no longer an approved client of this agency' USING ERRCODE='42501';
  END IF;
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
END $function$;
