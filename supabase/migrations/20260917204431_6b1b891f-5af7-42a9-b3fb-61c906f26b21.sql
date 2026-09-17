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