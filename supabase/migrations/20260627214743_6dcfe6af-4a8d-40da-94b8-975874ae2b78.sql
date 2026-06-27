
-- 1) Trigger-only SECURITY DEFINER functions: revoke from PUBLIC entirely.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC', r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- 2) Internal-only helpers (called by other SECURITY DEFINER funcs or pg_cron).
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_lane_stats(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_broker_stats(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_operating_metrics(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_personal_intelligence(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_stale_contact_requests() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recruiter_has_priority_plan(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_points(uuid, text, integer) FROM PUBLIC;

-- 3) Authenticated-only RPCs: revoke from PUBLIC, regrant to authenticated.
REVOKE EXECUTE ON FUNCTION public.apply_recruiter_intent() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.apply_recruiter_intent() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_driver_referral_safe(uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_driver_referral_safe(uuid, uuid, text, text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_application_contract_summary(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_application_contract_summary(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_recruiter_profile_safe() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_recruiter_profile_safe() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.list_recruiter_applications_safe(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_recruiter_applications_safe(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.list_recruiter_application_summaries(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_recruiter_application_summaries(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_driver_application_response(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_driver_application_response(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_driver_contact(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.request_driver_contact(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.respond_to_contact_request(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.respond_to_contact_request(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.resubmit_recruiter_profile(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resubmit_recruiter_profile(uuid) TO authenticated;

-- 4) Fix the one non-SECURITY-DEFINER function flagged for mutable search_path.
ALTER FUNCTION public.notification_category(text) SET search_path = public;
