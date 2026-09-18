-- CANDIDATE MIGRATION — Phase RB-2C.
-- Recruiter Telegram reply → existing CF-1 conversation message.
--
-- Scope contract:
--   * CF-1 remains the ONLY conversation authority. This migration NEVER
--     inserts into conversation_messages / _participants / _threads / _events
--     itself and never alters their columns, RLS or grants. The Driver-visible
--     message is written EXCLUSIVELY by the existing canonical
--     public.conversation_post_message, under the linked recruiter's own
--     identity and its own unmodified authorization + idempotency;
--   * routing is NEVER implicit. A recruiter free-text message becomes a
--     conversation reply ONLY when it is a Telegram reply to a bot alert
--     message that was actually delivered to THAT linked account. The
--     reply_to_message_id is an UNTRUSTED LOCATOR: a copied or guessed id
--     resolves to nothing;
--   * private chat ONLY, and the chat must be the acting account's own private
--     chat. A group message can never write into a conversation;
--   * exactly-once: the terminal receipt for the update_id is written in the
--     SAME transaction as the CF-1 message, so a duplicate delivery of the same
--     update can never produce a second Driver-visible message;
--   * no driver identity, contact detail or profile data is read, returned or
--     representable here. The mapping stores Telegram transport ids only.
--
-- Deliberately NOT here: no Driver→Telegram notification, no conversation
-- session state, no new conversation table, no media, no webhook, no second
-- poller, no credential.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Alert → Telegram message mapping (transport ids only, no PII)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.telegram_conversation_alerts
  ADD COLUMN IF NOT EXISTS telegram_message_id bigint NULL,
  ADD COLUMN IF NOT EXISTS telegram_chat_id bigint NULL;

ALTER TABLE public.telegram_conversation_alerts
  DROP CONSTRAINT IF EXISTS telegram_conversation_alerts_message_id_positive_check;
ALTER TABLE public.telegram_conversation_alerts
  ADD CONSTRAINT telegram_conversation_alerts_message_id_positive_check
  CHECK (telegram_message_id IS NULL OR telegram_message_id > 0);

ALTER TABLE public.telegram_conversation_alerts
  DROP CONSTRAINT IF EXISTS telegram_conversation_alerts_chat_id_nonzero_check;
ALTER TABLE public.telegram_conversation_alerts
  ADD CONSTRAINT telegram_conversation_alerts_chat_id_nonzero_check
  CHECK (telegram_chat_id IS NULL OR telegram_chat_id <> 0);

-- A delivered alert message is uniquely addressable by (chat, message id), so
-- an inbound reply can never resolve to two threads.
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_conversation_alerts_chat_message
  ON public.telegram_conversation_alerts (telegram_chat_id, telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Mark-sent narrowly extended to persist the delivered message id
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Identical semantics to RB-2A: only a CONFIRMED Telegram success may reach
-- 'sent', and only from 'claimed'. The two new arguments are optional and
-- carry Telegram transport ids only.

DROP FUNCTION IF EXISTS public.telegram_mark_conversation_alert_sent(uuid);

CREATE FUNCTION public.telegram_mark_conversation_alert_sent(
  _alert_id uuid,
  _telegram_message_id bigint DEFAULT NULL,
  _telegram_chat_id bigint DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  _updated integer;
BEGIN
  IF _alert_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.telegram_conversation_alerts
     SET status = 'sent',
         sent_at = now(),
         last_error_code = NULL,
         telegram_message_id = CASE
           WHEN _telegram_message_id IS NOT NULL AND _telegram_message_id > 0
             THEN _telegram_message_id
           ELSE telegram_message_id
         END,
         telegram_chat_id = CASE
           WHEN _telegram_chat_id IS NOT NULL AND _telegram_chat_id <> 0
             THEN _telegram_chat_id
           ELSE telegram_chat_id
         END
   WHERE id = _alert_id
     AND status = 'claimed';

  GET DIAGNOSTICS _updated = ROW_COUNT;
  RETURN _updated = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_mark_conversation_alert_sent(uuid, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_mark_conversation_alert_sent(uuid, bigint, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_mark_conversation_alert_sent(uuid, bigint, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_mark_conversation_alert_sent(uuid, bigint, bigint) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Receipt vocabulary — narrow extension only
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Five new terminal outcomes for recruiter replies. Every pre-existing code,
-- including the six RB-2B callback outcomes, keeps its exact meaning. The
-- update_type vocabulary is UNCHANGED: a reply is an ordinary 'message'.

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
    'conversation_action_invalid'::text,
    'conversation_reply_sent'::text,
    'conversation_reply_denied'::text,
    'conversation_reply_unavailable'::text,
    'conversation_reply_invalid'::text,
    'conversation_reply_unroutable'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Reply processor — canonical CF-1 message + terminal receipt, one txn
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.telegram_process_conversation_reply_update(
  _lease_token uuid,
  _update_id bigint,
  _payload_hash text,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text,
  _reply_to_message_id bigint,
  _text text
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
  _thread_id uuid;
  _t public.conversation_threads%ROWTYPE;
  _outcome text;
  _client_message_id uuid;
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
  -- ALREADY RECORDED outcome and writes no second conversation message.
  SELECT * INTO _existing
    FROM public.telegram_update_receipts r
   WHERE r.update_id = _update_id
   FOR UPDATE;

  IF FOUND THEN
    IF _existing.payload_hash = _payload_hash
       AND _existing.update_type = 'message'
       AND _existing.telegram_user_id IS NOT DISTINCT FROM _telegram_user_id
       AND _existing.telegram_chat_id IS NOT DISTINCT FROM _telegram_chat_id
       AND _existing.status = 'processed'
       AND _existing.result_code = ANY (ARRAY[
             'conversation_reply_sent',
             'conversation_reply_denied',
             'conversation_reply_unavailable',
             'conversation_reply_invalid',
             'conversation_reply_unroutable'
           ]) THEN
      is_new := false;
      result_code := _existing.result_code;
      RETURN NEXT;
      RETURN;
    END IF;

    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  IF _reply_to_message_id IS NULL
     OR _reply_to_message_id <= 0
     OR _text IS NULL
     OR btrim(_text) = '' THEN
    _outcome := 'conversation_reply_invalid';
  -- Private chat ONLY. A shared group can never write into a conversation.
  ELSIF _chat_type IS DISTINCT FROM 'private' THEN
    _outcome := 'conversation_reply_denied';
  ELSE
    SELECT l.user_id, l.telegram_user_id INTO _actor_user_id, _linked_chat_id
      FROM public.telegram_user_links l
     WHERE l.telegram_user_id = _telegram_user_id
       AND l.status = 'active';

    IF _actor_user_id IS NULL THEN
      -- Not linked, or the link was revoked since the alert was delivered.
      _outcome := 'conversation_reply_denied';
    ELSIF _linked_chat_id IS DISTINCT FROM _telegram_chat_id THEN
      -- The reply did not arrive in this account's own private chat.
      _outcome := 'conversation_reply_denied';
    ELSE
      -- Thread resolution comes ONLY from an alert actually delivered to this
      -- account in this chat. A copied message id belonging to someone else
      -- resolves to nothing.
      SELECT a.thread_id INTO _thread_id
        FROM public.telegram_conversation_alerts a
       WHERE a.recipient_user_id = _actor_user_id
         AND a.telegram_chat_id = _telegram_chat_id
         AND a.telegram_message_id = _reply_to_message_id
         AND a.status = 'sent';

      IF _thread_id IS NULL THEN
        _outcome := 'conversation_reply_unroutable';
      ELSE
        SELECT * INTO _t FROM public.conversation_threads WHERE id = _thread_id;

        IF NOT FOUND OR _t.driver_user_id = _actor_user_id THEN
          _outcome := 'conversation_reply_denied';
        ELSE
          -- Bind the acting identity transaction-locally so the canonical CF-1
          -- function runs under its OWN unmodified authorization, exactly as
          -- it does for the web recruiter.
          PERFORM pg_catalog.set_config(
            'request.jwt.claim.sub', _actor_user_id::text, true);

          IF NOT public.current_user_can_conversation_action(_thread_id, 'reply') THEN
            -- Covers revoked permission, suspended workspace, and any thread
            -- state that is not the CF-1 recruiter-messaging state.
            _outcome := CASE
              WHEN _t.status <> 'active' THEN 'conversation_reply_unavailable'
              ELSE 'conversation_reply_denied'
            END;
          ELSE
            -- Deterministic per Telegram update: a second attempt for the same
            -- update can never create a second message even if it somehow
            -- reached this point.
            _client_message_id :=
              (md5('telegram-reply:' || _update_id::text))::uuid;

            BEGIN
              PERFORM public.conversation_post_message(
                _thread_id, _text, _client_message_id);
              _outcome := 'conversation_reply_sent';
            EXCEPTION
              WHEN insufficient_privilege THEN
                _outcome := 'conversation_reply_denied';
              WHEN invalid_parameter_value THEN
                -- CF-1 length contract (1..4000). Nothing was written.
                _outcome := 'conversation_reply_invalid';
            END;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Same transaction as the CF-1 write above: the Driver-visible message and
  -- its exactly-once receipt commit together or not at all.
  INSERT INTO public.telegram_update_receipts (
    update_id, payload_hash, update_type,
    telegram_user_id, telegram_chat_id, status, result_code
  ) VALUES (
    _update_id, _payload_hash, 'message',
    _telegram_user_id, _telegram_chat_id, 'processed', _outcome
  );

  is_new := true;
  result_code := _outcome;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_process_conversation_reply_update(uuid, bigint, text, bigint, bigint, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_process_conversation_reply_update(uuid, bigint, text, bigint, bigint, text, bigint, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_process_conversation_reply_update(uuid, bigint, text, bigint, bigint, text, bigint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_process_conversation_reply_update(uuid, bigint, text, bigint, bigint, text, bigint, text) TO service_role;

COMMENT ON FUNCTION public.telegram_process_conversation_reply_update(uuid, bigint, text, bigint, bigint, text, bigint, text) IS
  'RB-2C: private-chat Telegram recruiter reply bridge. Service-role only. Resolves the thread ONLY from a bot alert delivered to the acting linked account, re-authorizes against CF-1, and delegates the Driver-visible message to conversation_post_message. Message and terminal receipt share one transaction.';

COMMENT ON COLUMN public.telegram_conversation_alerts.telegram_message_id IS
  'RB-2C: Telegram message id of the delivered alert. Transport identifier only; used as an untrusted reply locator that is re-authorized server-side.';

COMMIT;