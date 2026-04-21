ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS lifecycle_emails_opt_in BOOLEAN NOT NULL DEFAULT true;