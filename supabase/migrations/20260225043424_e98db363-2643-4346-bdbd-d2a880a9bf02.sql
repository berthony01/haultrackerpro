
-- Add category column to feedback_responses for structured feedback
ALTER TABLE public.feedback_responses ADD COLUMN IF NOT EXISTS category text;

-- Add onboarding_completed flag to user_settings
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;
