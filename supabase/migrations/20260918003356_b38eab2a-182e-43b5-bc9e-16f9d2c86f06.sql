-- Phase RB-2D — Driver HaulTracker message → recruiter Telegram delivery.
--
-- Scope contract:
--   * CF-1 remains the ONLY conversation authority. This migration NEVER
--     writes to conversation_threads / _participants / _messages / _events and
--     never alters their columns, RLS or grants. Eligible work is DERIVED
--     (read-only) from canonical conversation_messages;
--   * the new table is TRANSPORT STATE ONLY — delivery bookkeeping for an
--     outbound Telegram send. It stores no message body and no driver PII;
--     the body is read from canonical conversation_messages at claim time;
--   * NO ECHO: only messages whose sender is exactly the thread's driver are
--     eligible. A recruiter-authored message (web or RB-2C Telegram reply) can
--     never be materialised;
--   * NO HISTORICAL BLAST: only driver messages created strictly AFTER the
--     canonical acceptance timestamp conversation_threads.accepted_at on a
--     thread that is currently 'active';
--   * recipients are exactly the accounts that already received a SENT RB-2A
--     conversation alert for that thread, re-authorized through the canonical
--     CF-1 helper at enqueue time AND again at claim time;
--   * exactly-once with RB-2A.1 ambiguity hardening: only 'pending' rows are
--     claimable. A row left 'claimed' (process died after a possibly
--     successful Telegram send) is NEVER auto-reclaimed;
--   * the confirmed Telegram message id is persisted so a recruiter reply to a
--     delivered driver message resolves back to the SAME thread through the
--     existing RB-2C bridge. A bot message id remains an untrusted locator.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Delivery outbox (transport state only)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.telegram_conversation_message_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_message_id uuid NOT NULL
    REFERENCES public.conversation_messages(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL
    REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_chat_id bigint NULL,
  telegram_message_id bigint NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text NULL,
  claimed_at timestamptz NULL,
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_conversation_message_deliveries_status_check
    CHECK (status = ANY (ARRAY['pending','claimed','sent','failed','skipped'])),
  CONSTRAINT telegram_conversation_message_deliveries_attempts_check
    CHECK (attempts >= 0),
  CONSTRAINT telegram_conversation_message_deliveries_error_code_check
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{3,64}$'),
  CONSTRAINT telegram_conversation_message_deliveries_message_id_positive_check
    CHECK (telegram_message_id IS NULL OR telegram_message_id > 0),
  CONSTRAINT telegram_conversation_message_deliveries_chat_id_nonzero_check
    CHECK (telegram_chat_id IS NULL OR telegram_chat_id <> 0),
  CONSTRAINT telegram_conversation_message_deliveries_idempotency_key
    UNIQUE (conversation_message_id, recipient_user_id)
);

REVOKE ALL ON public.telegram_conversation_message_deliveries FROM PUBLIC;
REVOKE ALL ON public.telegram_conversation_message_deliveries FROM anon;
REVOKE ALL ON public.telegram_conversation_message_deliveries FROM authenticated;
GRANT ALL ON public.telegram_conversation_message_deliveries TO service_role;
ALTER TABLE public.telegram_conversation_message_deliveries
  ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policy: anon/authenticated are denied by default.

CREATE INDEX IF NOT EXISTS idx_telegram_conv_msg_deliveries_pending
  ON public.telegram_conversation_message_deliveries (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_telegram_conv_msg_deliveries_thread
  ON public.telegram_conversation_message_deliveries (thread_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_conv_msg_deliveries_chat_message
  ON public.telegram_conversation_message_deliveries
     (telegram_chat_id, telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_telegram_conv_msg_deliveries_updated_at
  ON public.telegram_conversation_message_deliveries;
CREATE TRIGGER update_telegram_conv_msg_deliveries_updated_at
  BEFORE UPDATE ON public.telegram_conversation_message_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Enqueue + claim (one transaction, SKIP LOCKED, re-checked at claim time)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.telegram_claim_conversation_message_deliveries(
  _limit integer DEFAULT 10
)
RETURNS TABLE(
  delivery_id uuid,
  telegram_chat_id bigint,
  message_body text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _max integer := LEAST(GREATEST(COALESCE(_limit, 10), 1), 25);
  _eligible record;
  _row record;
  _chat_id bigint;
  _body text;
BEGIN
  FOR _eligible IN
    SELECT m.id AS conversation_message_id,
           m.thread_id,
           a.recipient_user_id
      FROM public.conversation_messages m
      JOIN public.conversation_threads th ON th.id = m.thread_id
      JOIN public.telegram_conversation_alerts a
        ON a.thread_id = th.id
       AND a.status = 'sent'
     WHERE th.status = 'active'
       AND th.accepted_at IS NOT NULL
       AND m.created_at > th.accepted_at
       AND m.sender_user_id = th.driver_user_id
       AND m.sender_actor_type = 'driver'
       AND a.recipient_user_id <> th.driver_user_id
       AND NOT EXISTS (
             SELECT 1
               FROM public.telegram_conversation_message_deliveries d
              WHERE d.conversation_message_id = m.id
                AND d.recipient_user_id = a.recipient_user_id)
     ORDER BY m.created_at
     LIMIT _max
  LOOP
    IF public.telegram_user_can_receive_conversation_alert(
         _eligible.recipient_user_id, _eligible.thread_id) THEN
      INSERT INTO public.telegram_conversation_message_deliveries (
        conversation_message_id, thread_id, recipient_user_id
      )
      VALUES (
        _eligible.conversation_message_id, _eligible.thread_id,
        _eligible.recipient_user_id
      )
      ON CONFLICT (conversation_message_id, recipient_user_id) DO NOTHING;
    END IF;
  END LOOP;

  FOR _row IN
    SELECT p.id, p.thread_id, p.recipient_user_id, p.conversation_message_id
      FROM public.telegram_conversation_message_deliveries p
     WHERE p.status = 'pending'
     ORDER BY p.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT _max
  LOOP
    IF NOT public.telegram_user_can_receive_conversation_alert(
         _row.recipient_user_id, _row.thread_id) THEN
      UPDATE public.telegram_conversation_message_deliveries
         SET status = 'skipped', last_error_code = 'not_authorized_at_send'
       WHERE id = _row.id;
      CONTINUE;
    END IF;

    SELECT l.telegram_user_id INTO _chat_id
      FROM public.telegram_user_links l
     WHERE l.user_id = _row.recipient_user_id
       AND l.status = 'active';

    IF _chat_id IS NULL THEN
      UPDATE public.telegram_conversation_message_deliveries
         SET status = 'skipped', last_error_code = 'telegram_link_inactive'
       WHERE id = _row.id;
      CONTINUE;
    END IF;

    SELECT m.body INTO _body
      FROM public.conversation_messages m
     WHERE m.id = _row.conversation_message_id;

    IF _body IS NULL OR btrim(_body) = '' THEN
      UPDATE public.telegram_conversation_message_deliveries
         SET status = 'skipped', last_error_code = 'message_unavailable'
       WHERE id = _row.id;
      CONTINUE;
    END IF;

    UPDATE public.telegram_conversation_message_deliveries
       SET status = 'claimed',
           attempts = attempts + 1,
           claimed_at = now(),
           telegram_chat_id = _chat_id
     WHERE id = _row.id;

    delivery_id := _row.id;
    telegram_chat_id := _chat_id;
    message_body := _body;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_claim_conversation_message_deliveries(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_claim_conversation_message_deliveries(integer) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_claim_conversation_message_deliveries(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_claim_conversation_message_deliveries(integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Terminal delivery transitions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.telegram_mark_conversation_message_delivery_sent(
  _delivery_id uuid,
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
  IF _delivery_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.telegram_conversation_message_deliveries
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
   WHERE id = _delivery_id
     AND status = 'claimed';

  GET DIAGNOSTICS _updated = ROW_COUNT;
  RETURN _updated = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_mark_conversation_message_delivery_sent(uuid, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_mark_conversation_message_delivery_sent(uuid, bigint, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_mark_conversation_message_delivery_sent(uuid, bigint, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_mark_conversation_message_delivery_sent(uuid, bigint, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_mark_conversation_message_delivery_failed(
  _delivery_id uuid,
  _error_code text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  _clean text;
  _status text;
BEGIN
  IF _delivery_id IS NULL THEN
    RETURN NULL;
  END IF;

  _clean := CASE
    WHEN COALESCE(_error_code, '') ~ '^[a-z0-9_]{3,64}$' THEN _error_code
    ELSE 'telegram_send_failed'
  END;

  UPDATE public.telegram_conversation_message_deliveries
     SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
         last_error_code = _clean,
         claimed_at = NULL
   WHERE id = _delivery_id
     AND status = 'claimed'
  RETURNING status INTO _status;

  RETURN _status;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_mark_conversation_message_delivery_failed(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_mark_conversation_message_delivery_failed(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_mark_conversation_message_delivery_failed(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_mark_conversation_message_delivery_failed(uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RB-2C reply bridge — one additional safe locator source
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
  ELSIF _chat_type IS DISTINCT FROM 'private' THEN
    _outcome := 'conversation_reply_denied';
  ELSE
    SELECT l.user_id, l.telegram_user_id INTO _actor_user_id, _linked_chat_id
      FROM public.telegram_user_links l
     WHERE l.telegram_user_id = _telegram_user_id
       AND l.status = 'active';

    IF _actor_user_id IS NULL THEN
      _outcome := 'conversation_reply_denied';
    ELSIF _linked_chat_id IS DISTINCT FROM _telegram_chat_id THEN
      _outcome := 'conversation_reply_denied';
    ELSE
      -- Locator source 1 (RB-2A/RB-2C): the original conversation alert.
      SELECT a.thread_id INTO _thread_id
        FROM public.telegram_conversation_alerts a
       WHERE a.recipient_user_id = _actor_user_id
         AND a.telegram_chat_id = _telegram_chat_id
         AND a.telegram_message_id = _reply_to_message_id
         AND a.status = 'sent';

      -- Locator source 2 (RB-2D): a delivered driver message.
      IF _thread_id IS NULL THEN
        SELECT d.thread_id INTO _thread_id
          FROM public.telegram_conversation_message_deliveries d
         WHERE d.recipient_user_id = _actor_user_id
           AND d.telegram_chat_id = _telegram_chat_id
           AND d.telegram_message_id = _reply_to_message_id
           AND d.status = 'sent';
      END IF;

      IF _thread_id IS NULL THEN
        _outcome := 'conversation_reply_unroutable';
      ELSE
        SELECT * INTO _t FROM public.conversation_threads WHERE id = _thread_id;

        IF NOT FOUND OR _t.driver_user_id = _actor_user_id THEN
          _outcome := 'conversation_reply_denied';
        ELSE
          PERFORM pg_catalog.set_config(
            'request.jwt.claim.sub', _actor_user_id::text, true);

          IF NOT public.current_user_can_conversation_action(_thread_id, 'reply') THEN
            _outcome := CASE
              WHEN _t.status <> 'active' THEN 'conversation_reply_unavailable'
              ELSE 'conversation_reply_denied'
            END;
          ELSE
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
                _outcome := 'conversation_reply_invalid';
            END;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

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

COMMENT ON TABLE public.telegram_conversation_message_deliveries IS
  'RB-2D: outbound Telegram delivery state for canonical CF-1 driver messages. Service-role only; stores no message body and no driver PII; at-most-once after a confirmed Telegram send; a stale claimed row is never auto-reclaimed.';

COMMIT;