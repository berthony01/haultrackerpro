-- Phase 1R-D2-B6-B1 — Recruiter Checkout Eligibility Alignment
--
-- ACTIVE managed-migration promotion of the reviewed and tested candidate:
--   supabase/migration-candidates/20260731232000_phase1r_d2_b6_b1_recruiter_checkout_eligibility_alignment.sql
--
-- The executable body from BEGIN; through COMMIT; is unchanged from the
-- candidate. Production application remains a separately controlled action.

BEGIN;

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

  -- Suspension check runs BEFORE the readiness check (order preserved).
  IF v_prof.status = 'suspended' OR v_prof.verification_status = 'suspended' THEN
    outcome := 'not_eligible'; reason := 'account_suspended'; RETURN NEXT; RETURN;
  END IF;

  -- Phase 1R-D2-B6-B1: canonical readiness helper replaces the obsolete
  -- approved-verification comparison.
  IF NOT public.recruiter_profile_can_manage_opportunities(_recruiter_id) THEN
    outcome := 'not_eligible'; reason := 'profile_not_ready'; RETURN NEXT; RETURN;
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
  'Phase 1R-D2-B6-B1 service-role-only claim RPC. Advisory-locked per recruiter_id. '
  'Readiness gated by public.recruiter_profile_can_manage_opportunities.';

-- Reassert least privilege for the replaced function only.
DO $priv$
DECLARE
  v_role text;
  v_sig  constant text :=
    'public.claim_recruiter_checkout_intent(uuid,uuid,text)';
BEGIN
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
END
$priv$;

COMMIT;
