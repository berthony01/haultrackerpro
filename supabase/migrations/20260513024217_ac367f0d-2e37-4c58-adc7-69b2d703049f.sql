REVOKE EXECUTE ON FUNCTION public.withdraw_opportunity_application(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_opportunity_application(uuid) TO authenticated;