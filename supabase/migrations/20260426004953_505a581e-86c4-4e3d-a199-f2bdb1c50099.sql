
-- ==========================================
-- PARKING LOCATIONS
-- ==========================================
CREATE TABLE public.parking_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  address text,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  type text NOT NULL DEFAULT 'truck_stop' CHECK (type IN ('truck_stop','rest_area','warehouse','street','private')),
  is_paid boolean NOT NULL DEFAULT false,
  overnight_allowed boolean NOT NULL DEFAULT true,
  truck_friendly boolean NOT NULL DEFAULT true,
  total_spots integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.parking_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view parking locations"
  ON public.parking_locations FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Users can add parking locations"
  ON public.parking_locations FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Creators or admins can update parking locations"
  ON public.parking_locations FOR UPDATE
  TO authenticated USING (auth.uid() = created_by OR public.is_admin(auth.uid()));

CREATE POLICY "Creators or admins can delete parking locations"
  ON public.parking_locations FOR DELETE
  TO authenticated USING (auth.uid() = created_by OR public.is_admin(auth.uid()));

CREATE INDEX idx_parking_locations_coords ON public.parking_locations (latitude, longitude);

-- ==========================================
-- PARKING REPORTS
-- ==========================================
CREATE TABLE public.parking_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parking_id uuid NOT NULL REFERENCES public.parking_locations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('available','limited','full')),
  safety_rating smallint CHECK (safety_rating BETWEEN 1 AND 5),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.parking_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view parking reports"
  ON public.parking_reports FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Users can submit own parking reports"
  ON public.parking_reports FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_parking_reports_parking_created ON public.parking_reports (parking_id, created_at DESC);
CREATE INDEX idx_parking_reports_user_created ON public.parking_reports (user_id, created_at DESC);

-- ==========================================
-- PARKING VERIFICATIONS
-- ==========================================
CREATE TABLE public.parking_verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parking_id uuid NOT NULL REFERENCES public.parking_locations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  verified_status text NOT NULL CHECK (verified_status IN ('available','full')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.parking_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view verifications"
  ON public.parking_verifications FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Users can submit own verifications"
  ON public.parking_verifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_parking_verifications_parking_created ON public.parking_verifications (parking_id, created_at DESC);

-- ==========================================
-- PARKING FAVORITES
-- ==========================================
CREATE TABLE public.parking_favorites (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  parking_id uuid NOT NULL REFERENCES public.parking_locations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, parking_id)
);

ALTER TABLE public.parking_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own favorites"
  ON public.parking_favorites FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own favorites"
  ON public.parking_favorites FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own favorites"
  ON public.parking_favorites FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ==========================================
-- DRIVER POINTS
-- ==========================================
CREATE TABLE public.driver_points (
  user_id uuid NOT NULL PRIMARY KEY,
  total_points integer NOT NULL DEFAULT 0,
  weekly_points integer NOT NULL DEFAULT 0,
  parking_points integer NOT NULL DEFAULT 0,
  load_points integer NOT NULL DEFAULT 0,
  streak_days integer NOT NULL DEFAULT 0,
  last_activity_date date,
  weekly_period_start date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own points"
  ON public.driver_points FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- (Inserts/updates only via SECURITY DEFINER award_points fn)

-- ==========================================
-- AWARD POINTS HELPER
-- ==========================================
CREATE OR REPLACE FUNCTION public.award_points(_user_id uuid, _category text, _amount integer)
RETURNS public.driver_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _week_start date := date_trunc('week', _today)::date;
  _row public.driver_points;
BEGIN
  IF _category NOT IN ('parking','load') THEN
    RAISE EXCEPTION 'Invalid points category: %', _category;
  END IF;

  -- Ensure row exists
  INSERT INTO public.driver_points (user_id, weekly_period_start)
  VALUES (_user_id, _week_start)
  ON CONFLICT (user_id) DO NOTHING;

  -- Reset weekly bucket if we crossed into a new week
  UPDATE public.driver_points
  SET weekly_points = 0,
      weekly_period_start = _week_start
  WHERE user_id = _user_id
    AND (weekly_period_start IS NULL OR weekly_period_start < _week_start);

  -- Streak logic
  UPDATE public.driver_points
  SET streak_days = CASE
        WHEN last_activity_date = _today THEN streak_days
        WHEN last_activity_date = (_today - 1) THEN streak_days + 1
        ELSE 1
      END,
      last_activity_date = _today,
      total_points = total_points + _amount,
      weekly_points = weekly_points + _amount,
      parking_points = parking_points + CASE WHEN _category = 'parking' THEN _amount ELSE 0 END,
      load_points = load_points + CASE WHEN _category = 'load' THEN _amount ELSE 0 END,
      updated_at = now()
  WHERE user_id = _user_id
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.award_points(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_points(uuid, text, integer) TO authenticated;

-- ==========================================
-- SEED ~30 well-known truck stops
-- ==========================================
INSERT INTO public.parking_locations (name, address, latitude, longitude, type, is_paid, overnight_allowed, truck_friendly, total_spots) VALUES
('Pilot Travel Center #001', '5404 Strawberry Plains Pike, Knoxville, TN', 36.0080, -83.7461, 'truck_stop', true, true, true, 150),
('Loves Travel Stop - Oklahoma City', '2811 S Council Rd, Oklahoma City, OK', 35.4423, -97.6300, 'truck_stop', true, true, true, 120),
('TA Travel Center - Ontario', '4325 E Guasti Rd, Ontario, CA', 34.0680, -117.6035, 'truck_stop', true, true, true, 200),
('Petro Stopping Center - Effingham', '1702 W Evergreen Ave, Effingham, IL', 39.1153, -88.5664, 'truck_stop', true, true, true, 250),
('Pilot Flying J - Atlanta South', '1409 Cedar Grove Rd, Conley, GA', 33.6395, -84.3279, 'truck_stop', true, true, true, 180),
('Loves Travel Stop - Dallas', '8701 S Lancaster Rd, Dallas, TX', 32.6671, -96.7894, 'truck_stop', true, true, true, 140),
('TA Express - Lodi', '15100 N Thornton Rd, Lodi, CA', 38.2083, -121.3458, 'truck_stop', true, true, true, 90),
('Pilot Travel Center - Gary', '3001 Grant St, Gary, IN', 41.5868, -87.3389, 'truck_stop', true, true, true, 110),
('Loves Travel Stop - Amarillo', '8500 E I-40, Amarillo, TX', 35.1872, -101.7700, 'truck_stop', true, true, true, 130),
('Petro Stopping Center - Laredo', '11530 IH-35 N, Laredo, TX', 27.6648, -99.4965, 'truck_stop', true, true, true, 220),
('TA Travel Center - Columbia', '3604 Forum Blvd, Columbia, MO', 38.9430, -92.3610, 'truck_stop', true, true, true, 175),
('Pilot Flying J - Bloomington', '6810 N Old US Hwy 31, Indianapolis, IN', 39.9612, -86.1480, 'truck_stop', true, true, true, 160),
('Loves Travel Stop - Albuquerque', '1700 Bridge Blvd SW, Albuquerque, NM', 35.0540, -106.6760, 'truck_stop', true, true, true, 100),
('TA Travel Center - Holbrook', '3270 Navajo Blvd, Holbrook, AZ', 34.9027, -110.1604, 'truck_stop', true, true, true, 145),
('Pilot Travel Center - Cheyenne', '3501 W College Dr, Cheyenne, WY', 41.1187, -104.8570, 'truck_stop', true, true, true, 95),
('Loves Travel Stop - Billings', '4341 Garden Ave, Billings, MT', 45.7833, -108.5407, 'truck_stop', true, true, true, 85),
('Petro Stopping Center - Bakersfield', '8730 Dillard Rd, Bakersfield, CA', 35.3300, -118.9700, 'truck_stop', true, true, true, 235),
('Pilot Travel Center - Walcott', '2790 N Plainview Rd, Walcott, IA', 41.5908, -90.7700, 'truck_stop', true, true, true, 175),
('Iowa 80 Truckstop', '755 W Iowa 80 Rd, Walcott, IA', 41.5919, -90.7613, 'truck_stop', true, true, true, 900),
('Loves Travel Stop - Salt Lake City', '2858 W 1500 S, Salt Lake City, UT', 40.7345, -112.0040, 'truck_stop', true, true, true, 105),
('TA Travel Center - Atlanta West', '3375 Bankhead Hwy, Lithia Springs, GA', 33.7800, -84.6400, 'truck_stop', true, true, true, 195),
('Pilot Flying J - Jacksonville', '7401 Commonwealth Ave, Jacksonville, FL', 30.3252, -81.7800, 'truck_stop', true, true, true, 165),
('Loves Travel Stop - Phoenix', '4400 N Black Canyon Hwy, Phoenix, AZ', 33.4940, -112.1090, 'truck_stop', true, true, true, 115),
('Petro Stopping Center - Kingman', '3300 E Andy Devine Ave, Kingman, AZ', 35.1893, -114.0080, 'truck_stop', true, true, true, 210),
('Pilot Travel Center - Memphis', '1265 Riverport Rd, Memphis, TN', 35.0640, -90.1490, 'truck_stop', true, true, true, 155),
('Loves Travel Stop - Charlotte', '8001 Wilkinson Blvd, Charlotte, NC', 35.2200, -80.9920, 'truck_stop', true, true, true, 125),
('TA Travel Center - Harrisburg', '7848 Linglestown Rd, Harrisburg, PA', 40.3340, -76.7700, 'truck_stop', true, true, true, 185),
('Pilot Flying J - Carlisle', '1501 Harrisburg Pike, Carlisle, PA', 40.2090, -77.1520, 'truck_stop', true, true, true, 170),
('Loves Travel Stop - Chicago South', '17120 Halsted St, Harvey, IL', 41.6080, -87.6470, 'truck_stop', true, true, true, 100),
('Petro Stopping Center - Florence', '4225 W Lucas St, Florence, SC', 34.1957, -79.7900, 'truck_stop', true, true, true, 215);
