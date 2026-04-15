-- Remove existing job if present (idempotent)
SELECT cron.unschedule('generate-recurring-expenses')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'generate-recurring-expenses'
);

-- Schedule daily at 6am UTC
SELECT cron.schedule(
  'generate-recurring-expenses',
  '0 6 * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://pngptztxwbtozwxrtbwo.supabase.co/functions/v1/generate-recurring-expenses',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBuZ3B0enR4d2J0b3p3eHJ0YndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NzYwOTAsImV4cCI6MjA4NzU1MjA5MH0.Y4X4nJdsAVEOuhyWPF9hSYv0RXyH_3D-SjXWxpJdn0s"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);