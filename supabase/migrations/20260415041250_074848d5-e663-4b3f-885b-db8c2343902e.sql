
-- Unschedule existing jobs (idempotent)
SELECT cron.unschedule('expire-ended-trials')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-ended-trials');

SELECT cron.unschedule('generate-recurring-expenses')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-recurring-expenses');

-- Trial expiration: call DB function directly, no HTTP/token needed
SELECT cron.schedule(
  'expire-ended-trials',
  '0 * * * *',
  $$SELECT public.expire_ended_trials();$$
);

-- Recurring expenses: HTTP post without hardcoded bearer token (verify_jwt=false)
SELECT cron.schedule(
  'generate-recurring-expenses',
  '0 6 * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://pngptztxwbtozwxrtbwo.supabase.co/functions/v1/generate-recurring-expenses',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
