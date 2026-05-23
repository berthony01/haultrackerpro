
-- Extend notification_category helper so 'referral_*' types route to the
-- existing recruiter_status_events preference toggle (no new prefs column).
CREATE OR REPLACE FUNCTION public.notification_category(_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _type LIKE 'application_%' THEN 'application_events'
    WHEN _type LIKE 'contact_request_%' THEN 'contact_request_events'
    WHEN _type LIKE 'contract_%' THEN 'contract_events'
    WHEN _type LIKE 'recruiter_profile_%' OR _type LIKE 'opportunity_%' THEN 'recruiter_status_events'
    WHEN _type LIKE 'referral_%' OR _type = 'referred_driver_linked' THEN 'recruiter_status_events'
    ELSE 'application_events'
  END
$$;

-- Trigger function: referral INSERT
CREATE OR REPLACE FUNCTION public.notify_referral_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _opp_title text;
  _opp_company text;
  _recruiter_user_id uuid;
  _opp_label text;
BEGIN
  SELECT o.title, o.company_name, rp.user_id
    INTO _opp_title, _opp_company, _recruiter_user_id
    FROM public.opportunities o
    JOIN public.recruiter_profiles rp ON rp.id = o.recruiter_id
   WHERE o.id = NEW.opportunity_id;

  _opp_label := COALESCE(NULLIF(_opp_title, ''), NULLIF(_opp_company, ''), 'your opportunity');

  -- Notify owning recruiter
  IF _recruiter_user_id IS NOT NULL THEN
    PERFORM public.create_notification(
      _recruiter_user_id,
      'referral_created',
      'New driver referral',
      'A driver referred someone to "' || _opp_label || '". Haul Tracker Pro tracks referral progress only.',
      jsonb_build_object(
        'referral_id', NEW.id,
        'opportunity_id', NEW.opportunity_id,
        'recruiter_id', NEW.recruiter_id,
        'status', NEW.status
      )
    );
  END IF;

  -- Notify linked referred driver (only if a real account is linked and not the same as referring driver)
  IF NEW.referred_driver_user_id IS NOT NULL
     AND NEW.referred_driver_user_id <> NEW.referring_driver_id THEN
    PERFORM public.create_notification(
      NEW.referred_driver_user_id,
      'referred_driver_linked',
      'You were referred to an opportunity',
      'A driver referred you to a recruiter opportunity. Haul Tracker Pro tracks referral progress only.',
      jsonb_build_object(
        'referral_id', NEW.id,
        'opportunity_id', NEW.opportunity_id,
        'recruiter_id', NEW.recruiter_id
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger function: referral status UPDATE
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

  _label := replace(NEW.status, '_', ' ');
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
    _body := 'Your referral status changed to "' || _label || '".';
  END IF;

  -- Notify referring driver
  IF NEW.referring_driver_id IS NOT NULL THEN
    PERFORM public.create_notification(
      NEW.referring_driver_id, _type, _title, _body, _payload
    );
  END IF;

  -- Notify linked referred driver, only if present and not the same user
  IF NEW.referred_driver_user_id IS NOT NULL
     AND NEW.referred_driver_user_id <> NEW.referring_driver_id THEN
    PERFORM public.create_notification(
      NEW.referred_driver_user_id, _type, _title, _body, _payload
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_referral_insert ON public.driver_referrals;
CREATE TRIGGER trg_notify_referral_insert
  AFTER INSERT ON public.driver_referrals
  FOR EACH ROW EXECUTE FUNCTION public.notify_referral_insert();

DROP TRIGGER IF EXISTS trg_notify_referral_status_update ON public.driver_referrals;
CREATE TRIGGER trg_notify_referral_status_update
  AFTER UPDATE OF status ON public.driver_referrals
  FOR EACH ROW EXECUTE FUNCTION public.notify_referral_status_update();
