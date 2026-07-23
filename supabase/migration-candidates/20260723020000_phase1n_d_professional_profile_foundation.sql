-- =============================================================================
-- Phase 1N-D — Shared Professional Profile Foundation (CANDIDATE ONLY)
--
-- This candidate is staged in the writable migration-candidates area. It is
-- NOT applied to any production or connected database by this pass. A
-- dedicated PostgreSQL 16 gate at
--   tests/postgres/phase1nProfessionalProfilesPostgres.test.ts
-- reads this file from disk and executes it against an ephemeral database.
--
-- CONTRACT
-- One reusable professional profile per auth user. Fully separate from agency
-- business profile, account/sign-in data, driver Leaderboard Identity, driver
-- Opportunity Preferences, agency membership, and assistant/delegation
-- permission records. Never grants any access, role, or capability.
--
-- All application writes route through SECURITY DEFINER RPCs. authenticated
-- has direct SELECT of the caller's own row only; no direct INSERT/UPDATE/
-- DELETE table privilege; anon has no table access.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.professional_profiles (
  user_id                 uuid PRIMARY KEY
                            REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name            text NOT NULL,
  professional_title      text,
  bio                     text,
  years_experience        smallint,
  services                text[]      NOT NULL DEFAULT '{}'::text[],
  service_areas           text[]      NOT NULL DEFAULT '{}'::text[],
  availability            text        NOT NULL,
  contact_email           text,
  contact_phone           text,
  visibility              text        NOT NULL DEFAULT 'private',
  share_contact_details   boolean     NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT professional_profiles_display_name_len_chk
    CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 80),
  CONSTRAINT professional_profiles_professional_title_len_chk
    CHECK (professional_title IS NULL
           OR char_length(btrim(professional_title)) BETWEEN 1 AND 120),
  CONSTRAINT professional_profiles_bio_len_chk
    CHECK (bio IS NULL OR char_length(btrim(bio)) BETWEEN 1 AND 1000),
  CONSTRAINT professional_profiles_years_experience_range_chk
    CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 70),
  CONSTRAINT professional_profiles_contact_email_len_chk
    CHECK (contact_email IS NULL
           OR char_length(btrim(contact_email)) BETWEEN 1 AND 320),
  CONSTRAINT professional_profiles_contact_phone_len_chk
    CHECK (contact_phone IS NULL
           OR char_length(btrim(contact_phone)) BETWEEN 1 AND 40),
  CONSTRAINT professional_profiles_availability_vocab_chk
    CHECK (availability IN ('available','limited','unavailable')),
  CONSTRAINT professional_profiles_visibility_vocab_chk
    CHECK (visibility IN ('private','authorized_connections')),
  CONSTRAINT professional_profiles_services_cardinality_chk
    CHECK (cardinality(services) <= 12),
  CONSTRAINT professional_profiles_service_areas_cardinality_chk
    CHECK (cardinality(service_areas) <= 12),
  CONSTRAINT professional_profiles_share_requires_authorized_chk
    CHECK (share_contact_details = false
           OR visibility = 'authorized_connections')
);

-- -----------------------------------------------------------------------------
-- 2. Privileges — table
--    authenticated: SELECT only. All writes flow through SECURITY DEFINER RPCs.
--    anon:         no access.
--    service_role: full admin.
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.professional_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.professional_profiles FROM anon;
REVOKE ALL ON TABLE public.professional_profiles FROM authenticated;
GRANT SELECT ON TABLE public.professional_profiles TO authenticated;
GRANT ALL ON TABLE public.professional_profiles TO service_role;

-- -----------------------------------------------------------------------------
-- 3. RLS — authenticated can SELECT own row only.
-- -----------------------------------------------------------------------------
ALTER TABLE public.professional_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS professional_profiles_owner_select
  ON public.professional_profiles;
CREATE POLICY professional_profiles_owner_select
  ON public.professional_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 4. updated_at trigger — reuse existing helper; do not redefine it.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_professional_profiles_updated_at
  ON public.professional_profiles;
CREATE TRIGGER trg_professional_profiles_updated_at
  BEFORE UPDATE ON public.professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 5. Internal helpers (definer-only; not executable by anon/authenticated).
-- =============================================================================

-- Normalize a text[]:
--   * NULL input -> empty array.
--   * Trim each element.
--   * If raw nonblank count exceeds _max_elems -> raise (cannot bypass with
--     duplicates).
--   * Reject any nonblank trimmed element whose length > _max_len.
--   * Drop blanks.
--   * Case-insensitive dedupe preserving first-occurrence display value/order.
CREATE OR REPLACE FUNCTION public._professional_profile_normalize_string_array(
  _input     text[],
  _max_elems int,
  _max_len   int,
  _label     text
) RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _raw_nonblank_count int := 0;
  _element text;
  _trimmed text;
  _seen_keys text[] := '{}';
  _result   text[] := '{}';
BEGIN
  IF _input IS NULL THEN
    RETURN '{}'::text[];
  END IF;

  -- Count raw nonblank entries BEFORE dedupe so callers cannot bypass the
  -- input cap by submitting duplicates.
  FOREACH _element IN ARRAY _input LOOP
    IF _element IS NOT NULL AND btrim(_element) <> '' THEN
      _raw_nonblank_count := _raw_nonblank_count + 1;
    END IF;
  END LOOP;

  IF _raw_nonblank_count > _max_elems THEN
    RAISE EXCEPTION
      '% may contain at most % entries (received % nonblank entries).',
      _label, _max_elems, _raw_nonblank_count
      USING ERRCODE = '22023';
  END IF;

  FOREACH _element IN ARRAY _input LOOP
    IF _element IS NULL THEN
      CONTINUE;
    END IF;
    _trimmed := btrim(_element);
    IF _trimmed = '' THEN
      CONTINUE;
    END IF;
    IF char_length(_trimmed) > _max_len THEN
      RAISE EXCEPTION
        'Each % entry must be at most % characters (got %).',
        _label, _max_len, char_length(_trimmed)
        USING ERRCODE = '22023';
    END IF;
    IF NOT (_seen_keys @> ARRAY[lower(_trimmed)]) THEN
      _seen_keys := _seen_keys || lower(_trimmed);
      _result    := _result    || _trimmed;
    END IF;
  END LOOP;

  RETURN _result;
END
$function$;

REVOKE ALL ON FUNCTION public._professional_profile_normalize_string_array(
  text[], int, int, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._professional_profile_normalize_string_array(
  text[], int, int, text
) TO service_role;

-- Relationship authorization helper. Returns true when _viewer is authorized
-- to see _target's professional profile. Self is always allowed. Non-self
-- REQUIRES _target visibility = 'authorized_connections' AND one of:
--   a) _viewer is a driver, _target is an ACTIVE direct assistant of _viewer;
--   b) _viewer is a driver, _target is member_user_id on one of _viewer's
--      delegation requests with status pending_driver_approval OR approved;
--   c) _viewer and _target are BOTH connected to the same ACTIVE agency,
--      each as owner OR ACTIVE member.
CREATE OR REPLACE FUNCTION public._professional_profile_relationship_authorized(
  _viewer uuid,
  _target uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    CASE
      WHEN _viewer IS NULL OR _target IS NULL THEN false
      WHEN _viewer = _target THEN true
      WHEN NOT EXISTS (
        SELECT 1 FROM public.professional_profiles pp
         WHERE pp.user_id = _target
           AND pp.visibility = 'authorized_connections'
      ) THEN false
      ELSE (
        -- (a) Active direct assistant of viewer-as-driver.
        EXISTS (
          SELECT 1
            FROM public.driver_assistants da
           WHERE da.driver_user_id    = _viewer
             AND da.assistant_user_id = _target
             AND da.status            = 'active'
        )
        -- (b) Delegation request on viewer-as-driver's row, in an approvable
        --     state (pending driver approval OR approved).
        OR EXISTS (
          SELECT 1
            FROM public.agency_delegation_requests adr
           WHERE adr.driver_user_id  = _viewer
             AND adr.member_user_id  = _target
             AND adr.status IN ('pending_driver_approval','approved')
        )
        -- (c) Both connected to same ACTIVE agency; each as owner or ACTIVE
        --     member.
        OR EXISTS (
          SELECT 1
            FROM public.agency_profiles ap
           WHERE ap.status = 'active'
             AND (
                   ap.owner_user_id = _viewer
                   OR EXISTS (
                     SELECT 1
                       FROM public.agency_members am
                      WHERE am.agency_id      = ap.id
                        AND am.member_user_id = _viewer
                        AND am.status         = 'active'
                   )
                 )
             AND (
                   ap.owner_user_id = _target
                   OR EXISTS (
                     SELECT 1
                       FROM public.agency_members am2
                      WHERE am2.agency_id      = ap.id
                        AND am2.member_user_id = _target
                        AND am2.status         = 'active'
                   )
                 )
        )
      )
    END
$function$;

REVOKE ALL ON FUNCTION public._professional_profile_relationship_authorized(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._professional_profile_relationship_authorized(uuid, uuid)
  TO service_role;

-- =============================================================================
-- 6. Self-service RPCs
-- =============================================================================

-- get_my_professional_profile — own row only.
CREATE OR REPLACE FUNCTION public.get_my_professional_profile()
RETURNS SETOF public.professional_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT *
    FROM public.professional_profiles
   WHERE user_id = auth.uid()
     AND auth.uid() IS NOT NULL
$function$;

REVOKE ALL ON FUNCTION public.get_my_professional_profile()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_professional_profile()
  TO authenticated, service_role;

-- upsert_my_professional_profile — caller-only. No target user_id parameter.
CREATE OR REPLACE FUNCTION public.upsert_my_professional_profile(
  p_display_name          text,
  p_professional_title    text        DEFAULT NULL,
  p_bio                   text        DEFAULT NULL,
  p_years_experience      smallint    DEFAULT NULL,
  p_services              text[]      DEFAULT '{}'::text[],
  p_service_areas         text[]      DEFAULT '{}'::text[],
  p_availability          text        DEFAULT 'available',
  p_contact_email         text        DEFAULT NULL,
  p_contact_phone         text        DEFAULT NULL,
  p_visibility            text        DEFAULT 'private',
  p_share_contact_details boolean     DEFAULT false
) RETURNS public.professional_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _display_name       text;
  _professional_title text;
  _bio                text;
  _contact_email      text;
  _contact_phone      text;
  _services           text[];
  _service_areas      text[];
  _availability       text;
  _visibility         text;
  _share              boolean;
  _row                public.professional_profiles;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- Trim and null-coalesce string fields.
  _display_name       := NULLIF(btrim(COALESCE(p_display_name, '')), '');
  _professional_title := NULLIF(btrim(COALESCE(p_professional_title, '')), '');
  _bio                := NULLIF(btrim(COALESCE(p_bio, '')), '');
  _contact_email      := NULLIF(btrim(COALESCE(p_contact_email, '')), '');
  _contact_phone      := NULLIF(btrim(COALESCE(p_contact_phone, '')), '');

  -- Required fields.
  IF _display_name IS NULL THEN
    RAISE EXCEPTION 'display_name is required.'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(_display_name) < 2 OR char_length(_display_name) > 80 THEN
    RAISE EXCEPTION 'display_name must be 2–80 characters.'
      USING ERRCODE = '22023';
  END IF;
  IF _professional_title IS NOT NULL
     AND char_length(_professional_title) > 120 THEN
    RAISE EXCEPTION 'professional_title must be at most 120 characters.'
      USING ERRCODE = '22023';
  END IF;
  IF _bio IS NOT NULL AND char_length(_bio) > 1000 THEN
    RAISE EXCEPTION 'bio must be at most 1000 characters.'
      USING ERRCODE = '22023';
  END IF;
  IF _contact_email IS NOT NULL AND char_length(_contact_email) > 320 THEN
    RAISE EXCEPTION 'contact_email must be at most 320 characters.'
      USING ERRCODE = '22023';
  END IF;
  IF _contact_phone IS NOT NULL AND char_length(_contact_phone) > 40 THEN
    RAISE EXCEPTION 'contact_phone must be at most 40 characters.'
      USING ERRCODE = '22023';
  END IF;
  IF p_years_experience IS NOT NULL
     AND (p_years_experience < 0 OR p_years_experience > 70) THEN
    RAISE EXCEPTION 'years_experience must be between 0 and 70.'
      USING ERRCODE = '22023';
  END IF;

  -- Availability vocabulary.
  _availability := COALESCE(NULLIF(btrim(COALESCE(p_availability, '')), ''), 'available');
  IF _availability NOT IN ('available','limited','unavailable') THEN
    RAISE EXCEPTION 'availability must be one of available|limited|unavailable.'
      USING ERRCODE = '22023';
  END IF;

  -- Visibility vocabulary.
  _visibility := COALESCE(NULLIF(btrim(COALESCE(p_visibility, '')), ''), 'private');
  IF _visibility NOT IN ('private','authorized_connections') THEN
    RAISE EXCEPTION 'visibility must be one of private|authorized_connections.'
      USING ERRCODE = '22023';
  END IF;

  -- Fail-closed share normalization: sharing is only meaningful when
  -- visibility is authorized_connections; any other visibility forces false.
  _share := COALESCE(p_share_contact_details, false)
              AND _visibility = 'authorized_connections';

  -- Normalize arrays (rejects raw >12 nonblank entries; trims; drops blanks;
  -- case-insensitive dedupe; per-element length enforcement).
  _services      := public._professional_profile_normalize_string_array(
                      p_services, 12, 60, 'services'
                    );
  _service_areas := public._professional_profile_normalize_string_array(
                      p_service_areas, 12, 80, 'service_areas'
                    );

  INSERT INTO public.professional_profiles AS pp (
    user_id, display_name, professional_title, bio, years_experience,
    services, service_areas, availability, contact_email, contact_phone,
    visibility, share_contact_details
  ) VALUES (
    _uid, _display_name, _professional_title, _bio, p_years_experience,
    _services, _service_areas, _availability, _contact_email, _contact_phone,
    _visibility, _share
  )
  ON CONFLICT (user_id) DO UPDATE
     SET display_name          = EXCLUDED.display_name,
         professional_title    = EXCLUDED.professional_title,
         bio                   = EXCLUDED.bio,
         years_experience      = EXCLUDED.years_experience,
         services              = EXCLUDED.services,
         service_areas         = EXCLUDED.service_areas,
         availability          = EXCLUDED.availability,
         contact_email         = EXCLUDED.contact_email,
         contact_phone         = EXCLUDED.contact_phone,
         visibility            = EXCLUDED.visibility,
         share_contact_details = EXCLUDED.share_contact_details
  RETURNING * INTO _row;

  RETURN _row;
END
$function$;

REVOKE ALL ON FUNCTION public.upsert_my_professional_profile(
  text, text, text, smallint, text[], text[], text, text, text, text, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_my_professional_profile(
  text, text, text, smallint, text[], text[], text, text, text, text, boolean
) TO authenticated, service_role;

-- delete_my_professional_profile — caller-only; returns whether a row existed.
CREATE OR REPLACE FUNCTION public.delete_my_professional_profile()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _deleted int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.professional_profiles WHERE user_id = _uid;
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted > 0;
END
$function$;

REVOKE ALL ON FUNCTION public.delete_my_professional_profile()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_professional_profile()
  TO authenticated, service_role;

-- =============================================================================
-- 7. Batch authorized-fetch RPC.
--    Absence never distinguishes missing / private / unauthorized.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_authorized_professional_profiles(
  _user_ids uuid[]
) RETURNS TABLE (
  user_id               uuid,
  display_name          text,
  professional_title    text,
  bio                   text,
  years_experience      smallint,
  services              text[],
  service_areas         text[],
  availability          text,
  visibility            text,
  share_contact_details boolean,
  contact_email         text,
  contact_phone         text,
  updated_at            timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _viewer uuid := auth.uid();
  _raw_count int;
  _deduped uuid[];
BEGIN
  IF _viewer IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF _user_ids IS NULL THEN
    RAISE EXCEPTION '_user_ids must not be null.' USING ERRCODE = '22023';
  END IF;

  _raw_count := cardinality(_user_ids);
  IF _raw_count > 100 THEN
    RAISE EXCEPTION 'Too many user ids requested (received %). Max 100.',
      _raw_count USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT uid), '{}')
    INTO _deduped
    FROM unnest(_user_ids) AS t(uid)
   WHERE uid IS NOT NULL;

  RETURN QUERY
    SELECT
      pp.user_id,
      pp.display_name,
      pp.professional_title,
      pp.bio,
      pp.years_experience,
      pp.services,
      pp.service_areas,
      pp.availability,
      pp.visibility,
      pp.share_contact_details,
      CASE
        WHEN pp.user_id = _viewer THEN pp.contact_email
        WHEN pp.share_contact_details THEN pp.contact_email
        ELSE NULL
      END AS contact_email,
      CASE
        WHEN pp.user_id = _viewer THEN pp.contact_phone
        WHEN pp.share_contact_details THEN pp.contact_phone
        ELSE NULL
      END AS contact_phone,
      pp.updated_at
    FROM public.professional_profiles pp
   WHERE pp.user_id = ANY(_deduped)
     AND public._professional_profile_relationship_authorized(_viewer, pp.user_id);
END
$function$;

REVOKE ALL ON FUNCTION public.list_authorized_professional_profiles(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_authorized_professional_profiles(uuid[])
  TO authenticated, service_role;
