-- Create fuel_logs table for fuel tracking
CREATE TABLE public.fuel_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  station TEXT,
  gallons NUMERIC NOT NULL,
  price_per_gallon NUMERIC NOT NULL,
  total_cost NUMERIC NOT NULL,
  odometer NUMERIC,
  linked_load_id UUID REFERENCES public.loads(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for user queries
CREATE INDEX fuel_logs_user_id_idx ON public.fuel_logs(user_id);
CREATE INDEX fuel_logs_date_idx ON public.fuel_logs(date);
CREATE INDEX fuel_logs_linked_load_id_idx ON public.fuel_logs(linked_load_id);

-- Enable RLS
ALTER TABLE public.fuel_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own fuel logs" ON public.fuel_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own fuel logs" ON public.fuel_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own fuel logs" ON public.fuel_logs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own fuel logs" ON public.fuel_logs
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_fuel_logs_updated_at
  BEFORE UPDATE ON public.fuel_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();