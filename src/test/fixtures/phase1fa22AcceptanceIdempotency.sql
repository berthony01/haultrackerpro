-- Phase 1F-A.2.2 — Recruiter consent idempotency + duplicate-guard-trigger cleanup.
--
-- LOCAL CANDIDATE FIXTURE (pre-promotion). This is loaded by the runtime
-- harness so pre-live gates exercise the exact SQL that Stage 1F-A.2.2 will
-- apply through the Supabase migration mechanism. Once the production
-- migration file lands under supabase/migrations/, the harness discovers it
-- there by header token and this fixture is removed.
--
-- Two narrow corrections applied on top of Phase 1F-A.2.1B:
--
--   1. accept_recruiter_posting_terms(text) is rewritten to be safe under
--      simultaneous first-write calls. The caller's profile row is locked
--      with SELECT ... FOR UPDATE, then a COALESCE first-write-wins UPDATE
--      preserves the original timestamp/version and returns that same value
--      to every caller.
--
--      Version handling:
--        * NULL / unsupported version               → 22023, no write.
--        * Already-accepted, same version            → return existing ts.
--        * Already-accepted, DIFFERENT version       → 22023, no overwrite;
--          historical consent is preserved intact.
--        * Never-accepted                            → first-write-wins.
--
--   2. `trg_recruiter_profiles_guard` is DROPPED. Live pg_trigger shows two
--      BEFORE INSERT OR UPDATE triggers wired to recruiter_profile_guard()
--      with identical timing / event / function / no WHEN clause /
--      enabled — the guard runs twice per row. Dropping the redundant
--      trigger leaves exactly one canonical guard trigger
--      (`recruiter_profile_guard`) with identical effective behavior.

CREATE OR REPLACE FUNCTION public.accept_recruiter_posting_terms(_version text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _rp  public.recruiter_profiles;
  _ts  timestamptz;
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

  IF COALESCE(btrim(_rp.recruiter_name), '') = ''
     OR COALESCE(btrim(_rp.company_name), '') = ''
     OR COALESCE(btrim(_rp.recruiter_email), '') = ''
     OR btrim(_rp.recruiter_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR (
          COALESCE(btrim(_rp.dot_number), '') = ''
      AND COALESCE(btrim(_rp.mc_number), '') = ''
     )
  THEN
    RAISE EXCEPTION 'Profile incomplete' USING ERRCODE = '22023';
  END IF;

  IF _rp.posting_terms_accepted_at IS NOT NULL
     AND _rp.posting_terms_version IS NOT NULL
     AND _rp.posting_terms_version <> _version THEN
    RAISE EXCEPTION 'Posting terms version mismatch' USING ERRCODE = '22023';
  END IF;

  IF _rp.posting_terms_accepted_at IS NOT NULL
     AND _rp.posting_terms_version = _version THEN
    RETURN _rp.posting_terms_accepted_at;
  END IF;

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
GRANT  EXECUTE ON FUNCTION public.accept_recruiter_posting_terms(text) TO   authenticated, service_role;

DROP TRIGGER IF EXISTS trg_recruiter_profiles_guard ON public.recruiter_profiles;
