
-- ===============================================================
-- Phase 4B: In-app notifications for assistant + agency events
-- ===============================================================

-- 1. Extend preferences ----------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS assistant_events boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS agency_events    boolean NOT NULL DEFAULT true;

-- 2. Teach notification_category about the new types ----------------------
CREATE OR REPLACE FUNCTION public.notification_category(_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _type LIKE 'application_%'      THEN 'application_events'
    WHEN _type LIKE 'contact_request_%'  THEN 'contact_request_events'
    WHEN _type LIKE 'contract_%'         THEN 'contract_events'
    WHEN _type LIKE 'recruiter_profile_%' OR _type LIKE 'opportunity_%'
                                         THEN 'recruiter_status_events'
    WHEN _type LIKE 'assistant_%'        THEN 'assistant_events'
    WHEN _type LIKE 'agency_%'           THEN 'agency_events'
    ELSE 'application_events'
  END
$$;

-- Update create_notification to respect the new categories
CREATE OR REPLACE FUNCTION public.create_notification(
  _user_id uuid,
  _type text,
  _title text,
  _body text,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prefs public.notification_preferences;
  _category text := public.notification_category(_type);
  _enabled boolean := true;
  _id uuid;
BEGIN
  IF _user_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _prefs FROM public.notification_preferences WHERE user_id = _user_id;
  IF FOUND THEN
    IF NOT _prefs.in_app_enabled THEN RETURN NULL; END IF;
    _enabled := CASE _category
      WHEN 'application_events'      THEN _prefs.application_events
      WHEN 'contact_request_events'  THEN _prefs.contact_request_events
      WHEN 'contract_events'         THEN _prefs.contract_events
      WHEN 'recruiter_status_events' THEN _prefs.recruiter_status_events
      WHEN 'assistant_events'        THEN _prefs.assistant_events
      WHEN 'agency_events'           THEN _prefs.agency_events
      ELSE true
    END;
    IF NOT _enabled THEN RETURN NULL; END IF;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, payload)
  VALUES (_user_id, _type, _title, _body, COALESCE(_payload, '{}'::jsonb))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- 3. driver_assistants trigger -------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_driver_assistants_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _driver_email text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Notify invitee if they already have an account
    IF NEW.assistant_user_id IS NOT NULL THEN
      PERFORM public.create_notification(
        NEW.assistant_user_id,
        'assistant_invited',
        'You have a new assistant invitation',
        'A driver has invited you to assist with their account.',
        jsonb_build_object('assistant_id', NEW.id, 'driver_user_id', NEW.driver_user_id)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Status transitions
    IF NEW.status = 'active' AND OLD.status <> 'active' THEN
      -- Notify driver that assistant accepted
      PERFORM public.create_notification(
        NEW.driver_user_id,
        'assistant_accepted',
        'Assistant accepted your invitation',
        COALESCE(NEW.invite_email, 'Your assistant') || ' is now active on your account.',
        jsonb_build_object('assistant_id', NEW.id)
      );
    ELSIF NEW.status = 'revoked' AND OLD.status <> 'revoked' THEN
      -- Notify assistant they were revoked
      IF NEW.assistant_user_id IS NOT NULL THEN
        PERFORM public.create_notification(
          NEW.assistant_user_id,
          'assistant_revoked',
          'Your assistant access was ended',
          'A driver has revoked your access to their account.',
          jsonb_build_object('assistant_id', NEW.id)
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_assistants_notify ON public.driver_assistants;
CREATE TRIGGER trg_driver_assistants_notify
  AFTER INSERT OR UPDATE ON public.driver_assistants
  FOR EACH ROW EXECUTE FUNCTION public.tg_driver_assistants_notify();

-- 4. agency_client_requests trigger --------------------------------------
CREATE OR REPLACE FUNCTION public.tg_agency_client_requests_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT owner_user_id INTO _owner FROM public.agency_profiles WHERE id = NEW.agency_id;
    IF _owner IS NOT NULL THEN
      PERFORM public.create_notification(
        _owner,
        'agency_client_request_new',
        'New client request',
        'A driver submitted a new request to your agency.',
        jsonb_build_object('request_id', NEW.id, 'agency_id', NEW.agency_id, 'driver_user_id', NEW.driver_user_id)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- Notify the driver of the decision
    IF NEW.status IN ('approved','declined','cancelled','converted_to_client') THEN
      PERFORM public.create_notification(
        NEW.driver_user_id,
        'agency_client_request_' || NEW.status::text,
        CASE NEW.status::text
          WHEN 'approved' THEN 'Your agency request was approved'
          WHEN 'declined' THEN 'Your agency request was declined'
          WHEN 'cancelled' THEN 'Your agency request was cancelled'
          WHEN 'converted_to_client' THEN 'You are now an agency client'
        END,
        'Status updated on your agency client request.',
        jsonb_build_object('request_id', NEW.id, 'agency_id', NEW.agency_id, 'status', NEW.status::text)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_client_requests_notify ON public.agency_client_requests;
CREATE TRIGGER trg_agency_client_requests_notify
  AFTER INSERT OR UPDATE ON public.agency_client_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_agency_client_requests_notify();

-- 5. agency_delegation_requests trigger ----------------------------------
CREATE OR REPLACE FUNCTION public.tg_agency_delegation_requests_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Notify the driver they need to approve
    PERFORM public.create_notification(
      NEW.driver_user_id,
      'agency_delegation_pending',
      'Agency is requesting access to your account',
      'An agency wants to assist you. Review and approve or decline the request.',
      jsonb_build_object('delegation_id', NEW.id, 'agency_id', NEW.agency_id)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- Notify the agency owner about the driver's decision
    IF NEW.status IN ('approved','declined','revoked','expired') THEN
      SELECT owner_user_id INTO _owner FROM public.agency_profiles WHERE id = NEW.agency_id;
      IF _owner IS NOT NULL THEN
        PERFORM public.create_notification(
          _owner,
          'agency_delegation_' || NEW.status::text,
          CASE NEW.status::text
            WHEN 'approved' THEN 'Driver approved your delegation request'
            WHEN 'declined' THEN 'Driver declined your delegation request'
            WHEN 'revoked'  THEN 'Driver revoked agency access'
            WHEN 'expired'  THEN 'Delegation request expired'
          END,
          'A driver updated the status of an agency delegation.',
          jsonb_build_object('delegation_id', NEW.id, 'agency_id', NEW.agency_id, 'status', NEW.status::text)
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_delegation_requests_notify ON public.agency_delegation_requests;
CREATE TRIGGER trg_agency_delegation_requests_notify
  AFTER INSERT OR UPDATE ON public.agency_delegation_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_agency_delegation_requests_notify();

-- 6. agency_work_items trigger -------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_agency_work_items_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_member_user_id IS NOT NULL THEN
      PERFORM public.create_notification(
        NEW.assigned_member_user_id,
        'agency_work_item_assigned',
        'New work item assigned to you',
        COALESCE(NEW.title, 'You have a new work item.'),
        jsonb_build_object('work_item_id', NEW.id, 'agency_id', NEW.agency_id, 'driver_user_id', NEW.driver_user_id)
      );
    END IF;
    IF NEW.status = 'waiting_on_driver' THEN
      PERFORM public.create_notification(
        NEW.driver_user_id,
        'agency_work_item_waiting_on_driver',
        'Agency needs your input',
        COALESCE(NEW.title, 'An agency work item is waiting on you.'),
        jsonb_build_object('work_item_id', NEW.id, 'agency_id', NEW.agency_id)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Reassignment
    IF NEW.assigned_member_user_id IS DISTINCT FROM OLD.assigned_member_user_id
       AND NEW.assigned_member_user_id IS NOT NULL THEN
      PERFORM public.create_notification(
        NEW.assigned_member_user_id,
        'agency_work_item_assigned',
        'Work item assigned to you',
        COALESCE(NEW.title, 'You have a new work item.'),
        jsonb_build_object('work_item_id', NEW.id, 'agency_id', NEW.agency_id, 'driver_user_id', NEW.driver_user_id)
      );
    END IF;
    -- Status -> waiting_on_driver
    IF NEW.status = 'waiting_on_driver' AND OLD.status <> 'waiting_on_driver' THEN
      PERFORM public.create_notification(
        NEW.driver_user_id,
        'agency_work_item_waiting_on_driver',
        'Agency needs your input',
        COALESCE(NEW.title, 'An agency work item is waiting on you.'),
        jsonb_build_object('work_item_id', NEW.id, 'agency_id', NEW.agency_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_work_items_notify ON public.agency_work_items;
CREATE TRIGGER trg_agency_work_items_notify
  AFTER INSERT OR UPDATE ON public.agency_work_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_agency_work_items_notify();

-- 7. Lock down direct EXECUTE on the trigger functions -------------------
REVOKE ALL ON FUNCTION public.tg_driver_assistants_notify()           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_agency_client_requests_notify()      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_agency_delegation_requests_notify()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_agency_work_items_notify()           FROM PUBLIC;
