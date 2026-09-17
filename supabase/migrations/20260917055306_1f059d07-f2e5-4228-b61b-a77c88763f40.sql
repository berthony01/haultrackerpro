BEGIN;

ALTER TABLE public.telegram_update_receipts
  DROP CONSTRAINT telegram_update_receipts_result_code_check;

ALTER TABLE public.telegram_update_receipts
  ADD CONSTRAINT telegram_update_receipts_result_code_check
  CHECK (result_code = ANY (ARRAY[
    'link_success',
    'link_rejected',
    'non_private_message',
    'non_start_message',
    'invalid_start_command',
    'invalid_update_shape',
    'bind_success',
    'bind_rejected'
  ]));

CREATE FUNCTION public.telegram_process_bind_update(
  _lease_token uuid,
  _update_id bigint,
  _payload_hash text,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text,
  _raw_token text
)
RETURNS TABLE(is_new boolean, result_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  _existing public.telegram_update_receipts%ROWTYPE;
  _outcome text;
  _sqlstate text;
  _message text;
BEGIN
  IF _update_id IS NULL
     OR _update_id <= 0
     OR _payload_hash IS NULL
     OR _payload_hash !~ '^[0-9a-f]{64}$'
     OR _telegram_user_id IS NULL
     OR _telegram_user_id <= 0
     OR _telegram_chat_id IS NULL
     OR _telegram_chat_id = 0
     OR _chat_type IS NULL
     OR _chat_type NOT IN ('group', 'supergroup')
     OR _raw_token IS NULL
     OR _raw_token !~ '^[0-9a-f]{64}$' THEN
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
       AND _existing.result_code = ANY (ARRAY['bind_success','bind_rejected']) THEN
      is_new := false;
      result_code := _existing.result_code;
      RETURN NEXT;
      RETURN;
    END IF;

    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  BEGIN
    PERFORM public.consume_telegram_dispatch_bind_token(
      _telegram_user_id,
      _telegram_chat_id,
      _chat_type,
      _raw_token
    );
    _outcome := 'bind_success';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        _sqlstate = RETURNED_SQLSTATE,
        _message  = MESSAGE_TEXT;

      IF _sqlstate = 'P0001' AND _message = ANY (ARRAY[
           'telegram_dispatch_bind_invalid_input',
           'telegram_dispatch_bind_token_invalid',
           'telegram_bind_invalid_input',
           'telegram_actor_not_linked',
           'telegram_workspace_not_available',
           'telegram_dispatch_not_authorized',
           'telegram_chat_already_bound',
           'telegram_chat_bind_conflict'
         ]) THEN
        _outcome := 'bind_rejected';
      ELSE
        RAISE;
      END IF;
  END;

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
$$;

REVOKE ALL ON FUNCTION public.telegram_process_bind_update(uuid, bigint, text, bigint, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_process_bind_update(uuid, bigint, text, bigint, bigint, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_process_bind_update(uuid, bigint, text, bigint, bigint, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_process_bind_update(uuid, bigint, text, bigint, bigint, text, text) TO service_role;

COMMIT;