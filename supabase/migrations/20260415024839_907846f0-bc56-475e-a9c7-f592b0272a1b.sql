-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Remove existing job if present (idempotent)
SELECT cron.unschedule('expire-ended-trials')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'expire-ended-trials'
);

-- Schedule hourly trial expiration
SELECT cron.schedule(
  'expire-ended-trials',
  '0 * * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://pngptztxwbtozwxrtbwo.supabase.co/functions/v1/check-subscription',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBuZ3B0enR4d2J0b3p3eHJ0YndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NzYwOTAsImV4cCI6MjA4NzU1MjA5MH0.Y4X4nJdsAVEOuhyWPF9hSYv0RXyH_3D-SjXWxpJdn0s"}'::jsonb,
    body := '{"action": "expire_trials"}'::jsonb
  );
  $$
);