-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase AM-1C-E — Agency Work Items permission consumer cutover.
--
-- Work Items become the next AM-1B workspace-permission consumer:
--   * `work_items_view_all` grants BROAD Agency workspace visibility of every
--     work item for that agency.
--   * `work_items_manage` grants Agency-side create + full management
--     (including rename/reassign) of any work item.
--   * Neither permission implies the other. Role labels (`agency_admin`,
--     `agency_member`) grant no Work Item authority by themselves.
--
-- Preserved untouched, structurally and behaviorally:
--   * The narrow assigned-member visibility branch (assigned member of an
--     active membership sees only their own items, with no workspace
--     permission required).
--   * The assigned-member limited self-service update path, including
--     `is_agency_member`, the `_positive` mutation test, and
--     `_agency_member_paid_operational_authority`.
--   * Driver waiting-on-driver / recent-response read paths and the driver
--     response RPC.
--
-- Agency workspace permission NEVER grants driver-account access. Any action
-- inside a driver's account still requires the exact driver-approved
-- delegation and exact Driver Assistant permission enforced elsewhere.

BEGIN;

-- ---------------------------------------------------------------------------
-- A) list_agency_work_items — broad branch becomes `work_items_view_all`.
--    Signature, defaults, return columns/order/types, language, volatility,
--    security, search_path, joins, filters and ordering are unchanged. Only
--    the broad owner/admin predicate is replaced. The narrow assigned-member
--    branch is preserved exactly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_agency_work_items(_agency_id uuid, _status agency_work_item_status DEFAULT NULL::agency_work_item_status, _driver_user_id uuid DEFAULT NULL::uuid, _assigned_member_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, agency_id uuid, driver_user_id uuid, driver_email text, assigned_member_user_id uuid, assigned_member_email text, client_request_id uuid, title text, description text, type agency_work_item_type, status agency_work_item_status, priority agency_work_item_priority, due_date date, created_at timestamp with time zone, completed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT w.id,w.agency_id,w.driver_user_id,du.email,w.assigned_member_user_id,mu.email,w.client_request_id,w.title,w.description,w.type,w.status,w.priority,w.due_date,w.created_at,w.completed_at FROM public.agency_work_items w LEFT JOIN auth.users du ON du.id=w.driver_user_id LEFT JOIN auth.users mu ON mu.id=w.assigned_member_user_id WHERE w.agency_id=_agency_id AND (public.current_user_has_agency_permission(_agency_id,'work_items_view_all') OR (w.assigned_member_user_id=auth.uid() AND public.is_agency_member(_agency_id,auth.uid()))) AND (_status IS NULL OR w.status=_status) AND (_driver_user_id IS NULL OR w.driver_user_id=_driver_user_id) AND (_assigned_member_user_id IS NULL OR w.assigned_member_user_id=_assigned_member_user_id) ORDER BY w.due_date NULLS LAST,w.created_at DESC; $function$;

-- ---------------------------------------------------------------------------
-- B) create_agency_work_item — Agency-side creation becomes
--    `work_items_manage`. Plan limit, approved-client validation, active
--    assigned-member validation, paid operational authority, INSERT payload,
--    audit payload, return shape and every error code are unchanged.
--    `work_items_view_all` is NOT required.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agency_work_item(_agency_id uuid, _driver_user_id uuid, _title text, _description text, _type agency_work_item_type, _priority agency_work_item_priority, _assigned_member_user_id uuid, _client_request_id uuid, _due_date date)
 RETURNS agency_work_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE _uid uuid:=auth.uid(); _row public.agency_work_items; BEGIN IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF; IF NOT public.current_user_has_agency_permission(_agency_id,'work_items_manage') THEN RAISE EXCEPTION 'You do not have permission to manage work items for this agency' USING ERRCODE='42501'; END IF; PERFORM public.assert_agency_limit(_agency_id,'create_work_item'); IF NOT EXISTS(SELECT 1 FROM public.agency_delegation_requests WHERE agency_id=_agency_id AND driver_user_id=_driver_user_id AND status='approved') THEN RAISE EXCEPTION 'Driver is not an approved client of this agency' USING ERRCODE='42501'; END IF; IF _assigned_member_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agency_members WHERE agency_id=_agency_id AND member_user_id=_assigned_member_user_id AND status='active') THEN RAISE EXCEPTION 'Assigned member must be an active agency member' USING ERRCODE='22023'; END IF; IF _assigned_member_user_id IS NOT NULL AND NOT public._agency_member_paid_operational_authority(_agency_id,_assigned_member_user_id) THEN RAISE EXCEPTION 'Assigned member cannot take on work under this agency plan' USING ERRCODE='22023'; END IF; INSERT INTO public.agency_work_items(agency_id,driver_user_id,assigned_member_user_id,client_request_id,title,description,type,priority,due_date,created_by_user_id) VALUES(_agency_id,_driver_user_id,_assigned_member_user_id,_client_request_id,btrim(_title),NULLIF(btrim(coalesce(_description,'')),''),COALESCE(_type,'other'::public.agency_work_item_type),COALESCE(_priority,'normal'::public.agency_work_item_priority),_due_date,_uid) RETURNING * INTO _row; INSERT INTO public.agency_audit_log(actor_user_id,agency_id,driver_user_id,target_user_id,action,entity_type,entity_id,metadata) VALUES(_uid,_agency_id,_driver_user_id,_assigned_member_user_id,'work_item_created','agency_work_item',_row.id,jsonb_build_object('title',_row.title,'type',_row.type,'priority',_row.priority)); RETURN _row; END $function$;

-- ---------------------------------------------------------------------------
-- C) update_agency_work_item — full-management authority becomes
--    `work_items_manage` (local `_is_admin` renamed `_can_manage_work_items`).
--    The initial allowed branch remains "full manager OR exact assigned
--    member". Reassign/rename still require full management. The exact
--    assigned member without `work_items_manage` keeps the identical limited
--    self-service path (`is_agency_member`, `_positive`, paid operational
--    authority). `work_items_view_all` is NOT required anywhere here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_agency_work_item(_id uuid, _status agency_work_item_status, _assigned_member_user_id uuid, _title text, _description text, _priority agency_work_item_priority, _due_date date)
 RETURNS agency_work_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE _uid uuid:=auth.uid(); _old public.agency_work_items; _row public.agency_work_items; _can_manage_work_items boolean; _is_assigned boolean; _reassigning boolean; _renaming boolean; _positive boolean; BEGIN IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF; SELECT * INTO _old FROM public.agency_work_items WHERE id=_id; IF NOT FOUND THEN RAISE EXCEPTION 'Work item not found' USING ERRCODE='42704'; END IF; _can_manage_work_items:=public.current_user_has_agency_permission(_old.agency_id,'work_items_manage'); _is_assigned:=(_old.assigned_member_user_id=_uid); IF NOT (_can_manage_work_items OR _is_assigned) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF; _reassigning:=(_assigned_member_user_id IS NOT NULL AND _assigned_member_user_id IS DISTINCT FROM _old.assigned_member_user_id); _renaming:=(NULLIF(btrim(coalesce(_title,'')),'') IS NOT NULL AND _title<>_old.title); IF (_reassigning OR _renaming) AND NOT _can_manage_work_items THEN RAISE EXCEPTION 'You do not have permission to reassign or rename work items' USING ERRCODE='42501'; END IF; IF _is_assigned AND NOT _can_manage_work_items THEN IF NOT public.is_agency_member(_old.agency_id,_uid) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF; _positive:=(_status IS NOT NULL AND _status NOT IN ('cancelled')) OR _priority IS NOT NULL OR _due_date IS NOT NULL OR NULLIF(btrim(coalesce(_description,'')),'') IS NOT NULL; IF _positive AND NOT public._agency_member_paid_operational_authority(_old.agency_id,_uid) THEN RAISE EXCEPTION 'Your agency workspace cannot perform this action right now' USING ERRCODE='P0001'; END IF; END IF; IF _reassigning AND NOT EXISTS(SELECT 1 FROM public.agency_members WHERE agency_id=_old.agency_id AND member_user_id=_assigned_member_user_id AND status='active') THEN RAISE EXCEPTION 'Assigned member must be an active agency member' USING ERRCODE='22023'; END IF; IF _reassigning AND NOT public._agency_member_paid_operational_authority(_old.agency_id,_assigned_member_user_id) THEN RAISE EXCEPTION 'Assigned member cannot take on work under this agency plan' USING ERRCODE='22023'; END IF; IF NOT EXISTS(SELECT 1 FROM public.agency_delegation_requests WHERE agency_id=_old.agency_id AND driver_user_id=_old.driver_user_id AND status='approved') THEN RAISE EXCEPTION 'Driver is no longer an approved client of this agency' USING ERRCODE='42501'; END IF; UPDATE public.agency_work_items SET status=COALESCE(_status,status),assigned_member_user_id=CASE WHEN _reassigning THEN _assigned_member_user_id ELSE assigned_member_user_id END,title=COALESCE(NULLIF(btrim(_title),''),title),description=COALESCE(NULLIF(btrim(coalesce(_description,'')),''),description),priority=COALESCE(_priority,priority),due_date=COALESCE(_due_date,due_date),completed_at=CASE WHEN _status='completed' THEN now() ELSE completed_at END WHERE id=_id RETURNING * INTO _row; INSERT INTO public.agency_audit_log(actor_user_id,agency_id,driver_user_id,target_user_id,action,entity_type,entity_id,metadata) VALUES(_uid,_row.agency_id,_row.driver_user_id,_row.assigned_member_user_id,CASE WHEN _old.assigned_member_user_id IS DISTINCT FROM _row.assigned_member_user_id THEN 'work_item_assigned' WHEN _old.status IS DISTINCT FROM _row.status AND _row.status='completed' THEN 'work_item_completed' WHEN _old.status IS DISTINCT FROM _row.status THEN 'work_item_status_changed' ELSE 'work_item_updated' END,'agency_work_item',_row.id,jsonb_build_object('from_status',_old.status,'to_status',_row.status)); RETURN _row; END $function$;

-- ---------------------------------------------------------------------------
-- D) SELECT RLS — replace only the role-derived broad policy.
--    `awi_assigned_member_select`, `awi_driver_waiting_select` and
--    `awi_driver_responded_select` are intentionally left untouched.
--    No INSERT/UPDATE/DELETE/ALL policy is added and no grants change.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS awi_agency_admin_select ON public.agency_work_items;

CREATE POLICY awi_workspace_view_all_select
  ON public.agency_work_items
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_agency_permission(agency_id,'work_items_view_all'));

COMMIT;
