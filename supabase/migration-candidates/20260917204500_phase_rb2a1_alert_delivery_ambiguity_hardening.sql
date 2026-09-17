-- ─────────────────────────────────────────────────────────────────────────────
-- Phase RB-2A.1 — alert delivery ambiguity hardening.
--
-- Defect corrected: the RB-2A claim RPC also re-claimed rows left in 'claimed'
-- for more than 10 minutes. Telegram may have already delivered such a row
-- (send succeeded, the process died before mark_sent), so an automatic re-claim
-- could resend a message that was in fact delivered. That contradicts the
-- at-most-once contract.
--
-- Correction: the send path claims ONLY 'pending' rows. A row whose delivery
-- outcome is UNKNOWN stays 'claimed' forever and is never sent again
-- automatically — fail closed. It is not silently marked sent or pending.
--
-- KNOWN failures are unaffected: telegram_mark_conversation_alert_failed still
-- returns a claimed row to 'pending' (bounded by max attempts), and only a
-- CONFIRMED Telegram success reaches 'sent'.
--
-- Deliberately NO reconciliation function is added. A stale 'claimed' row is
-- already fully observable through direct service-role inspection of
-- telegram_conversation_alerts, and any resolution of an ambiguous delivery is
-- a human judgement call, not something a scheduled job should decide. Adding a
-- resolver would be new unproven machinery for a state that currently cannot
-- occur (0 outbox rows) and would only create another path near the delivery
-- contract. Reconciliation NEVER sends, by construction: nothing but the claim
-- RPC produces send work, and it now only sees 'pending'.
--
-- Scope: replaces exactly one function body. No table shape, RLS, ACL,
-- vocabulary, conversation, permission, or Telegram-linking change.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

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

COMMIT;
