
-- ============================================================================
-- Phase 3C: Referral bridge hardening
-- ============================================================================

-- 1) Patch driver_referrals_before_update to allow an internal bridge bypass.
--    The bridge sets a transaction-local flag; only narrow fields may change
--    on that path, and only bridge-safe statuses are accepted.
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
  _is_bridge boolean := (COALESCE(current_setting('app.referral_bridge_update', true), 'false') = 'true');
  _recruiter_allowed text[] := ARRAY[
    'recruiter_contacted','application_started','interview_scheduled',
    'offer_sent','contract_sent','hired',
    'waiting_period_started','waiting_period_completed',
    'eligible_for_bonus','marked_paid_externally','closed_not_hired'
  ];
  _bridge_allowed text[] := ARRAY[
    'application_started','interview_scheduled','offer_sent',
    'hired','closed_not_hired'
  ];
  _protected text[] := ARRAY[
    'waiting_period_started','waiting_period_completed',
    'eligible_for_bonus','marked_paid_externally'
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

  -- Lock immutable ownership / contact fields for all non-admin paths.
  NEW.opportunity_id      := OLD.opportunity_id;
  NEW.recruiter_id        := OLD.recruiter_id;
  NEW.referring_driver_id := OLD.referring_driver_id;
  NEW.referred_driver_name  := OLD.referred_driver_name;
  NEW.referred_driver_email := OLD.referred_driver_email;
  NEW.referred_driver_phone := OLD.referred_driver_phone;
  NEW.referred_driver_note  := OLD.referred_driver_note;

  IF _is_bridge THEN
    -- Bridge path: may set referred_driver_user_id if it was NULL (safe link),
    -- and may advance status only within the bridge whitelist.
    IF OLD.referred_driver_user_id IS NULL THEN
      -- keep whatever NEW.referred_driver_user_id is (may be set by bridge)
      NULL;
    ELSE
      NEW.referred_driver_user_id := OLD.referred_driver_user_id;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- Never downgrade recruiter-controlled payout states from the bridge.
      IF OLD.status = ANY(_protected) THEN
        NEW.status := OLD.status;
      ELSIF NEW.status IS NULL OR NOT (NEW.status = ANY(_bridge_allowed)) THEN
        -- Disallowed bridge status -> ignore the change
        NEW.status := OLD.status;
      END IF;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.last_status_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- Non-bridge paths cannot move referred_driver_user_id.
  NEW.referred_driver_user_id := OLD.referred_driver_user_id;

  SELECT public.is_recruiter_owner(_uid, OLD.recruiter_id) INTO _is_recruiter_owner;

  IF _is_recruiter_owner THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IS NULL OR NOT (NEW.status = ANY(_recruiter_allowed)) THEN
        RAISE EXCEPTION 'Recruiters may only update recruiter-controlled referral statuses.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF _is_referring_driver THEN
    -- Driver-side updates cannot change status from this trigger path.
    NEW.status := OLD.status;
  ELSE
    NEW.status := OLD.status;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_status_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) Patch bridge_application_to_referral:
--    - email/phone-only matching via auth.users.email + driver_opportunity_profiles.phone
--    - deterministic single-credit (earliest referral wins)
--    - skip protected payout states
--    - safe-link referred_driver_user_id on first match
--    - set transaction-local bridge flag for the guard
CREATE OR REPLACE FUNCTION public.bridge_application_to_referral()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _mapped text;
  _ref RECORD;
  _driver_email text;
  _driver_phone text;
  _protected text[] := ARRAY[
    'waiting_period_started','waiting_period_completed',
    'eligible_for_bonus','marked_paid_externally','closed_not_hired'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    _mapped := 'application_started';
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    _mapped := CASE NEW.status
      WHEN 'new'                THEN 'application_started'
      WHEN 'viewed'             THEN 'application_started'
      WHEN 'contact_requested'  THEN 'application_started'
      WHEN 'contacted'          THEN 'application_started'
      WHEN 'call_scheduled'     THEN 'interview_scheduled'
      WHEN 'waiting_documents'  THEN 'interview_scheduled'
      WHEN 'interviewing'       THEN 'interview_scheduled'
      WHEN 'offer_sent'         THEN 'offer_sent'
      WHEN 'hired'              THEN 'hired'
      WHEN 'rejected'           THEN 'closed_not_hired'
      WHEN 'withdrawn'          THEN 'closed_not_hired'
      ELSE NULL
    END;
  ELSE
    RETURN NEW;
  END IF;

  IF _mapped IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve applying driver's contact fingerprints (server-side only).
  SELECT lower(btrim(u.email)) INTO _driver_email
    FROM auth.users u WHERE u.id = NEW.driver_user_id;

  SELECT NULLIF(btrim(dop.phone), '') INTO _driver_phone
    FROM public.driver_opportunity_profiles dop
   WHERE dop.user_id = NEW.driver_user_id
   ORDER BY dop.updated_at DESC NULLS LAST
   LIMIT 1;

  -- Pick exactly ONE deterministic referral to credit:
  --   1) prefer rows already linked by referred_driver_user_id
  --   2) then email match
  --   3) then phone match
  --   pick earliest by created_at, tiebreak by id
  SELECT id, status, referred_driver_user_id
    INTO _ref
    FROM public.driver_referrals dr
   WHERE dr.opportunity_id = NEW.opportunity_id
     AND (
       dr.referred_driver_user_id = NEW.driver_user_id
       OR (_driver_email IS NOT NULL
           AND lower(btrim(dr.referred_driver_email)) = _driver_email)
       OR (_driver_phone IS NOT NULL
           AND btrim(dr.referred_driver_phone) = _driver_phone)
     )
   ORDER BY
     (CASE WHEN dr.referred_driver_user_id = NEW.driver_user_id THEN 0
           WHEN _driver_email IS NOT NULL
                AND lower(btrim(dr.referred_driver_email)) = _driver_email THEN 1
           ELSE 2 END),
     dr.created_at ASC,
     dr.id ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Never override protected recruiter-controlled payout/terminal states.
  IF _ref.status = ANY(_protected) THEN
    RETURN NEW;
  END IF;

  -- Forward-only advance, except closed_not_hired is allowed from any
  -- non-protected state.
  IF _mapped <> 'closed_not_hired'
     AND public.referral_status_rank(_mapped) <= public.referral_status_rank(_ref.status)
  THEN
    RETURN NEW;
  END IF;

  -- Set the transaction-local bridge flag, then update.
  PERFORM set_config('app.referral_bridge_update', 'true', true);
  BEGIN
    UPDATE public.driver_referrals
       SET status = _mapped,
           last_status_at = now(),
           referred_driver_user_id = COALESCE(referred_driver_user_id, NEW.driver_user_id)
     WHERE id = _ref.id;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.referral_bridge_update', 'false', true);
    RAISE;
  END;
  PERFORM set_config('app.referral_bridge_update', 'false', true);

  RETURN NEW;
END;
$function$;
