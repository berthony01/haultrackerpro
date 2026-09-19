-- Phase RB-3B-B.1 — Quick Post created opportunity ID parity hotfix
-- The canonical creator returns JSON key `opportunity_id`; RB-3B-B's action
-- RPC incorrectly read `id`, leaving telegram_opportunity_drafts.created_opportunity_id NULL.
-- No confirmed Quick Post drafts existed when this hotfix was applied, so no backfill was required.

CREATE OR REPLACE FUNCTION public.telegram_process_quick_post_action_update(_lease_token uuid, _update_id bigint, _payload_hash text, _telegram_user_id bigint, _telegram_chat_id bigint, _chat_type text, _action text, _draft_id uuid)
 RETURNS TABLE(is_new boolean, result_code text, draft_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _existing public.telegram_update_receipts%ROWTYPE;
  _draft public.telegram_opportunity_drafts%ROWTYPE;
  _actor_user_id uuid;
  _linked_chat_id bigint;
  _recruiter_id uuid;
  _payload jsonb;
  _created jsonb;
  _outcome text;
  _draft_out uuid;
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
    SELECT 1 FROM public.telegram_poll_state s
     WHERE s.id = 1 AND s.lease_token = _lease_token AND s.lease_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'telegram_poll_lease_invalid';
  END IF;

  -- Exactly-once. A duplicate delivery of the same callback update returns the
  -- ALREADY RECORDED outcome and can never create a second opportunity, nor
  -- re-send a refreshed review.
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
             'quick_post_started',
             'quick_post_denied',
             'quick_post_unavailable',
             'quick_post_created',
             'quick_post_already_completed',
             'quick_post_create_blocked',
             'quick_post_cancelled',
             'quick_post_restarted',
             'quick_post_review_refreshed',
             'quick_post_action_invalid',
             'quick_post_action_denied',
             'quick_post_action_unavailable'
           ]) THEN
      is_new := false;
      result_code := _existing.result_code;
      draft_id := NULL;
      RETURN NEXT;
      RETURN;
    END IF;

    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  IF _action IS NULL
     OR _action NOT IN ('new', 'confirm', 'restart', 'cancel', 'refresh')
     OR (_action <> 'new' AND _draft_id IS NULL) THEN
    _outcome := 'quick_post_action_invalid';
  ELSIF _chat_type IS DISTINCT FROM 'private' THEN
    _outcome := 'quick_post_action_denied';
  ELSE
    SELECT l.user_id, l.telegram_user_id INTO _actor_user_id, _linked_chat_id
      FROM public.telegram_user_links l
     WHERE l.telegram_user_id = _telegram_user_id
       AND l.status = 'active';

    IF _actor_user_id IS NULL OR _linked_chat_id IS DISTINCT FROM _telegram_chat_id THEN
      _outcome := 'quick_post_action_denied';
    ELSE
      _recruiter_id := public._telegram_quick_post_recruiter(_telegram_user_id);

      IF _recruiter_id IS NULL THEN
        _outcome := 'quick_post_unavailable';

      ELSIF _action = 'new' THEN
        UPDATE public.telegram_opportunity_drafts d
           SET state = 'cancelled'
         WHERE d.telegram_user_id = _telegram_user_id
           AND d.telegram_chat_id = _telegram_chat_id
           AND d.state = ANY (ARRAY['awaiting_input', 'extracting', 'review']);

        INSERT INTO public.telegram_opportunity_drafts (
          actor_user_id, recruiter_id, telegram_user_id, telegram_chat_id, state
        ) VALUES (
          _actor_user_id, _recruiter_id, _telegram_user_id, _telegram_chat_id,
          'awaiting_input'
        )
        RETURNING id INTO _draft_out;

        _outcome := 'quick_post_started';

      ELSE
        -- The callback draft id is an UNTRUSTED locator: a copied payload from
        -- another account or chat resolves to nothing.
        SELECT * INTO _draft
          FROM public.telegram_opportunity_drafts d
         WHERE d.id = _draft_id
           AND d.actor_user_id = _actor_user_id
           AND d.telegram_user_id = _telegram_user_id
           AND d.telegram_chat_id = _telegram_chat_id
         FOR UPDATE;

        IF NOT FOUND OR _draft.recruiter_id IS DISTINCT FROM _recruiter_id THEN
          _outcome := 'quick_post_action_denied';

        ELSIF _draft.state = 'confirmed' THEN
          -- Terminal. Repeated Confirm / Cancel / Start Over / Refresh after
          -- success is reported as already completed and mutates nothing.
          _outcome := 'quick_post_already_completed';
          _draft_out := _draft.id;

        ELSIF _action = 'cancel' THEN
          UPDATE public.telegram_opportunity_drafts
             SET state = 'cancelled'
           WHERE id = _draft.id
             AND state <> 'confirmed';
          _outcome := 'quick_post_cancelled';
          _draft_out := _draft.id;

        ELSIF _action = 'restart' THEN
          UPDATE public.telegram_opportunity_drafts
             SET state = 'awaiting_input',
                 raw_source_text = NULL,
                 extracted_payload = NULL,
                 source_update_id = NULL,
                 last_error_code = NULL,
                 created_opportunity_id = NULL
           WHERE id = _draft.id
             AND state <> 'confirmed';
          _outcome := 'quick_post_restarted';
          _draft_out := _draft.id;

        ELSIF _draft.state <> 'review' OR _draft.expires_at <= now() THEN
          _outcome := 'quick_post_action_unavailable';
          _draft_out := _draft.id;

        ELSIF _action = 'refresh' THEN
          -- RB-3B-B. Read-only re-render of the CURRENT payload after a web
          -- edit. No model call, no opportunity mutation, no draft mutation.
          _outcome := 'quick_post_review_refreshed';
          _draft_out := _draft.id;

        ELSE
          _payload := public._telegram_quick_post_filter_payload(_draft.extracted_payload);

          IF COALESCE(btrim(_payload->>'title'), '') = ''
             OR COALESCE(btrim(_payload->>'company_name'), '') = '' THEN
            -- Required canonical fields were not provided. Nothing is created
            -- and the draft stays reviewable.
            UPDATE public.telegram_opportunity_drafts
               SET last_error_code = 'required_fields_missing'
             WHERE id = _draft.id;
            _outcome := 'quick_post_create_blocked';
            _draft_out := _draft.id;
          ELSE
            BEGIN
              -- The ONE canonical creation path. No direct INSERT here, ever.
              _created := public.create_recruiter_opportunity_as_actor(
                _draft.actor_user_id, _draft.recruiter_id, _payload
              );

              UPDATE public.telegram_opportunity_drafts
                 SET state = 'confirmed',
                     created_opportunity_id = (_created->>'opportunity_id')::uuid,
                     last_error_code = NULL
               WHERE id = _draft.id
                 AND state = 'review';

              _outcome := 'quick_post_created';
              _draft_out := _draft.id;
            EXCEPTION
              WHEN OTHERS THEN
                -- Entitlement / active-limit / validation refusal. Nothing was
                -- written; the draft remains in a safe reviewable state and the
                -- provider message is never surfaced.
                UPDATE public.telegram_opportunity_drafts
                   SET last_error_code = 'create_rejected'
                 WHERE id = _draft.id;
                _outcome := 'quick_post_create_blocked';
                _draft_out := _draft.id;
            END;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Same transaction as the canonical creation above: the opportunity and its
  -- exactly-once receipt commit together or not at all.
  INSERT INTO public.telegram_update_receipts (
    update_id, payload_hash, update_type,
    telegram_user_id, telegram_chat_id, status, result_code
  ) VALUES (
    _update_id, _payload_hash, 'callback_query',
    _telegram_user_id, _telegram_chat_id, 'processed', _outcome
  );

  is_new := true;
  result_code := _outcome;
  draft_id := _draft_out;
  RETURN NEXT;
END;
$function$;
