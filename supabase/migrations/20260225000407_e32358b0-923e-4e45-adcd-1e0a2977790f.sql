
-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Loads table
CREATE TABLE public.loads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  pickup TEXT NOT NULL,
  dropoff TEXT NOT NULL,
  loaded_miles NUMERIC NOT NULL DEFAULT 0,
  deadhead_miles NUMERIC NOT NULL DEFAULT 0,
  rate_per_mile NUMERIC NOT NULL DEFAULT 0,
  wait_fee NUMERIC NOT NULL DEFAULT 0,
  detention_fee NUMERIC NOT NULL DEFAULT 0,
  estimated_pay NUMERIC GENERATED ALWAYS AS (loaded_miles * rate_per_mile + wait_fee + detention_fee) STORED,
  actual_pay NUMERIC,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.loads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own loads" ON public.loads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own loads" ON public.loads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own loads" ON public.loads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own loads" ON public.loads FOR DELETE USING (auth.uid() = user_id);

-- Index for date range queries
CREATE INDEX idx_loads_user_date ON public.loads (user_id, date DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_loads_updated_at BEFORE UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
