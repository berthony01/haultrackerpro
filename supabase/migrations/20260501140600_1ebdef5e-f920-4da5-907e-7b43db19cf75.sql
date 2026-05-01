-- Remove the broken cron job (it was calling extensions.http_post which does not exist in this project)
SELECT cron.unschedule('generate-recurring-expenses');

-- Recreate it using net.http_post (the pg_net extension), matching the pattern used by every other working cron job in this project.
SELECT cron.schedule(
  'generate-recurring-expenses',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://pngptztxwbtozwxrtbwo.supabase.co/functions/v1/generate-recurring-expenses',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBuZ3B0enR4d2J0b3p3eHJ0YndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NzYwOTAsImV4cCI6MjA4NzU1MjA5MH0.Y4X4nJdsAVEOuhyWPF9hSYv0RXyH_3D-SjXWxpJdn0s"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);