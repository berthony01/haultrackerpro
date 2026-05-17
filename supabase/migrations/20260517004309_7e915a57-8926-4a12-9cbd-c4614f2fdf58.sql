-- Lock down notification helper functions: clients must not call them directly.
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.notification_category(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notification_category(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.notification_category(text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_application_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_application_change() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_application_change() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_contact_request_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_contact_request_change() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_contact_request_change() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_contract_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_contract_change() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_contract_change() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_recruiter_profile_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_recruiter_profile_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_recruiter_profile_status() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_opportunity_reviewed() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_opportunity_reviewed() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_opportunity_reviewed() FROM authenticated;

-- Client-facing RPCs remain callable.
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

-- Harden notification_preferences updates: only toggle fields are user-mutable.
CREATE OR REPLACE FUNCTION public.notification_preferences_update_guard()
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

  -- Pin identity / timestamps to OLD values.
  NEW.id         := OLD.id;
  NEW.user_id    := OLD.user_id;
  NEW.created_at := OLD.created_at;
  -- updated_at is set by trg_notification_prefs_updated_at; leave NEW as-is so that trigger can overwrite.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_prefs_update_guard ON public.notification_preferences;
CREATE TRIGGER trg_notification_prefs_update_guard
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.notification_preferences_update_guard();