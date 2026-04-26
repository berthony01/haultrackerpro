-- A3: Anti-spam DB protection for parking_reports (immutable-safe via trigger)
ALTER TABLE public.parking_reports
  ADD COLUMN IF NOT EXISTS report_hour_bucket timestamptz;

UPDATE public.parking_reports
SET report_hour_bucket = date_trunc('hour', created_at)
WHERE report_hour_bucket IS NULL;

CREATE OR REPLACE FUNCTION public.set_parking_report_hour_bucket()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.report_hour_bucket := date_trunc('hour', COALESCE(NEW.created_at, now()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_parking_report_hour_bucket ON public.parking_reports;
CREATE TRIGGER trg_set_parking_report_hour_bucket
  BEFORE INSERT OR UPDATE OF created_at ON public.parking_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_parking_report_hour_bucket();

-- Pre-clean duplicates (keep earliest)
DELETE FROM public.parking_reports a
USING public.parking_reports b
WHERE a.parking_id = b.parking_id
  AND a.user_id = b.user_id
  AND date_trunc('hour', a.created_at) = date_trunc('hour', b.created_at)
  AND (a.created_at, a.ctid) > (b.created_at, b.ctid);

ALTER TABLE public.parking_reports
  ALTER COLUMN report_hour_bucket SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS parking_reports_one_per_hour
  ON public.parking_reports (parking_id, user_id, report_hour_bucket);

-- B7: Idempotent dedupe safety for parking_locations
DELETE FROM public.parking_locations a
USING public.parking_locations b
WHERE lower(trim(a.name)) = lower(trim(b.name))
  AND round(a.latitude::numeric, 5) = round(b.latitude::numeric, 5)
  AND round(a.longitude::numeric, 5) = round(b.longitude::numeric, 5)
  AND (a.created_at, a.ctid) > (b.created_at, b.ctid);

CREATE UNIQUE INDEX IF NOT EXISTS parking_locations_dedupe
  ON public.parking_locations (
    lower(trim(name)),
    round(latitude::numeric, 5),
    round(longitude::numeric, 5)
  );

-- B5: Realtime publication (idempotent)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_points;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.parking_reports;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

ALTER TABLE public.driver_points REPLICA IDENTITY FULL;
ALTER TABLE public.parking_reports REPLICA IDENTITY FULL;