-- Phase 1N-F1-C — Production migration promotion of the accepted
-- Phase 1N-F1-B transactional account-data cleanup candidate.
--
-- The executable body below is copied byte-for-byte from the accepted
-- candidate SQL at
--   supabase/migration-candidates/20260724060000_phase1n_f1b_transactional_account_cleanup.sql
-- from the first `CREATE OR REPLACE FUNCTION` byte through the final
-- semicolon of the trailing GRANT.
--
-- Stripe subscription cancellation and auth.users deletion remain the
-- responsibility of the delete-account edge adapter and are NOT performed
-- by this migration. This migration only creates the SECURITY DEFINER
-- PL/pgSQL function `public.finalize_my_account_data_deletion()` and its
-- exact role ACL. The function itself is NOT invoked by this migration.

CREATE OR REPLACE FUNCTION public.finalize_my_account_data_deletion()
RETURNS TABLE (
  deleted_user_id             uuid,
  relationship_rows_deleted   integer,
  shared_assignments_cleared  integer,
  agency_memberships_revoked  integer,
  direct_rows_deleted         integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $fn$
DECLARE
  _uid          uuid;
  _n            integer := 0;
  _owner_count  integer := 0;
  _rel          integer := 0;
  _shared       integer := 0;
  _mem          integer := 0;
  _direct       integer := 0;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'authentication required to finalize account data deletion'
      USING ERRCODE = '42501';
  END IF;

  -- Per-user transaction-scoped advisory lock. Serializes concurrent calls
  -- for the same caller so counter aggregates never double-count and the
  -- owner check + mutation window is atomic.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_uid::text, 0)
  );

  -- Canonical owner hard block: an owned agency workspace MUST be
  -- transferred or closed before personal account deletion. No cleanup
  -- statement runs before this check.
  SELECT count(*)::int
    INTO _owner_count
    FROM public.agency_profiles
   WHERE owner_user_id = _uid;
  IF _owner_count > 0 THEN
    RAISE EXCEPTION 'You own an agency workspace. Transfer ownership or close the agency before deleting your personal account.'
      USING ERRCODE = 'P0001';
  END IF;

  -- D1. Relationship deletions ------------------------------------------
  DELETE FROM public.driver_assistants WHERE driver_user_id = _uid;
  GET DIAGNOSTICS _n = ROW_COUNT; _rel := _rel + _n;

  DELETE FROM public.driver_assistants WHERE assistant_user_id = _uid;
  GET DIAGNOSTICS _n = ROW_COUNT; _rel := _rel + _n;

  DELETE FROM public.agency_work_items WHERE driver_user_id = _uid;
  GET DIAGNOSTICS _n = ROW_COUNT; _rel := _rel + _n;

  DELETE FROM public.agency_delegation_requests WHERE driver_user_id = _uid;
  GET DIAGNOSTICS _n = ROW_COUNT; _rel := _rel + _n;

  DELETE FROM public.agency_delegation_requests WHERE member_user_id = _uid;
  GET DIAGNOSTICS _n = ROW_COUNT; _rel := _rel + _n;

  DELETE FROM public.agency_client_requests WHERE driver_user_id = _uid;
  GET DIAGNOSTICS _n = ROW_COUNT; _rel := _rel + _n;

  -- D2. Shared-assignment clearing --------------------------------------
  UPDATE public.agency_work_items
     SET assigned_member_user_id = NULL
   WHERE assigned_member_user_id = _uid;
  GET DIAGNOSTICS _n = ROW_COUNT; _shared := _shared + _n;

  UPDATE public.agency_client_requests
     SET assigned_member_user_id = NULL
   WHERE assigned_member_user_id = _uid;
  GET DIAGNOSTICS _n = ROW_COUNT; _shared := _shared + _n;

  -- D3. Agency membership detachment ------------------------------------
  UPDATE public.agency_members
     SET status = 'revoked',
         revoked_at = now(),
         member_user_id = NULL
   WHERE member_user_id = _uid;
  GET DIAGNOSTICS _n = ROW_COUNT; _mem := _mem + _n;

  -- D4. Direct user_id deletions (29 tables, exact order) ---------------
  DELETE FROM public.load_stops                  WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.expenses                    WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.fuel_logs                   WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.loads                       WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.broker_stats                WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.lane_stats                  WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.operating_metrics           WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.brokers                     WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.recurring_expense_templates WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.weekly_snapshots            WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.feedback_responses          WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.parse_usage                 WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.user_alerts                 WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.expense_automation_logs     WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.ai_insights                 WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.cost_profile                WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.parking_favorites           WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.parking_reports             WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.parking_verifications       WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.driver_point_events         WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.driver_points               WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.driver_opportunity_profiles WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.saved_opportunities         WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.notifications               WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.notification_preferences    WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.recruiter_billing_profiles  WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.subscriptions               WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.user_settings               WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;
  DELETE FROM public.profiles                    WHERE user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _direct := _direct + _n;

  RETURN QUERY SELECT _uid, _rel, _shared, _mem, _direct;
END;
$fn$;

REVOKE ALL     ON FUNCTION public.finalize_my_account_data_deletion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_my_account_data_deletion() FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_my_account_data_deletion() FROM service_role;
GRANT  EXECUTE ON FUNCTION public.finalize_my_account_data_deletion() TO authenticated;
