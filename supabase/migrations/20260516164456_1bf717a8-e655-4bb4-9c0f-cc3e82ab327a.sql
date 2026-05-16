-- Allow the billing-sync trigger to update opportunities.featured even though
-- opportunities_guard normally pins featured := OLD.featured for non-admin updates.
-- Uses a session-local GUC sentinel (same pattern as app.allow_driver_withdraw).

CREATE OR REPLACE FUNCTION public.opportunities_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_owner_approved boolean := false;
  _allow_featured_sync boolean := (current_setting('app.allow_featured_sync', true) = 'true');
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.admin_review_status := 'pending';
    -- featured is set by trg_opportunities_set_featured (BEFORE INSERT) based on plan
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

    IF _is_owner_approved
       AND OLD.admin_review_status = 'rejected'
       AND COALESCE(NEW.status, OLD.status) = 'active'
    THEN
      NEW.admin_review_status := 'pending';
    ELSE
      NEW.admin_review_status := OLD.admin_review_status;
    END IF;

    -- Only pin featured to OLD when the system-controlled sync is NOT in flight.
    IF NOT _allow_featured_sync THEN
      NEW.featured := OLD.featured;
    END IF;

    NEW.view_count := OLD.view_count;
    NEW.published_at := OLD.published_at;
  END IF;
  RETURN NEW;
END;
$$;

-- Update billing sync trigger to set the GUC sentinel before updating opportunities.
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
  PERFORM set_config('app.allow_featured_sync', 'true', true);
  UPDATE public.opportunities
    SET featured = v_featured
    WHERE recruiter_id = NEW.recruiter_id
      AND featured IS DISTINCT FROM v_featured;
  PERFORM set_config('app.allow_featured_sync', 'false', true);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.opportunities_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recruiter_billing_sync_featured() FROM PUBLIC, anon, authenticated;