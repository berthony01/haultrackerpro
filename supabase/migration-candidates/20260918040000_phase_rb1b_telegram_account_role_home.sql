-- CANDIDATE MIGRATION — staged for review; applied live only after the
-- RB-1B verification ladder passes.
--
-- Phase RB-1B — role-aware Telegram bot home.
--
-- Scope: exactly ONE new resolver, ONE replacement of the existing RB-1A menu
-- processor, and ONE narrow widening of the terminal result-code vocabulary.
--
-- ARCHITECTURAL RULING (ChatGPT, RB-1B):
--   * There is NO bot-role table, NO bot entitlement table, and NO Telegram
--     role switch. Role signal is DERIVED, per call, from data that already
--     exists: an ACTIVE `telegram_user_links` row -> `profiles.intended_role`.
--   * `telegram_resolve_recruiter_actor` remains the ONLY recruiter workspace
--     resolver. Recruiter capability is whatever that function returns; the
--     declared intent in `profiles.intended_role` never grants it.
--   * Therefore ACTIVE RECRUITER WORKSPACE CAPABILITY IS AUTHORITATIVE:
--       - intent 'driver'    + recruiter capability => menu_multi_role
--       - intent 'recruiter' + recruiter capability => menu_recruiter
--       - any other intent   + recruiter capability => menu_recruiter
--       - intent 'recruiter' + NO capability        => menu_linked_no_workspace
--       - intent 'driver'    + NO capability        => menu_driver
--       - unknown/NULL intent + NO capability       => menu_linked_unsupported
--     A declared recruiter with no active workspace is NEVER shown a recruiter
--     menu; it fails closed to the explicit no-workspace outcome.
--   * The new resolver returns a ROLE SIGNAL ONLY. It deliberately does not
--     return the auth user id, email, phone, billing state, or any driver or
--     candidate data, so a compromised caller learns nothing beyond "which
--     menu shape applies".
--
-- Deliberately NOT in this candidate:
--   * ZERO new tables, policies, RLS changes, triggers, indexes or enums;
--   * ZERO signature change to `telegram_process_menu_update` — it still takes
--     the same six arguments and still returns (is_new, result_code,
--     workspaces). The bare command is a PRESENTATION selector held entirely
--     in the Edge adapter and is never an authorization input, so it is
--     deliberately NOT passed to the database;
--   * ZERO change to lease, cursor, receipt or idempotency semantics;
--   * ZERO DML or backfill.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Terminal result-code vocabulary — additive only
-- ---------------------------------------------------------------------------
-- All eleven pre-existing codes are restated verbatim; RB-1B appends exactly
-- three. Nothing is removed, so every historical receipt stays valid.
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
    'bind_rejected',
    'menu_recruiter',
    'menu_linked_no_workspace',
    'menu_unlinked',
    'menu_driver',
    'menu_multi_role',
    'menu_linked_unsupported'
  ]));

-- ---------------------------------------------------------------------------
-- B. telegram_resolve_account_role — minimum role signal, nothing else
-- ---------------------------------------------------------------------------
-- Returns NULL for an unknown or unlinked Telegram identity, which is
-- indistinguishable from a linked account with no declared intent. The caller
-- must therefore establish linkage separately and never infer it from here.
CREATE FUNCTION public.telegram_resolve_account_role(
  _telegram_user_id bigint
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $$
DECLARE
  _actor_user_id uuid;
  _intended_role text;
BEGIN
  IF _telegram_user_id IS NULL OR _telegram_user_id <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT l.user_id INTO _actor_user_id
    FROM public.telegram_user_links l
   WHERE l.telegram_user_id = _telegram_user_id
     AND l.status = 'active';

  IF _actor_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.intended_role INTO _intended_role
    FROM public.profiles p
   WHERE p.user_id = _actor_user_id;

  -- Normalised to the closed set the bot understands. Any other stored value
  -- collapses to NULL rather than leaking the raw column contents.
  IF _intended_role IN ('driver', 'recruiter') THEN
    RETURN _intended_role;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_resolve_account_role(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_resolve_account_role(bigint) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_resolve_account_role(bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_resolve_account_role(bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- C. telegram_process_menu_update — same signature, widened outcomes
-- ---------------------------------------------------------------------------
-- Everything outside the outcome-selection block is carried over from RB-1A
-- unchanged: identical validation, identical lease check, identical
-- FOR UPDATE receipt lock, identical single INSERT, identical return shape.
CREATE OR REPLACE FUNCTION public.telegram_process_menu_update(
  _lease_token uuid,
  _update_id bigint,
  _payload_hash text,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text
)
RETURNS TABLE(is_new boolean, result_code text, workspaces jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  _existing public.telegram_update_receipts%ROWTYPE;
  _actor_linked boolean;
  _account_role text;
  _workspaces jsonb;
  _outcome text;
BEGIN
  IF _update_id IS NULL
     OR _update_id <= 0
     OR _payload_hash IS NULL
     OR _payload_hash !~ '^[0-9a-f]{64}$'
     OR _telegram_user_id IS NULL
     OR _telegram_user_id <= 0
     OR _telegram_chat_id IS NULL
     OR _telegram_chat_id = 0
     OR _chat_type IS DISTINCT FROM 'private' THEN
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
    -- Replay of an already-terminal menu update. The reply is suppressed by
    -- the orchestrator because is_new is false, so no workspace data is
    -- re-emitted here.
    IF _existing.payload_hash = _payload_hash
       AND _existing.update_type = 'message'
       AND _existing.telegram_user_id IS NOT DISTINCT FROM _telegram_user_id
       AND _existing.telegram_chat_id IS NOT DISTINCT FROM _telegram_chat_id
       AND _existing.status = 'processed'
       AND _existing.result_code = ANY (ARRAY[
             'menu_recruiter',
             'menu_linked_no_workspace',
             'menu_unlinked',
             'menu_driver',
             'menu_multi_role',
             'menu_linked_unsupported'
           ]) THEN
      is_new := false;
      result_code := _existing.result_code;
      workspaces := '[]'::jsonb;
      RETURN NEXT;
      RETURN;
    END IF;

    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.telegram_user_links l
    WHERE l.telegram_user_id = _telegram_user_id
      AND l.status = 'active'
  ) INTO _actor_linked;

  IF _actor_linked THEN
    _account_role := public.telegram_resolve_account_role(_telegram_user_id);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'recruiter_id', r.recruiter_id,
             'workspace_name', r.workspace_name,
             'role', r.role,
             'can_manage_opportunities', r.can_manage_opportunities,
             'active_opportunity_count', r.active_opportunity_count
           )), '[]'::jsonb)
      INTO _workspaces
      FROM public.telegram_resolve_recruiter_actor(_telegram_user_id) r;
  ELSE
    _account_role := NULL;
    _workspaces := '[]'::jsonb;
  END IF;

  -- Outcome precedence. Actual recruiter workspace capability outranks the
  -- declared intent in every branch; declared intent alone never produces a
  -- recruiter menu.
  IF NOT _actor_linked THEN
    _outcome := 'menu_unlinked';
  ELSIF jsonb_array_length(_workspaces) > 0 THEN
    _outcome := CASE
      WHEN _account_role = 'driver' THEN 'menu_multi_role'
      ELSE 'menu_recruiter'
    END;
  ELSE
    _outcome := CASE
      WHEN _account_role = 'driver' THEN 'menu_driver'
      WHEN _account_role = 'recruiter' THEN 'menu_linked_no_workspace'
      ELSE 'menu_linked_unsupported'
    END;
  END IF;

  -- Workspace data is returned ONLY for the two outcomes whose copy renders
  -- it, so a driver-shaped or unsupported outcome can never carry it.
  IF _outcome NOT IN ('menu_recruiter', 'menu_multi_role') THEN
    _workspaces := '[]'::jsonb;
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
  workspaces := _workspaces;
  RETURN NEXT;
END;
$$;

-- Execution privileges are restated verbatim so the replacement can never
-- silently widen who may call the processor.
REVOKE ALL ON FUNCTION public.telegram_process_menu_update(uuid, bigint, text, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_process_menu_update(uuid, bigint, text, bigint, bigint, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_process_menu_update(uuid, bigint, text, bigint, bigint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_process_menu_update(uuid, bigint, text, bigint, bigint, text) TO service_role;

COMMIT;
