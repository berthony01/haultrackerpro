-- Phase 1F-A.2.2-R1B — Consent-pair integrity for accept_recruiter_posting_terms.
--
-- Narrow replacement of public.accept_recruiter_posting_terms(text) only.
-- Adds an explicit atomic-pair guard: a recruiter_profiles row where exactly
-- one of (posting_terms_accepted_at, posting_terms_version) is NULL is a
-- corrupt / malformed consent pair. The RPC now rejects that state with
-- SQLSTATE 22023 BEFORE any mutation, so historical partial data is never
-- silently repaired, filled, cleared, or overwritten.
--
-- All other behavior — row lock, first-write-wins, same-version idempotent
-- retry, different-version rejection, incomplete-profile / suspended-profile
-- / anonymous-caller / unsupported-version rejections, SECURITY DEFINER,
-- pinned search_path, EXECUTE grants — is preserved unchanged.
--
-- No table, trigger, policy, column privilege, or other function is altered.

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

  -- R1B: atomic-pair integrity. If exactly one of the two consent columns
  -- is NULL the row is malformed. Reject BEFORE any UPDATE so no field is
  -- repaired, filled, cleared, or overwritten by this call.
  IF (_rp.posting_terms_accepted_at IS NULL) <> (_rp.posting_terms_version IS NULL) THEN
    RAISE EXCEPTION 'Malformed posting terms consent pair' USING ERRCODE = '22023';
  END IF;

  -- Historical consent is preserved intact: mismatched versions do not
  -- silently overwrite the accepted timestamp/version.
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
GRANT  EXECUTE ON FUNCTION public.accept_recruiter_posting_terms(text) TO   authenticated, service_role;