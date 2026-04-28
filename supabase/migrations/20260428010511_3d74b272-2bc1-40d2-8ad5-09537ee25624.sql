ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS total_miles numeric,
  ADD COLUMN IF NOT EXISTS pay_model text,
  ADD COLUMN IF NOT EXISTS flat_rate_amount numeric;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS default_pay_model text;