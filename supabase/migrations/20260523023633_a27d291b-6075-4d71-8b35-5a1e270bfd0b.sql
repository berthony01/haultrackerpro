
-- Phase 6A: referral integrity & status safety patch

-- PART 1 & 2: rebuild insert trigger to force safe status + normalize blanks
CREATE OR REPLACE FUNCTION public.driver_referrals_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _opp public.opportunities;
BEGIN
  SELECT * INTO _opp FROM public.opportunities WHERE id = NEW.opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opportunity not found' USING ERRCODE = '23503';
  END IF;

  NEW.recruiter_id := _opp.recruiter_id;

  IF NOT public.is_admin(auth.uid()) THEN
    IF _opp.status <> 'active' OR _opp.admin_review_status <> 'approved' THEN
      RAISE EXCEPTION 'Cannot create referral for an opportunity that is not approved and active'
        USING ERRCODE = '42501';
    END IF;
    -- Force initial status for non-admins; drivers may never seed advanced statuses
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

-- PART 3: rebuild unique indexes to ignore blanks and normalize email
DROP INDEX IF EXISTS public.idx_driver_referrals_unique_email;
DROP INDEX IF EXISTS public.idx_driver_referrals_unique_phone;

CREATE UNIQUE INDEX idx_driver_referrals_unique_email
  ON public.driver_referrals (
    opportunity_id,
    referring_driver_id,
    (lower(btrim(referred_driver_email)))
  )
  WHERE NULLIF(btrim(referred_driver_email), '') IS NOT NULL;

CREATE UNIQUE INDEX idx_driver_referrals_unique_phone
  ON public.driver_referrals (
    opportunity_id,
    referring_driver_id,
    (btrim(referred_driver_phone))
  )
  WHERE NULLIF(btrim(referred_driver_phone), '') IS NOT NULL;

-- PART 4: lock recruiter contact-field edits, preserve driver/admin rules
CREATE OR REPLACE FUNCTION public.driver_referrals_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_admin boolean := public.is_admin(_uid);
  _is_recruiter_owner boolean := false;
  _is_referring_driver boolean := (_uid IS NOT NULL AND _uid = OLD.referring_driver_id);
BEGIN
  IF _is_admin THEN
    -- Admin: still bump last_status_at on status change; normalize blanks for consistency
    NEW.referred_driver_name  := NULLIF(btrim(NEW.referred_driver_name),  '');
    NEW.referred_driver_email := NULLIF(lower(btrim(NEW.referred_driver_email)), '');
    NEW.referred_driver_phone := NULLIF(btrim(NEW.referred_driver_phone), '');
    NEW.referred_driver_note  := NULLIF(btrim(NEW.referred_driver_note),  '');
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.last_status_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- Lock immutable ownership fields for all non-admins
  NEW.opportunity_id          := OLD.opportunity_id;
  NEW.recruiter_id            := OLD.recruiter_id;
  NEW.referring_driver_id     := OLD.referring_driver_id;
  NEW.referred_driver_user_id := OLD.referred_driver_user_id;

  SELECT public.is_recruiter_owner(_uid, OLD.recruiter_id) INTO _is_recruiter_owner;

  IF _is_recruiter_owner THEN
    -- Recruiter may only change status. Pin all contact fields to OLD.
    NEW.referred_driver_name  := OLD.referred_driver_name;
    NEW.referred_driver_email := OLD.referred_driver_email;
    NEW.referred_driver_phone := OLD.referred_driver_phone;
    NEW.referred_driver_note  := OLD.referred_driver_note;
  ELSIF _is_referring_driver THEN
    -- Referring driver may only correct contact/note while status = referral_sent.
    IF OLD.status <> 'referral_sent' THEN
      -- Pin everything; effectively a no-op update.
      NEW.referred_driver_name  := OLD.referred_driver_name;
      NEW.referred_driver_email := OLD.referred_driver_email;
      NEW.referred_driver_phone := OLD.referred_driver_phone;
      NEW.referred_driver_note  := OLD.referred_driver_note;
    ELSE
      NEW.referred_driver_name  := NULLIF(btrim(NEW.referred_driver_name),  '');
      NEW.referred_driver_email := NULLIF(lower(btrim(NEW.referred_driver_email)), '');
      NEW.referred_driver_phone := NULLIF(btrim(NEW.referred_driver_phone), '');
      NEW.referred_driver_note  := NULLIF(btrim(NEW.referred_driver_note),  '');
    END IF;
    -- Driver may never change status here
    NEW.status := OLD.status;
  ELSE
    -- Any other actor: pin everything (RLS should already block, defense-in-depth)
    NEW.referred_driver_name  := OLD.referred_driver_name;
    NEW.referred_driver_email := OLD.referred_driver_email;
    NEW.referred_driver_phone := OLD.referred_driver_phone;
    NEW.referred_driver_note  := OLD.referred_driver_note;
    NEW.status                := OLD.status;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_status_at := now();
  END IF;
  RETURN NEW;
END;
$$;
