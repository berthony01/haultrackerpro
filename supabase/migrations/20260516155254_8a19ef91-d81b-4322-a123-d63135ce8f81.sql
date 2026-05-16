
REVOKE EXECUTE ON FUNCTION public.recruiter_has_priority_plan(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.opportunities_set_featured_from_plan() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recruiter_billing_sync_featured() FROM PUBLIC, anon, authenticated;
