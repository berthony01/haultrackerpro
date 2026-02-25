
-- Create load_stops table for multi-stop loads
CREATE TABLE public.load_stops (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  load_id UUID NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  stop_order INTEGER NOT NULL,
  location TEXT NOT NULL,
  stop_type TEXT NOT NULL DEFAULT 'Stop',
  detention_minutes INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_load_stops_user_id ON public.load_stops(user_id);
CREATE INDEX idx_load_stops_load_id ON public.load_stops(load_id);
CREATE INDEX idx_load_stops_load_order ON public.load_stops(load_id, stop_order);

-- Enable RLS
ALTER TABLE public.load_stops ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own load stops"
ON public.load_stops FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own load stops"
ON public.load_stops FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.loads WHERE id = load_id AND user_id = auth.uid())
);

CREATE POLICY "Users can update own load stops"
ON public.load_stops FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.loads WHERE id = load_id AND user_id = auth.uid())
);

CREATE POLICY "Users can delete own load stops"
ON public.load_stops FOR DELETE
USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_load_stops_updated_at
BEFORE UPDATE ON public.load_stops
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
