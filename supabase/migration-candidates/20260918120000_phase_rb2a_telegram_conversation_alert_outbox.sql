-- CANDIDATE MIGRATION — Phase RB-2A.
-- Recruiter Telegram conversation alert foundation (durable outbound outbox).
--
-- Scope contract:
--   * additive only — ONE new table plus four service-role-only functions;
--   * the CF-1 conversation system stays the single source of truth: this
--     migration NEVER writes to conversation_threads / _participants /
--     _messages / _events and never alters their RLS, grants or columns;
--   * eligible work is DERIVED (read-only) from the existing CF-1 'requested'
--     conversation event — conversation_events is not overloaded as an outbox;
--   * recruiter authority is re-resolved through the canonical CF-1 helpers
--     (recruiter_profile_can_manage_opportunities +
--      current_user_has_recruiter_permission + current_user_can_conversation_action)
--     at enqueue time AND again at claim time. No parallel ownership model;
--   * the outbox carries NO driver PII: thread / recruiter / recipient ids and
--     delivery state only. The alert body is composed by the Edge Function
--     from the opportunity title, which the recruiter can already see;
--   * at-most-once-after-success: a row reaches 'sent' only after Telegram
--     confirms. A transient failure returns it to 'pending' for retry;
--   * nothing here can create, close, or otherwise mutate a conversation.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Outbox table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.telegram_conversation_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text NULL,
  claimed_at timestamptz NULL,
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_conversation_alerts_kind_check
    CHECK (notification_kind = 'conversation_requested'),
  CONSTRAINT telegram_conversation_alerts_status_check
    CHECK (status = ANY (ARRAY['pending','claimed','sent','failed','skipped'])),
  CONSTRAINT telegram_conversation_alerts_attempts_check
    CHECK (attempts >= 0),
  CONSTRAINT telegram_conversation_alerts_error_code_check
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{3,64}$'),
  -- Durable at-most-once identity: one alert per thread + recipient + kind.
  CONSTRAINT telegram_conversation_alerts_idempotency_key
    UNIQUE (thread_id, recipient_user_id, notification_kind)
);

-- Internal delivery state. No end-user role may read or write it; the poller
-- reaches it exclusively through the service-role RPCs below.
REVOKE ALL ON public.telegram_conversation_alerts FROM PUBLIC;
REVOKE ALL ON public.telegram_conversation_alerts FROM anon;
REVOKE ALL ON public.telegram_conversation_alerts FROM authenticated;
GRANT ALL ON public.telegram_conversation_alerts TO service_role;
ALTER TABLE public.telegram_conversation_alerts ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policy: anon/authenticated are denied by default.

CREATE INDEX IF NOT EXISTS idx_telegram_conversation_alerts_pending
  ON public.telegram_conversation_alerts (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_telegram_conversation_alerts_thread
  ON public.telegram_conversation_alerts (thread_id, notification_kind);

DROP TRIGGER IF EXISTS update_telegram_conversation_alerts_updated_at
  ON public.telegram_conversation_alerts;
CREATE TRIGGER update_telegram_conversation_alerts_updated_at
  BEFORE UPDATE ON public.telegram_conversation_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Recipient authorization — reuses the CF-1 authority, never replaces it
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Resolves the candidate recipient's own authority by binding the request
-- identity locally (the RB-1A precedent) and then asking the SAME canonical
-- helpers the web app is governed by. Driver-side identity is excluded, so a
-- driver can never be a recipient, and an admin-only viewer can never be one
-- either because the recruiter workspace permission is required explicitly.
CREATE OR REPLACE FUNCTION public.telegram_user_can_receive_conversation_alert(
  _user_id uuid,
  _thread_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _t public.conversation_threads%ROWTYPE;
BEGIN
  IF _user_id IS NULL OR _thread_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO _t FROM public.conversation_threads WHERE id = _thread_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Recruiter side only. The driver is never a Telegram alert recipient.
  IF _t.driver_user_id = _user_id THEN
    RETURN false;
  END IF;

  IF _t.status NOT IN ('requested', 'active') THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', _user_id::text, true);

  RETURN COALESCE(
    public.recruiter_profile_can_manage_opportunities(_t.recruiter_id)
    AND public.current_user_has_recruiter_permission(
          _t.recruiter_id, 'conversations_view'::public.recruiter_workspace_permission)
    AND public.current_user_can_conversation_action(_thread_id, 'view'),
    false);
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_user_can_receive_conversation_alert(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_user_can_receive_conversation_alert(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_user_can_receive_conversation_alert(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_user_can_receive_conversation_alert(uuid, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Enqueue + claim (one transaction, SKIP LOCKED, re-checked at claim time)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.telegram_claim_conversation_alerts(
  _limit integer DEFAULT 10
)
RETURNS TABLE(alert_id uuid, telegram_chat_id bigint, opportunity_title text)
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
  -- 3a. Derive eligible work from the EXISTING CF-1 'requested' event. This is
  -- a pure read of the conversation system; no conversation row is written.
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

  -- 3b. Claim pending work. Authorization and Telegram linkage are re-resolved
  -- HERE, at send time, so stale enqueued state can never leak an alert.
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
      -- Unlinked recruiter: no Telegram send. The conversation is untouched
      -- and remains fully available in HaulTracker Pro.
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
-- 4. Terminal delivery transitions
-- ─────────────────────────────────────────────────────────────────────────────

-- Only a CONFIRMED Telegram success may reach 'sent'.
CREATE OR REPLACE FUNCTION public.telegram_mark_conversation_alert_sent(_alert_id uuid)
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
     SET status = 'sent', sent_at = now(), last_error_code = NULL
   WHERE id = _alert_id
     AND status = 'claimed';

  GET DIAGNOSTICS _updated = ROW_COUNT;
  RETURN _updated = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_mark_conversation_alert_sent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_mark_conversation_alert_sent(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_mark_conversation_alert_sent(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_mark_conversation_alert_sent(uuid) TO service_role;

-- A failed send returns the row to 'pending' so the next cycle retries it, and
-- gives up only after a bounded number of attempts. It never marks delivery.
CREATE OR REPLACE FUNCTION public.telegram_mark_conversation_alert_failed(
  _alert_id uuid,
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
  IF _alert_id IS NULL THEN
    RETURN NULL;
  END IF;

  _clean := CASE
    WHEN COALESCE(_error_code, '') ~ '^[a-z0-9_]{3,64}$' THEN _error_code
    ELSE 'telegram_send_failed'
  END;

  UPDATE public.telegram_conversation_alerts
     SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
         last_error_code = _clean,
         claimed_at = NULL
   WHERE id = _alert_id
     AND status = 'claimed'
  RETURNING status INTO _status;

  RETURN _status;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_mark_conversation_alert_failed(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_mark_conversation_alert_failed(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_mark_conversation_alert_failed(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_mark_conversation_alert_failed(uuid, text) TO service_role;

COMMENT ON TABLE public.telegram_conversation_alerts IS
  'RB-2A: outbound Telegram alert outbox for existing CF-1 conversations. Service-role only; carries no driver PII; at-most-once after a confirmed Telegram send.';

COMMIT;
