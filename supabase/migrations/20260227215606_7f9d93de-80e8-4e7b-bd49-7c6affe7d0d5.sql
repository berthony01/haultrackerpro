
-- Add pay profile columns to user_settings
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS pay_type text NOT NULL DEFAULT 'cpm',
  ADD COLUMN IF NOT EXISTS pay_percentage numeric,
  ADD COLUMN IF NOT EXISTS company_start_date date;

-- Add gross_revenue to loads for percentage-based pay tracking
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS gross_revenue numeric;
