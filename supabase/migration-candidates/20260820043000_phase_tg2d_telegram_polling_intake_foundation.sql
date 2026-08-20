-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase TG-2D — Telegram server adapter + polling intake foundation.
--
-- Scope: exactly two new public tables and exactly five SECURITY DEFINER RPCs
-- that make Lovable-gateway `getUpdates` polling correct and replay-safe.
-- Nothing here creates a load, updates a load status, binds a chat, or calls
-- any TG-1 / TG-2C dispatch object.
--
-- ARCHITECTURAL RULINGS (ChatGPT, TG-2D):
--   * Lovable's Telegram app+chat connector does NOT support incoming
--     webhooks. The supported receive path is `getUpdates` polling through the
--     Lovable connector gateway, so TG-2D needs a DURABLE POLL CURSOR in
--     addition to per-update replay protection. A webhook-only design would
--     have needed only the latter.
--   * The cursor is a SINGLETON row, not a per-scope table: HaulTracker Pro
--     will own exactly ONE dedicated Telegram bot/connection. There is
--     deliberately no caller-supplied scope parameter through which two bots
--     could be conflated or one poller could address another's cursor.
--   * Telegram invalidates a prior `getUpdates` when a later one arrives for
--     the same bot, so two concurrent pollers are a CORRECTNESS defect, not
--     merely wasted work. A short lease (90s) serialises pollers; a lease is
--     never STOLEN, only allowed to expire, so a slow-but-live poller can
--     never have its cursor advanced underneath it.
--   * The cursor may only ever advance to an update that already holds a
--     TERMINAL receipt. This is enforced in the database, not in the
--     orchestrator, so a buggy or malicious caller cannot skip an update.
--   * This ledger is the WEBHOOK-DOOR ledger described in TG-2A. It is
--     deliberately NOT `dispatch_command_receipts`: that one is command-level
--     and only fires AFTER authorization succeeds, whereas this one must fire
--     for every update that ever entered the door, including the ones that
--     were rejected or ignored.
--
-- Deliberately NOT in this candidate:
--   * ZERO chat-binding, load, status, or dispatch RPCs;
--   * ZERO changes to TG-1 (`dispatch_create_driver_load`,
--     `dispatch_update_driver_load_status`, `dispatch_command_receipts`),
--     TG-2B, or TG-2C objects, grants, or policies;
--   * ZERO webhook URL, `setWebhook`, bot token, secret, or connector object;
--   * ZERO update types other than `message`.
--
-- Privacy properties enforced below:
--   * the receipt ledger stores NO raw update JSON, NO message text, NO link
--     token, and NO Telegram username / title / display name / phone. Only a
--     SHA-256 digest of the update, the numeric ids, and a fixed-vocabulary
--     outcome are retained, so a database read can neither reconstruct the
--     message nor replay the link challenge;
--   * every failure raises a FIXED machine-readable message; raw Postgres
--     error text is never surfaced to the caller.
--
-- This candidate intentionally does NOT use CREATE OR REPLACE or DROP: a
-- re-apply must fail loudly rather than silently replace a function that
-- gates account linking.

BEGIN;

-- ---------------------------------------------------------------------------
-- A1. public.telegram_poll_state — singleton cursor + poller lease
-- ---------------------------------------------------------------------------
CREATE TABLE public.telegram_poll_state (
  id smallint PRIMARY KEY DEFAULT 1,
  last_confirmed_update_id bigint NOT NULL DEFAULT 0,
  lease_token uuid NULL,
  lease_expires_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_poll_state_singleton_check
    CHECK (id = 1),
  CONSTRAINT telegram_poll_state_cursor_nonnegative_check
    CHECK (last_confirmed_update_id >= 0),
  CONSTRAINT telegram_poll_state_lease_shape_check
    CHECK (
      (lease_token IS NULL AND lease_expires_at IS NULL)
      OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    )
);

-- The singleton exists from the moment the foundation is applied, so the
-- claim RPC never has to create it and can always take a plain row lock.
INSERT INTO public.telegram_poll_state (id, last_confirmed_update_id)
VALUES (1, 0);

-- ---------------------------------------------------------------------------
-- A2. public.telegram_update_receipts — terminal, privacy-minimal ledger
-- ---------------------------------------------------------------------------
-- There is deliberately no payload / text / token / username / title / name /
-- phone column anywhere in this table.
CREATE TABLE public.telegram_update_receipts (
  update_id bigint PRIMARY KEY,
  payload_hash text NOT NULL,
  update_type text NOT NULL,
  telegram_user_id bigint NULL,
  telegram_chat_id bigint NULL,
  status text NOT NULL,
  result_code text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_update_receipts_update_id_positive_check
    CHECK (update_id > 0),
  CONSTRAINT telegram_update_receipts_payload_hash_format_check
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT telegram_update_receipts_update_type_check
    CHECK (update_type = 'message'),
  CONSTRAINT telegram_update_receipts_telegram_user_id_positive_check
    CHECK (telegram_user_id IS NULL OR telegram_user_id > 0),
  CONSTRAINT telegram_update_receipts_telegram_chat_id_nonzero_check
    CHECK (telegram_chat_id IS NULL OR telegram_chat_id <> 0),
  CONSTRAINT telegram_update_receipts_status_check
    CHECK (status = ANY (ARRAY['processed','ignored'])),
  CONSTRAINT telegram_update_receipts_result_code_check
    CHECK (result_code = ANY (ARRAY[
      'link_success',
      'link_rejected',
      'non_private_message',
      'non_start_message',
      'invalid_start_command',
      'invalid_update_shape'
    ]))
);

-- ---------------------------------------------------------------------------
-- A3. RLS + direct table privileges — service_role only, zero client surface
-- ---------------------------------------------------------------------------
ALTER TABLE public.telegram_poll_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_update_receipts ENABLE ROW LEVEL SECURITY;

-- Zero policies are created for either table on purpose: the web app has no
-- business reading a poll cursor or a per-update ledger, and RLS with no
-- policy is the strongest possible default.
REVOKE ALL ON TABLE public.telegram_poll_state FROM PUBLIC;
REVOKE ALL ON TABLE public.telegram_poll_state FROM anon;
REVOKE ALL ON TABLE public.telegram_poll_state FROM authenticated;
GRANT ALL ON TABLE public.telegram_poll_state TO service_role;

REVOKE ALL ON TABLE public.telegram_update_receipts FROM PUBLIC;
REVOKE ALL ON TABLE public.telegram_update_receipts FROM anon;
REVOKE ALL ON TABLE public.telegram_update_receipts FROM authenticated;
GRANT ALL ON TABLE public.telegram_update_receipts TO service_role;

-- ---------------------------------------------------------------------------
-- B1. telegram_claim_poll_lease() — serialise pollers
-- ---------------------------------------------------------------------------
-- Returns ZERO rows when another poller holds a live lease. Returning no row
-- rather than raising lets the caller treat "busy" as a clean no-op tick.
CREATE FUNCTION public.telegram_claim_poll_lease()
RETURNS TABLE(lease_token uuid, next_offset bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  _state public.telegram_poll_state%ROWTYPE;
  _token uuid;
BEGIN
  SELECT * INTO _state
    FROM public.telegram_poll_state s
   WHERE s.id = 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A live lease is never stolen. The holder may still be mid-batch, and
  -- stealing would let two pollers advance the same cursor.
  IF _state.lease_token IS NOT NULL AND _state.lease_expires_at > now() THEN
    RETURN;
  END IF;

  _token := gen_random_uuid();

  UPDATE public.telegram_poll_state s
     SET lease_token = _token,
         lease_expires_at = now() + interval '90 seconds',
         updated_at = now()
   WHERE s.id = 1;

  lease_token := _token;
  next_offset := _state.last_confirmed_update_id + 1;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_claim_poll_lease() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_claim_poll_lease() FROM anon;
REVOKE ALL ON FUNCTION public.telegram_claim_poll_lease() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_claim_poll_lease() TO service_role;

-- ---------------------------------------------------------------------------
-- B2. telegram_release_poll_lease(_lease_token)
-- ---------------------------------------------------------------------------
-- Releasing an EXPIRED but still-matching token is permitted: a slow poller
-- finishing late should tidy up its own lease rather than leave it pinned.
CREATE FUNCTION public.telegram_release_poll_lease(_lease_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  _released integer := 0;
BEGIN
  IF _lease_token IS NULL THEN
    RETURN false;
  END IF;

  WITH cleared AS (
    UPDATE public.telegram_poll_state s
       SET lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE s.id = 1
       AND s.lease_token = _lease_token
    RETURNING s.id
  )
  SELECT count(*) INTO _released FROM cleared;

  RETURN _released > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_release_poll_lease(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_release_poll_lease(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_release_poll_lease(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_release_poll_lease(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- B3. telegram_advance_poll_cursor(_lease_token, _last_update_id)
-- ---------------------------------------------------------------------------
-- The single most important invariant in TG-2D: the cursor may only move to an
-- update that ALREADY has a terminal receipt. Enforced here, in the database,
-- so no orchestrator bug can silently drop a Telegram update.
CREATE FUNCTION public.telegram_advance_poll_cursor(
  _lease_token uuid,
  _last_update_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  _state public.telegram_poll_state%ROWTYPE;
BEGIN
  IF _last_update_id IS NULL OR _last_update_id <= 0 THEN
    RAISE EXCEPTION 'telegram_poll_cursor_invalid';
  END IF;

  SELECT * INTO _state
    FROM public.telegram_poll_state s
   WHERE s.id = 1
   FOR UPDATE;

  IF NOT FOUND
     OR _lease_token IS NULL
     OR _state.lease_token IS NULL
     OR _state.lease_token <> _lease_token
     OR _state.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'telegram_poll_lease_invalid';
  END IF;

  IF _last_update_id < _state.last_confirmed_update_id THEN
    RAISE EXCEPTION 'telegram_poll_cursor_regression';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.telegram_update_receipts r
    WHERE r.update_id = _last_update_id
      AND r.status = ANY (ARRAY['processed','ignored'])
  ) THEN
    RAISE EXCEPTION 'telegram_poll_update_not_terminal';
  END IF;

  -- Re-advancing to the SAME id is idempotent, so a retried tail call after a
  -- network blip cannot regress or double-count.
  UPDATE public.telegram_poll_state s
     SET last_confirmed_update_id = _last_update_id,
         lease_expires_at = now() + interval '90 seconds',
         updated_at = now()
   WHERE s.id = 1;

  RETURN _last_update_id;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_advance_poll_cursor(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_advance_poll_cursor(uuid, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_advance_poll_cursor(uuid, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_advance_poll_cursor(uuid, bigint) TO service_role;


-- ---------------------------------------------------------------------------
-- C1. telegram_record_ignored_update(...)
-- ---------------------------------------------------------------------------
-- Replay protection is EXACT-MATCH: a repeat of the identical update is a
-- benign duplicate, but the SAME update_id carrying a DIFFERENT payload hash,
-- identity, or outcome is a conflict and fails closed rather than overwriting
-- history.
CREATE FUNCTION public.telegram_record_ignored_update(
  _lease_token uuid,
  _update_id bigint,
  _payload_hash text,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _result_code text
)
RETURNS TABLE(is_new boolean, result_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  _existing public.telegram_update_receipts%ROWTYPE;
BEGIN
  IF _update_id IS NULL
     OR _update_id <= 0
     OR _payload_hash IS NULL
     OR _payload_hash !~ '^[0-9a-f]{64}$'
     OR (_telegram_user_id IS NOT NULL AND _telegram_user_id <= 0)
     OR (_telegram_chat_id IS NOT NULL AND _telegram_chat_id = 0)
     OR _result_code IS NULL
     OR _result_code <> ALL (ARRAY[
          'non_private_message',
          'non_start_message',
          'invalid_start_command',
          'invalid_update_shape'
        ]) THEN
    RAISE EXCEPTION 'telegram_update_invalid';
  END IF;

  PERFORM public._telegram_assert_poll_lease(_lease_token);

  SELECT * INTO _existing
    FROM public.telegram_update_receipts r
   WHERE r.update_id = _update_id
   FOR UPDATE;

  IF FOUND THEN
    IF _existing.payload_hash = _payload_hash
       AND _existing.update_type = 'message'
       AND _existing.telegram_user_id IS NOT DISTINCT FROM _telegram_user_id
       AND _existing.telegram_chat_id IS NOT DISTINCT FROM _telegram_chat_id
       AND _existing.status = 'ignored'
       AND _existing.result_code = _result_code THEN
      is_new := false;
      result_code := _existing.result_code;
      RETURN NEXT;
      RETURN;
    END IF;

    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  INSERT INTO public.telegram_update_receipts (
    update_id, payload_hash, update_type,
    telegram_user_id, telegram_chat_id, status, result_code
  ) VALUES (
    _update_id, _payload_hash, 'message',
    _telegram_user_id, _telegram_chat_id, 'ignored', _result_code
  );

  is_new := true;
  result_code := _result_code;
  RETURN NEXT;
EXCEPTION
  WHEN unique_violation THEN
    -- A concurrent poller inserted the same update_id first. Fail closed
    -- rather than guessing whether the two payloads agreed.
    RAISE EXCEPTION 'telegram_update_conflict';
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_record_ignored_update(uuid, bigint, text, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_record_ignored_update(uuid, bigint, text, bigint, bigint, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_record_ignored_update(uuid, bigint, text, bigint, bigint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_record_ignored_update(uuid, bigint, text, bigint, bigint, text) TO service_role;

-- ---------------------------------------------------------------------------
-- C2. telegram_process_start_update(...)
-- ---------------------------------------------------------------------------
-- The link consume and its receipt are written in ONE transaction. That is the
-- whole point: a link that succeeded must never be re-consumable, and a link
-- that failed for an unexpected reason must leave NO receipt so the poller
-- retries it rather than burning the user's challenge.
--
-- `_raw_token` is a parameter only. It is never inserted, never logged, and
-- never returned.
CREATE FUNCTION public.telegram_process_start_update(
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
     OR _chat_type IS DISTINCT FROM 'private'
     OR _raw_token IS NULL
     OR _raw_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'telegram_update_invalid';
  END IF;

  PERFORM public._telegram_assert_poll_lease(_lease_token);

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
       AND _existing.result_code = ANY (ARRAY['link_success','link_rejected']) THEN
      is_new := false;
      result_code := _existing.result_code;
      RETURN NEXT;
      RETURN;
    END IF;

    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  BEGIN
    PERFORM public.consume_telegram_link_token(_raw_token, _telegram_user_id);
    _outcome := 'link_success';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        _sqlstate = RETURNED_SQLSTATE,
        _message  = MESSAGE_TEXT;

      -- ONLY the four expected TG-2B user/input outcomes become a terminal
      -- rejection. Anything else (missing function, permission failure,
      -- deadlock, constraint bug) must propagate so the whole transaction
      -- rolls back, no receipt is written, and the update is retried.
      IF _sqlstate = 'P0001' AND _message = ANY (ARRAY[
           'telegram_link_token_invalid',
           'telegram_user_already_linked',
           'telegram_account_already_linked',
           'telegram_link_conflict'
         ]) THEN
        _outcome := 'link_rejected';
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

REVOKE ALL ON FUNCTION public.telegram_process_start_update(uuid, bigint, text, bigint, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_process_start_update(uuid, bigint, text, bigint, bigint, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_process_start_update(uuid, bigint, text, bigint, bigint, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_process_start_update(uuid, bigint, text, bigint, bigint, text, text) TO service_role;

COMMIT;
