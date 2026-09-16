-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase CF-1A (B) — Secure conversation foundation (schema, RLS, RPCs).
--
-- Depends on CF-1A (A) `20260916050000_phase_cf1a_conversation_permission_vocabulary.sql`
-- having been applied and COMMITTED first: this migration consumes the enum
-- values 'conversations_view' and 'conversations_reply'.
--
-- Scope contract:
--   * additive only — four new tables, helpers, RPCs, indexes;
--   * driver-initiated conversations ONLY; a recruiter can never originate a
--     thread with an arbitrary driver in CF-1A;
--   * recruiter authority is re-resolved live through
--     current_user_has_recruiter_permission (owner implicit, seat limit and
--     membership revocation take effect immediately);
--   * participant rows are audit/participation state and NEVER a source of
--     authorization on their own;
--   * no dependency on opportunity_applications / application_events /
--     recruiter_contact_requests / offers / contracts;
--   * no RLS, grant, policy or column change on any pre-existing table.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.conversation_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  opportunity_id uuid NULL REFERENCES public.opportunities(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'requested',
  initiated_by_user_id uuid NOT NULL REFERENCES auth.users(id),
  accepted_at timestamptz NULL,
  declined_at timestamptz NULL,
  closed_at timestamptz NULL,
  closed_by_user_id uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_threads_status_check
    CHECK (status = ANY (ARRAY['requested','active','declined','closed']))
);

-- Writes happen exclusively through the SECURITY DEFINER RPCs below.
GRANT SELECT ON public.conversation_threads TO authenticated;
GRANT ALL ON public.conversation_threads TO service_role;
ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz NULL,
  CONSTRAINT conversation_participants_role_check
    CHECK (participant_role = ANY (ARRAY['driver','recruiter'])),
  CONSTRAINT conversation_participants_thread_user_key UNIQUE (thread_id, user_id)
);

GRANT SELECT ON public.conversation_participants TO authenticated;
GRANT ALL ON public.conversation_participants TO service_role;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id),
  sender_actor_type text NOT NULL,
  source text NOT NULL DEFAULT 'web',
  message_type text NOT NULL DEFAULT 'text',
  body text NOT NULL,
  client_message_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_messages_actor_type_check
    CHECK (sender_actor_type = ANY (ARRAY['driver','recruiter'])),
  CONSTRAINT conversation_messages_source_check
    CHECK (source = ANY (ARRAY['web','telegram','system'])),
  CONSTRAINT conversation_messages_message_type_check
    CHECK (message_type = 'text'),
  CONSTRAINT conversation_messages_body_check
    CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  CONSTRAINT conversation_messages_idempotency_key
    UNIQUE (thread_id, sender_user_id, client_message_id)
);

GRANT SELECT ON public.conversation_messages TO authenticated;
GRANT ALL ON public.conversation_messages TO service_role;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.conversation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  actor_user_id uuid NULL REFERENCES auth.users(id),
  actor_type text NOT NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_events_actor_type_check
    CHECK (actor_type = ANY (ARRAY['driver','recruiter','system'])),
  CONSTRAINT conversation_events_event_type_check
    CHECK (event_type = ANY (ARRAY['requested','accepted','declined','closed'])),
  CONSTRAINT conversation_events_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

GRANT SELECT ON public.conversation_events TO authenticated;
GRANT ALL ON public.conversation_events TO service_role;
ALTER TABLE public.conversation_events ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Indexes (lookup, list views, chronological retrieval, uniqueness)
-- ─────────────────────────────────────────────────────────────────────────────

-- At most ONE open (requested/active) thread per driver+recruiter+opportunity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_threads_open_with_opportunity
  ON public.conversation_threads (driver_user_id, recruiter_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL AND status IN ('requested','active');

-- At most ONE open (requested/active) thread per driver+recruiter when the
-- thread is not tied to an opportunity. No sentinel UUID is used.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_threads_open_without_opportunity
  ON public.conversation_threads (driver_user_id, recruiter_id)
  WHERE opportunity_id IS NULL AND status IN ('requested','active');

CREATE INDEX IF NOT EXISTS idx_conversation_threads_driver_updated
  ON public.conversation_threads (driver_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_threads_recruiter_updated
  ON public.conversation_threads (recruiter_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user
  ON public.conversation_participants (user_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread_created
  ON public.conversation_messages (thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversation_events_thread_created
  ON public.conversation_events (thread_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger (existing shared convention)
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS update_conversation_threads_updated_at ON public.conversation_threads;
CREATE TRIGGER update_conversation_threads_updated_at
  BEFORE UPDATE ON public.conversation_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Authorization helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- Marketplace moderation gate. 'warned' never blocks; viewing is never blocked.
CREATE OR REPLACE FUNCTION public.user_has_blocking_messaging_restriction(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.marketplace_user_restrictions r
    WHERE _user_id IS NOT NULL
      AND r.user_id = _user_id
      AND r.scope IN ('messaging','all')
      AND r.restriction IN ('blocked','read_only')
      AND r.starts_at <= now()
      AND (r.ends_at IS NULL OR r.ends_at > now())
  );
$function$;

REVOKE ALL ON FUNCTION public.user_has_blocking_messaging_restriction(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_blocking_messaging_restriction(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.user_has_blocking_messaging_restriction(uuid) FROM authenticated;

-- Single conversation authorization authority.
-- Actions: 'view' | 'reply' | 'accept' | 'decline' | 'close'.
-- Recruiter authority is ALWAYS re-resolved through
-- current_user_has_recruiter_permission; a participant row grants nothing.
CREATE OR REPLACE FUNCTION public.current_user_can_conversation_action(
  _thread_id uuid,
  _action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _t public.conversation_threads%ROWTYPE;
BEGIN
  IF _uid IS NULL OR _thread_id IS NULL OR _action IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO _t FROM public.conversation_threads WHERE id = _thread_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF public.is_admin(_uid) THEN
    RETURN true;
  END IF;

  -- Driver side: strictly the thread's own driver.
  IF _t.driver_user_id = _uid THEN
    IF _action = 'view' THEN
      RETURN true;
    ELSIF _action = 'reply' THEN
      RETURN _t.status IN ('requested','active')
         AND NOT public.user_has_blocking_messaging_restriction(_uid);
    ELSIF _action = 'close' THEN
      RETURN _t.status IN ('requested','active');
    END IF;
    RETURN false;
  END IF;

  -- Recruiter side: live workspace permission resolution, owner implicit.
  IF NOT public.current_user_has_recruiter_permission(
       _t.recruiter_id, 'conversations_view'::public.recruiter_workspace_permission) THEN
    RETURN false;
  END IF;

  IF _action = 'view' THEN
    RETURN true;
  END IF;

  IF NOT public.current_user_has_recruiter_permission(
       _t.recruiter_id, 'conversations_reply'::public.recruiter_workspace_permission) THEN
    RETURN false;
  END IF;

  IF _action = 'reply' THEN
    RETURN _t.status = 'active'
       AND NOT public.user_has_blocking_messaging_restriction(_uid);
  ELSIF _action IN ('accept','decline','close') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.current_user_can_conversation_action(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_conversation_action(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_conversation_action(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS policies — read-only for authenticated, writes via RPC only
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authorized participants view conversation threads" ON public.conversation_threads;
CREATE POLICY "Authorized participants view conversation threads"
  ON public.conversation_threads
  FOR SELECT
  TO authenticated
  USING (public.current_user_can_conversation_action(id, 'view'));

DROP POLICY IF EXISTS "Authorized participants view conversation participants" ON public.conversation_participants;
CREATE POLICY "Authorized participants view conversation participants"
  ON public.conversation_participants
  FOR SELECT
  TO authenticated
  USING (public.current_user_can_conversation_action(thread_id, 'view'));

DROP POLICY IF EXISTS "Authorized participants view conversation messages" ON public.conversation_messages;
CREATE POLICY "Authorized participants view conversation messages"
  ON public.conversation_messages
  FOR SELECT
  TO authenticated
  USING (public.current_user_can_conversation_action(thread_id, 'view'));

DROP POLICY IF EXISTS "Authorized participants view conversation events" ON public.conversation_events;
CREATE POLICY "Authorized participants view conversation events"
  ON public.conversation_events
  FOR SELECT
  TO authenticated
  USING (public.current_user_can_conversation_action(thread_id, 'view'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Driver start RPC
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.start_opportunity_conversation(
  _opportunity_id uuid,
  _initial_message text,
  _client_message_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _recruiter_id uuid;
  _body text := btrim(COALESCE(_initial_message, ''));
  _thread_id uuid;
  _created boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF _opportunity_id IS NULL OR _client_message_id IS NULL THEN
    RAISE EXCEPTION 'Invalid request' USING ERRCODE = '22023';
  END IF;
  IF char_length(_body) < 1 OR char_length(_body) > 4000 THEN
    RAISE EXCEPTION 'Message must be between 1 and 4000 characters' USING ERRCODE = '22023';
  END IF;
  IF public.user_has_blocking_messaging_restriction(_uid) THEN
    RAISE EXCEPTION 'Messaging is not available for this account' USING ERRCODE = '42501';
  END IF;

  -- recruiter_id is derived from the opportunity, NEVER from client input.
  SELECT o.recruiter_id INTO _recruiter_id
  FROM public.opportunities o
  WHERE o.id = _opportunity_id;

  IF _recruiter_id IS NULL
     OR NOT public.driver_can_access_opportunity(_opportunity_id, _recruiter_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT t.id INTO _thread_id
  FROM public.conversation_threads t
  WHERE t.driver_user_id = _uid
    AND t.recruiter_id = _recruiter_id
    AND t.opportunity_id = _opportunity_id
    AND t.status IN ('requested','active')
  FOR UPDATE;

  IF _thread_id IS NULL THEN
    INSERT INTO public.conversation_threads (
      driver_user_id, recruiter_id, opportunity_id, status, initiated_by_user_id
    )
    VALUES (_uid, _recruiter_id, _opportunity_id, 'requested', _uid)
    ON CONFLICT (driver_user_id, recruiter_id, opportunity_id)
      WHERE opportunity_id IS NOT NULL AND status IN ('requested','active')
      DO NOTHING
    RETURNING id INTO _thread_id;

    IF _thread_id IS NULL THEN
      -- Lost a concurrent race: resolve to the canonical existing thread.
      SELECT t.id INTO _thread_id
      FROM public.conversation_threads t
      WHERE t.driver_user_id = _uid
        AND t.recruiter_id = _recruiter_id
        AND t.opportunity_id = _opportunity_id
        AND t.status IN ('requested','active')
      FOR UPDATE;
    ELSE
      _created := true;
    END IF;
  END IF;

  IF _thread_id IS NULL THEN
    RAISE EXCEPTION 'Unable to open conversation' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.conversation_participants (thread_id, user_id, participant_role)
  VALUES (_thread_id, _uid, 'driver')
  ON CONFLICT (thread_id, user_id) DO NOTHING;

  IF _created THEN
    INSERT INTO public.conversation_events (thread_id, actor_user_id, actor_type, event_type)
    VALUES (_thread_id, _uid, 'driver', 'requested');
  END IF;

  INSERT INTO public.conversation_messages (
    thread_id, sender_user_id, sender_actor_type, source, message_type, body, client_message_id
  )
  VALUES (_thread_id, _uid, 'driver', 'web', 'text', _body, _client_message_id)
  ON CONFLICT (thread_id, sender_user_id, client_message_id) DO NOTHING;

  RETURN _thread_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_opportunity_conversation(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_opportunity_conversation(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_opportunity_conversation(uuid, text, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Recruiter accept / decline RPCs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_conversation_thread(_thread_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _t public.conversation_threads%ROWTYPE;
BEGIN
  IF _uid IS NULL OR _thread_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _t FROM public.conversation_threads WHERE id = _thread_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Recruiter-side authority only; drivers cannot accept their own request.
  IF _t.driver_user_id = _uid
     OR NOT public.current_user_can_conversation_action(_thread_id, 'accept') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _t.status = 'active' THEN
    RETURN _t.status; -- idempotent
  END IF;
  IF _t.status <> 'requested' THEN
    RAISE EXCEPTION 'Conversation is no longer open' USING ERRCODE = '22023';
  END IF;

  UPDATE public.conversation_threads
     SET status = 'active', accepted_at = now()
   WHERE id = _thread_id;

  INSERT INTO public.conversation_participants (thread_id, user_id, participant_role)
  VALUES (_thread_id, _uid, 'recruiter')
  ON CONFLICT (thread_id, user_id) DO NOTHING;

  INSERT INTO public.conversation_events (thread_id, actor_user_id, actor_type, event_type)
  VALUES (_thread_id, _uid, 'recruiter', 'accepted');

  RETURN 'active';
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_conversation_thread(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_conversation_thread(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_conversation_thread(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_conversation_thread(_thread_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _t public.conversation_threads%ROWTYPE;
BEGIN
  IF _uid IS NULL OR _thread_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _t FROM public.conversation_threads WHERE id = _thread_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _t.driver_user_id = _uid
     OR NOT public.current_user_can_conversation_action(_thread_id, 'decline') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _t.status = 'declined' THEN
    RETURN _t.status; -- idempotent
  END IF;
  IF _t.status <> 'requested' THEN
    RAISE EXCEPTION 'Conversation is no longer open' USING ERRCODE = '22023';
  END IF;

  UPDATE public.conversation_threads
     SET status = 'declined', declined_at = now()
   WHERE id = _thread_id;

  INSERT INTO public.conversation_participants (thread_id, user_id, participant_role)
  VALUES (_thread_id, _uid, 'recruiter')
  ON CONFLICT (thread_id, user_id) DO NOTHING;

  INSERT INTO public.conversation_events (thread_id, actor_user_id, actor_type, event_type)
  VALUES (_thread_id, _uid, 'recruiter', 'declined');

  RETURN 'declined';
END;
$function$;

REVOKE ALL ON FUNCTION public.decline_conversation_thread(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_conversation_thread(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.decline_conversation_thread(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Post message RPC
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.conversation_post_message(
  _thread_id uuid,
  _body text,
  _client_message_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _t public.conversation_threads%ROWTYPE;
  _actor text;
  _clean text := btrim(COALESCE(_body, ''));
  _message_id uuid;
BEGIN
  IF _uid IS NULL OR _thread_id IS NULL OR _client_message_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(_clean) < 1 OR char_length(_clean) > 4000 THEN
    RAISE EXCEPTION 'Message must be between 1 and 4000 characters' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _t FROM public.conversation_threads WHERE id = _thread_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Actor type is derived server-side; never trusted from the client.
  IF _t.driver_user_id = _uid THEN
    _actor := 'driver';
  ELSE
    _actor := 'recruiter';
  END IF;

  IF NOT public.current_user_can_conversation_action(_thread_id, 'reply') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversation_participants (thread_id, user_id, participant_role)
  VALUES (_thread_id, _uid, _actor)
  ON CONFLICT (thread_id, user_id) DO NOTHING;

  INSERT INTO public.conversation_messages (
    thread_id, sender_user_id, sender_actor_type, source, message_type, body, client_message_id
  )
  VALUES (_thread_id, _uid, _actor, 'web', 'text', _clean, _client_message_id)
  ON CONFLICT (thread_id, sender_user_id, client_message_id) DO NOTHING
  RETURNING id INTO _message_id;

  IF _message_id IS NULL THEN
    -- Idempotent retry: return the canonical existing message.
    SELECT m.id INTO _message_id
    FROM public.conversation_messages m
    WHERE m.thread_id = _thread_id
      AND m.sender_user_id = _uid
      AND m.client_message_id = _client_message_id;
  END IF;

  UPDATE public.conversation_threads SET updated_at = now() WHERE id = _thread_id;

  RETURN _message_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.conversation_post_message(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conversation_post_message(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.conversation_post_message(uuid, text, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Close RPC
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.close_conversation_thread(_thread_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _t public.conversation_threads%ROWTYPE;
  _actor text;
BEGIN
  IF _uid IS NULL OR _thread_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _t FROM public.conversation_threads WHERE id = _thread_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.current_user_can_conversation_action(_thread_id, 'close') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  _actor := CASE WHEN _t.driver_user_id = _uid THEN 'driver' ELSE 'recruiter' END;

  IF _t.status = 'closed' THEN
    RETURN _t.status; -- idempotent
  END IF;
  IF _t.status NOT IN ('requested','active') THEN
    -- Declined threads are terminal and are never reopened or re-closed.
    RAISE EXCEPTION 'Conversation is no longer open' USING ERRCODE = '22023';
  END IF;

  UPDATE public.conversation_threads
     SET status = 'closed', closed_at = now(), closed_by_user_id = _uid
   WHERE id = _thread_id;

  INSERT INTO public.conversation_events (thread_id, actor_user_id, actor_type, event_type)
  VALUES (_thread_id, _uid, _actor, 'closed');

  RETURN 'closed';
END;
$function$;

REVOKE ALL ON FUNCTION public.close_conversation_thread(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_conversation_thread(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_conversation_thread(uuid) TO authenticated;

COMMENT ON TABLE public.conversation_threads IS
  'CF-1A: driver-initiated conversation threads. One driver + one recruiter workspace, optional opportunity. Writes only through authorized SECURITY DEFINER RPCs.';
COMMENT ON TABLE public.conversation_participants IS
  'CF-1A: participation/audit state only. NEVER a source of authorization on its own.';

COMMIT;
