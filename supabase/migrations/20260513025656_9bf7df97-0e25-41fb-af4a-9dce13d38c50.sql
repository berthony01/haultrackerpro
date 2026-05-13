
-- 1. Recruiters can view limited driver opportunity profiles attached to their own applications
DROP POLICY IF EXISTS "Recruiters view profiles attached to own applications" ON public.driver_opportunity_profiles;

CREATE POLICY "Recruiters view profiles attached to own applications"
ON public.driver_opportunity_profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.opportunity_applications oa
    JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id
    WHERE oa.driver_profile_id = driver_opportunity_profiles.id
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  )
);

-- 2. Update guard to enforce terminal state, no-withdraw, and forward-only status flow for non-admins
CREATE OR REPLACE FUNCTION public.opportunity_applications_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _old_rank int;
  _new_rank int;
BEGIN
  -- Admins bypass restrictions
  IF public.is_admin(auth.uid()) THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Block edits to protected fields
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

  -- Status change rules
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Block any change from a terminal status
    IF OLD.status IN ('withdrawn','hired','rejected') THEN
      RAISE EXCEPTION 'Terminal application status cannot be changed.'
        USING ERRCODE = '42501';
    END IF;

    -- Recruiters cannot set withdrawn (driver-only via RPC)
    IF NEW.status = 'withdrawn' THEN
      RAISE EXCEPTION 'Only the driver can withdraw an application.'
        USING ERRCODE = '42501';
    END IF;

    -- Forward-only flow
    _old_rank := CASE OLD.status
      WHEN 'new' THEN 1
      WHEN 'viewed' THEN 2
      WHEN 'contacted' THEN 3
      WHEN 'interviewing' THEN 4
      WHEN 'hired' THEN 5
      WHEN 'rejected' THEN 5
      ELSE 0
    END;

    _new_rank := CASE NEW.status
      WHEN 'new' THEN 1
      WHEN 'viewed' THEN 2
      WHEN 'contacted' THEN 3
      WHEN 'interviewing' THEN 4
      WHEN 'hired' THEN 5
      WHEN 'rejected' THEN 5
      ELSE 0
    END;

    IF _new_rank = 0 THEN
      RAISE EXCEPTION 'Invalid application status.'
        USING ERRCODE = '22023';
    END IF;

    IF _new_rank < _old_rank THEN
      RAISE EXCEPTION 'Application status cannot move backward.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
