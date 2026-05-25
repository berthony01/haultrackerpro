-- 1. Add durable intended_role column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS intended_role text NOT NULL DEFAULT 'driver';

-- 2. Constrain allowed values (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_intended_role_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_intended_role_check
      CHECK (intended_role IN ('driver','recruiter'));
  END IF;
END $$;

-- 3. Backfill existing recruiters so they retain their role
UPDATE public.profiles p
SET intended_role = 'recruiter'
WHERE intended_role <> 'recruiter'
  AND EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.user_id = p.user_id
  );

-- 4. Update handle_new_user() to persist signup intent from auth metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_intended_role text;
BEGIN
  v_intended_role := CASE
    WHEN COALESCE(NEW.raw_user_meta_data->>'intended_role','') = 'recruiter'
      THEN 'recruiter'
    ELSE 'driver'
  END;

  INSERT INTO public.profiles (user_id, display_name, intended_role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    v_intended_role
  );

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);

  -- Free plan by default. Pro is granted via paid subscription or admin override.
  INSERT INTO public.subscriptions (user_id, plan_key, status)
  VALUES (NEW.id, 'free', 'free');

  RETURN NEW;
END;
$function$;