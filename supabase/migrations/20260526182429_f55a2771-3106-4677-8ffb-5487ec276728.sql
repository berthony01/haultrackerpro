-- Reschedule the generate-recurring-expenses cron to send the x-internal-secret
-- header, matching the new auth gate added to the edge function. The secret is
-- read from vault.decrypted_secrets (name 'internal_function_secret'); if absent
-- the call sends an empty header and the function returns 401 (fail-closed).
DO $$
BEGIN
  PERFORM cron.unschedule('generate-recurring-expenses');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'generate-recurring-expenses',
  '0 6 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://pngptztxwbtozwxrtbwo.supabase.co/functions/v1/generate-recurring-expenses',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBuZ3B0enR4d2J0b3p3eHJ0YndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NzYwOTAsImV4cCI6MjA4NzU1MjA5MH0.Y4X4nJdsAVEOuhyWPF9hSYv0RXyH_3D-SjXWxpJdn0s',
      'x-internal-secret', COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_function_secret' LIMIT 1),
        ''
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);