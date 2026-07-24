-- Phase 1N-E1 — Legacy recruiter compatibility (staged candidate).
--
-- Purpose: close the "recruiter capability = setup but no
-- public.recruiter_profiles row" compatibility gap that blocks opportunity
-- posting with a recruiter-profile error. This candidate performs EXACTLY
-- two operations and nothing else:
--
--   1. An idempotent one-shot backfill that inserts a single incomplete
--      recruiter_profiles row for every existing user whose recruiter
--      capability is precisely `setup` and who has no recruiter_profiles
--      row. Trusted fields only — never invents a name, never accepts
--      posting terms, never grandfathers, never approves verification,
--      never touches billing or opportunity policies.
--
--   2. A caller-only self-heal RPC
--      `public.ensure_my_recruiter_setup_state()` that safely reproduces
--      the same backfill for the authenticated caller and returns a
--      deterministic setup summary.
--
-- No other behavior. No trigger changes. No opportunity or billing policy
-- changes. No modifications to existing functions.
--
-- Staged in supabase/migration-candidates/ per Phase 1N-E1 packet: DO NOT
-- apply to any production or connected database from this pass.


-- ---------------------------------------------------------------------------
-- 1. Idempotent backfill for existing setup-only recruiter users missing
--    a recruiter_profiles row.
--
-- Selection rules (ALL required):
--   * public.user_capabilities.capability = 'recruiter'
--   * public.user_capabilities.status     = 'setup' (exact)
--   * auth.users row exists
--   * NO public.recruiter_profiles row for that user
--
-- Explicit non-targets:
--   * users with recruiter capability status active, suspended, revoked
--   * users with no recruiter capability
--   * users who already have any recruiter_profiles row (complete, legacy
--     grandfathered, accepted terms, rejected, suspended, malformed)
--
-- Trusted-source rules:
--   * recruiter_name  ← first nonblank of profiles.display_name,
--                       raw_user_meta_data->>'display_name',
--                       raw_user_meta_data->>'full_name',
--                       raw_user_meta_data->>'name'; else '' (column NOT
--                       NULL). Email local-part is never used.
--   * recruiter_email ← auth.users.email when trimmed value matches the
--                       canonical recruiter email pattern; else NULL.
--   * recruiter_phone ← nonblank trimmed raw_user_meta_data->>'phone';
--                       else NULL.
--   * company_name    ← '' (never inferred).
--   * All other fields left at existing table defaults / NULL. Never sets
--     posting_terms_accepted_at, posting_terms_version,
--     legacy_terms_grandfathered_at, verification_status, verified_at,
--     verified_by, admin_notes, or any billing/subscription data.
--
-- Idempotency: ON CONFLICT (user_id) DO NOTHING preserves the existing
-- UNIQUE(user_id) contract so a rerun cannot duplicate or overwrite.
-- ---------------------------------------------------------------------------
DO $phase1n_e_backfill$
DECLARE
  _r        record;
  _name     text;
  _email    text;
  _phone    text;
BEGIN
  FOR _r IN
    SELECT uc.user_id
      FROM public.user_capabilities uc
      JOIN auth.users u ON u.id = uc.user_id
      LEFT JOIN public.recruiter_profiles rp ON rp.user_id = uc.user_id
     WHERE uc.capability = 'recruiter'
       AND uc.status = 'setup'
       AND rp.user_id IS NULL
  LOOP
    SELECT
      COALESCE(
        NULLIF(btrim(p.display_name), ''),
        NULLIF(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
        NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
        NULLIF(btrim(u.raw_user_meta_data ->> 'name'), ''),
        ''
      ),
      CASE
        WHEN btrim(u.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          THEN btrim(u.email)
        ELSE NULL
      END,
      NULLIF(btrim(u.raw_user_meta_data ->> 'phone'), '')
    INTO _name, _email, _phone
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
    WHERE u.id = _r.user_id;

    INSERT INTO public.recruiter_profiles(
      user_id,
      recruiter_name,
      recruiter_email,
      recruiter_phone,
      company_name
    ) VALUES (
      _r.user_id,
      _name,
      _email,
      _phone,
      ''
    )
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
END
$phase1n_e_backfill$;


-- ---------------------------------------------------------------------------
-- 2. Caller-only self-heal RPC.
--
--   public.ensure_my_recruiter_setup_state() RETURNS TABLE(...)
--
-- Security:
--   * SECURITY DEFINER, pinned SET search_path = public.
--   * No parameters — caller identity is auth.uid() only.
--   * Anonymous / NULL auth fails with SQLSTATE 42501.
--   * Revoked from PUBLIC and anon; EXECUTE only to authenticated
--     and service_role.
--
-- Behavior contract (deterministic):
--   * capability missing            → eligibility_state='capability_missing',
--                                     profile_created=false, no writes.
--   * capability revoked            → eligibility_state='revoked', no writes.
--   * capability suspended          → eligibility_state='suspended', no writes.
--   * capability active w/o profile → RAISE (controlled) — never fabricate.
--   * capability setup, no profile  → insert trusted-field row (same rules
--                                     as backfill), conflict-safe.
--   * profile already exists        → never updated.
--
-- Missing-requirements token order (only when profile exists / created and
-- state is not suspended/revoked):
--   1. recruiter_name
--   2. company_name
--   3. recruiter_email
--   4. dot_or_mc_number
--   5. posting_terms
--
-- eligibility_state='active' only when capability is active AND
-- public.recruiter_profile_can_manage_opportunities(profile.id) is true.
-- This RPC never promotes capability itself — promotion happens through
-- the existing capability-sync triggers when a legitimate profile change
-- occurs elsewhere.
--
-- Concurrency: two concurrent first calls for the same setup user finish
-- with exactly one recruiter_profiles row via the UNIQUE(user_id) contract;
-- exactly one call reports profile_created=true.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_my_recruiter_setup_state()
RETURNS TABLE (
  user_id              uuid,
  profile_id           uuid,
  profile_created      boolean,
  capability_status    text,
  eligibility_state    text,
  missing_requirements text[]
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid         uuid := auth.uid();
  _cap_status  text;
  _rp          public.recruiter_profiles;
  _created     boolean := false;
  _name        text;
  _email       text;
  _phone       text;
  _missing     text[] := ARRAY[]::text[];
  _elig        text;
  _inserted_id uuid;
BEGIN
  -- Anonymous / NULL auth: fail closed with 42501.
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT uc.status::text
    INTO _cap_status
    FROM public.user_capabilities uc
   WHERE uc.user_id = _uid
     AND uc.capability = 'recruiter';

  -- No recruiter capability at all: never create anything.
  IF _cap_status IS NULL THEN
    RETURN QUERY
      SELECT _uid,
             NULL::uuid,
             false,
             NULL::text,
             'capability_missing'::text,
             ARRAY[]::text[];
    RETURN;
  END IF;

  SELECT * INTO _rp
    FROM public.recruiter_profiles rp
   WHERE rp.user_id = _uid;

  -- Terminal / non-mutating states.
  IF _cap_status = 'revoked' THEN
    RETURN QUERY
      SELECT _uid, _rp.id, false, _cap_status, 'revoked'::text, ARRAY[]::text[];
    RETURN;
  END IF;

  IF _cap_status = 'suspended' THEN
    RETURN QUERY
      SELECT _uid, _rp.id, false, _cap_status, 'suspended'::text, ARRAY[]::text[];
    RETURN;
  END IF;

  -- Anomalous: active capability with no profile row. Fail closed rather
  -- than fabricate an incomplete profile that would silently demote the
  -- caller. Do not mutate anything.
  IF _cap_status = 'active' AND _rp.id IS NULL THEN
    RAISE EXCEPTION
      'active recruiter capability without recruiter_profiles row for user %',
      _uid
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Setup + no profile: perform trusted-field insert (conflict-safe).
  IF _cap_status = 'setup' AND _rp.id IS NULL THEN
    SELECT
      COALESCE(
        NULLIF(btrim(p.display_name), ''),
        NULLIF(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
        NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
        NULLIF(btrim(u.raw_user_meta_data ->> 'name'), ''),
        ''
      ),
      CASE
        WHEN btrim(u.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          THEN btrim(u.email)
        ELSE NULL
      END,
      NULLIF(btrim(u.raw_user_meta_data ->> 'phone'), '')
    INTO _name, _email, _phone
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
    WHERE u.id = _uid;

    INSERT INTO public.recruiter_profiles(
      user_id,
      recruiter_name,
      recruiter_email,
      recruiter_phone,
      company_name
    ) VALUES (
      _uid,
      _name,
      _email,
      _phone,
      ''
    )
    ON CONFLICT (user_id) DO NOTHING
    RETURNING id INTO _inserted_id;

    IF _inserted_id IS NOT NULL THEN
      _created := true;
    END IF;

    SELECT * INTO _rp
      FROM public.recruiter_profiles rp
     WHERE rp.user_id = _uid;
  END IF;

  -- Recompute capability status post-op (triggers may have updated it).
  SELECT uc.status::text
    INTO _cap_status
    FROM public.user_capabilities uc
   WHERE uc.user_id = _uid
     AND uc.capability = 'recruiter';

  IF _cap_status = 'revoked' THEN
    RETURN QUERY
      SELECT _uid, _rp.id, _created, _cap_status, 'revoked'::text, ARRAY[]::text[];
    RETURN;
  END IF;

  IF _cap_status = 'suspended' THEN
    RETURN QUERY
      SELECT _uid, _rp.id, _created, _cap_status, 'suspended'::text, ARRAY[]::text[];
    RETURN;
  END IF;

  -- Deterministic missing-requirement calculation (canonical posting rule).
  IF COALESCE(btrim(_rp.recruiter_name), '') = '' THEN
    _missing := _missing || 'recruiter_name';
  END IF;
  IF COALESCE(btrim(_rp.company_name), '') = '' THEN
    _missing := _missing || 'company_name';
  END IF;
  IF COALESCE(btrim(_rp.recruiter_email), '') = ''
     OR btrim(COALESCE(_rp.recruiter_email, '')) !~
        '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    _missing := _missing || 'recruiter_email';
  END IF;
  IF COALESCE(btrim(_rp.dot_number), '') = ''
     AND COALESCE(btrim(_rp.mc_number), '') = '' THEN
    _missing := _missing || 'dot_or_mc_number';
  END IF;
  IF _rp.posting_terms_accepted_at IS NULL
     AND _rp.legacy_terms_grandfathered_at IS NULL THEN
    _missing := _missing || 'posting_terms';
  END IF;

  IF _cap_status = 'active'
     AND public.recruiter_profile_can_manage_opportunities(_rp.id) THEN
    _elig := 'active';
  ELSE
    _elig := 'setup_incomplete';
  END IF;

  RETURN QUERY
    SELECT _uid, _rp.id, _created, _cap_status, _elig, _missing;
END;
$$;

REVOKE ALL     ON FUNCTION public.ensure_my_recruiter_setup_state() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_my_recruiter_setup_state() FROM anon;
GRANT  EXECUTE ON FUNCTION public.ensure_my_recruiter_setup_state()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ensure_my_recruiter_setup_state() IS
  'Phase 1N-E1 caller-only self-heal for legacy recruiter setup users '
  'missing a recruiter_profiles row. Never accepts posting terms, never '
  'grandfathers, never approves verification, never mutates billing, and '
  'never updates an existing recruiter profile.';
