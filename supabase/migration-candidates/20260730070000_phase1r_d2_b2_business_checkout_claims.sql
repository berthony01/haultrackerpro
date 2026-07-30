-- Phase 1R-D2-B2-A — Atomic Business Checkout Claim (CANDIDATE)
--
-- CANDIDATE ONLY. This file lives under supabase/migration-candidates/ and is
-- deliberately NOT part of the managed migrations directory.
--
-- This candidate has NOT been applied to production and is NOT applied to any
-- connected database by creating or committing it.
--
-- B2-B promotion into supabase/migrations/ is a SEPARATE phase.
-- Edge-function integration of these RPCs is a SEPARATE phase.
--
-- Purpose: one durable, service-role-only claim row per authenticated user_id
-- that coordinates recruiter-versus-agency business checkout across external
-- Stripe calls. A transaction-scoped advisory lock serializes each RPC
-- transaction, but the DURABLE ROW plus its lease is the cross-request
-- coordination mechanism. A processing claim holds a fixed 300-second lease.
-- A ready claim remains blocking through the exact Checkout Session expiry.
BEGIN;

-- =====================================================================
-- 1. Durable per-user business checkout claim table
-- =====================================================================
CREATE TABLE public.business_checkout_claims (
  user_id                     uuid PRIMARY KEY,
  context                     text NOT NULL,
  subject_id                  uuid NOT NULL,
  plan_key                    text NOT NULL,
  request_key                 text NOT NULL,
  generation                  integer NOT NULL DEFAULT 1,
  state                       text NOT NULL,
  claim_token                 uuid NULL,
  lease_expires_at            timestamptz NULL,
  stripe_checkout_session_id  text NULL,
  checkout_expires_at         timestamptz NULL,
  last_error_code             text NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_checkout_claims_context_chk
    CHECK (context IN ('recruiter','agency')),
  CONSTRAINT business_checkout_claims_context_plan_chk
    CHECK (
      (context = 'recruiter' AND plan_key IN ('starter','growth','fleet'))
      OR
      (context = 'agency' AND plan_key IN ('agency_starter','agency_team','agency_growth'))
    ),
  CONSTRAINT business_checkout_claims_generation_chk
    CHECK (generation > 0),
  CONSTRAINT business_checkout_claims_state_chk
    CHECK (state IN ('processing','ready','released','failed')),
  CONSTRAINT business_checkout_claims_request_key_chk
    CHECK (btrim(request_key) <> ''
      AND char_length(btrim(request_key)) BETWEEN 1 AND 200),
  CONSTRAINT business_checkout_claims_error_code_chk
    CHECK (last_error_code IS NULL OR
      (last_error_code ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'
       AND char_length(last_error_code) BETWEEN 1 AND 64)),
  CONSTRAINT business_checkout_claims_processing_coherent_chk
    CHECK (state <> 'processing'
      OR (claim_token IS NOT NULL
          AND lease_expires_at IS NOT NULL
          AND stripe_checkout_session_id IS NULL
          AND checkout_expires_at IS NULL)),
  CONSTRAINT business_checkout_claims_ready_coherent_chk
    CHECK (state <> 'ready'
      OR (stripe_checkout_session_id IS NOT NULL
          AND btrim(stripe_checkout_session_id) <> ''
          AND checkout_expires_at IS NOT NULL
          AND claim_token IS NULL
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at = checkout_expires_at)),
  CONSTRAINT business_checkout_claims_inactive_coherent_chk
    CHECK (state NOT IN ('released','failed')
      OR (claim_token IS NULL AND lease_expires_at IS NULL))
);

COMMENT ON TABLE public.business_checkout_claims IS
  'Phase 1R-D2-B2 durable per-user business checkout claim/lease. '
  'Service-role only. All mutation happens via SECURITY DEFINER RPCs. '
  'RLS enabled with no policies; PostgREST access is fully denied.';

REVOKE ALL ON TABLE public.business_checkout_claims FROM PUBLIC;
REVOKE ALL ON TABLE public.business_checkout_claims FROM anon;
REVOKE ALL ON TABLE public.business_checkout_claims FROM authenticated;
GRANT  ALL ON TABLE public.business_checkout_claims TO service_role;

ALTER TABLE public.business_checkout_claims ENABLE ROW LEVEL SECURITY;
-- Intentionally NO client policies. Table is invisible to anon/authenticated.

-- Strict partial unique indexes (no IF NOT EXISTS — fail loudly on collision).
CREATE UNIQUE INDEX business_checkout_claims_claim_token_uniq
  ON public.business_checkout_claims (claim_token)
  WHERE claim_token IS NOT NULL;

CREATE UNIQUE INDEX business_checkout_claims_session_id_uniq
  ON public.business_checkout_claims (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- =====================================================================
-- 2. State-machine RPCs — EXACTLY THREE. Service-role-only.
--    Advisory lock keyed by user_id. Fixed 300s server-side lease.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.claim_business_checkout(
  _user_id     uuid,
  _context     text,
  _subject_id  uuid,
  _plan_key    text,
  _request_key text
)
RETURNS TABLE (
  outcome                     text,
  reason                      text,
  claim_context               text,
  claim_subject_id            uuid,
  claim_plan_key              text,
  generation                  integer,
  claim_token                 uuid,
  claim_state                 text,
  lease_expires_at            timestamptz,
  stripe_checkout_session_id  text,
  checkout_expires_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_seconds constant integer := 300;
  v_lock_namespace constant bigint := 7218926914894380123;
  v_now        timestamptz;
  v_row        public.business_checkout_claims%ROWTYPE;
  v_new_token  uuid;
  v_active     boolean;
  v_found      boolean;
  v_unknown          bigint := 0;
  v_live             bigint := 0;
  v_past_due_stripe  bigint := 0;
  v_past_due_other   bigint := 0;
  v_null_status      bigint := 0;
BEGIN
  -- (a) Input validation. Structured outcomes only; never raw SQL errors.
  IF _user_id IS NULL OR _subject_id IS NULL THEN
    outcome := 'invalid_input'; reason := 'missing_identifier';
    RETURN NEXT; RETURN;
  END IF;

  IF _context IS NULL OR _context NOT IN ('recruiter','agency') THEN
    outcome := 'invalid_input'; reason := 'unsupported_context';
    RETURN NEXT; RETURN;
  END IF;

  -- A NULL plan key must be rejected explicitly: SQL three-valued logic makes
  -- NOT (NULL IN (...)) evaluate to NULL, which would otherwise fall through.
  IF _plan_key IS NULL THEN
    outcome := 'invalid_input'; reason := 'plan_not_supported';
    RETURN NEXT; RETURN;
  END IF;

  IF NOT (
       (_context = 'recruiter' AND _plan_key IN ('starter','growth','fleet'))
    OR (_context = 'agency'    AND _plan_key IN ('agency_starter','agency_team','agency_growth'))
  ) THEN
    outcome := 'invalid_input'; reason := 'plan_not_supported';
    RETURN NEXT; RETURN;
  END IF;

  IF _request_key IS NULL
     OR btrim(_request_key) = ''
     OR char_length(btrim(_request_key)) > 200 THEN
    outcome := 'invalid_input'; reason := 'request_key_invalid';
    RETURN NEXT; RETURN;
  END IF;

  -- (b) Ownership must be proven before any claim can be acquired.
  IF _context = 'recruiter' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.recruiter_profiles
       WHERE id = _subject_id AND user_id = _user_id
    ) THEN
      outcome := 'not_owner'; reason := 'recruiter_ownership_mismatch';
      RETURN NEXT; RETURN;
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.agency_profiles
       WHERE id = _subject_id AND owner_user_id = _user_id
    ) THEN
      outcome := 'not_owner'; reason := 'agency_ownership_mismatch';
      RETURN NEXT; RETURN;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.agency_members
       WHERE agency_id = _subject_id
         AND member_user_id = _user_id
         AND role::text = 'agency_owner'
         AND status::text = 'active'
    ) THEN
      outcome := 'not_owner'; reason := 'agency_owner_membership_missing';
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  -- (c) Serialize this transaction per user with a 64-bit namespaced advisory
  -- lock. The durable row below is still the long-lived cross-request
  -- coordination mechanism.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(_user_id::text, v_lock_namespace)
  );

  -- Wall-clock time must be re-read AFTER the lock is acquired: now() is fixed
  -- at transaction start and would be stale by the length of the lock wait.
  v_now := clock_timestamp();

  -- (d) Exact Phase 1R-D1 opposing durable-billing policy, evaluated SETWISE
  -- across every matching row with deterministic precedence:
  -- unknown > live > past_due(non-stripe, fail closed) > past_due(stripe).
  IF _context = 'recruiter' THEN
    -- Ownership linkage is expressed inside the aggregate join itself: zero
    -- joined rows naturally yields all-zero counts, which allows checkout.
    SELECT
      count(*) FILTER (WHERE
           COALESCE(ae.plan_key::text,'') NOT IN ('agency_starter','agency_team','agency_growth')
        OR COALESCE(ae.source::text,'')   NOT IN ('stripe','manual','admin_seed')
        OR COALESCE(ae.status::text,'')   NOT IN ('manual_beta','trialing','active','past_due','cancelled')),
      count(*) FILTER (WHERE ae.status::text IN ('active','trialing')),
      count(*) FILTER (WHERE ae.status::text = 'past_due' AND ae.source::text = 'stripe'),
      count(*) FILTER (WHERE ae.status::text = 'past_due' AND ae.source::text IS DISTINCT FROM 'stripe')
      INTO v_unknown, v_live, v_past_due_stripe, v_past_due_other
      FROM public.agency_entitlements ae
      JOIN public.agency_profiles ap ON ap.id = ae.agency_id
      JOIN public.agency_members am
        ON am.agency_id = ap.id
       AND am.member_user_id = _user_id
       AND am.role::text = 'agency_owner'
       AND am.status::text = 'active'
     WHERE ap.owner_user_id = _user_id;

    IF v_unknown > 0 THEN
      outcome := 'blocked'; reason := 'opposing_entitlement_unknown';
      RETURN NEXT; RETURN;
    ELSIF v_live > 0 THEN
      outcome := 'blocked'; reason := 'agency_entitlement_exists';
      RETURN NEXT; RETURN;
    ELSIF v_past_due_other > 0 THEN
      outcome := 'blocked'; reason := 'opposing_entitlement_unknown';
      RETURN NEXT; RETURN;
    ELSIF v_past_due_stripe > 0 THEN
      outcome := 'blocked'; reason := 'agency_billing_requires_management';
      RETURN NEXT; RETURN;
    END IF;
    -- manual_beta and cancelled confer no live agency premium → allow.
  ELSE
    SELECT
      count(*) FILTER (WHERE rbp.status IS NULL OR btrim(rbp.status::text) = ''),
      count(*) FILTER (WHERE rbp.status IS NOT NULL
        AND btrim(rbp.status::text) <> ''
        AND rbp.status::text NOT IN ('canceled','incomplete_expired','inactive')
        AND (
             rbp.status::text NOT IN ('active','trialing','past_due','unpaid','incomplete','paused')
          OR COALESCE(rbp.plan::text,'') NOT IN ('starter','growth','fleet')
        )),
      count(*) FILTER (WHERE
             rbp.status::text IN ('active','trialing','past_due','unpaid','incomplete','paused')
         AND COALESCE(rbp.plan::text,'') IN ('starter','growth','fleet'))
      INTO v_null_status, v_unknown, v_live
      FROM public.recruiter_billing_profiles rbp
     WHERE rbp.user_id = _user_id;

    IF v_null_status > 0 OR v_unknown > 0 THEN
      outcome := 'blocked'; reason := 'opposing_entitlement_unknown';
      RETURN NEXT; RETURN;
    ELSIF v_live > 0 THEN
      outcome := 'blocked'; reason := 'recruiter_subscription_exists';
      RETURN NEXT; RETURN;
    END IF;
    -- canceled / incomplete_expired / inactive are terminal → allow.
  END IF;

  -- (e) Durable row under row lock. Wall-clock time is refreshed once more so
  -- lease comparison and any new lease use time read after policy evaluation.
  v_now := clock_timestamp();

  SELECT * INTO v_row FROM public.business_checkout_claims
    WHERE user_id = _user_id FOR UPDATE;
  v_found := FOUND;

  IF v_found THEN
    -- (f) An active claim is processing/ready with a live lease.
    v_active := v_row.state IN ('processing','ready')
                AND v_row.lease_expires_at IS NOT NULL
                AND v_row.lease_expires_at > v_now;

    IF v_active THEN
      claim_context      := v_row.context;
      claim_subject_id   := v_row.subject_id;
      claim_plan_key     := v_row.plan_key;
      generation         := v_row.generation;
      claim_state        := v_row.state;
      lease_expires_at   := v_row.lease_expires_at;
      -- claim_token intentionally NULL: only a NEW acquisition exposes a token.

      -- (g) Exact same request on an active claim → reuse.
      IF v_row.context = _context
         AND v_row.subject_id = _subject_id
         AND v_row.plan_key = _plan_key
         AND v_row.request_key = _request_key THEN
        outcome := 'reused';
        stripe_checkout_session_id := v_row.stripe_checkout_session_id;
        checkout_expires_at        := v_row.checkout_expires_at;
        RETURN NEXT; RETURN;
      END IF;

      -- (h) Opposing context is blocked.
      IF v_row.context <> _context THEN
        outcome := 'blocked'; reason := 'opposing_claim_active';
        RETURN NEXT; RETURN;
      END IF;

      -- (i) Same context, different subject/plan/request key.
      outcome := 'blocked'; reason := 'same_context_claim_active';
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  v_new_token := gen_random_uuid();

  IF NOT v_found THEN
    -- (j) First claim for this user.
    INSERT INTO public.business_checkout_claims
      (user_id, context, subject_id, plan_key, request_key,
       generation, state, claim_token, lease_expires_at)
    VALUES
      (_user_id, _context, _subject_id, _plan_key, _request_key,
       1, 'processing', v_new_token,
       v_now + make_interval(secs => v_lease_seconds))
    RETURNING * INTO v_row;
  ELSE
    -- (k) Released, failed, or expired processing/ready → atomic takeover.
    UPDATE public.business_checkout_claims
       SET context                    = _context,
           subject_id                 = _subject_id,
           plan_key                   = _plan_key,
           request_key                = _request_key,
           generation                 = v_row.generation + 1,
           state                      = 'processing',
           claim_token                = v_new_token,
           lease_expires_at           = v_now + make_interval(secs => v_lease_seconds),
           stripe_checkout_session_id = NULL,
           checkout_expires_at        = NULL,
           last_error_code            = NULL,
           updated_at                 = v_now
     WHERE user_id = _user_id
     RETURNING * INTO v_row;
  END IF;

  -- (l) No recruiter-billing or agency-entitlement row is ever mutated here.
  outcome            := 'acquired';
  claim_context      := v_row.context;
  claim_subject_id   := v_row.subject_id;
  claim_plan_key     := v_row.plan_key;
  generation         := v_row.generation;
  claim_token        := v_row.claim_token;
  claim_state        := v_row.state;
  lease_expires_at   := v_row.lease_expires_at;
  RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.claim_business_checkout(uuid,text,uuid,text,text) IS
  'Phase 1R-D2-B2 service-role-only durable business checkout claim RPC. '
  'Advisory-locked per user_id; enforces the exact Phase 1R-D1 opposing policy.';

CREATE OR REPLACE FUNCTION public.complete_business_checkout_claim(
  _user_id             uuid,
  _context             text,
  _claim_token         uuid,
  _session_id          text,
  _checkout_expires_at timestamptz
)
RETURNS TABLE (outcome text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_row public.business_checkout_claims%ROWTYPE;
BEGIN
  IF _user_id IS NULL THEN
    outcome := 'invalid_input'; reason := 'missing_identifier'; RETURN NEXT; RETURN;
  END IF;
  IF _context IS NULL OR _context NOT IN ('recruiter','agency') THEN
    outcome := 'invalid_input'; reason := 'unsupported_context'; RETURN NEXT; RETURN;
  END IF;
  IF _claim_token IS NULL THEN
    outcome := 'invalid_input'; reason := 'missing_claim_token'; RETURN NEXT; RETURN;
  END IF;
  IF _session_id IS NULL OR btrim(_session_id) = '' THEN
    outcome := 'invalid_input'; reason := 'session_id_invalid'; RETURN NEXT; RETURN;
  END IF;
  IF _checkout_expires_at IS NULL OR _checkout_expires_at <= v_now THEN
    outcome := 'invalid_input'; reason := 'checkout_expiry_invalid'; RETURN NEXT; RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_user_id::text, 7218926914894380123)
  );

  -- Fresh wall-clock time after the lock wait.
  v_now := clock_timestamp();

  SELECT * INTO v_row FROM public.business_checkout_claims
    WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'not_found'; reason := 'claim_missing'; RETURN NEXT; RETURN;
  END IF;

  IF v_row.context <> _context THEN
    outcome := 'context_mismatch'; reason := 'claim_context_differs';
    RETURN NEXT; RETURN;
  END IF;

  -- Exact duplicate completion after a lost response is idempotent.
  IF v_row.state = 'ready' THEN
    IF v_row.stripe_checkout_session_id = _session_id
       AND v_row.checkout_expires_at = _checkout_expires_at THEN
      outcome := 'completed'; reason := 'already_completed'; RETURN NEXT; RETURN;
    END IF;
    outcome := 'session_mismatch'; reason := 'ready_session_differs';
    RETURN NEXT; RETURN;
  END IF;

  IF v_row.state <> 'processing'
     OR v_row.claim_token IS NULL
     OR v_row.claim_token <> _claim_token
     OR v_row.lease_expires_at IS NULL
     OR v_row.lease_expires_at <= v_now THEN
    outcome := 'lease_invalid'; reason := 'no_active_lease'; RETURN NEXT; RETURN;
  END IF;

  -- Narrow unique-session collision handling. No constraint names or raw
  -- database text is ever surfaced to the caller.
  BEGIN
    UPDATE public.business_checkout_claims
       SET state                      = 'ready',
           claim_token                = NULL,
           stripe_checkout_session_id = _session_id,
           checkout_expires_at        = _checkout_expires_at,
           lease_expires_at           = _checkout_expires_at,
           last_error_code            = NULL,
           updated_at                 = v_now
     WHERE user_id = _user_id;
  EXCEPTION WHEN unique_violation THEN
    outcome := 'session_conflict'; reason := 'checkout_session_already_claimed';
    RETURN NEXT; RETURN;
  END;

  outcome := 'completed'; RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.complete_business_checkout_claim(uuid,text,uuid,text,timestamptz) IS
  'Phase 1R-D2-B2 service-role-only completion RPC. Ready claims block through '
  'the exact Checkout Session expiry. Exact duplicate completion is idempotent.';

CREATE OR REPLACE FUNCTION public.release_business_checkout_claim(
  _user_id     uuid,
  _context     text,
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
  v_now  timestamptz := clock_timestamp();
  v_row  public.business_checkout_claims%ROWTYPE;
  v_next text;
BEGIN
  IF _user_id IS NULL THEN
    outcome := 'invalid_input'; reason := 'missing_identifier'; RETURN NEXT; RETURN;
  END IF;
  IF _context IS NULL OR _context NOT IN ('recruiter','agency') THEN
    outcome := 'invalid_input'; reason := 'unsupported_context'; RETURN NEXT; RETURN;
  END IF;
  IF _claim_token IS NULL THEN
    outcome := 'invalid_input'; reason := 'missing_claim_token'; RETURN NEXT; RETURN;
  END IF;
  IF _terminal IS NULL THEN
    outcome := 'invalid_input'; reason := 'terminal_flag_missing'; RETURN NEXT; RETURN;
  END IF;
  IF _error_code IS NULL
     OR _error_code !~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'
     OR char_length(_error_code) > 64 THEN
    outcome := 'invalid_input'; reason := 'error_code_malformed'; RETURN NEXT; RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_user_id::text, 7218926914894380123)
  );

  -- Fresh wall-clock time after the lock wait.
  v_now := clock_timestamp();

  SELECT * INTO v_row FROM public.business_checkout_claims
    WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'not_found'; reason := 'claim_missing'; RETURN NEXT; RETURN;
  END IF;

  IF v_row.context <> _context THEN
    outcome := 'context_mismatch'; reason := 'claim_context_differs';
    RETURN NEXT; RETURN;
  END IF;

  -- A ready claim must never be released by this RPC.
  IF v_row.state = 'ready' THEN
    outcome := 'release_forbidden'; reason := 'ready_claim_not_releasable';
    RETURN NEXT; RETURN;
  END IF;

  IF v_row.state <> 'processing'
     OR v_row.claim_token IS NULL
     OR v_row.claim_token <> _claim_token
     OR v_row.lease_expires_at IS NULL
     OR v_row.lease_expires_at <= v_now THEN
    outcome := 'lease_invalid'; reason := 'no_active_lease'; RETURN NEXT; RETURN;
  END IF;

  v_next := CASE WHEN _terminal THEN 'failed' ELSE 'released' END;

  UPDATE public.business_checkout_claims
     SET state                      = v_next,
         claim_token                = NULL,
         lease_expires_at           = NULL,
         stripe_checkout_session_id = NULL,
         checkout_expires_at        = NULL,
         last_error_code            = _error_code,
         updated_at                 = v_now
   WHERE user_id = _user_id;

  outcome := v_next; RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.release_business_checkout_claim(uuid,text,uuid,text,boolean) IS
  'Phase 1R-D2-B2 service-role-only release RPC. Processing claims only; '
  'never releases a ready claim. No billing, entitlement, or Stripe mutation.';

-- =====================================================================
-- 3. Function privileges: service-role-only (+ optional sandbox test roles).
-- =====================================================================
DO $priv$
DECLARE
  v_fn   text;
  v_role text;
  v_sig  text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'claim_business_checkout(uuid,text,uuid,text,text)',
    'complete_business_checkout_claim(uuid,text,uuid,text,timestamptz)',
    'release_business_checkout_claim(uuid,text,uuid,text,boolean)'
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
