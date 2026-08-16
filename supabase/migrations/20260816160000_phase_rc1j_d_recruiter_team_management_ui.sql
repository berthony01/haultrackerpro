-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase RC-1J-D — Recruiter Team Management UI support.
--
-- Scope: exactly TWO additive functions. No existing function is redefined,
-- no RLS policy, table, column, enum, index, or trigger is touched, and no
-- billing/Agency/Stripe object is read directly.
--
-- FROZEN — deliberately NOT redefined here:
--   current_user_can_recruiter_team_action, current_user_has_recruiter_permission,
--   get_my_recruiter_permissions, list_recruiter_team_members_safe,
--   invite_recruiter_member, accept_recruiter_member_invite,
--   revoke_recruiter_member, set_recruiter_member_permissions,
--   set_recruiter_member_role, recruiter_team_seat_limit,
--   recruiter_team_occupied_seats, recruiter_team_workspace_within_limit,
--   effective_recruiter_tier, and every RC-1D … RC-1I operational helper.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Seat status projection.
--
-- The RC-1J-B helpers are the ONLY source of seat truth: this function does
-- not read billing/Agency tables and does not duplicate the 1/2/5/15 matrix.
-- It returns no plan key, no billing status, no owner email, no private
-- profile data, and no audit data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_recruiter_team_seat_status(_recruiter_id uuid)
RETURNS TABLE (
  seat_limit integer,
  occupied_seats integer,
  available_seats integer,
  within_limit boolean,
  can_invite boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _limit integer;
  _occupied integer;
  _within boolean;
BEGIN
  IF auth.uid() IS NULL OR _recruiter_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Owner semantics arrive through the existing team-action helper.
  IF NOT public.current_user_can_recruiter_team_action(_recruiter_id, 'team_view') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  _limit := public.recruiter_team_seat_limit(_recruiter_id);
  _occupied := public.recruiter_team_occupied_seats(_recruiter_id);
  _within := public.recruiter_team_workspace_within_limit(_recruiter_id);

  seat_limit := _limit;
  occupied_seats := _occupied;
  available_seats := GREATEST(_limit - _occupied, 0);
  within_limit := _within;
  can_invite := _within AND _occupied < _limit;

  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- B. Atomic invite + permissions wrapper.
--
-- Duplicates NO invite crypto, email validation, expiry, or seat-capacity
-- logic: it delegates entirely to the existing RC-1J-B/C functions inside a
-- single transaction, so a permission failure rolls the invite back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_recruiter_member_with_permissions(
  _recruiter_id uuid,
  _email text,
  _role public.recruiter_member_role,
  _permissions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _invite jsonb;
  _membership_id uuid;
  _perms jsonb;
BEGIN
  IF auth.uid() IS NULL OR _recruiter_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Owner implicit access plus the delegated BOTH-key manager requirement.
  IF NOT public.current_user_can_recruiter_team_action(_recruiter_id, 'team_manage') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  _invite := public.invite_recruiter_member(_recruiter_id, _email, _role);

  _membership_id := NULLIF(_invite ->> 'membership_id', '')::uuid;
  IF _membership_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  _perms := public.set_recruiter_member_permissions(
              _membership_id,
              COALESCE(_permissions, '{}'::jsonb)
            );

  RETURN _invite || jsonb_build_object('permissions', _perms -> 'permissions');
END;
$$;

-- ---------------------------------------------------------------------------
-- C. Function privileges. No table grants, no RLS policy changes.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_recruiter_team_seat_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invite_recruiter_member_with_permissions(uuid, text, public.recruiter_member_role, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_recruiter_team_seat_status(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invite_recruiter_member_with_permissions(uuid, text, public.recruiter_member_role, jsonb) TO authenticated, service_role;

COMMIT;
