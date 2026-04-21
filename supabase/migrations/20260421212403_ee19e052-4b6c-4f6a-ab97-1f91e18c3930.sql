INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, error_message, created_at)
SELECT message_id, template_name, recipient_email, 'failed', 'Drained by admin: stuck pending after function redeploy. Use Retry button to re-send.', now()
FROM public.email_send_log
WHERE status = 'pending'
  AND created_at < now() - interval '30 minutes'
  AND message_id IS NOT NULL
  AND message_id NOT IN (
    SELECT message_id FROM public.email_send_log
    WHERE message_id IS NOT NULL AND status IN ('sent', 'failed', 'dlq', 'bounced', 'complained', 'suppressed')
  );