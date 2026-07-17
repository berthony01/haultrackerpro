-- Phase 1G-R1A1 — Recruiter Checkout DB Candidate
-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Filed under supabase/migration-candidates/ (NOT supabase/migrations/) so the
-- Supabase migration mechanism cannot pick it up. Real Postgres concurrency
-- proof lives in Phase 1G-R1A3.
--
-- Scope:
--   1. Private recruiter_checkout_intents lease/intent table (service-role-only).
--   2. Partial unique indexes on recruiter_billing_profiles (user_id,
--      stripe_customer_id, stripe_subscription_id) restricted to NON-NULL values.
--   3. Four SECURITY DEFINER RPCs implementing a claim/bind/complete/fail state
--      machine with advisory transaction locks keyed by recruiter_id.
--
-- Preconditions confirmed live (SELECT-only) before authoring:
--   dup_user_groups=0, dup_cust_groups=0, dup_sub_groups=0,
--   overlap_driver_rows=0, overlap_agency_rows=0,
--   mismatch_owner_rows=0, total_recruiter_billing_profiles=1.
--
-- This migration performs no data rewrite, no deletes, and no trigger/policy
-- changes outside the objects it creates. It is safe on an empty or a
-- prechecks-satisfying populated database.

BEGIN;

-- =====================================================================
-- 1. Private intents/lease table
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.recruiter_checkout_intents (
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
  'Private per-recruiter Stripe Checkout lease/intent (Phase 1G-R1A1). '
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

CREATE OR REPLACE FUNCTION public._rci_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recruiter_checkout_intents_touch_updated_at
  ON public.recruiter_checkout_intents;
CREATE TRIGGER recruiter_checkout_intents_touch_updated_at
  BEFORE UPDATE ON public.recruiter_checkout_intents
  FOR EACH ROW EXECUTE FUNCTION public._rci_touch_updated_at();

-- =====================================================================
-- 2. Partial unique indexes on recruiter_billing_profiles
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS recruiter_billing_profiles_user_id_uniq
  ON public.recruiter_billing_profiles (user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS recruiter_billing_profiles_stripe_customer_id_uniq
  ON public.recruiter_billing_profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS recruiter_billing_profiles_stripe_subscription_id_uniq
  ON public.recruiter_billing_profiles (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- =====================================================================
-- 3. State-machine RPCs. Service-role-only. Advisory lock per recruiter_id.
-- =====================================================================
-- Fixed server-side lease durations (never accepted from the client):
--   processing lease: 5 minutes
--   ready checkout ceiling: taken from Stripe session expires_at

CREATE OR REPLACE FUNCTION public.claim_recruiter_checkout_intent(
  _recruiter_id uuid,
  _user_id      uuid,
  _plan         text
)
RETURNS TABLE (
  outcome              text,
  intent_id            uuid,
  claim_token          uuid,
  generation           integer,
  checkout_url         text,
  checkout_expires_at  timestamptz,
  reason               text
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

  IF COALESCE(v_prof.verification_status,'') <> 'approved' THEN
    outcome := 'not_eligible'; reason := 'verification_not_approved'; RETURN NEXT; RETURN;
  END IF;

  IF COALESCE(v_prof.is_suspended, false) = true
     OR v_prof.suspended_at IS NOT NULL THEN
    outcome := 'not_eligible'; reason := 'account_suspended'; RETURN NEXT; RETURN;
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

  IF v_row.state = 'ready'
     AND v_row.plan = _plan
     AND v_row.checkout_expires_at IS NOT NULL
     AND v_row.checkout_expires_at > v_now THEN
    outcome := 'ready_candidate';
    intent_id := v_row.id;
    generation := v_row.generation;
    checkout_url := v_row.checkout_url;
    checkout_expires_at := v_row.checkout_expires_at;
    RETURN NEXT; RETURN;
  END IF;

  IF v_row.state = 'processing'
     AND v_row.lease_expires_at IS NOT NULL
     AND v_row.lease_expires_at > v_now THEN
    outcome := 'in_progress';
    intent_id := v_row.id;
    generation := v_row.generation;
    reason := 'active_lease';
    RETURN NEXT; RETURN;
  END IF;

  IF v_row.state = 'blocked' THEN
    outcome := 'blocked';
    intent_id := v_row.id;
    generation := v_row.generation;
    reason := COALESCE(v_row.last_error_code, 'blocked');
    RETURN NEXT; RETURN;
  END IF;

  v_new_token := gen_random_uuid();
  IF v_row.state = 'processing' THEN
    -- expired lease → same generation reclaim
    UPDATE public.recruiter_checkout_intents
       SET plan = _plan,
           user_id = _user_id,
           state = 'processing',
           claim_token = v_new_token,
           lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
           stripe_checkout_session_id = NULL,
           checkout_url = NULL,
           checkout_expires_at = NULL,
           last_error_code = NULL
     WHERE id = v_row.id
     RETURNING * INTO v_row;
  ELSE
    -- ready-but-expired, failed retry, or plan changed → bump generation once
    UPDATE public.recruiter_checkout_intents
       SET plan = _plan,
           user_id = _user_id,
           generation = v_row.generation + 1,
           state = 'processing',
           claim_token = v_new_token,
           lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
           stripe_checkout_session_id = NULL,
           checkout_url = NULL,
           checkout_expires_at = NULL,
           last_error_code = NULL
     WHERE id = v_row.id
     RETURNING * INTO v_row;
  END IF;

  outcome := 'claimed';
  intent_id := v_row.id;
  claim_token := v_new_token;
  generation := v_row.generation;
  RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.claim_recruiter_checkout_intent(uuid,uuid,text) IS
  'Phase 1G-R1A1 service-role-only claim RPC. Advisory-locked per recruiter_id.';

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
  v_current_customer text;
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

  -- Check current canonical value before mutating (never overwrite a differing one)
  SELECT stripe_customer_id INTO v_current_customer
    FROM public.recruiter_billing_profiles
   WHERE recruiter_id = v_row.recruiter_id AND user_id = v_row.user_id;

  IF v_current_customer IS NOT NULL AND v_current_customer <> _customer_id THEN
    outcome := 'customer_conflict'; reason := 'existing_canonical_customer_differs';
    RETURN NEXT; RETURN;
  END IF;

  IF v_current_customer IS NULL THEN
    -- Insert or set canonical customer for exact recruiter/user pair
    INSERT INTO public.recruiter_billing_profiles
      (recruiter_id, user_id, stripe_customer_id)
    VALUES
      (v_row.recruiter_id, v_row.user_id, _customer_id)
    ON CONFLICT (recruiter_id) DO UPDATE
      SET stripe_customer_id = EXCLUDED.stripe_customer_id
      WHERE public.recruiter_billing_profiles.stripe_customer_id IS NULL
        AND public.recruiter_billing_profiles.user_id = EXCLUDED.user_id;

    -- Re-check that write actually landed (guards against a race where a
    -- different user_id owns the recruiter row).
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
     SET stripe_customer_id = _customer_id
   WHERE id = v_row.id;

  outcome := 'bound'; RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.bind_recruiter_checkout_customer(uuid,uuid,text) IS
  'Phase 1G-R1A1 service-role-only bind RPC. Never overwrites a differing canonical customer.';

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
     SET state = 'ready',
         claim_token = NULL,
         lease_expires_at = NULL,
         stripe_checkout_session_id = _session_id,
         checkout_url = _checkout_url,
         checkout_expires_at = _checkout_expires_at,
         last_error_code = NULL
   WHERE id = v_row.id;

  outcome := 'completed'; RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.complete_recruiter_checkout_intent(uuid,uuid,text,text,text,timestamptz) IS
  'Phase 1G-R1A1 service-role-only complete RPC. Requires bound customer + active lease.';

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

  IF v_row.claim_token IS NULL OR v_row.claim_token <> _claim_token THEN
    outcome := 'lease_invalid'; reason := 'token_mismatch'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.recruiter_checkout_intents
     SET state = CASE WHEN _terminal THEN 'blocked' ELSE 'failed' END,
         claim_token = NULL,
         lease_expires_at = NULL,
         stripe_checkout_session_id = NULL,
         checkout_url = NULL,
         checkout_expires_at = NULL,
         last_error_code = _error_code
   WHERE id = v_row.id;

  outcome := CASE WHEN _terminal THEN 'blocked' ELSE 'failed' END;
  RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.fail_recruiter_checkout_intent(uuid,uuid,text,boolean) IS
  'Phase 1G-R1A1 service-role-only fail RPC. terminal=true → blocked, else failed.';

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
