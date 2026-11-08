-- Disposable schema projection only. Production-used authorization/create/status
-- bodies are installed byte-for-byte by dispatchWorkspacePostgres.test.ts.
ALTER TABLE public.recruiter_profiles ADD COLUMN dispatch_week_start_day text NOT NULL DEFAULT 'sunday';
CREATE TABLE public.loads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),
 status text NOT NULL DEFAULT 'completed' CHECK(status IN('pending','en_route','completed','cancelled')),
 load_reference text,carrier_driver_relationship_id uuid REFERENCES public.carrier_driver_relationships(id),
 load_date date NOT NULL,pickup_location text NOT NULL,dropoff_location text NOT NULL,dropoff_date date,
 loaded_miles numeric NOT NULL DEFAULT 0,deadhead_miles numeric NOT NULL DEFAULT 0,total_miles numeric,rate_per_mile numeric NOT NULL DEFAULT 0,
 pay_model text,flat_rate_amount numeric,deadhead_rate_per_mile numeric,wait_fee numeric NOT NULL DEFAULT 0,detention_fee numeric NOT NULL DEFAULT 0,other_fees numeric NOT NULL DEFAULT 0,
 estimated_pay numeric,notes text,created_by_user_id uuid,updated_by_user_id uuid,origin_channel text NOT NULL DEFAULT 'web',
 CONSTRAINT loads_total_miles_component_consistency_check CHECK(total_miles IS NULL OR(total_miles>=0 AND(loaded_miles+deadhead_miles=0 OR abs(total_miles-(loaded_miles+deadhead_miles))<=2)))
);
GRANT SELECT ON public.loads TO authenticated;
GRANT ALL ON public.loads TO service_role;
ALTER TABLE public.loads ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_read ON public.loads FOR SELECT TO authenticated USING(user_id=auth.uid());