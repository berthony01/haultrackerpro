REVOKE EXECUTE ON FUNCTION public.driver_has_active_pro(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_direct_assistants_on_driver_pro_end(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_driver_report_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_has_active_pro(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_direct_assistants_on_driver_pro_end(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_driver_report_settings(uuid) TO authenticated, service_role;