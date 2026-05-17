-- Harden notification client RPC permissions
REVOKE EXECUTE ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
