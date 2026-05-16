
-- ============================================================
-- Phase 4A: Notifications Foundation
-- ============================================================

-- 1. notifications table -------------------------------------------------
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread
  ON public.notifications(user_id, read_at);
CREATE INDEX idx_notifications_type
  ON public.notifications(type);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Read own notifications
CREATE POLICY "Users view own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Update own notifications (read_at toggle). A BEFORE UPDATE trigger
-- enforces that only read_at can change for non-service-role callers.
CREATE POLICY "Users update own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- No INSERT / DELETE policies — clients cannot insert or delete.
-- All inserts happen via SECURITY DEFINER triggers / service_role.

CREATE OR REPLACE FUNCTION public.notifications_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Lock every field except read_at
  NEW.id         := OLD.id;
  NEW.user_id    := OLD.user_id;
  NEW.type       := OLD.type;
  NEW.title      := OLD.title;
  NEW.body       := OLD.body;
  NEW.payload    := OLD.payload;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notifications_update_guard
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_update_guard();

-- 2. notification_preferences -------------------------------------------
CREATE TABLE public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  application_events boolean NOT NULL DEFAULT true,
  contact_request_events boolean NOT NULL DEFAULT true,
  contract_events boolean NOT NULL DEFAULT true,
  recruiter_status_events boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own notification prefs"
  ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own notification prefs"
  ON public.notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own notification prefs"
  ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_notification_prefs_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Helper functions ----------------------------------------------------
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
    ELSE 'application_events'
  END
$$;

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

-- 4. Mark-as-read RPCs (used by the client) -----------------------------
CREATE OR REPLACE FUNCTION public.mark_notification_read(notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications
     SET read_at = COALESCE(read_at, now())
   WHERE id = notification_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications
     SET read_at = now()
   WHERE user_id = auth.uid() AND read_at IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

-- 5. Event triggers ------------------------------------------------------

-- 5a. opportunity_applications
CREATE OR REPLACE FUNCTION public.notify_application_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _opp_title text;
  _recruiter_user_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT o.title, rp.user_id
      INTO _opp_title, _recruiter_user_id
      FROM public.opportunities o
      JOIN public.recruiter_profiles rp ON rp.id = o.recruiter_id
     WHERE o.id = NEW.opportunity_id;

    PERFORM public.create_notification(
      _recruiter_user_id,
      'application_submitted',
      'New driver application',
      'A driver applied to your "' || COALESCE(_opp_title,'opportunity') || '" opportunity.',
      jsonb_build_object('application_id', NEW.id, 'opportunity_id', NEW.opportunity_id)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('withdrawn') THEN
    PERFORM public.create_notification(
      NEW.driver_user_id,
      'application_status_updated',
      'Application status updated',
      'Your application status changed to "' || replace(NEW.status,'_',' ') || '".',
      jsonb_build_object(
        'application_id', NEW.id,
        'opportunity_id', NEW.opportunity_id,
        'status', NEW.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_application_insert
  AFTER INSERT ON public.opportunity_applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_application_change();

CREATE TRIGGER trg_notify_application_update
  AFTER UPDATE ON public.opportunity_applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_application_change();

-- 5b. recruiter_contact_requests
CREATE OR REPLACE FUNCTION public.notify_contact_request_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.create_notification(
      NEW.driver_user_id,
      'contact_request_created',
      'Contact request',
      'A recruiter requested permission to contact you about your application.',
      jsonb_build_object('application_id', NEW.application_id, 'request_id', NEW.id)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.create_notification(
        NEW.recruiter_user_id, 'contact_request_approved',
        'Contact request approved',
        'The driver approved your contact request.',
        jsonb_build_object('application_id', NEW.application_id, 'request_id', NEW.id)
      );
    ELSIF NEW.status = 'declined' THEN
      PERFORM public.create_notification(
        NEW.recruiter_user_id, 'contact_request_declined',
        'Contact request declined',
        'The driver declined your contact request.',
        jsonb_build_object('application_id', NEW.application_id, 'request_id', NEW.id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_contact_request_insert
  AFTER INSERT ON public.recruiter_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_contact_request_change();

CREATE TRIGGER trg_notify_contact_request_update
  AFTER UPDATE ON public.recruiter_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_contact_request_change();

-- 5c. contracts
CREATE OR REPLACE FUNCTION public.notify_contract_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.create_notification(
      NEW.driver_user_id,
      'contract_uploaded',
      'Contract needs review',
      'A recruiter uploaded a contract for your application.',
      jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- Recruiter posted a new version (status reset back to 'uploaded')
    IF NEW.status = 'uploaded' AND OLD.status <> 'uploaded' THEN
      PERFORM public.create_notification(
        NEW.driver_user_id, 'contract_uploaded',
        'Updated contract needs review',
        'A recruiter uploaded a new version of the contract.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
    ELSIF NEW.status = 'approved' THEN
      PERFORM public.create_notification(
        NEW.recruiter_user_id, 'contract_approved',
        'Contract approved',
        'The driver approved the contract.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
      PERFORM public.create_notification(
        NEW.driver_user_id, 'contract_approved',
        'Contract approval recorded',
        'Your contract approval was recorded.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.create_notification(
        NEW.recruiter_user_id, 'contract_rejected',
        'Contract rejected',
        'The driver rejected the contract.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
    ELSIF NEW.status = 'changes_requested' THEN
      PERFORM public.create_notification(
        NEW.recruiter_user_id, 'contract_changes_requested',
        'Contract changes requested',
        'The driver requested changes to the contract.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
    ELSIF NEW.status = 'signed' THEN
      PERFORM public.create_notification(
        NEW.recruiter_user_id, 'contract_signed',
        'Contract signed',
        'The driver signed the contract.',
        jsonb_build_object('contract_id', NEW.id, 'application_id', NEW.application_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_contract_insert
  AFTER INSERT ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.notify_contract_change();

CREATE TRIGGER trg_notify_contract_update
  AFTER UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.notify_contract_change();

-- 5d. recruiter_profiles verification status
CREATE OR REPLACE FUNCTION public.notify_recruiter_profile_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    IF NEW.verification_status = 'approved' THEN
      PERFORM public.create_notification(
        NEW.user_id, 'recruiter_profile_approved',
        'Recruiter profile approved',
        'Your recruiter profile is approved. You can now post opportunities.',
        jsonb_build_object('recruiter_id', NEW.id)
      );
    ELSIF NEW.verification_status = 'rejected' THEN
      PERFORM public.create_notification(
        NEW.user_id, 'recruiter_profile_rejected',
        'Recruiter profile needs updates',
        'Your recruiter profile was not approved. Review feedback and resubmit.',
        jsonb_build_object('recruiter_id', NEW.id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_recruiter_profile_status
  AFTER UPDATE ON public.recruiter_profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_recruiter_profile_status();

-- 5e. opportunities admin review
CREATE OR REPLACE FUNCTION public.notify_opportunity_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recruiter_user_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.admin_review_status IS DISTINCT FROM OLD.admin_review_status
     AND NEW.admin_review_status IN ('approved','rejected') THEN
    SELECT rp.user_id INTO _recruiter_user_id
      FROM public.recruiter_profiles rp WHERE rp.id = NEW.recruiter_id;

    IF _recruiter_user_id IS NOT NULL THEN
      PERFORM public.create_notification(
        _recruiter_user_id, 'opportunity_reviewed',
        CASE NEW.admin_review_status
          WHEN 'approved' THEN 'Opportunity approved'
          ELSE 'Opportunity rejected'
        END,
        'Your opportunity "' || COALESCE(NEW.title,'') || '" was ' || NEW.admin_review_status || '.',
        jsonb_build_object('opportunity_id', NEW.id, 'admin_review_status', NEW.admin_review_status)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_opportunity_reviewed
  AFTER UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.notify_opportunity_reviewed();
