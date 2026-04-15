-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Original cron schedule removed: superseded by migration 20260415041250
-- which replaces this with a safer token-free pattern.
