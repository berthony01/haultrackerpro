
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
    SELECT EXISTS (
      SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = NEW.recruiter_id
        AND rp.user_id = auth.uid()
        AND rp.verification_status = 'approved'
        AND rp.status <> 'suspended'
    ) INTO _is_owner_approved;

    -- Auto-resubmission: rejected opportunity, owned by approved recruiter, kept active → pending
    IF _is_owner_approved
       AND OLD.admin_review_status = 'rejected'
       AND COALESCE(NEW.status, OLD.status) = 'active'
    THEN
      NEW.admin_review_status := 'pending';
    ELSE
      NEW.admin_review_status := OLD.admin_review_status;
    END IF;

    NEW.featured := OLD.featured;
    NEW.view_count := OLD.view_count;
    NEW.published_at := OLD.published_at;
  END IF;
  RETURN NEW;
END;
$function$;
