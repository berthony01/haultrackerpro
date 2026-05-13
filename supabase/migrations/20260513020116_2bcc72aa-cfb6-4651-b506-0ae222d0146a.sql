
-- 1. Allow approved, non-suspended recruiter to resubmit a rejected opportunity
CREATE OR REPLACE FUNCTION public.opportunities_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _is_owner_approved boolean := false;
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.admin_review_status := 'pending';
    NEW.featured := false;
    NEW.view_count := 0;
    NEW.published_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Determine if the acting user owns this recruiter profile and is approved + active
    SELECT EXISTS (
      SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = NEW.recruiter_id
        AND rp.user_id = auth.uid()
        AND rp.verification_status = 'approved'
        AND rp.status <> 'suspended'
    ) INTO _is_owner_approved;

    -- Resubmission path: rejected -> pending when recruiter sets status='active'
    IF _is_owner_approved
       AND OLD.admin_review_status = 'rejected'
       AND NEW.admin_review_status = 'pending'
       AND COALESCE(NEW.status, OLD.status) = 'active'
    THEN
      -- allow flip rejected->pending
      NULL;
    ELSE
      NEW.admin_review_status := OLD.admin_review_status;
    END IF;

    -- Always lock these for non-admins
    NEW.featured := OLD.featured;
    NEW.view_count := OLD.view_count;
    NEW.published_at := OLD.published_at;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. RPC for rejected recruiter resubmission
CREATE OR REPLACE FUNCTION public.resubmit_recruiter_profile(profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.recruiter_profiles;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _row FROM public.recruiter_profiles WHERE id = profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recruiter profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF _row.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _row.status = 'suspended' OR _row.verification_status = 'suspended' THEN
    RAISE EXCEPTION 'Suspended recruiter cannot resubmit' USING ERRCODE = '42501';
  END IF;

  IF _row.verification_status <> 'rejected' THEN
    RAISE EXCEPTION 'Only rejected profiles can be resubmitted' USING ERRCODE = '22023';
  END IF;

  UPDATE public.recruiter_profiles
  SET verification_status = 'pending',
      verified_at = NULL,
      verified_by = NULL,
      updated_at = now()
  WHERE id = profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resubmit_recruiter_profile(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resubmit_recruiter_profile(uuid) TO authenticated;
