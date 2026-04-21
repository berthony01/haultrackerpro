INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, error_message, created_at)
SELECT DISTINCT ON (p.message_id) p.message_id, p.template_name, p.recipient_email, 'failed',
  'Drained by admin: stuck pending after function redeploy. Use Retry button to re-send.', now()
FROM public.email_send_log p
WHERE p.status = 'pending'
  AND p.created_at < now() - interval '30 minutes'
  AND p.message_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.email_send_log x
    WHERE x.message_id = p.message_id
      AND x.status IN ('sent','failed','dlq','bounced','complained','suppressed')
  );