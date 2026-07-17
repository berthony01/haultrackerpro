-- Phase 1F-A.2.1B — Server-terms authorization repair (DEF-GUC-Bypass).
--
-- Repairs Phase 1F-A.2's reliance on the client-settable custom GUC
-- `app.accept_posting_terms`. Any authenticated caller could `set_config`
-- that GUC and directly UPDATE their `posting_terms_*` columns with
-- forged values, bypassing the sanctioned RPC.
--
-- Repair strategy: PostgreSQL column privileges are the authorization
-- boundary. Direct authenticated UPDATE on posting_terms_accepted_at /
-- posting_terms_version / legacy_terms_grandfathered_at is denied at
-- grant-check time (before triggers run). The SECURITY DEFINER RPC
-- accept_recruiter_posting_terms() runs with the definer's privileges
-- and remains the only authorized path to stamp consent. The
-- recruiter_profile_guard() trigger is replaced with a no-GUC
-- implementation that never overwrites posting_terms_* on UPDATE.

-- =========================================================================
-- 1. Column privileges on public.recruiter_profiles
-- =========================================================================
-- Step 1: strip table-level UPDATE from PUBLIC / anon / authenticated so any
-- future write must be authorized column-by-column.
REVOKE UPDATE ON public.recruiter_profiles FROM PUBLIC;
REVOKE UPDATE ON public.recruiter_profiles FROM anon;
REVOKE UPDATE ON public.recruiter_profiles FROM authenticated;

-- Step 2: explicitly revoke UPDATE on every protected column from every
-- non-service_role grantee. This guarantees no stale column-level grant
-- from an earlier migration survives.
REVOKE UPDATE (
  id,
  user_id,
  created_at,
  posting_terms_accepted_at,
  posting_terms_version,
  legacy_terms_grandfathered_at
) ON public.recruiter_profiles FROM PUBLIC;
REVOKE UPDATE (
  id,
  user_id,
  created_at,
  posting_terms_accepted_at,
  posting_terms_version,
  legacy_terms_grandfathered_at
) ON public.recruiter_profiles FROM anon;
REVOKE UPDATE (
  id,
  user_id,
  created_at,
  posting_terms_accepted_at,
  posting_terms_version,
  legacy_terms_grandfathered_at
) ON public.recruiter_profiles FROM authenticated;

-- Step 3: grant UPDATE on the allowed ordinary/moderation columns to
-- authenticated. service_role privileges are intentionally NOT modified
-- here — this migration must not broaden any grant to service_role.
GRANT UPDATE (
  recruiter_name,
  recruiter_email,
  recruiter_phone,
  company_name,
  company_website,
  dot_number,
  mc_number,
  company_phone,
  company_address,
  company_city,
  company_state,
  hiring_states,
  equipment_types,
  driver_types_hired,
  verification_status,
  status,
  admin_notes,
  verified_at,
  verified_by,
  updated_at
) ON public.recruiter_profiles TO authenticated;

-- =========================================================================
-- 2. accept_recruiter_posting_terms(text) — no GUC, UPDATE ... RETURNING
-- =========================================================================
CREATE OR REPLACE FUNCTION public.accept_recruiter_posting_terms(_version text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _rp public.recruiter_profiles;
  _ts timestamptz;
  _returned_ts timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _version IS NULL OR _version <> '2026-07-17.v1' THEN
    RAISE EXCEPTION 'Unsupported posting terms version' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _rp
    FROM public.recruiter_profiles rp
   WHERE rp.user_id = _uid
   LIMIT 1;
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

  -- Idempotent repeat: same version → preserve and return original stamp.
  IF _rp.posting_terms_accepted_at IS NOT NULL
     AND _rp.posting_terms_version = _version THEN
    RETURN _rp.posting_terms_accepted_at;
  END IF;

  _ts := transaction_timestamp();

  UPDATE public.recruiter_profiles
     SET posting_terms_accepted_at = _ts,
         posting_terms_version = _version
   WHERE id = _rp.id
     AND user_id = _uid
  RETURNING posting_terms_accepted_at INTO _returned_ts;

  IF _returned_ts IS NULL THEN
    RAISE EXCEPTION 'Failed to stamp posting terms acceptance' USING ERRCODE = 'P0002';
  END IF;

  RETURN _returned_ts;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_recruiter_posting_terms(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_recruiter_posting_terms(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_recruiter_posting_terms(text) TO authenticated, service_role;

-- =========================================================================
-- 3. recruiter_profile_guard() — no GUC branch, no consent overwrite
-- =========================================================================
-- Consent fields (posting_terms_accepted_at, posting_terms_version) are
-- now protected by column privileges above. Direct authenticated UPDATE
-- on those columns is blocked at grant-check time. The SECURITY DEFINER
-- RPC bypasses column privileges as the definer and remains the sole
-- authorized write path.
--
-- legacy_terms_grandfathered_at is also column-privilege-protected AND
-- kept trigger-immutable to non-admin callers as defense-in-depth.
CREATE OR REPLACE FUNCTION public.recruiter_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending';
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
    NEW.admin_notes := NULL;
    NEW.posting_terms_accepted_at := NULL;
    NEW.posting_terms_version := NULL;
    NEW.legacy_terms_grandfathered_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.verification_status = 'rejected'
       AND NEW.verification_status = 'pending'
       AND OLD.user_id = auth.uid()
       AND OLD.status <> 'suspended'
       AND OLD.verification_status <> 'suspended'
    THEN
      -- Rejected-to-pending resubmission preserved.
      NEW.verified_at := NULL;
      NEW.verified_by := NULL;
      NEW.admin_notes := OLD.admin_notes;
      NEW.status := OLD.status;
    ELSE
      NEW.verification_status := OLD.verification_status;
      NEW.verified_at := OLD.verified_at;
      NEW.verified_by := OLD.verified_by;
      NEW.admin_notes := OLD.admin_notes;
      NEW.status := OLD.status;
    END IF;

    -- Legacy grandfather remains immutable to non-admin callers.
    NEW.legacy_terms_grandfathered_at := OLD.legacy_terms_grandfathered_at;

    -- IMPORTANT: do NOT overwrite posting_terms_* here. Column privileges
    -- prevent direct authenticated writes; the SECURITY DEFINER RPC is
    -- authorized to update these values as the definer and its writes
    -- must reach the row unmodified.
  END IF;

  RETURN NEW;
END;
$function$;