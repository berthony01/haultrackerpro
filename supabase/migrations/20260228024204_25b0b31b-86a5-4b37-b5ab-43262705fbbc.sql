
ALTER TABLE public.user_settings
ADD COLUMN tax_reminders_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN tax_reminder_offsets integer[] DEFAULT '{14,7,1,0}';
