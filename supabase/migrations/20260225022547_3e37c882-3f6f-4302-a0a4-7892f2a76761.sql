
-- Weekly snapshots for closeout feature
CREATE TABLE public.weekly_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  total_loads INTEGER NOT NULL DEFAULT 0,
  total_loaded_miles NUMERIC NOT NULL DEFAULT 0,
  total_deadhead_miles NUMERIC NOT NULL DEFAULT 0,
  total_estimated_pay NUMERIC NOT NULL DEFAULT 0,
  total_actual_pay NUMERIC NOT NULL DEFAULT 0,
  known_difference NUMERIC NOT NULL DEFAULT 0,
  unpaid_count INTEGER NOT NULL DEFAULT 0,
  unpaid_estimated NUMERIC NOT NULL DEFAULT 0,
  deadhead_percentage NUMERIC NOT NULL DEFAULT 0,
  finalized_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.weekly_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snapshots" ON public.weekly_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own snapshots" ON public.weekly_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Unique constraint: one snapshot per user per week
CREATE UNIQUE INDEX idx_weekly_snapshots_user_week ON public.weekly_snapshots (user_id, week_start);

-- Feedback responses
CREATE TABLE public.feedback_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  response TEXT NOT NULL,
  loads_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own feedback" ON public.feedback_responses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own feedback" ON public.feedback_responses FOR INSERT WITH CHECK (auth.uid() = user_id);
