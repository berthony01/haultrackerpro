-- Fix recruiter_profile_guard to allow safe self-resubmission from rejected to pending
-- while preserving all other protections.

CREATE OR REPLACE FUNCTION public.recruiter_profile_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending';
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
    NEW.admin_notes := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Allow the one safe transition: self-resubmission from rejected -> pending
    IF OLD.verification_status = 'rejected'
       AND NEW.verification_status = 'pending'
       AND OLD.user_id = auth.uid()
       AND OLD.status <> 'suspended'
       AND OLD.verification_status <> 'suspended'
    THEN
      NEW.verified_at := NULL;
      NEW.verified_by := NULL;
      NEW.admin_notes := OLD.admin_notes;
      NEW.status := OLD.status;
    ELSE
      -- Block all other non-admin verification_status changes
      NEW.verification_status := OLD.verification_status;
      NEW.verified_at := OLD.verified_at;
      NEW.verified_by := OLD.verified_by;
      NEW.admin_notes := OLD.admin_notes;
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Ensure the trigger exists on recruiter_profiles
DROP TRIGGER IF EXISTS recruiter_profile_guard ON public.recruiter_profiles;
CREATE TRIGGER recruiter_profile_guard
  BEFORE INSERT OR UPDATE ON public.recruiter_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.recruiter_profile_guard();