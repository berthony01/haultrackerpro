-- Phase 2A: Harden premium featured/priority placement protection.
-- Bug: current_setting('app.allow_featured_sync', true) returns NULL when unset,
-- making `_allow_featured_sync` NULL and `IF NOT _allow_featured_sync` evaluate
-- as NULL (treated as false), which silently skipped pinning NEW.featured to
-- OLD.featured during recruiter UPDATEs. Free/Starter recruiters could then
-- self-promote featured = true via direct UPDATE.

CREATE OR REPLACE FUNCTION public.opportunities_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_owner_approved boolean := false;
  -- COALESCE the GUC so unset/NULL is treated as 'false'. Only the
  -- billing-sync trigger explicitly sets it to 'true'.
  _allow_featured_sync boolean := (
    COALESCE(current_setting('app.allow_featured_sync', true), 'false') = 'true'
  );
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

    -- Pin featured to OLD unless the billing-sync trigger explicitly set the
    -- sentinel GUC to 'true'. Unset GUC is treated as false via COALESCE above.
    IF _allow_featured_sync IS NOT TRUE THEN
      NEW.featured := OLD.featured;
    END IF;

    NEW.view_count := OLD.view_count;
    NEW.published_at := OLD.published_at;
  END IF;
  RETURN NEW;
END;
$function$;

-- Defense-in-depth ownership check on the billing/posting guard.
-- Phase 2 behavior preserved: no billing status check, no count check,
-- no active_opportunity_limit check. We only additionally require that
-- the recruiter_profile row belongs to the authenticated user.
CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_becoming_active boolean := false;
BEGIN
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

  IF NOT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = NEW.recruiter_id
      AND rp.user_id = auth.uid()
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