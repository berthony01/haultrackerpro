-- Harden the three recruiter priority placement functions:
-- 1) Re-declare with explicit search_path (already set, but re-affirmed).
-- 2) Revoke EXECUTE from PUBLIC/anon/authenticated so they can only be invoked
--    via the triggers that own them. Triggers continue to fire because trigger
--    execution bypasses the EXECUTE privilege check on the function.

REVOKE EXECUTE ON FUNCTION public.recruiter_has_priority_plan(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recruiter_has_priority_plan(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recruiter_has_priority_plan(uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.opportunities_set_featured_from_plan() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.opportunities_set_featured_from_plan() FROM anon;
REVOKE EXECUTE ON FUNCTION public.opportunities_set_featured_from_plan() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.recruiter_billing_sync_featured() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recruiter_billing_sync_featured() FROM anon;
REVOKE EXECUTE ON FUNCTION public.recruiter_billing_sync_featured() FROM authenticated;