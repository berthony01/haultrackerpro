-- HJ-2 CANDIDATE ONLY. NOT APPLIED TO CLOUD. Do not move into supabase/migrations
-- without separate owner authorization and post-apply verification.
--
-- Recruiter-initiated opportunity invitations to opted-in anonymous job-search
-- cards. Depends on (applied, in order): CF-1A conversation foundation,
-- HJ-1A 20261024041952 card foundation, HJ-1B 20261024045239 discovery.
--
-- Contract:
--   * The recruiter only ever sees/sends an opaque card id. The server maps it
--     to the owner internally; driver identity/contact never leaves the server.
--   * Send requires: discovery_enabled AND invitations_enabled (both default
--     OFF, missing row = OFF), authenticated active approved recruiter OWNER
--     (staff denied), unrestricted actor, a REAL active approved opportunity
--     owned by that same workspace, a published unexpired v1 card whose owner is
--     an active unrestricted driver who has not blocked the workspace.
--   * Send AND accept also require the driver's separate contact consent:
--     driver_opportunity_profiles.visibility = 'verified_recruiters' AND
--     allow_verified_recruiter_contact IS TRUE. Decline/block never require it.
--   * Exactly one invitation per recruiter+driver+opportunity ever (no re-send
--     after decline/accept/expiry), command-id idempotency, per-workspace rate
--     limits, all serialized by a per-workspace advisory lock.
--   * An invitation never opens a conversation. Only the driver's explicit
--     ACCEPT (re-validated live) links or creates a CF-1A thread. Existing
--     start_opportunity_conversation / accept_conversation_thread are untouched.
--   * No client grants on any table. Only the four RPCs below are executable.

ALTER TABLE job_search_private.job_search_feature_control
  ADD COLUMN invitations_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE job_search_private.recruiter_opportunity_invitations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES job_search_private.driver_job_search_cards(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(message)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  thread_id uuid NULL REFERENCES public.conversation_threads(id) ON DELETE SET NULL,
  client_command_id uuid NOT NULL,
  input_fingerprint text NOT NULL CHECK (pg_catalog.length(input_fingerprint) = 32),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz NULL,
  CHECK (expires_at > created_at),
  CHECK (status <> 'accepted' OR responded_at IS NOT NULL),
  UNIQUE (sender_user_id, client_command_id),
  UNIQUE (driver_user_id, recruiter_id, opportunity_id)
);
REVOKE ALL ON job_search_private.recruiter_opportunity_invitations FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE job_search_private.recruiter_opportunity_invitations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_hj2_invitations_driver ON job_search_private.recruiter_opportunity_invitations (driver_user_id, created_at DESC);
CREATE INDEX idx_hj2_invitations_recruiter ON job_search_private.recruiter_opportunity_invitations (recruiter_id, created_at DESC);

CREATE TABLE job_search_private.recruiter_invitation_blocks (
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (driver_user_id, recruiter_id)
);
REVOKE ALL ON job_search_private.recruiter_invitation_blocks FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE job_search_private.recruiter_invitation_blocks ENABLE ROW LEVEL SECURITY;

-- Availability probe for the UI. Reveals only the two global flags.
CREATE FUNCTION public.job_search_invitations_available()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth, job_search_private
AS $probe$
  SELECT auth.uid() IS NOT NULL AND coalesce((SELECT f.discovery_enabled AND f.invitations_enabled
    FROM job_search_private.job_search_feature_control f WHERE f.singleton), false);
$probe$;

CREATE FUNCTION public.send_job_search_invitation(
  _recruiter_id uuid, _card_id uuid, _opportunity_id uuid, _message text, _client_command_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, auth, job_search_private
AS $send$
DECLARE
  _uid uuid := auth.uid();
  _body text := pg_catalog.btrim(coalesce(_message, ''));
  _fp text;
  _driver uuid;
  _existing job_search_private.recruiter_opportunity_invitations%ROWTYPE;
  _id uuid;
  _now timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF _recruiter_id IS NULL OR _card_id IS NULL OR _opportunity_id IS NULL OR _client_command_id IS NULL
    OR pg_catalog.char_length(_body) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '22023';
  END IF;
  IF (SELECT f.discovery_enabled AND f.invitations_enabled FROM job_search_private.job_search_feature_control f WHERE f.singleton) IS NOT TRUE THEN
    RAISE EXCEPTION 'Invitations unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_capabilities c WHERE c.user_id = _uid AND c.capability = 'recruiter' AND c.status = 'active')
    OR NOT public.is_recruiter_workspace_owner(_recruiter_id)
    OR NOT EXISTS (SELECT 1 FROM public.recruiter_profiles rp WHERE rp.id = _recruiter_id AND rp.user_id = _uid
      AND rp.status = 'active' AND rp.verification_status = 'approved' AND public.recruiter_profile_can_manage_opportunities(rp.id))
    OR public.user_has_blocking_messaging_restriction(_uid)
    OR public.is_qa_fixture_root('user', _uid)
    OR public.is_qa_fixture_root('recruiter_profile', _recruiter_id) THEN
    RAISE EXCEPTION 'Invitations unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = _opportunity_id AND o.recruiter_id = _recruiter_id
      AND o.status = 'active' AND o.admin_review_status = 'approved') THEN
    RAISE EXCEPTION 'Opportunity not eligible' USING ERRCODE = '42501';
  END IF;
  _fp := pg_catalog.md5(pg_catalog.jsonb_build_array(_recruiter_id, _card_id, _opportunity_id, _body)::text);
  -- One lock per workspace serializes rate limits, duplicates and replays.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hj2:' || _recruiter_id::text, 0));
  SELECT * INTO _existing FROM job_search_private.recruiter_opportunity_invitations i
    WHERE i.sender_user_id = _uid AND i.client_command_id = _client_command_id;
  IF FOUND THEN
    IF _existing.input_fingerprint <> _fp THEN RAISE EXCEPTION 'Command reuse conflict' USING ERRCODE = '22023'; END IF;
    RETURN pg_catalog.jsonb_build_object('invitation_id', _existing.id, 'result', 'replayed');
  END IF;
  SELECT c.owner_user_id INTO _driver FROM job_search_private.driver_job_search_cards c
    WHERE c.id = _card_id AND c.owner_user_id <> _uid AND c.status = 'published'
      AND c.expires_at > _now AND c.audience = 'approved_recruiters' AND c.consent_version = 'job_search_card_v1'
      AND EXISTS (SELECT 1 FROM public.user_capabilities cap WHERE cap.user_id = c.owner_user_id AND cap.capability = 'driver' AND cap.status = 'active')
      AND NOT public.user_has_blocking_messaging_restriction(c.owner_user_id)
      AND NOT public.is_qa_fixture_root('user', c.owner_user_id)
      AND NOT EXISTS (SELECT 1 FROM job_search_private.recruiter_invitation_blocks b WHERE b.driver_user_id = c.owner_user_id AND b.recruiter_id = _recruiter_id)
      AND EXISTS (SELECT 1 FROM public.driver_opportunity_profiles dp WHERE dp.user_id = c.owner_user_id
        AND dp.visibility = 'verified_recruiters' AND dp.allow_verified_recruiter_contact IS TRUE)
    FOR SHARE OF c;
  IF _driver IS NULL THEN RAISE EXCEPTION 'Card unavailable' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM job_search_private.recruiter_opportunity_invitations i
      WHERE i.driver_user_id = _driver AND i.recruiter_id = _recruiter_id AND i.opportunity_id = _opportunity_id) THEN
    RETURN pg_catalog.jsonb_build_object('invitation_id', NULL, 'result', 'already_invited');
  END IF;
  IF (SELECT count(*) FROM job_search_private.recruiter_opportunity_invitations i
      WHERE i.recruiter_id = _recruiter_id AND i.created_at > _now - interval '24 hours') >= 25
    OR (SELECT count(*) FROM job_search_private.recruiter_opportunity_invitations i
      WHERE i.recruiter_id = _recruiter_id AND i.driver_user_id = _driver AND i.status = 'pending' AND i.expires_at > _now) >= 2 THEN
    RAISE EXCEPTION 'Invitation limit reached' USING ERRCODE = '54000';
  END IF;
  INSERT INTO job_search_private.recruiter_opportunity_invitations
    (card_id, driver_user_id, recruiter_id, opportunity_id, sender_user_id, message, client_command_id, input_fingerprint, created_at, expires_at)
  VALUES (_card_id, _driver, _recruiter_id, _opportunity_id, _uid, _body, _client_command_id, _fp, _now, _now + interval '14 days')
  RETURNING id INTO _id;
  RETURN pg_catalog.jsonb_build_object('invitation_id', _id, 'result', 'sent');
END;
$send$;

CREATE FUNCTION public.list_my_job_search_invitations()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth, job_search_private
AS $list$
DECLARE _uid uuid := auth.uid(); _rows jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', i.id,
    'status', CASE WHEN i.status = 'pending' AND i.expires_at <= pg_catalog.statement_timestamp() THEN 'expired' ELSE i.status END,
    'message', i.message, 'created_at', i.created_at, 'expires_at', i.expires_at, 'thread_id', i.thread_id,
    'recruiter_id', rp.id, 'company_name', rp.company_name, 'recruiter_name', rp.recruiter_name,
    'verified', (rp.status = 'active' AND rp.verification_status = 'approved'),
    'opportunity_id', o.id, 'opportunity_title', o.title, 'opportunity_company', o.company_name,
    'hiring_city', o.hiring_city, 'hiring_state', o.hiring_state, 'route_type', o.route_type,
    'opportunity_open', (o.status = 'active' AND o.admin_review_status = 'approved')
  ) ORDER BY i.created_at DESC, i.id DESC), '[]'::jsonb) INTO _rows
  FROM (SELECT * FROM job_search_private.recruiter_opportunity_invitations x
        WHERE x.driver_user_id = _uid ORDER BY x.created_at DESC, x.id DESC LIMIT 50) i
  JOIN public.recruiter_profiles rp ON rp.id = i.recruiter_id
  JOIN public.opportunities o ON o.id = i.opportunity_id;
  RETURN _rows;
END;
$list$;

CREATE FUNCTION public.respond_job_search_invitation(_invitation_id uuid, _response text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, auth, job_search_private
AS $respond$
DECLARE
  _uid uuid := auth.uid();
  _inv job_search_private.recruiter_opportunity_invitations%ROWTYPE;
  _thread uuid;
  _created boolean := false;
  _now timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF _invitation_id IS NULL OR _response IS NULL OR _response NOT IN ('accept','decline','block') THEN
    RAISE EXCEPTION 'Invalid response' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _inv FROM job_search_private.recruiter_opportunity_invitations i
    WHERE i.id = _invitation_id AND i.driver_user_id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = '42501'; END IF;
  -- Idempotent replays of the same decision.
  IF _inv.status = 'accepted' AND _response = 'accept' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'accepted', 'thread_id', _inv.thread_id);
  END IF;
  IF _inv.status = 'declined' AND _response IN ('decline','block') THEN
    IF _response = 'block' THEN
      INSERT INTO job_search_private.recruiter_invitation_blocks (driver_user_id, recruiter_id) VALUES (_uid, _inv.recruiter_id) ON CONFLICT DO NOTHING;
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'declined', 'thread_id', NULL);
  END IF;
  IF _inv.status <> 'pending' OR _inv.expires_at <= _now THEN
    RAISE EXCEPTION 'Invitation no longer open' USING ERRCODE = '55000';
  END IF;
  IF _response IN ('decline','block') THEN
    UPDATE job_search_private.recruiter_opportunity_invitations SET status = 'declined', responded_at = _now WHERE id = _inv.id;
    IF _response = 'block' THEN
      INSERT INTO job_search_private.recruiter_invitation_blocks (driver_user_id, recruiter_id) VALUES (_uid, _inv.recruiter_id) ON CONFLICT DO NOTHING;
      UPDATE job_search_private.recruiter_opportunity_invitations SET status = 'declined', responded_at = _now
        WHERE driver_user_id = _uid AND recruiter_id = _inv.recruiter_id AND status = 'pending';
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'declined', 'thread_id', NULL);
  END IF;
  -- ACCEPT: re-validate every party and BOTH driver consents live.
  IF NOT EXISTS (SELECT 1 FROM job_search_private.driver_job_search_cards c WHERE c.id = _inv.card_id AND c.owner_user_id = _uid
      AND c.status = 'published' AND c.expires_at > _now AND c.audience = 'approved_recruiters' AND c.consent_version = 'job_search_card_v1')
    OR NOT EXISTS (SELECT 1 FROM public.driver_opportunity_profiles dp WHERE dp.user_id = _uid
      AND dp.visibility = 'verified_recruiters' AND dp.allow_verified_recruiter_contact IS TRUE)
    OR public.user_has_blocking_messaging_restriction(_uid)
    OR NOT EXISTS (SELECT 1 FROM public.user_capabilities c WHERE c.user_id = _uid AND c.capability = 'driver' AND c.status = 'active')
    OR public.user_has_blocking_messaging_restriction(_inv.sender_user_id)
    OR NOT EXISTS (SELECT 1 FROM public.user_capabilities c WHERE c.user_id = _inv.sender_user_id AND c.capability = 'recruiter' AND c.status = 'active')
    OR NOT EXISTS (SELECT 1 FROM public.recruiter_profiles rp WHERE rp.id = _inv.recruiter_id AND rp.user_id = _inv.sender_user_id
      AND rp.status = 'active' AND rp.verification_status = 'approved' AND public.recruiter_profile_can_manage_opportunities(rp.id))
    OR NOT EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = _inv.opportunity_id AND o.recruiter_id = _inv.recruiter_id
      AND o.status = 'active' AND o.admin_review_status = 'approved') THEN
    RAISE EXCEPTION 'Invitation can no longer be accepted' USING ERRCODE = '42501';
  END IF;
  SELECT t.id INTO _thread FROM public.conversation_threads t
    WHERE t.driver_user_id = _uid AND t.recruiter_id = _inv.recruiter_id AND t.opportunity_id = _inv.opportunity_id
      AND t.status IN ('requested','active') FOR UPDATE;
  IF _thread IS NULL THEN
    INSERT INTO public.conversation_threads (driver_user_id, recruiter_id, opportunity_id, status, initiated_by_user_id, accepted_at)
    VALUES (_uid, _inv.recruiter_id, _inv.opportunity_id, 'active', _uid, _now)
    ON CONFLICT (driver_user_id, recruiter_id, opportunity_id)
      WHERE opportunity_id IS NOT NULL AND status IN ('requested','active') DO NOTHING
    RETURNING id INTO _thread;
    IF _thread IS NULL THEN
      SELECT t.id INTO _thread FROM public.conversation_threads t
        WHERE t.driver_user_id = _uid AND t.recruiter_id = _inv.recruiter_id AND t.opportunity_id = _inv.opportunity_id
          AND t.status IN ('requested','active') FOR UPDATE;
    ELSE _created := true;
    END IF;
  END IF;
  IF _thread IS NULL THEN RAISE EXCEPTION 'Unable to open conversation' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.conversation_participants (thread_id, user_id, participant_role) VALUES (_thread, _uid, 'driver') ON CONFLICT (thread_id, user_id) DO NOTHING;
  INSERT INTO public.conversation_participants (thread_id, user_id, participant_role) VALUES (_thread, _inv.sender_user_id, 'recruiter') ON CONFLICT (thread_id, user_id) DO NOTHING;
  IF _created THEN
    INSERT INTO public.conversation_events (thread_id, actor_user_id, actor_type, event_type, metadata)
    VALUES (_thread, _uid, 'driver', 'accepted', pg_catalog.jsonb_build_object('source', 'job_search_invitation', 'invitation_id', _inv.id));
  END IF;
  INSERT INTO public.conversation_messages (thread_id, sender_user_id, sender_actor_type, source, message_type, body, client_message_id)
  VALUES (_thread, _inv.sender_user_id, 'recruiter', 'system', 'text', _inv.message, _inv.id)
  ON CONFLICT (thread_id, sender_user_id, client_message_id) DO NOTHING;
  UPDATE job_search_private.recruiter_opportunity_invitations SET status = 'accepted', responded_at = _now, thread_id = _thread WHERE id = _inv.id;
  RETURN pg_catalog.jsonb_build_object('status', 'accepted', 'thread_id', _thread);
END;
$respond$;

REVOKE ALL ON FUNCTION public.job_search_invitations_available() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.send_job_search_invitation(uuid,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_job_search_invitations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.respond_job_search_invitation(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.job_search_invitations_available() TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_job_search_invitation(uuid,uuid,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_job_search_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_job_search_invitation(uuid,text) TO authenticated;
