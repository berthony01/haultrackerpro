-- Replace referral status update trigger function with polished status labels
CREATE OR REPLACE FUNCTION public.notify_referral_status_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _label text;
  _type text;
  _title text;
  _body text;
  _payload jsonb;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  _label := CASE NEW.status
    WHEN 'referral_sent' THEN 'Referral sent'
    WHEN 'driver_viewed' THEN 'Driver viewed'
    WHEN 'driver_requested_info' THEN 'Driver requested info'
    WHEN 'recruiter_contacted' THEN 'Recruiter contacted'
    WHEN 'application_started' THEN 'Application started'
    WHEN 'interview_scheduled' THEN 'Interview scheduled'
    WHEN 'offer_sent' THEN 'Offer sent'
    WHEN 'contract_sent' THEN 'Contract sent'
    WHEN 'hired' THEN 'Hired'
    WHEN 'waiting_period_started' THEN 'Waiting period started'
    WHEN 'waiting_period_completed' THEN 'Waiting period completed'
    WHEN 'eligible_for_bonus' THEN 'Eligible based on recruiter terms'
    WHEN 'marked_paid_externally' THEN 'Marked paid externally'
    WHEN 'closed_not_hired' THEN 'Closed, not hired'
    ELSE initcap(replace(NEW.status, '_', ' '))
  END;

  _payload := jsonb_build_object(
    'referral_id', NEW.id,
    'opportunity_id', NEW.opportunity_id,
    'recruiter_id', NEW.recruiter_id,
    'previous_status', OLD.status,
    'new_status', NEW.status
  );

  IF NEW.status = 'marked_paid_externally' THEN
    _type := 'referral_paid_externally_marked';
    _title := 'Referral marked paid externally';
    _body := 'The recruiter marked this referral as paid externally. Haul Tracker Pro does not process or verify payment.';
  ELSE
    _type := 'referral_status_updated';
    _title := 'Referral status updated';
    _body := 'Your referral status changed to ' || _label || '.';
  END IF;

  IF NEW.referring_driver_id IS NOT NULL THEN
    PERFORM public.create_notification(
      NEW.referring_driver_id, _type, _title, _body, _payload
    );
  END IF;

  IF NEW.referred_driver_user_id IS NOT NULL
     AND NEW.referred_driver_user_id <> NEW.referring_driver_id THEN
    PERFORM public.create_notification(
      NEW.referred_driver_user_id, _type, _title, _body, _payload
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Harden direct execute permissions on referral notification trigger functions.
-- Triggers continue to fire normally; only direct RPC-style invocation is blocked.
REVOKE EXECUTE ON FUNCTION public.notify_referral_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_referral_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_referral_insert() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_referral_status_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_referral_status_update() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_referral_status_update() FROM authenticated;