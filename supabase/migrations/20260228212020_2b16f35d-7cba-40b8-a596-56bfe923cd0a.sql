
CREATE TABLE public.parse_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  used_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.parse_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own parse usage"
  ON public.parse_usage FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own parse usage"
  ON public.parse_usage FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_parse_usage_user_week ON public.parse_usage (user_id, used_at);
