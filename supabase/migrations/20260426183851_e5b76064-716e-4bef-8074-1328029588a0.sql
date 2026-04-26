-- 1. Convert all current trialing subscriptions to free
UPDATE public.subscriptions
SET status = 'free',
    plan_key = 'free',
    trial_start = NULL,
    trial_end = NULL,
    stripe_subscription_id = NULL,
    stripe_price_id = NULL,
    current_period_start = NULL,
    current_period_end = NULL,
    cancel_at_period_end = false,
    updated_at = now()
WHERE status = 'trialing';

-- 2. Mirror that on legacy profiles for any rows that still say 'trial'
UPDATE public.profiles
SET subscription_status = 'free',
    subscription_plan = NULL,
    subscription_expires_at = NULL,
    updated_at = now()
WHERE subscription_status IN ('trial', 'trialing');

-- 3. New users now start on free (no auto trial)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);

  -- Free plan by default. Pro is granted via paid subscription or admin override.
  INSERT INTO public.subscriptions (user_id, plan_key, status)
  VALUES (NEW.id, 'free', 'free');

  RETURN NEW;
END;
$function$;

-- 4. Drop the trial-expiry cron job (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('expire-ended-trials')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-ended-trials');
  END IF;
END $$;

-- 5. Drop trial-only DB functions (no longer referenced)
DROP FUNCTION IF EXISTS public.expire_ended_trials();
DROP FUNCTION IF EXISTS public.auto_start_pro_trial();