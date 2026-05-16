
CREATE OR REPLACE FUNCTION public.recruiter_has_priority_plan(_recruiter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recruiter_billing_profiles
    WHERE recruiter_id = _recruiter_id
      AND plan IN ('growth', 'fleet')
      AND status IN ('active', 'trialing')
  );
$$;

CREATE OR REPLACE FUNCTION public.opportunities_set_featured_from_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.featured := public.recruiter_has_priority_plan(NEW.recruiter_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opportunities_set_featured ON public.opportunities;
CREATE TRIGGER trg_opportunities_set_featured
BEFORE INSERT OR UPDATE OF recruiter_id ON public.opportunities
FOR EACH ROW
EXECUTE FUNCTION public.opportunities_set_featured_from_plan();

CREATE OR REPLACE FUNCTION public.recruiter_billing_sync_featured()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_featured boolean;
BEGIN
  v_featured := public.recruiter_has_priority_plan(NEW.recruiter_id);
  UPDATE public.opportunities
    SET featured = v_featured
    WHERE recruiter_id = NEW.recruiter_id
      AND featured IS DISTINCT FROM v_featured;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recruiter_billing_sync_featured ON public.recruiter_billing_profiles;
CREATE TRIGGER trg_recruiter_billing_sync_featured
AFTER INSERT OR UPDATE OF plan, status ON public.recruiter_billing_profiles
FOR EACH ROW
EXECUTE FUNCTION public.recruiter_billing_sync_featured();

UPDATE public.opportunities
  SET featured = public.recruiter_has_priority_plan(recruiter_id)
  WHERE featured IS DISTINCT FROM public.recruiter_has_priority_plan(recruiter_id);
