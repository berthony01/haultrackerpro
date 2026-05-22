-- Phase 2: Allow approved/verified recruiters to post unlimited standard opportunities.
-- Replaces the billing-based gate with an approval-only gate. Premium/featured
-- behavior remains controlled by the existing recruiter_has_priority_plan +
-- opportunities_set_featured_from_plan + recruiter_billing_sync_featured chain,
-- which is intentionally left untouched.

CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_becoming_active boolean := false;
BEGIN
  -- Admins bypass
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _is_becoming_active := (NEW.status = 'active');
  ELSIF TG_OP = 'UPDATE' THEN
    _is_becoming_active := (NEW.status = 'active' AND COALESCE(OLD.status, '') <> 'active');
  END IF;

  IF NOT _is_becoming_active THEN
    RETURN NEW;
  END IF;

  -- Approved + active recruiter requirement (defense in depth, RLS also enforces ownership).
  -- Unlimited standard posting: no billing status check, no active opportunity count check,
  -- no active_opportunity_limit check.
  IF NOT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = NEW.recruiter_id
      AND rp.verification_status = 'approved'
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  ) THEN
    RAISE EXCEPTION 'Recruiter must be verified and active to post opportunities.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;