-- =========================================
-- PHASE 1: Personal Intelligence Data Foundation
-- Additive only. No destructive changes.
-- =========================================

-- 1A: Brokers table (per user)
CREATE TABLE IF NOT EXISTS public.brokers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  mc_number TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own brokers"
  ON public.brokers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own brokers"
  ON public.brokers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own brokers"
  ON public.brokers FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own brokers"
  ON public.brokers FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_brokers_user_id ON public.brokers(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_brokers_user_name_unique
  ON public.brokers(user_id, lower(name));

CREATE TRIGGER trg_brokers_updated_at
  BEFORE UPDATE ON public.brokers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 1B: Link loads to brokers (additive, optional)
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS broker_id UUID REFERENCES public.brokers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS broker_name_raw TEXT;

CREATE INDEX IF NOT EXISTS idx_loads_broker_id ON public.loads(broker_id);

-- 1C: Per-user lane stats (derived storage)
CREATE TABLE IF NOT EXISTS public.lane_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  lane_key TEXT NOT NULL,
  origin_market TEXT,
  destination_market TEXT,
  load_count INTEGER NOT NULL DEFAULT 0,
  avg_loaded_miles NUMERIC NOT NULL DEFAULT 0,
  avg_deadhead_miles NUMERIC NOT NULL DEFAULT 0,
  avg_rpm NUMERIC NOT NULL DEFAULT 0,
  avg_net_profit NUMERIC NOT NULL DEFAULT 0,
  avg_margin_pct NUMERIC NOT NULL DEFAULT 0,
  avg_days_to_pay NUMERIC,
  last_load_date DATE,
  trend_direction TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lane_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own lane stats"
  ON public.lane_stats FOR SELECT
  USING (auth.uid() = user_id);

-- (No INSERT/UPDATE/DELETE policies: system-managed via SECURITY DEFINER recompute fns in Phase 2)

CREATE INDEX IF NOT EXISTS idx_lane_stats_user_id ON public.lane_stats(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lane_stats_user_lane_unique
  ON public.lane_stats(user_id, lane_key);

CREATE TRIGGER trg_lane_stats_updated_at
  BEFORE UPDATE ON public.lane_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 1D: Per-user broker stats (derived storage)
CREATE TABLE IF NOT EXISTS public.broker_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
  load_count INTEGER NOT NULL DEFAULT 0,
  avg_estimated_pay NUMERIC NOT NULL DEFAULT 0,
  avg_actual_pay NUMERIC NOT NULL DEFAULT 0,
  avg_variance_amount NUMERIC NOT NULL DEFAULT 0,
  short_pay_count INTEGER NOT NULL DEFAULT 0,
  days_to_invoice_avg NUMERIC,
  days_to_pay_avg NUMERIC,
  unpaid_count INTEGER NOT NULL DEFAULT 0,
  reliability_score NUMERIC,
  last_load_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.broker_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own broker stats"
  ON public.broker_stats FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_broker_stats_user_id ON public.broker_stats(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_stats_user_broker_unique
  ON public.broker_stats(user_id, broker_id);

CREATE TRIGGER trg_broker_stats_updated_at
  BEFORE UPDATE ON public.broker_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 1E: Per-user rolling operating metrics (single row per user)
CREATE TABLE IF NOT EXISTS public.operating_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  rolling_cost_per_mile NUMERIC NOT NULL DEFAULT 0,
  rolling_fuel_cost_per_mile NUMERIC NOT NULL DEFAULT 0,
  rolling_deadhead_pct NUMERIC NOT NULL DEFAULT 0,
  rolling_margin_pct NUMERIC NOT NULL DEFAULT 0,
  last_recomputed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.operating_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own operating metrics"
  ON public.operating_metrics FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_operating_metrics_user_id ON public.operating_metrics(user_id);

CREATE TRIGGER trg_operating_metrics_updated_at
  BEFORE UPDATE ON public.operating_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 1F: Reuse user_settings for targets (additive optional columns)
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS target_rpm NUMERIC,
  ADD COLUMN IF NOT EXISTS target_margin_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS target_deadhead_pct NUMERIC;
