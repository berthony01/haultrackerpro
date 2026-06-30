
-- Phase 7B: Close direct table-write bypasses on agency_service_packages and
-- agency_members, and restrict the internal limit-helper functions to
-- SECURITY DEFINER callers only.

-- 1) agency_service_packages: drop the broad FOR ALL policy.
--    Keep asp_member_select so active members can read.
--    Add explicit owner/admin SELECT just for clarity (no-op if member_select covers).
DROP POLICY IF EXISTS asp_owner_admin_write ON public.agency_service_packages;

-- Make sure a SELECT exists for owner/admin even if they're somehow not a "member" row.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agency_service_packages'
      AND policyname = 'asp_owner_admin_select'
  ) THEN
    CREATE POLICY asp_owner_admin_select ON public.agency_service_packages
      FOR SELECT TO authenticated
      USING (public.is_agency_owner_or_admin(agency_id, auth.uid()));
  END IF;
END $$;

-- 2) agency_members: drop the broad FOR ALL policy.
--    Keep agency_members_self_select so a user can see their own row.
--    Add an explicit SELECT for owner/admin so they can list members.
DROP POLICY IF EXISTS agency_members_owner_all ON public.agency_members;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agency_members'
      AND policyname = 'agency_members_owner_admin_select'
  ) THEN
    CREATE POLICY agency_members_owner_admin_select ON public.agency_members
      FOR SELECT TO authenticated
      USING (public.is_agency_owner_or_admin(agency_id, auth.uid()));
  END IF;
END $$;

-- 3) Lock down limit-helper functions.
--    The frontend never calls these; they're called from SECURITY DEFINER RPCs
--    (create_agency_package, update_agency_package, invite_agency_member,
--    driver_decide_delegation). SECURITY DEFINER callers run as the function
--    owner, so revoking from authenticated/PUBLIC/anon does not break them.
REVOKE EXECUTE ON FUNCTION public.get_effective_agency_limits(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_agency_limit(uuid, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.get_effective_agency_limits(uuid) IS
  'Phase 7B: internal helper. Callable only from SECURITY DEFINER RPCs.';
COMMENT ON FUNCTION public.assert_agency_limit(uuid, text) IS
  'Phase 7B: internal helper. Callable only from SECURITY DEFINER RPCs.';
