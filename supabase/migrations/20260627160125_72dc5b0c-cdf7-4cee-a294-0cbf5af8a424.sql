-- Phase 3: Safe bridge from opportunity_applications -> driver_referrals
-- When a referred driver applies (and as their application progresses), advance
-- the linked referral forward through the existing referral status enum so the
-- referrer sees safe milestone progress. Never exposes applicant PII, recruiter
-- notes, or application contents — only the mapped referral status, which the
-- existing referrer UI already renders via referralStatusLabel().

CREATE OR REPLACE FUNCTION public.referral_status_rank(_s text)
RETURNS int
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _s
    WHEN 'referral_sent' THEN 1
    WHEN 'driver_viewed' THEN 2
    WHEN 'driver_requested_info' THEN 3
    WHEN 'recruiter_contacted' THEN 4
    WHEN 'application_started' THEN 5
    WHEN 'interview_scheduled' THEN 6
    WHEN 'offer_sent' THEN 7
    WHEN 'contract_sent' THEN 8
    WHEN 'hired' THEN 9
    WHEN 'waiting_period_started' THEN 10
    WHEN 'waiting_period_completed' THEN 11
    WHEN 'eligible_for_bonus' THEN 12
    WHEN 'marked_paid_externally' THEN 13
    WHEN 'closed_not_hired' THEN 99
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION public.bridge_application_to_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _mapped text;
  _ref RECORD;
BEGIN
  -- Map application status -> referrer-safe referral status.
  -- 'viewed'/'contact_requested'/'contacted' do not outrank 'application_started'
  -- in the referral enum, so we leave the referral at 'application_started' for
  -- those (no regression, no extra event spam).
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

  -- Find any driver_referral that matches this opportunity + referred driver.
  -- Only the referrer sees these rows (via list_my_driver_referrals RPC).
  FOR _ref IN
    SELECT id, status
    FROM public.driver_referrals
    WHERE opportunity_id = NEW.opportunity_id
      AND referred_driver_user_id = NEW.driver_user_id
  LOOP
    -- Skip if already terminal or already at/ahead of mapped status.
    IF _ref.status IN ('marked_paid_externally','closed_not_hired') THEN
      CONTINUE;
    END IF;
    -- 'closed_not_hired' is allowed from any non-terminal state; otherwise
    -- only advance forward by rank to avoid regressions / event spam.
    IF _mapped = 'closed_not_hired'
       OR public.referral_status_rank(_mapped) > public.referral_status_rank(_ref.status)
    THEN
      UPDATE public.driver_referrals
        SET status = _mapped,
            last_status_at = now()
        WHERE id = _ref.id;
      -- The existing AFTER UPDATE trigger driver_referrals_emit_event writes
      -- a referral_status_events row (actor_role='system' since auth.uid()
      -- is the applying driver, not the referrer/recruiter).
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bridge_app_to_referral_ins ON public.opportunity_applications;
DROP TRIGGER IF EXISTS trg_bridge_app_to_referral_upd ON public.opportunity_applications;

CREATE TRIGGER trg_bridge_app_to_referral_ins
AFTER INSERT ON public.opportunity_applications
FOR EACH ROW EXECUTE FUNCTION public.bridge_application_to_referral();

CREATE TRIGGER trg_bridge_app_to_referral_upd
AFTER UPDATE OF status ON public.opportunity_applications
FOR EACH ROW EXECUTE FUNCTION public.bridge_application_to_referral();

-- Helpful index for the bridge lookup.
CREATE INDEX IF NOT EXISTS idx_driver_referrals_opp_referred
  ON public.driver_referrals (opportunity_id, referred_driver_user_id)
  WHERE referred_driver_user_id IS NOT NULL;