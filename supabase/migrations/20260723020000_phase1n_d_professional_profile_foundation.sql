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
-- =============================================================================

-- =============================================================================
-- 1. Internal immutable canonical-array validator.
--    Defined before the table so schema CHECK constraints can enforce the
--    logical field contract even for service-role/admin direct writes.
-- =============================================================================
CREATE OR REPLACE FUNCTION public._professional_profile_string_array_is_canonical(
  _input text[],
  _max_elems integer,
  _max_len integer
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    _input IS NOT NULL
    AND cardinality(_input) <= _max_elems
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(_input) WITH ORDINALITY AS item(value, ordinal)
      WHERE value IS NULL
         OR value = ''
         OR value <> btrim(value)
         OR char_length(value) > _max_len
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(_input) AS item(value)
      GROUP BY lower(value)
      HAVING count(*) > 1
    )
$function$;

REVOKE ALL ON FUNCTION public._professional_profile_string_array_is_canonical(
  text[], integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._professional_profile_string_array_is_canonical(
  text[], integer, integer
) TO service_role;

-- =============================================================================
-- 2. Table — strict creation. Unexpected pre-existing schema drift must fail.
-- =============================================================================
CREATE TABLE public.professional_profiles (
  user_id                 uuid PRIMARY KEY
                            REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name            text NOT NULL,
  professional_title      text,
  bio                     text,
  years_experience        smallint,
  services                text[]      NOT NULL DEFAULT '{}'::text[],
  service_areas           text[]      NOT NULL DEFAULT '{}'::text[],
  availability            text        NOT NULL DEFAULT 'available',
  contact_email           text,
  contact_phone           text,
  visibility              text        NOT NULL DEFAULT 'private',
  share_contact_details   boolean     NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT professional_profiles_display_name_canonical_chk
    CHECK (
      display_name = btrim(display_name)
      AND char_length(display_name) BETWEEN 2 AND 80
    ),
  CONSTRAINT professional_profiles_professional_title_canonical_chk
    CHECK (
      professional_title IS NULL
      OR (
        professional_title = btrim(professional_title)
        AND char_length(professional_title) BETWEEN 1 AND 120
      )
    ),
  CONSTRAINT professional_profiles_bio_canonical_chk
    CHECK (
      bio IS NULL
      OR (
        bio = btrim(bio)
        AND char_length(bio) BETWEEN 1 AND 1000
      )
    ),
  CONSTRAINT professional_profiles_years_experience_range_chk
    CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 70),
  CONSTRAINT professional_profiles_contact_email_canonical_chk
    CHECK (
      contact_email IS NULL
      OR (
        contact_email = btrim(contact_email)
        AND char_length(contact_email) BETWEEN 1 AND 320
      )
    ),
  CONSTRAINT professional_profiles_contact_phone_canonical_chk
    CHECK (
      contact_phone IS NULL
      OR (
        contact_phone = btrim(contact_phone)
        AND char_length(contact_phone) BETWEEN 1 AND 40
      )
    ),
  CONSTRAINT professional_profiles_services_canonical_chk
    CHECK (
      public._professional_profile_string_array_is_canonical(
        services, 12, 60
      )
    ),
  CONSTRAINT professional_profiles_service_areas_canonical_chk
    CHECK (
      public._professional_profile_string_array_is_canonical(
        service_areas, 12, 80
      )
    ),
  CONSTRAINT professional_profiles_availability_vocab_chk
    CHECK (availability IN ('available', 'limited', 'unavailable')),
  CONSTRAINT professional_profiles_visibility_vocab_chk
    CHECK (visibility IN ('private', 'authorized_connections')),
  CONSTRAINT professional_profiles_share_requires_authorized_chk
    CHECK (
      share_contact_details = false
      OR visibility = 'authorized_connections'
    )
);

REVOKE ALL ON TABLE public.professional_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.professional_profiles FROM anon;
REVOKE ALL ON TABLE public.professional_profiles FROM authenticated;
GRANT SELECT ON TABLE public.professional_profiles TO authenticated;
GRANT ALL ON TABLE public.professional_profiles TO service_role;

ALTER TABLE public.professional_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY professional_profiles_owner_select
  ON public.professional_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER trg_professional_profiles_updated_at
  BEFORE UPDATE ON public.professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 3. Internal normalizer for the self-service upsert RPC.
-- =============================================================================
CREATE OR REPLACE FUNCTION public._professional_profile_normalize_string_array(
  _input text[],
  _max_elems integer,
  _max_len integer,
  _label text
) RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _element text;
  _trimmed text;
  _raw_nonblank_count integer := 0;
  _result text[] := '{}'::text[];
  _seen text[] := '{}'::text[];
BEGIN
  IF _input IS NULL THEN
    RETURN '{}'::text[];
  END IF;

  FOREACH _element IN ARRAY _input LOOP
    IF _element IS NOT NULL AND btrim(_element) <> '' THEN
      _raw_nonblank_count := _raw_nonblank_count + 1;
    END IF;
  END LOOP;

  IF _raw_nonblank_count > _max_elems THEN
    RAISE EXCEPTION
      '% may contain at most % nonblank entries before deduplication.',
      _label,
      _max_elems
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
        'Each % entry must be at most % characters.',
        _label,
        _max_len
        USING ERRCODE = '22023';
    END IF;

    IF NOT (lower(_trimmed) = ANY(_seen)) THEN
      _seen := array_append(_seen, lower(_trimmed));
      _result := array_append(_result, _trimmed);
    END IF;
  END LOOP;

  RETURN _result;
END
$function$;

REVOKE ALL ON FUNCTION public._professional_profile_normalize_string_array(
  text[], integer, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._professional_profile_normalize_string_array(
  text[], integer, integer, text
) TO service_role;

-- =============================================================================
-- 4. Internal relationship authorization helper.
-- =============================================================================
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
        SELECT 1
        FROM public.professional_profiles AS pp
        WHERE pp.user_id = _target
          AND pp.visibility = 'authorized_connections'
      ) THEN false
      ELSE (
        EXISTS (
          SELECT 1
          FROM public.driver_assistants AS da
          WHERE da.driver_user_id = _viewer
            AND da.assistant_user_id = _target
            AND da.status = 'active'
        )
        OR EXISTS (
          SELECT 1
          FROM public.agency_delegation_requests AS adr
          WHERE adr.driver_user_id = _viewer
            AND adr.member_user_id = _target
            AND adr.status IN ('pending_driver_approval', 'approved')
        )
        OR EXISTS (
          SELECT 1
          FROM public.agency_profiles AS ap
          WHERE ap.status = 'active'
            AND (
              ap.owner_user_id = _viewer
              OR EXISTS (
                SELECT 1
                FROM public.agency_members AS viewer_member
                WHERE viewer_member.agency_id = ap.id
                  AND viewer_member.member_user_id = _viewer
                  AND viewer_member.status = 'active'
              )
            )
            AND (
              ap.owner_user_id = _target
              OR EXISTS (
                SELECT 1
                FROM public.agency_members AS target_member
                WHERE target_member.agency_id = ap.id
                  AND target_member.member_user_id = _target
                  AND target_member.status = 'active'
              )
            )
        )
      )
    END
$function$;

REVOKE ALL ON FUNCTION public._professional_profile_relationship_authorized(
  uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._professional_profile_relationship_authorized(
  uuid, uuid
) TO service_role;

-- =============================================================================
-- 5. Self-service RPCs.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_my_professional_profile()
RETURNS SETOF public.professional_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT pp.*
  FROM public.professional_profiles AS pp
  WHERE auth.uid() IS NOT NULL
    AND pp.user_id = auth.uid()
$function$;

REVOKE ALL ON FUNCTION public.get_my_professional_profile()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_professional_profile()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_my_professional_profile(
  p_display_name text,
  p_professional_title text DEFAULT NULL,
  p_bio text DEFAULT NULL,
  p_years_experience smallint DEFAULT NULL,
  p_services text[] DEFAULT '{}'::text[],
  p_service_areas text[] DEFAULT '{}'::text[],
  p_availability text DEFAULT 'available',
  p_contact_email text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_visibility text DEFAULT 'private',
  p_share_contact_details boolean DEFAULT false
) RETURNS public.professional_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _display_name text;
  _professional_title text;
  _bio text;
  _contact_email text;
  _contact_phone text;
  _services text[];
  _service_areas text[];
  _availability text;
  _visibility text;
  _share boolean;
  _saved public.professional_profiles;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  _display_name := NULLIF(btrim(COALESCE(p_display_name, '')), '');
  _professional_title := NULLIF(btrim(COALESCE(p_professional_title, '')), '');
  _bio := NULLIF(btrim(COALESCE(p_bio, '')), '');
  _contact_email := NULLIF(btrim(COALESCE(p_contact_email, '')), '');
  _contact_phone := NULLIF(btrim(COALESCE(p_contact_phone, '')), '');

  IF _display_name IS NULL
     OR char_length(_display_name) NOT BETWEEN 2 AND 80 THEN
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

  IF p_years_experience IS NOT NULL
     AND p_years_experience NOT BETWEEN 0 AND 70 THEN
    RAISE EXCEPTION 'years_experience must be between 0 and 70.'
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

  _availability := COALESCE(
    NULLIF(btrim(COALESCE(p_availability, '')), ''),
    'available'
  );
  IF _availability NOT IN ('available', 'limited', 'unavailable') THEN
    RAISE EXCEPTION
      'availability must be available, limited, or unavailable.'
      USING ERRCODE = '22023';
  END IF;

  _visibility := COALESCE(
    NULLIF(btrim(COALESCE(p_visibility, '')), ''),
    'private'
  );
  IF _visibility NOT IN ('private', 'authorized_connections') THEN
    RAISE EXCEPTION
      'visibility must be private or authorized_connections.'
      USING ERRCODE = '22023';
  END IF;

  _services := public._professional_profile_normalize_string_array(
    p_services, 12, 60, 'services'
  );
  _service_areas := public._professional_profile_normalize_string_array(
    p_service_areas, 12, 80, 'service_areas'
  );
  _share := (
    _visibility = 'authorized_connections'
    AND COALESCE(p_share_contact_details, false)
  );

  INSERT INTO public.professional_profiles AS profile (
    user_id,
    display_name,
    professional_title,
    bio,
    years_experience,
    services,
    service_areas,
    availability,
    contact_email,
    contact_phone,
    visibility,
    share_contact_details
  ) VALUES (
    _uid,
    _display_name,
    _professional_title,
    _bio,
    p_years_experience,
    _services,
    _service_areas,
    _availability,
    _contact_email,
    _contact_phone,
    _visibility,
    _share
  )
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    professional_title = EXCLUDED.professional_title,
    bio = EXCLUDED.bio,
    years_experience = EXCLUDED.years_experience,
    services = EXCLUDED.services,
    service_areas = EXCLUDED.service_areas,
    availability = EXCLUDED.availability,
    contact_email = EXCLUDED.contact_email,
    contact_phone = EXCLUDED.contact_phone,
    visibility = EXCLUDED.visibility,
    share_contact_details = EXCLUDED.share_contact_details
  RETURNING profile.* INTO _saved;

  RETURN _saved;
END
$function$;

REVOKE ALL ON FUNCTION public.upsert_my_professional_profile(
  text, text, text, smallint, text[], text[], text, text, text, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_my_professional_profile(
  text, text, text, smallint, text[], text[], text, text, text, text, boolean
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_my_professional_profile()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _deleted integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.professional_profiles
  WHERE user_id = _uid;

  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted > 0;
END
$function$;

REVOKE ALL ON FUNCTION public.delete_my_professional_profile()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_professional_profile()
  TO authenticated, service_role;

-- =============================================================================
-- 6. Authorized batch read RPC.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_authorized_professional_profiles(
  _user_ids uuid[]
) RETURNS TABLE (
  user_id uuid,
  display_name text,
  professional_title text,
  bio text,
  years_experience smallint,
  services text[],
  service_areas text[],
  availability text,
  visibility text,
  share_contact_details boolean,
  contact_email text,
  contact_phone text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _viewer uuid := auth.uid();
  _deduped uuid[];
BEGIN
  IF _viewer IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF _user_ids IS NULL THEN
    RAISE EXCEPTION '_user_ids must not be null.' USING ERRCODE = '22023';
  END IF;

  IF cardinality(_user_ids) > 100 THEN
    RAISE EXCEPTION '_user_ids may contain at most 100 entries.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(uid ORDER BY first_ordinal), '{}'::uuid[])
  INTO _deduped
  FROM (
    SELECT uid, min(ordinal) AS first_ordinal
    FROM unnest(_user_ids) WITH ORDINALITY AS request(uid, ordinal)
    WHERE uid IS NOT NULL
    GROUP BY uid
  ) AS normalized;

  RETURN QUERY
  SELECT
    profile.user_id,
    profile.display_name,
    profile.professional_title,
    profile.bio,
    profile.years_experience,
    profile.services,
    profile.service_areas,
    profile.availability,
    profile.visibility,
    profile.share_contact_details,
    CASE
      WHEN profile.user_id = _viewer THEN profile.contact_email
      WHEN profile.share_contact_details THEN profile.contact_email
      ELSE NULL
    END,
    CASE
      WHEN profile.user_id = _viewer THEN profile.contact_phone
      WHEN profile.share_contact_details THEN profile.contact_phone
      ELSE NULL
    END,
    profile.updated_at
  FROM unnest(_deduped) WITH ORDINALITY AS requested(user_id, ordinal)
  JOIN public.professional_profiles AS profile
    ON profile.user_id = requested.user_id
  WHERE public._professional_profile_relationship_authorized(
    _viewer,
    profile.user_id
  )
  ORDER BY requested.ordinal;
END
$function$;

REVOKE ALL ON FUNCTION public.list_authorized_professional_profiles(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_authorized_professional_profiles(uuid[])
  TO authenticated, service_role;
