-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase RC-1C — Recruiter staff workspace resolution (entry context only).
--
-- Adds exactly ONE new read-only RPC that lets an authenticated user
-- discover the recruiter workspaces where they hold an ACTIVE NON-OWNER
-- membership. This is organizational entry context ONLY.
--
-- This migration MUST NOT:
--   * grant any operational recruiter authority,
--   * modify current_user_can_manage_recruiter_opportunities,
--   * change any table, column, RLS policy, or table grant,
--   * touch opportunities / applications / referrals / reports /
--     contracts / settlements / Stripe / billing / agency objects.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_recruiter_staff_workspaces()
RETURNS TABLE (
  membership_id uuid,
  recruiter_id uuid,
  company_name text,
  recruiter_name text,
  member_role public.recruiter_member_role,
  member_since timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id AS membership_id,
    m.recruiter_id,
    rp.company_name::text AS company_name,
    rp.recruiter_name::text AS recruiter_name,
    m.role AS member_role,
    m.created_at AS member_since
  FROM public.recruiter_members m
  JOIN public.recruiter_profiles rp ON rp.id = m.recruiter_id
  WHERE auth.uid() IS NOT NULL
    AND m.member_user_id = auth.uid()
    AND m.status = 'active'
    AND m.role IN ('recruiter_admin', 'recruiter_staff')
    AND rp.status = 'active'
    AND COALESCE(rp.verification_status, '') <> 'suspended'
  ORDER BY rp.company_name NULLS LAST, m.created_at, m.id
$$;

REVOKE ALL ON FUNCTION public.get_my_recruiter_staff_workspaces() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_recruiter_staff_workspaces() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_recruiter_staff_workspaces() TO authenticated;

COMMENT ON FUNCTION public.get_my_recruiter_staff_workspaces() IS
  'RC-1C: caller-scoped ACTIVE non-owner recruiter memberships against active, non-suspended recruiter workspaces. Safe entry context only; grants no operational authority.';

COMMIT;
