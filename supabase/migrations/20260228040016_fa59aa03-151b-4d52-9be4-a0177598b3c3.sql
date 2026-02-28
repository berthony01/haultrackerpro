
-- Create user_alerts table for tracking dismissed alerts
CREATE TABLE public.user_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  dedupe_key text NOT NULL,
  dismissed_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add unique constraint to prevent duplicate dismissals
ALTER TABLE public.user_alerts ADD CONSTRAINT user_alerts_user_dedupe_unique UNIQUE (user_id, dedupe_key);

-- Enable RLS
ALTER TABLE public.user_alerts ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own alert dismissals"
  ON public.user_alerts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own alert dismissals"
  ON public.user_alerts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own alert dismissals"
  ON public.user_alerts FOR DELETE
  USING (auth.uid() = user_id);
