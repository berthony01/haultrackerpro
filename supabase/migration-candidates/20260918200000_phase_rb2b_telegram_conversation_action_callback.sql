-- CANDIDATE MIGRATION — Phase RB-2B.
-- Recruiter Accept / Pass from the private Telegram alert.
--
-- Scope contract:
--   * CF-1 remains the ONLY conversation authority. This migration NEVER
--     writes to conversation_threads / _participants / _messages / _events
--     directly and never alters their columns, RLS or grants. Every state
--     transition goes through the EXISTING canonical
--     public.accept_conversation_thread / public.decline_conversation_thread,
--     which perform their own authorization and their own idempotency;
--   * the callback payload is an UNTRUSTED LOCATOR. The acting HaulTracker
--     account is derived ONLY from an ACTIVE telegram_user_links row for the
--     numeric Telegram user id, and authority is re-resolved for THAT thread
--     at action time. No recruiter id, user id or workspace id is ever
--     accepted from Telegram;
--   * private chat ONLY, and the chat must be the acting user's own private
--     chat. A group tap can never mutate a conversation;
--   * an alert row must already exist for (thread, recipient). A guessed or
--     copied thread uuid grants nothing, so no cross-workspace action is
--     possible;
--   * exactly-once: the terminal receipt for the callback update_id is written
--     in the SAME transaction as the action, so a duplicate delivery of the
--     same update_id can never re-apply it;
--   * no driver identity, contact detail or profile data is read, returned or
--     representable here.
--
-- Deliberately NOT here: no new table, no new conversation architecture, no
-- free-text reply surface, no webhook, no second poller, no credential.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Receipt vocabulary — narrow extension only
-- ─────────────────────────────────────────────────────────────────────────────

-- The ledger must be able to record a button tap as its own update type, so a
-- callback update can never be mistaken for, or collide with, a message.
ALTER TABLE public.telegram_update_receipts
  DROP CONSTRAINT telegram_update_receipts_update_type_check;
ALTER TABLE public.telegram_update_receipts
  ADD CONSTRAINT telegram_update_receipts_update_type_check
  CHECK (update_type = ANY (ARRAY['message'::text, 'callback_query'::text]));

-- Six new terminal outcomes. Every pre-existing code keeps its exact meaning.
ALTER TABLE public.telegram_update_receipts
  DROP CONSTRAINT telegram_update_receipts_result_code_check;
ALTER TABLE public.telegram_update_receipts
  ADD CONSTRAINT telegram_update_receipts_result_code_check
  CHECK (result_code = ANY (ARRAY[
    'link_success'::text,
    'link_rejected'::text,
    'non_private_message'::text,
    'non_start_message'::text,
    'invalid_start_command'::text,
    'invalid_update_shape'::text,
    'bind_success'::text,
    'bind_rejected'::text,
    'menu_recruiter'::text,
    'menu_linked_no_workspace'::text,
    'menu_unlinked'::text,
    'menu_driver'::text,
    'menu_multi_role'::text,
    'menu_linked_unsupported'::text,
    'conversation_accepted'::text,
    'conversation_passed'::text,
    'conversation_already_handled'::text,
    'conversation_action_unavailable'::text,
    'conversation_action_denied'::text,
    'conversation_action_invalid'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Alert claim now also returns the thread locator
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Identical RB-2A / RB-2A.1 body and identical security posture; the ONLY
-- change is the added `thread_id` output column, which the Edge Function needs
-- in order to address the Accept / Pass buttons. 'pending'-only claiming
-- (RB-2A.1 ambiguity hardening) is preserved exactly.

DROP FUNCTION IF EXISTS public.telegram_claim_conversation_alerts(integer);

CREATE FUNCTION public.telegram_claim_conversation_alerts(
  _limit integer DEFAULT 10
)
RETURNS TABLE(alert_id uuid, thread_id uuid, telegram_chat_id bigint, opportunity_title text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _max integer := LEAST(GREATEST(COALESCE(_limit, 10), 1), 25);
  _thread record;
  _candidate record;
  _row record;
  _chat_id bigint;
  _title text;
BEGIN
  FOR _thread IN
    SELECT DISTINCT th.id AS thread_id, th.recruiter_id, th.driver_user_id
      FROM public.conversation_events e
      JOIN public.conversation_threads th ON th.id = e.thread_id
     WHERE e.event_type = 'requested'
       AND th.status IN ('requested', 'active')
       AND NOT EXISTS (
             SELECT 1
               FROM public.telegram_conversation_alerts a
              WHERE a.thread_id = th.id
                AND a.notification_kind = 'conversation_requested')
     LIMIT _max
  LOOP
    FOR _candidate IN
      SELECT l.user_id
        FROM public.telegram_user_links l
       WHERE l.status = 'active'
         AND l.user_id <> _thread.driver_user_id
    LOOP
      IF public.telegram_user_can_receive_conversation_alert(
           _candidate.user_id, _thread.thread_id) THEN
        INSERT INTO public.telegram_conversation_alerts (
          thread_id, recruiter_id, recipient_user_id, notification_kind
        )
        VALUES (
          _thread.thread_id, _thread.recruiter_id, _candidate.user_id,
          'conversation_requested'
        )
        ON CONFLICT (thread_id, recipient_user_id, notification_kind) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  -- RB-2A.1: ONLY 'pending' is send-eligible. A 'claimed' row has an UNKNOWN
  -- delivery outcome and must never be auto-reclaimed here.
  FOR _row IN
    SELECT p.id, p.thread_id, p.recipient_user_id
      FROM public.telegram_conversation_alerts p
     WHERE p.status = 'pending'
     ORDER BY p.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT _max
  LOOP
    IF NOT public.telegram_user_can_receive_conversation_alert(
         _row.recipient_user_id, _row.thread_id) THEN
      UPDATE public.telegram_conversation_alerts
         SET status = 'skipped', last_error_code = 'not_authorized_at_send'
       WHERE id = _row.id;
      CONTINUE;
    END IF;

    SELECT l.telegram_user_id INTO _chat_id
      FROM public.telegram_user_links l
     WHERE l.user_id = _row.recipient_user_id
       AND l.status = 'active';

    IF _chat_id IS NULL THEN
      UPDATE public.telegram_conversation_alerts
         SET status = 'skipped', last_error_code = 'telegram_link_inactive'
       WHERE id = _row.id;
      CONTINUE;
    END IF;

    UPDATE public.telegram_conversation_alerts
       SET status = 'claimed', attempts = attempts + 1, claimed_at = now()
     WHERE id = _row.id;

    SELECT o.title INTO _title
      FROM public.conversation_threads th
      LEFT JOIN public.opportunities o ON o.id = th.opportunity_id
     WHERE th.id = _row.thread_id;

    alert_id := _row.id;
    thread_id := _row.thread_id;
    telegram_chat_id := _chat_id;
    opportunity_title := _title;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_claim_conversation_alerts(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_claim_conversation_alerts(integer) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_claim_conversation_alerts(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_claim_conversation_alerts(integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Callback action processor — terminal receipt + canonical CF-1 action
-- ─────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.telegram_process_conversation_action_update(
  _lease_token uuid,
  _update_id bigint,
  _payload_hash text,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text,
  _action text,
  _thread_id uuid
)
RETURNS TABLE(is_new boolean, result_code text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _existing public.telegram_update_receipts%ROWTYPE;
  _actor_user_id uuid;
  _linked_chat_id bigint;
  _t public.conversation_threads%ROWTYPE;
  _outcome text;
  _prior_status text;
BEGIN
  -- Structural validation. These are poller bugs, never user input, so they
  -- raise rather than burning a terminal receipt.
  IF _update_id IS NULL
     OR _update_id <= 0
     OR _payload_hash IS NULL
     OR _payload_hash !~ '^[0-9a-f]{64}$'
     OR _telegram_user_id IS NULL
     OR _telegram_user_id <= 0
     OR _telegram_chat_id IS NULL
     OR _telegram_chat_id = 0 THEN
    RAISE EXCEPTION 'telegram_update_invalid';
  END IF;

  IF _lease_token IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.telegram_poll_state s
    WHERE s.id = 1
      AND s.lease_token = _lease_token
      AND s.lease_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'telegram_poll_lease_invalid';
  END IF;

  -- Exactly-once. A duplicate delivery of the same update_id returns the
  -- ALREADY RECORDED outcome and performs no action.
  SELECT * INTO _existing
    FROM public.telegram_update_receipts r
   WHERE r.update_id = _update_id
   FOR UPDATE;

  IF FOUND THEN
    IF _existing.payload_hash = _payload_hash
       AND _existing.update_type = 'callback_query'
       AND _existing.telegram_user_id IS NOT DISTINCT FROM _telegram_user_id
       AND _existing.telegram_chat_id IS NOT DISTINCT FROM _telegram_chat_id
       AND _existing.status = 'processed'
       AND _existing.result_code = ANY (ARRAY[
             'conversation_accepted',
             'conversation_passed',
             'conversation_already_handled',
             'conversation_action_unavailable',
             'conversation_action_denied',
             'conversation_action_invalid'
           ]) THEN
      is_new := false;
      result_code := _existing.result_code;
      RETURN NEXT;
      RETURN;
    END IF;

    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  -- Untrusted locator validation.
  IF _action IS NULL OR _action NOT IN ('accept', 'pass') OR _thread_id IS NULL THEN
    _outcome := 'conversation_action_invalid';
  -- Private chat ONLY. A shared group can never drive a conversation action.
  ELSIF _chat_type IS DISTINCT FROM 'private' THEN
    _outcome := 'conversation_action_denied';
  ELSE
    SELECT l.user_id, l.telegram_user_id INTO _actor_user_id, _linked_chat_id
      FROM public.telegram_user_links l
     WHERE l.telegram_user_id = _telegram_user_id
       AND l.status = 'active';

    IF _actor_user_id IS NULL THEN
      -- Not linked, or the link was revoked since the alert was sent.
      _outcome := 'conversation_action_denied';
    ELSIF _linked_chat_id IS DISTINCT FROM _telegram_chat_id THEN
      -- The tap did not arrive in this account's own private chat.
      _outcome := 'conversation_action_denied';
    ELSIF NOT EXISTS (
      SELECT 1
        FROM public.telegram_conversation_alerts a
       WHERE a.thread_id = _thread_id
         AND a.recipient_user_id = _actor_user_id
         AND a.notification_kind = 'conversation_requested'
    ) THEN
      -- No alert was ever addressed to this account for this thread, so a
      -- guessed or copied uuid grants nothing.
      _outcome := 'conversation_action_denied';
    ELSE
      SELECT * INTO _t FROM public.conversation_threads WHERE id = _thread_id;

      IF NOT FOUND OR _t.driver_user_id = _actor_user_id THEN
        _outcome := 'conversation_action_denied';
      ELSE
        -- Bind the acting identity transaction-locally so the canonical CF-1
        -- functions run under their OWN unmodified authorization, exactly as
        -- they do for the web recruiter.
        PERFORM pg_catalog.set_config(
          'request.jwt.claim.sub', _actor_user_id::text, true);

        IF NOT public.current_user_can_conversation_action(
             _thread_id, CASE WHEN _action = 'accept' THEN 'accept' ELSE 'decline' END) THEN
          _outcome := 'conversation_action_denied';
        ELSE
          _prior_status := _t.status;

          BEGIN
            IF _action = 'accept' THEN
              PERFORM public.accept_conversation_thread(_thread_id);
              _outcome := CASE
                WHEN _prior_status = 'active' THEN 'conversation_already_handled'
                ELSE 'conversation_accepted'
              END;
            ELSE
              PERFORM public.decline_conversation_thread(_thread_id);
              _outcome := CASE
                WHEN _prior_status = 'declined' THEN 'conversation_already_handled'
                ELSE 'conversation_passed'
              END;
            END IF;
          EXCEPTION
            WHEN insufficient_privilege THEN
              _outcome := 'conversation_action_denied';
            WHEN invalid_parameter_value THEN
              -- CF-1 'Conversation is no longer open' (22023): the thread left
              -- the actionable state. Nothing was mutated.
              _outcome := 'conversation_action_unavailable';
          END;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Same transaction as the action above: the action and its exactly-once
  -- receipt commit together or not at all.
  INSERT INTO public.telegram_update_receipts (
    update_id, payload_hash, update_type,
    telegram_user_id, telegram_chat_id, status, result_code
  ) VALUES (
    _update_id, _payload_hash, 'callback_query',
    _telegram_user_id, _telegram_chat_id, 'processed', _outcome
  );

  is_new := true;
  result_code := _outcome;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_process_conversation_action_update(uuid, bigint, text, bigint, bigint, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_process_conversation_action_update(uuid, bigint, text, bigint, bigint, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_process_conversation_action_update(uuid, bigint, text, bigint, bigint, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_process_conversation_action_update(uuid, bigint, text, bigint, bigint, text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.telegram_process_conversation_action_update(uuid, bigint, text, bigint, bigint, text, text, uuid) IS
  'RB-2B: private-chat Telegram Accept/Pass bridge. Service-role only. Derives the actor from an active Telegram link, re-authorizes against CF-1 for that thread, and delegates every state transition to accept_conversation_thread / decline_conversation_thread. Action and terminal receipt share one transaction.';

COMMIT;
