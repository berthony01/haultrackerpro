CREATE OR REPLACE FUNCTION public.driver_referrals_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_admin boolean := public.is_admin(_uid);
  _is_recruiter_owner boolean := false;
  _is_referring_driver boolean := (_uid IS NOT NULL AND _uid = OLD.referring_driver_id);
  _recruiter_allowed text[] := ARRAY[
    'recruiter_contacted',
    'application_started',
    'interview_scheduled',
    'offer_sent',
    'contract_sent',
    'hired',
    'waiting_period_started',
    'waiting_period_completed',
    'eligible_for_bonus',
    'marked_paid_externally',
    'closed_not_hired'
  ];
BEGIN
  IF _is_admin THEN
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

    -- Whitelist recruiter-controlled statuses on actual status changes.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IS NULL OR NOT (NEW.status = ANY(_recruiter_allowed)) THEN
        RAISE EXCEPTION 'Recruiters may only update recruiter-controlled referral statuses.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF _is_referring_driver THEN
    -- Referring driver may only correct contact/note while status = referral_sent.
    IF OLD.status <> 'referral_sent' THEN
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
$function$;