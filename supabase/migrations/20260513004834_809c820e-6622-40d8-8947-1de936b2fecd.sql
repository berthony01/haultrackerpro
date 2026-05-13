
-- FIX 1: Tighten INSERT policy on opportunity_applications
DROP POLICY IF EXISTS "Driver inserts own application" ON public.opportunity_applications;

CREATE POLICY "Driver inserts own application"
ON public.opportunity_applications
FOR INSERT
TO authenticated
WITH CHECK (
  driver_user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.opportunities o
    WHERE o.id = opportunity_applications.opportunity_id
      AND o.recruiter_id = opportunity_applications.recruiter_id
      AND o.status = 'active'
      AND o.admin_review_status = 'approved'
  )
  AND (
    driver_profile_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.driver_opportunity_profiles dop
      WHERE dop.id = opportunity_applications.driver_profile_id
        AND dop.user_id = auth.uid()
    )
  )
);

-- FIX 3: Suspended recruiters cannot read applications
DROP POLICY IF EXISTS "Recruiter views applications for own opportunities" ON public.opportunity_applications;

CREATE POLICY "Recruiter views applications for own opportunities"
ON public.opportunity_applications
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = opportunity_applications.recruiter_id
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  )
);

-- Also tighten recruiter UPDATE policy with same suspension check
DROP POLICY IF EXISTS "Recruiter updates application status" ON public.opportunity_applications;

CREATE POLICY "Recruiter updates application status"
ON public.opportunity_applications
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = opportunity_applications.recruiter_id
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = opportunity_applications.recruiter_id
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  )
);

-- FIX 2: Status-only enforcement trigger for recruiter updates
CREATE OR REPLACE FUNCTION public.opportunity_applications_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins bypass all field restrictions
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- For non-admins (recruiters via RLS), enforce status-only changes
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
     OR NEW.driver_user_id IS DISTINCT FROM OLD.driver_user_id
     OR NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id
     OR NEW.driver_profile_id IS DISTINCT FROM OLD.driver_profile_id
     OR NEW.application_type IS DISTINCT FROM OLD.application_type
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.preferred_contact_method IS DISTINCT FROM OLD.preferred_contact_method
     OR NEW.driver_phone_snapshot IS DISTINCT FROM OLD.driver_phone_snapshot
     OR NEW.driver_email_snapshot IS DISTINCT FROM OLD.driver_email_snapshot
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Recruiters may only update application status.'
      USING ERRCODE = '42501';
  END IF;

  -- Bump updated_at automatically
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_applications_update_guard_trg ON public.opportunity_applications;
CREATE TRIGGER opportunity_applications_update_guard_trg
BEFORE UPDATE ON public.opportunity_applications
FOR EACH ROW
EXECUTE FUNCTION public.opportunity_applications_update_guard();
