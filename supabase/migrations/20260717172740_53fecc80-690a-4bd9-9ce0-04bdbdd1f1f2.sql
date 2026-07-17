-- Phase 1F-A: Recruiter Immediate Standard Posting Authorization
-- Completing the Recruiter profile unlocks standard opportunity posting.
-- Admin verification adds trust badge only. Suspension still blocks.

CREATE OR REPLACE FUNCTION public.recruiter_can_post(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.user_id = _user_id
      AND COALESCE(btrim(rp.recruiter_name), '') <> ''
      AND COALESCE(btrim(rp.company_name), '') <> ''
      AND COALESCE(btrim(rp.recruiter_email), '') <> ''
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  );
$$;

REVOKE ALL ON FUNCTION public.recruiter_can_post(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.recruiter_can_post(uuid) TO authenticated, service_role;

-- Rewrite the opportunities INSERT/UPDATE guard so eligibility is the
-- "profile is complete + not suspended" rule, not "verified".
CREATE OR REPLACE FUNCTION public.opportunities_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _owner_user uuid;
  _is_eligible boolean := false;
  _allow_featured_sync boolean := (
    COALESCE(current_setting('app.allow_featured_sync', true), 'false') = 'true'
  );
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT rp.user_id INTO _owner_user
    FROM public.recruiter_profiles rp
    WHERE rp.id = NEW.recruiter_id;

    _is_eligible := (_owner_user IS NOT NULL
      AND _owner_user = auth.uid()
      AND public.recruiter_can_post(auth.uid()));

    -- Eligible recruiters skip manual admin review for standard posts.
    -- Admin moderation can still flag, reject, or remove after the fact.
    NEW.admin_review_status := CASE
      WHEN _is_eligible THEN 'approved'
      ELSE 'pending'
    END;
    NEW.featured := false;
    NEW.view_count := 0;
    NEW.published_at := CASE
      WHEN _is_eligible AND NEW.status = 'active' THEN now()
      ELSE NULL
    END;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Rejected posts must be re-reviewed after edits.
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

-- Publish-time guard: block activating an opportunity unless the
-- recruiter's profile is complete and not suspended. No verification needed.
CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _is_becoming_active boolean := false;
  _owner_user uuid;
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

  SELECT rp.user_id INTO _owner_user
  FROM public.recruiter_profiles rp
  WHERE rp.id = NEW.recruiter_id;

  IF _owner_user IS NULL
     OR _owner_user <> auth.uid()
     OR NOT public.recruiter_can_post(auth.uid())
  THEN
    RAISE EXCEPTION 'Complete your recruiter profile to publish opportunities.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;