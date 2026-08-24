-- Phase TG-2E — codify the already-live telegram-poll scheduler in source control.
-- No secret values are embedded; the internal secret is resolved at runtime by
-- its existing Vault name. No tables, RPCs, extensions, or policies are created.

DO $tg2e$
DECLARE
  _jobid bigint;
BEGIN
  FOR _jobid IN
    SELECT jobid FROM cron.job WHERE jobname = 'telegram-poll-every-minute'
  LOOP
    PERFORM cron.unschedule(_jobid);
  END LOOP;
END
$tg2e$;

SELECT cron.schedule(
  'telegram-poll-every-minute',
  '* * * * *',
  $tg2ejob$
  SELECT net.http_post(
    url := 'https://pngptztxwbtozwxrtbwo.supabase.co/functions/v1/telegram-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-HTP-Internal-Secret', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'telegram_poll_internal_secret'
        LIMIT 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $tg2ejob$
);
