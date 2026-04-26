ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS default_dh_pay_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS default_dh_pay_rate numeric;

ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_default_dh_pay_status_check;
ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_default_dh_pay_status_check
  CHECK (default_dh_pay_status IN ('unpaid','same','custom'));