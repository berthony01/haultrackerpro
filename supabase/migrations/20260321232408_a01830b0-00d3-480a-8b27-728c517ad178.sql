
-- Drop the conflicting trigger
DROP TRIGGER IF EXISTS on_user_created_start_trial ON public.user_settings;
DROP FUNCTION IF EXISTS public.auto_start_pro_trial();

-- Update handle_new_user to start trial directly
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);
  
  -- Start 14-day Pro trial
  INSERT INTO public.subscriptions (user_id, plan_key, status, trial_start, trial_end)
  VALUES (NEW.id, 'pro_monthly', 'trialing', now(), now() + interval '14 days');
  
  RETURN NEW;
END;
$$;
