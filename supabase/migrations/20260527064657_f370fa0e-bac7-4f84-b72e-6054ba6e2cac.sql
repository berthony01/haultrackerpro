DROP POLICY IF EXISTS "Authenticated can read public parking signals" ON public.parking_reports;
DROP POLICY IF EXISTS "Authenticated can read public parking verification signals" ON public.parking_verifications;
ALTER PUBLICATION supabase_realtime DROP TABLE public.driver_points;