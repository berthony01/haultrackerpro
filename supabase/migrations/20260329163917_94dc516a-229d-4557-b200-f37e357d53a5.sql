CREATE TABLE public.ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  insight_type text NOT NULL,
  content text NOT NULL,
  context_hash text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  week_start date,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own insights"
  ON public.ai_insights FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own insights"
  ON public.ai_insights FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own insights"
  ON public.ai_insights FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_ai_insights_user_type ON public.ai_insights (user_id, insight_type);
CREATE INDEX idx_ai_insights_context_hash ON public.ai_insights (user_id, insight_type, context_hash);