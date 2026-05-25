-- Phase 19A: Pro-only gate for driver referral submissions
CREATE OR REPLACE FUNCTION public.driver_referrals_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _opp public.opportunities;
  _uid uuid := auth.uid();
  _is_admin boolean := public.is_admin(_uid);
  _is_pro boolean := false;
BEGIN
  SELECT * INTO _opp FROM public.opportunities WHERE id = NEW.opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opportunity not found' USING ERRCODE = '23503';
  END IF;

  NEW.recruiter_id := _opp.recruiter_id;

  IF NOT _is_admin THEN
    IF _uid IS NULL THEN
      RAISE EXCEPTION 'Driver referrals are a Pro feature.' USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = _uid
        AND s.status = 'active'
        AND s.plan_key IN ('pro_monthly', 'pro_yearly')
    ) INTO _is_pro;

    IF NOT _is_pro THEN
      RAISE EXCEPTION 'Driver referrals are a Pro feature.' USING ERRCODE = '42501';
    END IF;

    IF _opp.status <> 'active' OR _opp.admin_review_status <> 'approved' THEN
      RAISE EXCEPTION 'Cannot create referral for an opportunity that is not approved and active'
        USING ERRCODE = '42501';
    END IF;

    NEW.status := 'referral_sent';
  ELSE
    NEW.status := COALESCE(NEW.status, 'referral_sent');
  END IF;

  -- Normalize blank contact fields
  NEW.referred_driver_name  := NULLIF(btrim(NEW.referred_driver_name),  '');
  NEW.referred_driver_email := NULLIF(lower(btrim(NEW.referred_driver_email)), '');
  NEW.referred_driver_phone := NULLIF(btrim(NEW.referred_driver_phone), '');
  NEW.referred_driver_note  := NULLIF(btrim(NEW.referred_driver_note),  '');

  NEW.last_status_at := now();
  RETURN NEW;
END;
$$;