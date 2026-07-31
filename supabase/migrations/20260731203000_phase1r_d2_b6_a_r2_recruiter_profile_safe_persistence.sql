-- Phase 1R-D2-B6-A-R2 — Recruiter profile safe persistence.
--
-- Recruiters update their own rows through an UPDATE policy, while direct
-- caller SELECT remains intentionally unavailable so protected moderation
-- fields cannot be read. This caller-bound SECURITY DEFINER function provides
-- a narrow persistence path and returns only the fields needed to verify that
-- the ordinary profile values were saved.

BEGIN;

CREATE OR REPLACE FUNCTION public.persist_my_recruiter_profile(
  _recruiter_name     text,
  _recruiter_email    text,
  _recruiter_phone    text,
  _company_name       text,
  _company_type       text,
  _company_website    text,
  _company_phone      text,
  _company_address    text,
  _company_city       text,
  _company_state      text,
  _dot_number         text,
  _mc_number          text,
  _hiring_states      text[],
  _equipment_types    text[],
  _driver_types_hired text[]
)
RETURNS TABLE (
  id              uuid,
  recruiter_name  text,
  company_name    text,
  recruiter_email text,
  company_type    text,
  dot_number      text,
  mc_number       text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid                 uuid := auth.uid();
  _capability_status   text;
  _profile_id          uuid;
  _profile_status      text;
  _verification_status text;
  _affected            integer;
  _returned            integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT uc.status::text
    INTO _capability_status
    FROM public.user_capabilities uc
   WHERE uc.user_id = _uid
     AND uc.capability = 'recruiter'::public.user_capability_type
   LIMIT 1;

  IF _capability_status IS NULL THEN
    RAISE EXCEPTION 'Recruiter access is not enabled for this account'
      USING ERRCODE = '42501';
  END IF;

  IF _capability_status NOT IN ('setup', 'active') THEN
    RAISE EXCEPTION 'Recruiter access is not available for this account'
      USING ERRCODE = '42501';
  END IF;

  SELECT rp.id, rp.status, rp.verification_status
    INTO _profile_id, _profile_status, _verification_status
    FROM public.recruiter_profiles rp
   WHERE rp.user_id = _uid
   LIMIT 1
     FOR UPDATE;

  IF _profile_id IS NOT NULL
     AND (
       _profile_status = 'suspended'
       OR _verification_status = 'suspended'
     )
  THEN
    RAISE EXCEPTION 'Recruiter profile is suspended and cannot be updated'
      USING ERRCODE = '42501';
  END IF;

  IF _profile_id IS NULL THEN
    INSERT INTO public.recruiter_profiles (
      user_id,
      recruiter_name,
      recruiter_email,
      recruiter_phone,
      company_name,
      company_type,
      company_website,
      company_phone,
      company_address,
      company_city,
      company_state,
      dot_number,
      mc_number,
      hiring_states,
      equipment_types,
      driver_types_hired
    )
    VALUES (
      _uid,
      _recruiter_name,
      _recruiter_email,
      _recruiter_phone,
      _company_name,
      _company_type,
      _company_website,
      _company_phone,
      _company_address,
      _company_city,
      _company_state,
      _dot_number,
      _mc_number,
      COALESCE(_hiring_states, ARRAY[]::text[]),
      COALESCE(_equipment_types, ARRAY[]::text[]),
      COALESCE(_driver_types_hired, ARRAY[]::text[])
    )
    RETURNING recruiter_profiles.id INTO _profile_id;

    GET DIAGNOSTICS _affected = ROW_COUNT;
  ELSE
    UPDATE public.recruiter_profiles rp
       SET recruiter_name     = _recruiter_name,
           recruiter_email    = _recruiter_email,
           recruiter_phone    = _recruiter_phone,
           company_name       = _company_name,
           company_type       = _company_type,
           company_website    = _company_website,
           company_phone      = _company_phone,
           company_address    = _company_address,
           company_city       = _company_city,
           company_state      = _company_state,
           dot_number         = _dot_number,
           mc_number          = _mc_number,
           hiring_states      = COALESCE(_hiring_states, ARRAY[]::text[]),
           equipment_types    = COALESCE(_equipment_types, ARRAY[]::text[]),
           driver_types_hired = COALESCE(_driver_types_hired, ARRAY[]::text[])
     WHERE rp.id = _profile_id
       AND rp.user_id = _uid;

    GET DIAGNOSTICS _affected = ROW_COUNT;
  END IF;

  IF _affected <> 1 OR _profile_id IS NULL THEN
    RAISE EXCEPTION 'Recruiter profile could not be saved'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT rp.id,
         rp.recruiter_name,
         rp.company_name,
         rp.recruiter_email,
         rp.company_type,
         rp.dot_number,
         rp.mc_number
    FROM public.recruiter_profiles rp
   WHERE rp.id = _profile_id
     AND rp.user_id = _uid;

  GET DIAGNOSTICS _returned = ROW_COUNT;
  IF _returned <> 1 THEN
    RAISE EXCEPTION 'Recruiter profile could not be verified'
      USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.persist_my_recruiter_profile(
  text, text, text, text, text, text, text, text, text, text,
  text, text, text[], text[], text[]
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.persist_my_recruiter_profile(
  text, text, text, text, text, text, text, text, text, text,
  text, text, text[], text[], text[]
) FROM anon;

GRANT EXECUTE ON FUNCTION public.persist_my_recruiter_profile(
  text, text, text, text, text, text, text, text, text, text,
  text, text, text[], text[], text[]
) TO authenticated, service_role;

COMMENT ON FUNCTION public.persist_my_recruiter_profile(
  text, text, text, text, text, text, text, text, text, text,
  text, text, text[], text[], text[]
) IS
  'Caller-bound persistence for ordinary recruiter profile fields. Identity is derived only from auth.uid(); protected moderation, status, timestamp, and posting-consent fields are neither accepted nor written. Returns one narrow verification row without adding a recruiter SELECT policy.';

COMMIT;
