-- Remove parking tables from realtime publication to prevent broadcasting user_id
ALTER PUBLICATION supabase_realtime DROP TABLE public.parking_reports;
ALTER PUBLICATION supabase_realtime DROP TABLE public.parking_verifications;

-- Remove recruiter UPDATE policy on billing row. The recruiter_billing_field_guard
-- trigger already pins every billing-controlled column to OLD for non-service/admin
-- callers, so the recruiter UPDATE path was a no-op that only widened attack surface.
-- Billing mutations remain available to service_role (stripe-webhook) and admins.
DROP POLICY IF EXISTS "Recruiter updates own billing row" ON public.recruiter_billing_profiles;