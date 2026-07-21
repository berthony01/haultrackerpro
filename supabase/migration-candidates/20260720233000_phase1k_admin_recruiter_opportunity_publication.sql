-- Phase 1K-A1: Admin recruiter opportunity publication integrity.
--
-- Fixes a defect in the live public.opportunities_guard() trigger, where an
-- unconditional top-level `IF public.is_admin(auth.uid()) THEN RETURN NEW;`
-- causes admin users posting through their OWN eligible recruiter profile to
-- skip normal publication stamping. The row persists with the client-supplied
-- (or default) admin_review_status/published_at values, so an admin-recruiter
-- posting that reports "success" in the recruiter UI can stay
-- status='active', admin_review_status='pending', published_at=NULL and never
-- appear in the driver-visible RPC.
--
-- This CREATE OR REPLACE is idempotent and preserves:
--   * language plpgsql, SECURITY DEFINER, and pinned search_path
--   * _allow_featured_sync behavior
--   * non-admin recruiter INSERT/UPDATE behavior (byte-equivalent SQL)
--   * rejected-row resubmission behavior
--   * featured/view_count protection
--   * published_at rules
--
-- The classification adds admin-role branching by ownership:
--   A. admin + NOT owner of NEW.recruiter_id -> preserve admin bypass
--      (RETURN NEW), retaining existing admin moderation authority for other
--      recruiters.
--   B. admin + owner of NEW.recruiter_id
--        * INSERT -> normal recruiter normalization
--        * UPDATE with no change to admin_review_status, featured, view_count,
--          or published_at -> normal recruiter normalization
--        * UPDATE with an explicit change to any of admin_review_status,
--          featured, view_count, or published_at -> preserve admin bypass so
--          explicit self-moderation remains possible.
--   C. non-admin -> unchanged.
--
-- No policy, grant, table, column, trigger binding, or trigger count is
-- changed. list_driver_visible_opportunities, driver_can_access_opportunity,
-- and opportunities_billing_guard are not touched here.

CREATE OR REPLACE FUNCTION public.opportunities_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _is_eligible boolean := false;
  _is_admin boolean := public.is_admin(auth.uid());
  _owns_recruiter_profile boolean := EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = NEW.recruiter_id
      AND rp.user_id = auth.uid()
  );
  _is_explicit_admin_moderation boolean := false;
  _allow_featured_sync boolean := (
    COALESCE(current_setting('app.allow_featured_sync', true), 'false') = 'true'
  );
BEGIN
  -- A. Admin acting on another recruiter's opportunity: preserve bypass.
  IF _is_admin AND NOT _owns_recruiter_profile THEN
    RETURN NEW;
  END IF;

  -- B. Admin acting on their OWN recruiter opportunity:
  --    explicit protected-field UPDATE stays administrative; otherwise the
  --    row is normalized like an ordinary recruiter write.
  IF TG_OP = 'UPDATE' AND _is_admin AND _owns_recruiter_profile THEN
    _is_explicit_admin_moderation :=
         (NEW.admin_review_status IS DISTINCT FROM OLD.admin_review_status)
      OR (NEW.featured             IS DISTINCT FROM OLD.featured)
      OR (NEW.view_count           IS DISTINCT FROM OLD.view_count)
      OR (NEW.published_at         IS DISTINCT FROM OLD.published_at);
    IF _is_explicit_admin_moderation THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Normal recruiter INSERT normalization (also for admin-own INSERT).
  IF TG_OP = 'INSERT' THEN
    _is_eligible := public.current_user_can_manage_recruiter_opportunities(NEW.recruiter_id);

    NEW.admin_review_status := CASE WHEN _is_eligible THEN 'approved' ELSE 'pending' END;
    NEW.featured := false;
    NEW.view_count := 0;
    NEW.published_at := CASE
      WHEN _is_eligible AND NEW.status = 'active' THEN now()
      ELSE NULL
    END;
    RETURN NEW;
  END IF;

  -- Normal recruiter UPDATE normalization (also for admin-own ordinary UPDATE).
  IF TG_OP = 'UPDATE' THEN
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
