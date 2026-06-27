-- Phase 1A: rejected opportunities can NEVER auto-approve from a recruiter-side
-- update. They must go through admin review again. Brand-new posts from
-- verified recruiters still auto-approve on INSERT.

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
    -- Recruiter-side updates can never change admin_review_status.
    -- If the post was previously rejected, force it back to 'pending' so
    -- admins re-review the edited content. It stays hidden from the driver
    -- feed (which requires admin_review_status='approved') until then.
    IF OLD.admin_review_status = 'rejected' THEN
      NEW.admin_review_status := 'pending';
      NEW.published_at := NULL;
    ELSE
      NEW.admin_review_status := OLD.admin_review_status;
    END IF;

    IF _allow_featured_sync IS NOT TRUE THEN
      NEW.featured := OLD.featured;
    END IF;

    NEW.view_count := OLD.view_count;
    -- Stamp published_at the first time it goes live (only when still approved).
    IF OLD.admin_review_status <> 'rejected'
       AND OLD.published_at IS NULL
       AND NEW.status = 'active'
       AND NEW.admin_review_status = 'approved'
    THEN
      NEW.published_at := now();
    ELSIF OLD.admin_review_status <> 'rejected' THEN
      NEW.published_at := OLD.published_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;