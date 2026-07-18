-- Phase 1G-R1A1-R1 — Recruiter Checkout DB Candidate (CORRECTED)
-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Filed under supabase/migration-candidates/ (NOT supabase/migrations/) so the
-- Supabase migration mechanism cannot pick it up. Real Postgres concurrency
-- proof lives in Phase 1G-R1A3.
--
-- Scope (unchanged from A1):
--   1. Private recruiter_checkout_intents lease/intent table (service-role-only).
--   2. Partial unique indexes on recruiter_billing_profiles (user_id,
--      stripe_customer_id, stripe_subscription_id) restricted to NON-NULL values.
--   3. Exactly four SECURITY DEFINER RPCs implementing claim/bind/complete/fail
--      with advisory transaction locks keyed by recruiter_id.
--
-- R1 corrections:
--   - Eligibility uses real columns only: recruiter_profiles.status and
--     recruiter_profiles.verification_status. Ineligible when either equals
--     the suspended sentinel or verification_status is not the approved
--     sentinel. No reference to any legacy boolean/timestamp flag.
--   - No fifth function and no trigger; every UPDATE sets
--     updated_at directly. Exactly four function definitions.
--   - Claim generation matrix:
--       * new row                                   → gen 1, claimed
--       * ready + same plan + not expired           → ready_candidate
--       * processing + active lease                 → in_progress
--       * expired processing + same plan            → reclaim same gen
--       * failed         + same plan                → reclaim same gen
--       * expired processing + changed plan         → gen + 1
--       * failed         + changed plan             → gen + 1
--       * ready + expired (any plan)                → gen + 1
--       * blocked (server-authorized retry)         → gen + 1
--     Every claimed path issues a fresh claim_token and fixed 300s lease and
--     clears session fields. Canonical stripe_customer_id on the intent is
--     preserved across reclaims.
--   - fail RPC requires state='processing' + matching non-null token +
--     non-null lease + lease > now(); otherwise lease_invalid with no mutation.
--   - Candidate strictness: CREATE TABLE (not IF NOT EXISTS); partial unique
--     indexes without IF NOT EXISTS.
--
-- Preconditions re-confirmed live (SELECT-only): all seven counts unchanged
-- (dup_user/cust/sub=0, driver overlap=0, agency overlap=0, mismatch=0,
-- total_recruiter_billing_profiles=1). No data rewrite or delete. No trigger
-- or policy changes outside the objects this file creates.

BEGIN;

-- =====================================================================
-- 1. Private intents/lease table
-- =====================================================================
CREATE TABLE public.recruiter_checkout_intents (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id                uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  user_id                     uuid NOT NULL,
  plan                        text NOT NULL,
  generation                  integer NOT NULL DEFAULT 1,
  state                       text NOT NULL,
  claim_token                 uuid NULL,
  lease_expires_at            timestamptz NULL,
  stripe_customer_id          text NULL,
  stripe_checkout_session_id  text NULL,
  checkout_url                text NULL,
  checkout_expires_at         timestamptz NULL,
  last_error_code             text NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recruiter_checkout_intents_recruiter_unique UNIQUE (recruiter_id),
  CONSTRAINT recruiter_checkout_intents_plan_chk
    CHECK (plan IN ('starter','growth','fleet')),
  CONSTRAINT recruiter_checkout_intents_generation_chk
    CHECK (generation > 0),
  CONSTRAINT recruiter_checkout_intents_state_chk
    CHECK (state IN ('processing','ready','blocked','failed')),
  CONSTRAINT recruiter_checkout_intents_error_code_chk
    CHECK (last_error_code IS NULL OR
      (last_error_code ~ '^[a-z0-9_]+$' AND char_length(last_error_code) BETWEEN 1 AND 64)),
  CONSTRAINT recruiter_checkout_intents_processing_coherent_chk
    CHECK (state <> 'processing'
      OR (claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT recruiter_checkout_intents_ready_coherent_chk
    CHECK (state <> 'ready'
      OR (stripe_checkout_session_id IS NOT NULL
          AND checkout_url IS NOT NULL
          AND checkout_expires_at IS NOT NULL
          AND claim_token IS NULL
          AND lease_expires_at IS NULL)),
  CONSTRAINT recruiter_checkout_intents_non_processing_no_lease_chk
    CHECK (state = 'processing'
      OR (claim_token IS NULL AND lease_expires_at IS NULL))
);

COMMENT ON TABLE public.recruiter_checkout_intents IS
  'Private per-recruiter Stripe Checkout lease/intent (Phase 1G-R1A1-R1). '
  'Service-role only. All mutation happens via SECURITY DEFINER RPCs. '
  'RLS enabled with no policies; PostgREST access is fully denied.';

REVOKE ALL ON TABLE public.recruiter_checkout_intents FROM PUBLIC;
REVOKE ALL ON TABLE public.recruiter_checkout_intents FROM anon;
REVOKE ALL ON TABLE public.recruiter_checkout_intents FROM authenticated;
GRANT  ALL ON TABLE public.recruiter_checkout_intents TO service_role;

ALTER TABLE public.recruiter_checkout_intents ENABLE ROW LEVEL SECURITY;
-- Intentionally NO client policies. Table is invisible to anon/authenticated.

CREATE INDEX IF NOT EXISTS recruiter_checkout_intents_state_idx
  ON public.recruiter_checkout_intents (state);
CREATE INDEX IF NOT EXISTS recruiter_checkout_intents_user_idx
  ON public.recruiter_checkout_intents (user_id);

-- =====================================================================
-- 2. Partial unique indexes on recruiter_billing_profiles
--    (no IF NOT EXISTS — fail loudly on collision)
-- =====================================================================
CREATE UNIQUE INDEX recruiter_billing_profiles_user_id_uniq
  ON public.recruiter_billing_profiles (user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX recruiter_billing_profiles_stripe_customer_id_uniq
  ON public.recruiter_billing_profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX recruiter_billing_profiles_stripe_subscription_id_uniq
  ON public.recruiter_billing_profiles (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- =====================================================================
-- 3. State-machine RPCs — EXACTLY FOUR. Service-role-only.
--    Advisory lock keyed by recruiter_id. Fixed 300s server-side lease.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.claim_recruiter_checkout_intent(
  _recruiter_id uuid,
  _user_id      uuid,
  _plan         text
)
RETURNS TABLE (
  outcome                     text,
  intent_id                   uuid,
  claim_token                 uuid,
  generation                  integer,
  checkout_url                text,
  checkout_expires_at         timestamptz,
  stripe_customer_id          text,
  stripe_checkout_session_id  text,
  reason                      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_seconds constant integer := 300;
  v_prof          public.recruiter_profiles%ROWTYPE;
  v_row           public.recruiter_checkout_intents%ROWTYPE;
  v_now           timestamptz := now();
  v_new_token     uuid;
  v_bump          boolean;
BEGIN
  IF _plan NOT IN ('starter','growth','fleet') THEN
    outcome := 'invalid_plan'; reason := 'plan_not_supported'; RETURN NEXT; RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('rci:' || _recruiter_id::text)::bigint
  );

  SELECT * INTO v_prof FROM public.recruiter_profiles
    WHERE id = _recruiter_id AND user_id = _user_id;
  IF NOT FOUND THEN
    outcome := 'not_owner'; reason := 'recruiter_ownership_mismatch'; RETURN NEXT; RETURN;
  END IF;

  -- Suspension check runs BEFORE the approved-verification check.
  IF v_prof.status = 'suspended' OR v_prof.verification_status = 'suspended' THEN
    outcome := 'not_eligible'; reason := 'account_suspended'; RETURN NEXT; RETURN;
  END IF;

  -- Eligibility uses real columns only.
  IF COALESCE(v_prof.verification_status,'') <> 'approved' THEN
    outcome := 'not_eligible'; reason := 'verification_not_approved'; RETURN NEXT; RETURN;
  END IF;


  SELECT * INTO v_row FROM public.recruiter_checkout_intents
    WHERE recruiter_id = _recruiter_id FOR UPDATE;

  IF NOT FOUND THEN
    v_new_token := gen_random_uuid();
    INSERT INTO public.recruiter_checkout_intents
      (recruiter_id, user_id, plan, generation, state,
       claim_token, lease_expires_at)
    VALUES
      (_recruiter_id, _user_id, _plan, 1, 'processing',
       v_new_token, v_now + make_interval(secs => v_lease_seconds))
    RETURNING * INTO v_row;
    outcome := 'claimed'; intent_id := v_row.id; claim_token := v_new_token;
    generation := v_row.generation;
    RETURN NEXT; RETURN;
  END IF;

  -- Ready and unexpired for the same plan → hand back existing session.
  IF v_row.state = 'ready'
     AND v_row.plan = _plan
     AND v_row.checkout_expires_at IS NOT NULL
     AND v_row.checkout_expires_at > v_now THEN
    outcome := 'ready_candidate';
    intent_id := v_row.id;
    generation := v_row.generation;
    checkout_url := v_row.checkout_url;
    checkout_expires_at := v_row.checkout_expires_at;
    stripe_customer_id := v_row.stripe_customer_id;
    stripe_checkout_session_id := v_row.stripe_checkout_session_id;
    -- claim_token intentionally NULL: only 'claimed' issues a token.
    RETURN NEXT; RETURN;
  END IF;

  -- Active processing lease → concurrent request.
  IF v_row.state = 'processing'
     AND v_row.lease_expires_at IS NOT NULL
     AND v_row.lease_expires_at > v_now THEN
    outcome := 'in_progress';
    intent_id := v_row.id;
    generation := v_row.generation;
    stripe_customer_id := v_row.stripe_customer_id;
    reason := 'active_lease';
    -- claim_token intentionally NULL: only 'claimed' issues a token.
    RETURN NEXT; RETURN;
  END IF;


  -- Generation matrix for all remaining (claimable) branches:
  --   expired processing + same plan   → keep generation
  --   failed              + same plan  → keep generation
  --   expired processing + plan change → bump
  --   failed              + plan change → bump
  --   ready + expired (any plan)       → bump
  --   blocked (server-authorized retry)→ bump
  v_bump := NOT (
       (v_row.state = 'processing' AND v_row.plan = _plan)
    OR (v_row.state = 'failed'     AND v_row.plan = _plan)
  );

  v_new_token := gen_random_uuid();
  UPDATE public.recruiter_checkout_intents
     SET plan             = _plan,
         user_id          = _user_id,
         generation       = CASE WHEN v_bump THEN v_row.generation + 1
                                 ELSE v_row.generation END,
         state            = 'processing',
         claim_token      = v_new_token,
         lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
         stripe_checkout_session_id = NULL,
         checkout_url     = NULL,
         checkout_expires_at = NULL,
         last_error_code  = NULL,
         -- stripe_customer_id preserved across reclaim
         updated_at       = v_now
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  outcome := 'claimed';
  intent_id := v_row.id;
  claim_token := v_new_token;
  generation := v_row.generation;
  stripe_customer_id := v_row.stripe_customer_id;
  RETURN NEXT; RETURN;

END;
$$;

COMMENT ON FUNCTION public.claim_recruiter_checkout_intent(uuid,uuid,text) IS
  'Phase 1G-R1A1-R1 service-role-only claim RPC. Advisory-locked per recruiter_id.';

CREATE OR REPLACE FUNCTION public.bind_recruiter_checkout_customer(
  _intent_id   uuid,
  _claim_token uuid,
  _customer_id text
)
RETURNS TABLE (outcome text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row  public.recruiter_checkout_intents%ROWTYPE;
  v_now  timestamptz := now();
  v_existing_recruiter uuid;
  v_current_customer   text;
BEGIN
  IF _customer_id IS NULL OR btrim(_customer_id) = '' THEN
    outcome := 'invalid_customer'; reason := 'empty_customer_id'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_row FROM public.recruiter_checkout_intents
    WHERE id = _intent_id FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'not_found'; reason := 'intent_missing'; RETURN NEXT; RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('rci:' || v_row.recruiter_id::text)::bigint
  );

  IF v_row.state <> 'processing'
     OR v_row.claim_token IS NULL
     OR v_row.claim_token <> _claim_token
     OR v_row.lease_expires_at IS NULL
     OR v_row.lease_expires_at <= v_now THEN
    outcome := 'lease_invalid'; reason := 'no_active_lease'; RETURN NEXT; RETURN;
  END IF;

  -- Cross-recruiter customer collision
  SELECT recruiter_id INTO v_existing_recruiter
    FROM public.recruiter_billing_profiles
   WHERE stripe_customer_id = _customer_id
   LIMIT 1;
  IF v_existing_recruiter IS NOT NULL
     AND v_existing_recruiter <> v_row.recruiter_id THEN
    outcome := 'customer_conflict'; reason := 'recruiter_customer_owned_elsewhere';
    RETURN NEXT; RETURN;
  END IF;

  -- Driver isolation
  IF EXISTS (SELECT 1 FROM public.subscriptions
              WHERE stripe_customer_id = _customer_id) THEN
    outcome := 'customer_conflict'; reason := 'driver_customer_collision';
    RETURN NEXT; RETURN;
  END IF;

  -- Agency isolation
  IF EXISTS (SELECT 1 FROM public.agency_entitlements
              WHERE stripe_customer_id = _customer_id) THEN
    outcome := 'customer_conflict'; reason := 'agency_customer_collision';
    RETURN NEXT; RETURN;
  END IF;

  -- Never overwrite a differing canonical customer.
  SELECT stripe_customer_id INTO v_current_customer
    FROM public.recruiter_billing_profiles
   WHERE recruiter_id = v_row.recruiter_id AND user_id = v_row.user_id;

  IF v_current_customer IS NOT NULL AND v_current_customer <> _customer_id THEN
    outcome := 'customer_conflict'; reason := 'existing_canonical_customer_differs';
    RETURN NEXT; RETURN;
  END IF;

  IF v_current_customer IS NULL THEN
    -- Narrow SQLSTATE 23505 handler scoped ONLY to the canonical
    -- recruiter_billing_profiles insert/upsert. A concurrent identity
    -- race is surfaced as a structured customer_conflict/
    -- billing_identity_unique_conflict outcome — never as a raw DB
    -- error and never with constraint names exposed to the caller.
    BEGIN
      INSERT INTO public.recruiter_billing_profiles
        (recruiter_id, user_id, stripe_customer_id)
      VALUES
        (v_row.recruiter_id, v_row.user_id, _customer_id)
      ON CONFLICT (recruiter_id) DO UPDATE
        SET stripe_customer_id = EXCLUDED.stripe_customer_id
        WHERE public.recruiter_billing_profiles.stripe_customer_id IS NULL
          AND public.recruiter_billing_profiles.user_id = EXCLUDED.user_id;
    EXCEPTION WHEN unique_violation THEN
      outcome := 'customer_conflict';
      reason  := 'billing_identity_unique_conflict';
      RETURN NEXT; RETURN;
    END;

    -- Post-write ownership verification is preserved.
    IF NOT EXISTS (
      SELECT 1 FROM public.recruiter_billing_profiles
       WHERE recruiter_id = v_row.recruiter_id
         AND user_id = v_row.user_id
         AND stripe_customer_id = _customer_id
    ) THEN
      outcome := 'customer_conflict'; reason := 'billing_row_ownership_mismatch';
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  UPDATE public.recruiter_checkout_intents
     SET stripe_customer_id = _customer_id,
         updated_at         = v_now
   WHERE id = v_row.id;

  outcome := 'bound'; RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.bind_recruiter_checkout_customer(uuid,uuid,text) IS
  'Phase 1G-R1A1-R1 service-role-only bind RPC. Never overwrites a differing canonical customer.';

CREATE OR REPLACE FUNCTION public.complete_recruiter_checkout_intent(
  _intent_id           uuid,
  _claim_token         uuid,
  _customer_id         text,
  _session_id          text,
  _checkout_url        text,
  _checkout_expires_at timestamptz
)
RETURNS TABLE (outcome text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.recruiter_checkout_intents%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF _session_id IS NULL OR btrim(_session_id) = ''
     OR _checkout_url IS NULL OR btrim(_checkout_url) = ''
     OR _checkout_expires_at IS NULL
     OR _checkout_expires_at <= v_now THEN
    outcome := 'invalid_session'; reason := 'session_fields_incomplete'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_row FROM public.recruiter_checkout_intents
    WHERE id = _intent_id FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'not_found'; reason := 'intent_missing'; RETURN NEXT; RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('rci:' || v_row.recruiter_id::text)::bigint
  );

  IF v_row.state <> 'processing'
     OR v_row.claim_token IS NULL
     OR v_row.claim_token <> _claim_token
     OR v_row.lease_expires_at IS NULL
     OR v_row.lease_expires_at <= v_now THEN
    outcome := 'lease_invalid'; reason := 'no_active_lease'; RETURN NEXT; RETURN;
  END IF;

  IF v_row.stripe_customer_id IS NULL
     OR v_row.stripe_customer_id <> _customer_id THEN
    outcome := 'customer_mismatch'; reason := 'bound_customer_differs'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.recruiter_checkout_intents
     SET state                      = 'ready',
         claim_token                = NULL,
         lease_expires_at           = NULL,
         stripe_checkout_session_id = _session_id,
         checkout_url               = _checkout_url,
         checkout_expires_at        = _checkout_expires_at,
         last_error_code            = NULL,
         updated_at                 = v_now
   WHERE id = v_row.id;

  outcome := 'completed'; RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.complete_recruiter_checkout_intent(uuid,uuid,text,text,text,timestamptz) IS
  'Phase 1G-R1A1-R1 service-role-only complete RPC. Requires bound customer + active lease.';

CREATE OR REPLACE FUNCTION public.fail_recruiter_checkout_intent(
  _intent_id   uuid,
  _claim_token uuid,
  _error_code  text,
  _terminal    boolean
)
RETURNS TABLE (outcome text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.recruiter_checkout_intents%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF _error_code IS NULL
     OR _error_code !~ '^[a-z0-9_]+$'
     OR char_length(_error_code) > 64 THEN
    outcome := 'invalid_error_code'; reason := 'error_code_malformed'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_row FROM public.recruiter_checkout_intents
    WHERE id = _intent_id FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'not_found'; reason := 'intent_missing'; RETURN NEXT; RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('rci:' || v_row.recruiter_id::text)::bigint
  );

  -- Full lease safety: state must still be processing with a live matching lease.
  IF v_row.state <> 'processing'
     OR v_row.claim_token IS NULL
     OR v_row.claim_token <> _claim_token
     OR v_row.lease_expires_at IS NULL
     OR v_row.lease_expires_at <= v_now THEN
    outcome := 'lease_invalid'; reason := 'no_active_lease'; RETURN NEXT; RETURN;
  END IF;

  -- Preserves generation and canonical stripe_customer_id.
  UPDATE public.recruiter_checkout_intents
     SET state                      = CASE WHEN _terminal THEN 'blocked' ELSE 'failed' END,
         claim_token                = NULL,
         lease_expires_at           = NULL,
         stripe_checkout_session_id = NULL,
         checkout_url               = NULL,
         checkout_expires_at        = NULL,
         last_error_code            = _error_code,
         updated_at                 = v_now
   WHERE id = v_row.id;

  outcome := CASE WHEN _terminal THEN 'blocked' ELSE 'failed' END;
  RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.fail_recruiter_checkout_intent(uuid,uuid,text,boolean) IS
  'Phase 1G-R1A1-R1 service-role-only fail RPC. Requires live processing lease + matching token.';

-- =====================================================================
-- 4. Function privileges: service-role-only (+ optional sandbox test roles).
-- =====================================================================
DO $priv$
DECLARE
  v_fn text;
  v_role text;
  v_sig text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'claim_recruiter_checkout_intent(uuid,uuid,text)',
    'bind_recruiter_checkout_customer(uuid,uuid,text)',
    'complete_recruiter_checkout_intent(uuid,uuid,text,text,text,timestamptz)',
    'fail_recruiter_checkout_intent(uuid,uuid,text,boolean)'
  ]
  LOOP
    v_sig := 'public.' || v_fn;
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_sig || ' TO service_role';

    FOREACH v_role IN ARRAY ARRAY['pglite_test','postgres_test_runner']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_sig || ' TO ' || quote_ident(v_role);
      END IF;
    END LOOP;
  END LOOP;
END
$priv$;

COMMIT;
