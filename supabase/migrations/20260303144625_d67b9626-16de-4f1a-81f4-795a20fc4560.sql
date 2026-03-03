
CREATE TABLE public.expense_automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('voice', 'receipt')),
  raw_text text,
  parsed_json jsonb,
  parse_confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_automation_logs_user_created ON public.expense_automation_logs (user_id, created_at);

ALTER TABLE public.expense_automation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own automation logs"
  ON public.expense_automation_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own automation logs"
  ON public.expense_automation_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own automation logs"
  ON public.expense_automation_logs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
