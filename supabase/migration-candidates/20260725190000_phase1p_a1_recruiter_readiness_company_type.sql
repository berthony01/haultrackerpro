-- Phase 1P-A1 — Recruiter readiness + company type + conditional DOT/MC.
--
-- Staged in supabase/migration-candidates/ per Phase 1P-A1 packet:
-- DO NOT apply to any production or connected database from this pass.
--
-- Scope (locked, in order):
--   1. Add nullable public.recruiter_profiles.company_type text (if absent).
--   2. Add a named CHECK constraint limiting values to the exact four tokens
--      { carrier, third_party_recruiter, staffing_agency, independent_recruiter }
--      WITHOUT assigning existing rows. Legacy rows remain NULL.
--   3. GRANT UPDATE (company_type) to authenticated ONLY. No table-wide
--      UPDATE grant, no privilege change on protected consent / user_id /
--      id / created_at columns, no service_role broadening.
--   4. Replace public.recruiter_profile_can_manage_opportunities(uuid) with
--      company-type-aware conditional DOT/MC logic:
--        * `carrier` requires DOT OR MC.
--        * `third_party_recruiter`, `staffing_agency`, `independent_recruiter`
--          do NOT require DOT/MC for standard posting.
--        * NULL company_type is incomplete (blocks posting).
--   5. Replace public.current_user_can_manage_recruiter_opportunities(uuid)
--      with the same rule plus caller ownership.
--   6. Replace public.accept_recruiter_posting_terms(text) while preserving
--      every existing security, locking, atomic consent-pair integrity,
--      concurrency, version, suspension, ownership, grants, and search_path
--      behavior. Add company_type + conditional carrier DOT/MC checks. Emit
--      machine-readable missing-requirement tokens via the RAISE DETAIL
--      channel using safe non-PII vocabulary.
--   7. Replace public.ensure_my_recruiter_setup_state() only as needed so
--      missing_requirements includes 'company_type' and includes
--      'dot_or_mc_number' only when stored company_type is 'carrier'. Never
--      infers or writes company_type. All other behavior byte-preserved
--      from the promoted Phase 1N-E migration where practical.
--
-- Explicit non-scope:
--   * No opportunity-row changes.
--   * No consent backfill / grandfathering.
--   * No verification-status changes.
--   * No billing changes.
--   * No profile-data updates.
--   * No changes to protected column privileges except adding
--     UPDATE (company_type) to authenticated.
--
-- Idempotency: each step is guarded so a second application is a no-op.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Nullable company_type text column (idempotent).
-- ---------------------------------------------------------------------------
ALTER TABLE public.recruiter_profiles
  ADD COLUMN IF NOT EXISTS company_type text;

-- ---------------------------------------------------------------------------
-- 2. Named CHECK constraint limiting to exactly the four tokens. NULL is
--    permitted (legacy rows stay NULL until a user chooses).
-- ---------------------------------------------------------------------------
DO $phase1p_a1_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class     t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'recruiter_profiles'
       AND c.conname = 'recruiter_profiles_company_type_check'
  ) THEN
    ALTER TABLE public.recruiter_profiles
      ADD CONSTRAINT recruiter_profiles_company_type_check
      CHECK (
        company_type IS NULL
        OR company_type IN (
          'carrier',
          'third_party_recruiter',
          'staffing_agency',
          'independent_recruiter'
        )
      );
  END IF;
END
$phase1p_a1_check$;

-- ---------------------------------------------------------------------------
-- 3. Minimum-privilege GRANT for the new column only. Nothing else changes.
-- ---------------------------------------------------------------------------
GRANT UPDATE (company_type) ON public.recruiter_profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. recruiter_profile_can_manage_opportunities — company-type-aware.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(_recruiter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
      AND COALESCE(btrim(rp.recruiter_name), '') <> ''
      AND COALESCE(btrim(rp.company_name), '')   <> ''
      AND COALESCE(btrim(rp.recruiter_email), '') <> ''
      AND btrim(rp.recruiter_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND rp.company_type IN (
        'carrier',
        'third_party_recruiter',
        'staffing_agency',
        'independent_recruiter'
      )
      AND (
        rp.company_type <> 'carrier'
        OR (
          COALESCE(btrim(rp.dot_number), '') <> ''
          OR COALESCE(btrim(rp.mc_number), '') <> ''
        )
      )
      AND (
        rp.posting_terms_accepted_at IS NOT NULL
        OR rp.legacy_terms_grandfathered_at IS NOT NULL
      )
  );
$function$;

-- ---------------------------------------------------------------------------
-- 5. current_user_can_manage_recruiter_opportunities — same rule + ownership.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(_recruiter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
      AND COALESCE(btrim(rp.recruiter_name), '') <> ''
      AND COALESCE(btrim(rp.company_name), '')   <> ''
      AND COALESCE(btrim(rp.recruiter_email), '') <> ''
      AND btrim(rp.recruiter_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND rp.company_type IN (
        'carrier',
        'third_party_recruiter',
        'staffing_agency',
        'independent_recruiter'
      )
      AND (
        rp.company_type <> 'carrier'
        OR (
          COALESCE(btrim(rp.dot_number), '') <> ''
          OR COALESCE(btrim(rp.mc_number), '') <> ''
        )
      )
      AND (
        rp.posting_terms_accepted_at IS NOT NULL
        OR rp.legacy_terms_grandfathered_at IS NOT NULL
      )
  );
$function$;

-- ---------------------------------------------------------------------------
-- 6. accept_recruiter_posting_terms(text) — preserves every existing
--    security/locking/consent-pair/concurrency/version/suspension/ownership
--    invariant. Adds company_type + conditional carrier DOT/MC checks and
--    emits machine-readable safe missing-requirement tokens via DETAIL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_recruiter_posting_terms(_version text)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid     uuid := auth.uid();
  _rp      public.recruiter_profiles;
  _ts      timestamptz;
  _missing text[] := ARRAY[]::text[];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _version IS NULL OR _version <> '2026-07-17.v1' THEN
    RAISE EXCEPTION 'Unsupported posting terms version' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO _rp
    FROM public.recruiter_profiles rp
   WHERE rp.user_id = _uid
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recruiter profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF _rp.status = 'suspended' OR _rp.verification_status = 'suspended' THEN
    RAISE EXCEPTION 'Recruiter profile is suspended' USING ERRCODE = '42501';
  END IF;

  -- Deterministic missing-requirement collection using the locked token
  -- vocabulary. Order mirrors the client selector.
  IF COALESCE(btrim(_rp.recruiter_name), '') = '' THEN
    _missing := array_append(_missing, 'recruiter_name');
  END IF;
  IF COALESCE(btrim(_rp.company_name), '') = '' THEN
    _missing := array_append(_missing, 'company_name');
  END IF;
  IF COALESCE(btrim(_rp.recruiter_email), '') = '' THEN
    _missing := array_append(_missing, 'recruiter_email_missing');
  ELSIF btrim(_rp.recruiter_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    _missing := array_append(_missing, 'recruiter_email_invalid');
  END IF;
  IF _rp.company_type IS NULL
     OR _rp.company_type NOT IN (
       'carrier',
       'third_party_recruiter',
       'staffing_agency',
       'independent_recruiter'
     )
  THEN
    _missing := array_append(_missing, 'company_type');
  END IF;
  IF _rp.company_type = 'carrier'
     AND COALESCE(btrim(_rp.dot_number), '') = ''
     AND COALESCE(btrim(_rp.mc_number), '') = ''
  THEN
    _missing := array_append(_missing, 'dot_or_mc');
  END IF;

  IF array_length(_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Profile incomplete'
      USING ERRCODE = '22023',
            DETAIL  = 'missing_requirements=' || array_to_string(_missing, ',');
  END IF;

  -- Atomic-pair integrity. If exactly one of the two consent columns is
  -- NULL the row is malformed. Reject BEFORE any UPDATE.
  IF (_rp.posting_terms_accepted_at IS NULL) <> (_rp.posting_terms_version IS NULL) THEN
    RAISE EXCEPTION 'Malformed posting terms consent pair' USING ERRCODE = '22023';
  END IF;

  -- Historical consent preserved intact: mismatched versions never silently
  -- overwrite the accepted timestamp/version.
  IF _rp.posting_terms_accepted_at IS NOT NULL
     AND _rp.posting_terms_version IS NOT NULL
     AND _rp.posting_terms_version <> _version THEN
    RAISE EXCEPTION 'Posting terms version mismatch' USING ERRCODE = '22023';
  END IF;

  -- Same-version retry: return the ORIGINAL timestamp unchanged.
  IF _rp.posting_terms_accepted_at IS NOT NULL
     AND _rp.posting_terms_version = _version THEN
    RETURN _rp.posting_terms_accepted_at;
  END IF;

  -- First-write-wins. If two callers race, both observe the same value
  -- via COALESCE after the row lock is released.
  UPDATE public.recruiter_profiles
     SET posting_terms_accepted_at = COALESCE(posting_terms_accepted_at, transaction_timestamp()),
         posting_terms_version     = COALESCE(posting_terms_version, _version)
   WHERE id = _rp.id
     AND user_id = _uid
  RETURNING posting_terms_accepted_at INTO _ts;

  IF _ts IS NULL THEN
    RAISE EXCEPTION 'Failed to stamp posting terms acceptance' USING ERRCODE = 'P0002';
  END IF;

  RETURN _ts;
END;
$function$;

REVOKE ALL     ON FUNCTION public.accept_recruiter_posting_terms(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_recruiter_posting_terms(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.accept_recruiter_posting_terms(text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. ensure_my_recruiter_setup_state — include company_type and conditional
--    dot_or_mc_number tokens. Never infers or writes company_type. All
--    other behavior byte-preserved from Phase 1N-E where practical.
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
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT uc.status::text
    INTO _cap_status
    FROM public.user_capabilities uc
   WHERE uc.user_id = _uid
     AND uc.capability = 'recruiter';

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

  IF _cap_status = 'active' AND _rp.id IS NULL THEN
    RAISE EXCEPTION
      'active recruiter capability without recruiter_profiles row for user %',
      _uid
      USING ERRCODE = 'raise_exception';
  END IF;

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

    -- NOTE: company_type is NEVER inferred or written here. Legacy rows
    -- stay NULL until the user chooses one in onboarding.
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
    ON CONFLICT DO NOTHING
    RETURNING id INTO _inserted_id;

    IF _inserted_id IS NOT NULL THEN
      _created := true;
    END IF;

    SELECT * INTO _rp
      FROM public.recruiter_profiles rp
     WHERE rp.user_id = _uid;
  END IF;

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
    _missing := array_append(_missing, 'recruiter_name');
  END IF;
  IF COALESCE(btrim(_rp.company_name), '') = '' THEN
    _missing := array_append(_missing, 'company_name');
  END IF;
  IF COALESCE(btrim(_rp.recruiter_email), '') = ''
     OR btrim(COALESCE(_rp.recruiter_email, '')) !~
        '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    _missing := array_append(_missing, 'recruiter_email');
  END IF;
  IF _rp.company_type IS NULL
     OR _rp.company_type NOT IN (
       'carrier',
       'third_party_recruiter',
       'staffing_agency',
       'independent_recruiter'
     )
  THEN
    _missing := array_append(_missing, 'company_type');
  END IF;
  -- dot_or_mc_number is only a missing requirement for carrier accounts.
  IF _rp.company_type = 'carrier'
     AND COALESCE(btrim(_rp.dot_number), '') = ''
     AND COALESCE(btrim(_rp.mc_number), '') = '' THEN
    _missing := array_append(_missing, 'dot_or_mc_number');
  END IF;
  IF _rp.posting_terms_accepted_at IS NULL
     AND _rp.legacy_terms_grandfathered_at IS NULL THEN
    _missing := array_append(_missing, 'posting_terms');
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
  'Phase 1P-A1 update: adds company_type and conditional dot_or_mc_number '
  'tokens to missing_requirements. Never infers or writes company_type. '
  'All other behavior byte-preserved from Phase 1N-E1.';

COMMIT;
