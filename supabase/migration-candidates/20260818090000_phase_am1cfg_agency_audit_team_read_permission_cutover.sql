-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase AM-1C-FG — Agency Audit + Team READ-ONLY workspace-permission cutover.
--
-- Scope: read authorization ONLY for the Agency activity log and the SAFE
-- Agency member listing. This phase introduces no write authority whatsoever.
--
-- Locked contract:
--   * `audit_view` grants broad read of the Agency activity log.
--   * `team_view` grants broad read of the SAFE member projection only.
--   * A non-holder keeps the exact self-membership read path.
--   * Canonical Agency owner remains implicitly authorized through
--     `public.current_user_has_agency_permission`; role labels
--     (`agency_admin` / `agency_member`) grant nothing after this cutover.
--   * There is deliberately NO `team_manage` permission. Invitation,
--     revocation and permission assignment stay canonical-owner-only through
--     the frozen `invite_agency_member`, `revoke_agency_member` and
--     `set_agency_member_permissions` RPCs, which this migration does not
--     touch.
--   * Agency workspace permission NEVER grants driver-account access. Driver
--     data still requires an exact driver-approved Driver Assistant
--     delegation.
--
-- Deliberate least-privilege note (section D): no broad `team_view` policy is
-- created on `public.agency_members`. That table carries internal fields
-- (invite token hashes, raw workspace-permission JSON) that the SAFE
-- `list_agency_members` projection intentionally omits. `team_view` therefore
-- broadens the safe RPC projection only, never raw table-wide SELECT.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Agency activity log listing — broad gate becomes `audit_view`
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_agency_audit_log(_agency_id uuid, _limit integer DEFAULT 100)
 RETURNS SETOF agency_audit_log
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.agency_audit_log
   WHERE agency_id=_agency_id
     AND public.current_user_has_agency_permission(_agency_id,'audit_view')
   ORDER BY created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(_limit,100),500));
$function$;

-- ---------------------------------------------------------------------------
-- B. SAFE Agency member listing — `team_view` OR exact self membership
-- ---------------------------------------------------------------------------
-- Projection is unchanged and intentionally excludes invite_token_hash,
-- invite_expires_at, workspace_permissions and all created/updated internals.
CREATE OR REPLACE FUNCTION public.list_agency_members(_agency_id uuid)
 RETURNS TABLE(id uuid, agency_id uuid, member_user_id uuid, invite_email text, role agency_member_role, status agency_member_status, invited_at timestamp with time zone, accepted_at timestamp with time zone, revoked_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT am.id, am.agency_id, am.member_user_id, am.invite_email, am.role, am.status,
         am.invited_at, am.accepted_at, am.revoked_at
    FROM public.agency_members am
   WHERE am.agency_id=_agency_id
     AND (public.current_user_has_agency_permission(_agency_id,'team_view')
          OR am.member_user_id=auth.uid())
   ORDER BY am.invited_at DESC;
$function$;

-- ---------------------------------------------------------------------------
-- C. Activity log SELECT RLS — broad role policy replaced by `audit_view`
-- ---------------------------------------------------------------------------
-- `aal_driver_select_own` is preserved untouched.
DROP POLICY IF EXISTS aal_agency_admin_select ON public.agency_audit_log;

CREATE POLICY aal_workspace_audit_view_select
  ON public.agency_audit_log
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_agency_permission(agency_id,'audit_view'));

-- ---------------------------------------------------------------------------
-- D. Member table SELECT RLS — broad role policy removed, NOT replaced
-- ---------------------------------------------------------------------------
-- Intentional least privilege: no broad `team_view` table policy is created.
-- Broad Team visibility is delivered exclusively through the SAFE
-- SECURITY DEFINER `list_agency_members` RPC above. Direct table SELECT stays
-- limited to the preserved exact self-membership policy.
DROP POLICY IF EXISTS agency_members_owner_admin_select ON public.agency_members;

-- `agency_members_self_select` is preserved untouched.

COMMIT;
