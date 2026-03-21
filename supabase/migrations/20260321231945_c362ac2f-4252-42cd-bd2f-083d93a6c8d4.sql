
-- Function: auto-start 14-day Pro trial when user_settings row is inserted
CREATE OR REPLACE FUNCTION public.auto_start_pro_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only insert trial if no subscription row exists yet
  IF NOT EXISTS (
    SELECT 1 FROM public.subscriptions WHERE user_id = NEW.user_id
  ) THEN
    INSERT INTO public.subscriptions (
      user_id, plan_key, status, trial_start, trial_end
    ) VALUES (
      NEW.user_id,
      'pro_monthly',
      'trialing',
      now(),
      now() + interval '14 days'
    );
  ELSE
    -- If subscription exists but is free, upgrade to trial
    UPDATE public.subscriptions
    SET plan_key = 'pro_monthly',
        status = 'trialing',
        trial_start = now(),
        trial_end = now() + interval '14 days',
        updated_at = now()
    WHERE user_id = NEW.user_id
      AND status = 'free';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger on user_settings insert
CREATE TRIGGER on_user_created_start_trial
  AFTER INSERT ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_start_pro_trial();

-- Function: expire ended trials (to be called periodically)
CREATE OR REPLACE FUNCTION public.expire_ended_trials()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.subscriptions
  SET status = 'free',
      plan_key = 'free',
      updated_at = now()
  WHERE status = 'trialing'
    AND trial_end IS NOT NULL
    AND trial_end < now();
END;
$$;
