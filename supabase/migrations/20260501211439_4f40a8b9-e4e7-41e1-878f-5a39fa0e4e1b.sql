-- Cost Profile: driver-defined operating costs for pre-load profitability check
CREATE TABLE public.cost_profile (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,

  -- Fixed monthly costs
  truck_payment NUMERIC,
  trailer_payment NUMERIC,
  insurance_monthly NUMERIC,
  permits_licensing_monthly NUMERIC,
  eld_software_monthly NUMERIC,
  other_fixed_monthly NUMERIC,

  -- Per-mile variable costs
  avg_mpg NUMERIC,
  diesel_price_per_gallon NUMERIC,
  maintenance_per_mile NUMERIC,
  tires_per_mile NUMERIC,
  tolls_per_mile NUMERIC,

  -- Per-day costs
  meals_per_day NUMERIC,
  lodging_per_day NUMERIC,

  -- Targets and assumptions
  min_margin_pct NUMERIC,
  min_rpm NUMERIC,
  days_per_1000_miles NUMERIC DEFAULT 2.5,
  estimated_monthly_miles NUMERIC,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cost_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cost profile"
  ON public.cost_profile FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cost profile"
  ON public.cost_profile FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cost profile"
  ON public.cost_profile FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own cost profile"
  ON public.cost_profile FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_cost_profile_updated_at
  BEFORE UPDATE ON public.cost_profile
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();