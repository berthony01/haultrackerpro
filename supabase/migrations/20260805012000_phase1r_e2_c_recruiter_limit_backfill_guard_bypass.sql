-- PRODUCTION REPAIR MIGRATION — Phase 1R-E2-C recruiter limit backfill guard bypass.
--
-- The Phase 1R-E1 backfill ran while the production BEFORE UPDATE triggers on
-- public.recruiter_billing_profiles were active:
--
--   trg_recruiter_billing_field_guard -> public.recruiter_billing_field_guard()
--     restores OLD billing-controlled values unless the caller presents a
--     service_role claim / auth.role() or is an admin.
--   trg_recruiter_billing_updated_at  -> public.update_updated_at_column()
--     advances updated_at on every update.
--
-- Net effect: active_opportunity_limit was restored to its legacy value while
-- updated_at was advanced. This migration repeats ONLY the canonical backfill,
-- with a transaction-local service_role claim (so the field guard permits the
-- write while staying enabled) and with the updated-at trigger temporarily
-- disabled (so no timestamp is disturbed).
--
-- It changes no function, policy, index, table, column, RLS rule, ACL, other
-- trigger, or data field.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Fail-closed pre-mutation gate.
-- ---------------------------------------------------------------------------
DO $gate$
DECLARE
  _guard_count integer;
  _touch_count integer;
BEGIN
  SELECT count(*) INTO _guard_count
  FROM pg_trigger t
  JOIN pg_class c       ON c.oid = t.tgrelid
  JOIN pg_namespace n   ON n.oid = c.relnamespace
  JOIN pg_proc p        ON p.oid = t.tgfoid
  JOIN pg_namespace pn  ON pn.oid = p.pronamespace
  WHERE NOT t.tgisinternal
    AND n.nspname  = 'public'
    AND c.relname  = 'recruiter_billing_profiles'
    AND t.tgname   = 'trg_recruiter_billing_field_guard'
    AND pn.nspname = 'public'
    AND p.proname  = 'recruiter_billing_field_guard'
    AND t.tgenabled = 'O';

  IF _guard_count <> 1 THEN
    RAISE EXCEPTION
      'Phase 1R-E2-C aborted: expected exactly one enabled trg_recruiter_billing_field_guard calling public.recruiter_billing_field_guard() on public.recruiter_billing_profiles, found %',
      _guard_count;
  END IF;

  SELECT count(*) INTO _touch_count
  FROM pg_trigger t
  JOIN pg_class c       ON c.oid = t.tgrelid
  JOIN pg_namespace n   ON n.oid = c.relnamespace
  JOIN pg_proc p        ON p.oid = t.tgfoid
  JOIN pg_namespace pn  ON pn.oid = p.pronamespace
  WHERE NOT t.tgisinternal
    AND n.nspname  = 'public'
    AND c.relname  = 'recruiter_billing_profiles'
    AND t.tgname   = 'trg_recruiter_billing_updated_at'
    AND pn.nspname = 'public'
    AND p.proname  = 'update_updated_at_column'
    AND t.tgenabled = 'O';

  IF _touch_count <> 1 THEN
    RAISE EXCEPTION
      'Phase 1R-E2-C aborted: expected exactly one enabled trg_recruiter_billing_updated_at calling public.update_updated_at_column() on public.recruiter_billing_profiles, found %',
      _touch_count;
  END IF;
END
$gate$;

-- ---------------------------------------------------------------------------
-- 2) Transaction-local service_role claim (is_local = true).
-- ---------------------------------------------------------------------------
DO $claim$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
END
$claim$;

-- ---------------------------------------------------------------------------
-- 3) Temporarily disable ONLY the updated-at trigger.
-- ---------------------------------------------------------------------------
ALTER TABLE public.recruiter_billing_profiles DISABLE TRIGGER trg_recruiter_billing_updated_at;

-- ---------------------------------------------------------------------------
-- 4) Canonical backfill (identical statement to Phase 1R-E1).
-- ---------------------------------------------------------------------------
UPDATE public.recruiter_billing_profiles b SET active_opportunity_limit = public.recruiter_plan_limit(b.plan) WHERE b.active_opportunity_limit IS DISTINCT FROM public.recruiter_plan_limit(b.plan);

-- ---------------------------------------------------------------------------
-- 5) Re-enable ONLY the updated-at trigger.
-- ---------------------------------------------------------------------------
ALTER TABLE public.recruiter_billing_profiles ENABLE TRIGGER trg_recruiter_billing_updated_at;

-- ---------------------------------------------------------------------------
-- 6) Fail-closed postcondition.
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  _guard_count integer;
  _touch_count integer;
  _mismatch    integer;
BEGIN
  SELECT count(*) INTO _guard_count
  FROM pg_trigger t
  JOIN pg_class c       ON c.oid = t.tgrelid
  JOIN pg_namespace n   ON n.oid = c.relnamespace
  JOIN pg_proc p        ON p.oid = t.tgfoid
  JOIN pg_namespace pn  ON pn.oid = p.pronamespace
  WHERE NOT t.tgisinternal
    AND n.nspname  = 'public'
    AND c.relname  = 'recruiter_billing_profiles'
    AND t.tgname   = 'trg_recruiter_billing_field_guard'
    AND pn.nspname = 'public'
    AND p.proname  = 'recruiter_billing_field_guard'
    AND t.tgenabled = 'O';

  SELECT count(*) INTO _touch_count
  FROM pg_trigger t
  JOIN pg_class c       ON c.oid = t.tgrelid
  JOIN pg_namespace n   ON n.oid = c.relnamespace
  JOIN pg_proc p        ON p.oid = t.tgfoid
  JOIN pg_namespace pn  ON pn.oid = p.pronamespace
  WHERE NOT t.tgisinternal
    AND n.nspname  = 'public'
    AND c.relname  = 'recruiter_billing_profiles'
    AND t.tgname   = 'trg_recruiter_billing_updated_at'
    AND pn.nspname = 'public'
    AND p.proname  = 'update_updated_at_column'
    AND t.tgenabled = 'O';

  IF _guard_count <> 1 OR _touch_count <> 1 THEN
    RAISE EXCEPTION
      'Phase 1R-E2-C postcondition failed: trigger posture not restored (field_guard=%, updated_at=%)',
      _guard_count, _touch_count;
  END IF;

  SELECT count(*) INTO _mismatch
  FROM public.recruiter_billing_profiles b
  WHERE b.active_opportunity_limit IS DISTINCT FROM public.recruiter_plan_limit(b.plan);

  IF _mismatch <> 0 THEN
    RAISE EXCEPTION
      'Phase 1R-E2-C postcondition failed: % recruiter_billing_profiles row(s) still mismatch recruiter_plan_limit(plan)',
      _mismatch;
  END IF;
END
$post$;

COMMIT;
