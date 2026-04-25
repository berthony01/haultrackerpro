ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS home_time_paused_template_ids uuid[] NOT NULL DEFAULT '{}';