-- Phase R3: auto-approve opportunities posted by verified+active recruiters.
-- Previously every insert was forced to admin_review_status='pending', but no
-- admin queue actively reviews them, so posts never reached the driver feed.
-- Verified recruiters now go live immediately; admins retain the ability to
-- reject or suspend afterward. Non-verified inserts still land 'pending'
-- (defense-in-depth; the billing guard also blocks status='active' for them).

CREATE OR REPLACE FUNCTION public.opportunities_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _is_owner_approved boolean := false;
  _allow_featured_sync boolean := (
    COALESCE(current_setting('app.allow_featured_sync', true), 'false') = 'true'
  );
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = NEW.recruiter_id
        AND rp.user_id = auth.uid()
        AND rp.verification_status = 'approved'
        AND rp.status <> 'suspended'
        AND rp.verification_status <> 'suspended'
    ) INTO _is_owner_approved;

    NEW.admin_review_status := CASE
      WHEN _is_owner_approved THEN 'approved'
      ELSE 'pending'
    END;
    NEW.view_count := 0;
    NEW.published_at := CASE
      WHEN _is_owner_approved AND NEW.status = 'active' THEN now()
      ELSE NULL
    END;
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

    IF _is_owner_approved
       AND OLD.admin_review_status = 'rejected'
       AND COALESCE(NEW.status, OLD.status) = 'active'
    THEN
      -- Resubmission after rejection — auto-approve again since recruiter is verified.
      NEW.admin_review_status := 'approved';
    ELSE
      NEW.admin_review_status := OLD.admin_review_status;
    END IF;

    IF _allow_featured_sync IS NOT TRUE THEN
      NEW.featured := OLD.featured;
    END IF;

    NEW.view_count := OLD.view_count;
    -- Stamp published_at the first time it goes live.
    IF OLD.published_at IS NULL
       AND NEW.status = 'active'
       AND NEW.admin_review_status = 'approved'
    THEN
      NEW.published_at := now();
    ELSE
      NEW.published_at := OLD.published_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;