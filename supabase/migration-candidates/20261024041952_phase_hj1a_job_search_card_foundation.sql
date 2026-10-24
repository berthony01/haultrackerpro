-- HJ-1A CANDIDATE ONLY. Not applied to Cloud; no recruiter discovery grants.
-- Serialize every mutation (including first publication) by transaction-scoped
-- advisory lock on hashtextextended(auth.uid()::text, 0). Hash collisions only
-- over-serialize unrelated owners; owner predicates still enforce isolation.
CREATE SCHEMA job_search_private;
REVOKE ALL ON SCHEMA job_search_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA job_search_private TO authenticated;

CREATE TABLE job_search_private.driver_job_search_cards (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('published','paused','withdrawn')),
  audience text NOT NULL DEFAULT 'approved_recruiters' CHECK (audience = 'approved_recruiters'),
  consent_version text NOT NULL CHECK (consent_version = 'job_search_card_v1'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON job_search_private.driver_job_search_cards FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE job_search_private.driver_job_search_cards ENABLE ROW LEVEL SECURITY;
CREATE TABLE job_search_private.job_search_card_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  card_id uuid REFERENCES job_search_private.driver_job_search_cards(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('publish','pause','withdraw')),
  revision integer NOT NULL CHECK (revision >= 0),
  client_command_id uuid NOT NULL,
  input_fingerprint text NOT NULL CHECK (length(input_fingerprint) = 32),
  consent_version text CHECK (consent_version = 'job_search_card_v1'),
  created_at timestamptz NOT NULL,
  UNIQUE (owner_user_id, client_command_id)
);
REVOKE ALL ON job_search_private.job_search_card_events FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE job_search_private.job_search_card_events ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION job_search_private.manage_my_job_search_card(
  _action text, _payload jsonb DEFAULT NULL, _expected_revision integer DEFAULT NULL,
  _client_command_id uuid DEFAULT NULL, _consent_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth, job_search_private
AS $command$
DECLARE
  _uid uuid := auth.uid();
  _card job_search_private.driver_job_search_cards%ROWTYPE;
  _receipt job_search_private.job_search_card_events%ROWTYPE;
  _fingerprint text;
  _now timestamptz;
  _date date;
  _normalized jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF _action IS NULL OR _action NOT IN ('get','publish','pause','withdraw') THEN
    RAISE EXCEPTION 'Invalid command' USING ERRCODE = '22023';
  END IF;
  IF _action = 'get' THEN
    IF _payload IS NOT NULL OR _expected_revision IS NOT NULL OR _client_command_id IS NOT NULL OR _consent_version IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid get arguments' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF _client_command_id IS NULL OR _expected_revision IS NULL OR _expected_revision < 0 THEN
      RAISE EXCEPTION 'Revision and command required' USING ERRCODE = '22023';
    END IF;
    IF _action <> 'publish' AND (_payload IS NOT NULL OR _consent_version IS NOT NULL) THEN
      RAISE EXCEPTION 'Unexpected command fields' USING ERRCODE = '22023';
    END IF;
    IF _action = 'publish' THEN
      IF NOT EXISTS (SELECT 1 FROM public.user_capabilities c WHERE c.user_id = _uid AND c.capability = 'driver' AND c.status = 'active')
        OR public.user_has_blocking_messaging_restriction(_uid) THEN
        RAISE EXCEPTION 'Driver publication unavailable' USING ERRCODE = '42501';
      END IF;
      IF _consent_version IS DISTINCT FROM 'job_search_card_v1' OR _payload IS NULL OR pg_catalog.jsonb_typeof(_payload) <> 'object' THEN
        RAISE EXCEPTION 'Reviewed consent and payload required' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(_payload) k WHERE k NOT IN
        ('state','cdl_class','years_experience','experience_qualifier','preferred_route_type','preferred_home_time','trailer_experience','preferred_driver_type','available_start_date','min_weekly_gross'))
        OR NOT (_payload ?& ARRAY['state','cdl_class','years_experience','experience_qualifier','preferred_route_type','preferred_home_time']) THEN
        RAISE EXCEPTION 'Invalid payload fields' USING ERRCODE = '22023';
      END IF;
      IF pg_catalog.jsonb_typeof(_payload->'state') IS DISTINCT FROM 'string' OR (_payload->>'state') NOT IN
        ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC')
        OR pg_catalog.jsonb_typeof(_payload->'cdl_class') IS DISTINCT FROM 'string' OR (_payload->>'cdl_class') NOT IN ('A','B','C')
        OR pg_catalog.jsonb_typeof(_payload->'preferred_route_type') IS DISTINCT FROM 'string' OR (_payload->>'preferred_route_type') NOT IN ('Local','Regional','OTR','Dedicated')
        OR pg_catalog.jsonb_typeof(_payload->'preferred_home_time') IS DISTINCT FROM 'string' OR (_payload->>'preferred_home_time') NOT IN ('Daily','Weekly','Bi-weekly','2-3 weeks out')
        OR pg_catalog.jsonb_typeof(_payload->'experience_qualifier') IS DISTINCT FROM 'string' OR (_payload->>'experience_qualifier') NOT IN ('exact','at_least','less_than') THEN
        RAISE EXCEPTION 'Invalid choices' USING ERRCODE = '22023';
      END IF;
      IF pg_catalog.jsonb_typeof(_payload->'years_experience') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid experience' USING ERRCODE='22023'; END IF;
      IF (_payload->>'years_experience')::numeric NOT BETWEEN 0 AND 60 OR pg_catalog.trunc((_payload->>'years_experience')::numeric) <> (_payload->>'years_experience')::numeric
        OR (_payload->>'experience_qualifier' = 'less_than' AND (_payload->>'years_experience')::numeric = 0) THEN
        RAISE EXCEPTION 'Invalid experience' USING ERRCODE='22023';
      END IF;
      IF _payload ? 'preferred_driver_type' AND (pg_catalog.jsonb_typeof(_payload->'preferred_driver_type') IS DISTINCT FROM 'string' OR (_payload->>'preferred_driver_type') NOT IN ('Owner Operator','Team')) THEN
        RAISE EXCEPTION 'Invalid driver type' USING ERRCODE='22023';
      END IF;
      IF _payload ? 'available_start_date' THEN
        IF pg_catalog.jsonb_typeof(_payload->'available_start_date') IS DISTINCT FROM 'string' OR (_payload->>'available_start_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          RAISE EXCEPTION 'Invalid date' USING ERRCODE='22023';
        END IF;
        BEGIN _date := (_payload->>'available_start_date')::date;
        EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='22023'; END;
        IF pg_catalog.to_char(_date,'YYYY-MM-DD') <> _payload->>'available_start_date' THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='22023'; END IF;
      END IF;
      IF _payload ? 'min_weekly_gross' THEN
        IF pg_catalog.jsonb_typeof(_payload->'min_weekly_gross') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid gross' USING ERRCODE='22023'; END IF;
        IF (_payload->>'min_weekly_gross')::numeric <= 0 OR (_payload->>'min_weekly_gross')::numeric > 100000 THEN RAISE EXCEPTION 'Invalid gross' USING ERRCODE='22023'; END IF;
      END IF;
      _normalized := _payload;
      IF _payload ? 'trailer_experience' THEN
        IF pg_catalog.jsonb_typeof(_payload->'trailer_experience') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid trailers' USING ERRCODE='22023'; END IF;
        IF pg_catalog.jsonb_array_length(_payload->'trailer_experience') > 8 OR EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_array_elements(_payload->'trailer_experience') t
          WHERE pg_catalog.jsonb_typeof(t) <> 'string' OR t #>> '{}' NOT IN ('Dry Van','Reefer','Flatbed','Step Deck','Tanker','Power Only','Car Hauler','Hopper'))
          OR (SELECT count(*) <> count(DISTINCT t) FROM pg_catalog.jsonb_array_elements(_payload->'trailer_experience') t) THEN
          RAISE EXCEPTION 'Invalid trailers' USING ERRCODE='22023';
        END IF;
        _normalized := pg_catalog.jsonb_set(_payload,'{trailer_experience}',
          (SELECT coalesce(pg_catalog.jsonb_agg(t ORDER BY t #>> '{}' COLLATE "C"),'[]'::jsonb) FROM pg_catalog.jsonb_array_elements(_payload->'trailer_experience') t));
      END IF;
    END IF;
    _fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_array(_action,_normalized,_expected_revision,_consent_version)::text);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_uid::text,0));
    SELECT * INTO _receipt FROM job_search_private.job_search_card_events e WHERE e.owner_user_id = _uid AND e.client_command_id = _client_command_id;
    IF FOUND AND _receipt.input_fingerprint <> _fingerprint THEN RAISE EXCEPTION 'Command input changed' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT * INTO _card FROM job_search_private.driver_job_search_cards c WHERE c.owner_user_id = _uid;
  -- Re-resolve publication authority AFTER any owner-lock wait, before either
  -- applying a publication or returning its replay. At READ COMMITTED this
  -- sees moderation/capability changes committed before this fresh statement.
  -- Other writers do not share this lock: this is not globally serialized
  -- moderation, nor a guarantee against changes committed after this check.
  IF _action = 'publish' THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_capabilities c WHERE c.user_id = _uid AND c.capability = 'driver' AND c.status = 'active')
      OR public.user_has_blocking_messaging_restriction(_uid) THEN
      RAISE EXCEPTION 'Driver publication unavailable' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _action <> 'get' AND _receipt.id IS NULL THEN
    IF coalesce(_card.revision,0) <> _expected_revision THEN RAISE EXCEPTION 'Stale revision' USING ERRCODE='PT409'; END IF;
    _now := pg_catalog.clock_timestamp();
    IF _action = 'publish' THEN
      INSERT INTO job_search_private.driver_job_search_cards AS c (owner_user_id,payload,revision,status,created_at,updated_at,published_at,expires_at,consent_version)
      VALUES (_uid,_normalized,1,'published',_now,_now,_now,_now + interval '14 days','job_search_card_v1')
      ON CONFLICT (owner_user_id) DO UPDATE SET payload=EXCLUDED.payload, revision=c.revision+1,status='published',updated_at=_now,published_at=_now,expires_at=_now+interval '14 days',consent_version='job_search_card_v1'
      RETURNING * INTO _card;
    ELSIF _card.id IS NOT NULL THEN
      UPDATE job_search_private.driver_job_search_cards c SET status=CASE WHEN _action='pause' THEN 'paused' ELSE 'withdrawn' END,revision=c.revision+1,updated_at=_now
      WHERE c.owner_user_id=_uid RETURNING * INTO _card;
    ELSE RAISE EXCEPTION 'No card' USING ERRCODE='22023';
    END IF;
    INSERT INTO job_search_private.job_search_card_events(card_id,owner_user_id,action,revision,client_command_id,input_fingerprint,consent_version,created_at)
    VALUES (_card.id,_uid,_action,coalesce(_card.revision,0),_client_command_id,_fingerprint,_consent_version,_now);
  END IF;
  IF _card.id IS NULL THEN RETURN NULL; END IF;
  -- Replays return the CURRENT card, never historical distribution state.
  RETURN pg_catalog.jsonb_build_object('id',_card.id,'payload',_card.payload,'revision',_card.revision,
    'status',CASE WHEN _card.status='published' AND _card.expires_at <= pg_catalog.clock_timestamp() THEN 'expired' ELSE _card.status END,
    'audience',_card.audience,'consent_version',_card.consent_version,'created_at',_card.created_at,'updated_at',_card.updated_at,'published_at',_card.published_at,'expires_at',_card.expires_at);
END;
$command$;
REVOKE ALL ON FUNCTION job_search_private.manage_my_job_search_card(text,jsonb,integer,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION job_search_private.manage_my_job_search_card(text,jsonb,integer,uuid,text) TO authenticated;

CREATE FUNCTION public.manage_my_job_search_card(
  _action text, _payload jsonb DEFAULT NULL, _expected_revision integer DEFAULT NULL,
  _client_command_id uuid DEFAULT NULL, _consent_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, auth, job_search_private
AS $wrapper$
  SELECT job_search_private.manage_my_job_search_card(_action,_payload,_expected_revision,_client_command_id,_consent_version);
$wrapper$;
REVOKE ALL ON FUNCTION public.manage_my_job_search_card(text,jsonb,integer,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manage_my_job_search_card(text,jsonb,integer,uuid,text) TO authenticated;
