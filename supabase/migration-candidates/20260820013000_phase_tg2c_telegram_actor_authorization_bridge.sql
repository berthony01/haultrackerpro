-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase TG-2C — Telegram actor authorization + chat-binding bridge.
--
-- PREREQUISITE: the TG-2B candidate
-- (20260819213000_phase_tg2b_telegram_identity_linking_foundation.sql) must be
-- applied before this one. This candidate references TG-2B tables but never
-- creates, alters, or drops them.
--
-- ARCHITECTURAL RULING (ChatGPT, TG-2C):
--   * NO end-user JWT is ever minted, stored, refreshed, or impersonated.
--   * The bridge resolves the acting HaulTracker account from the ACTIVE
--     telegram_user_links row for the numeric Telegram user id, resolves the
--     recruiter workspace from the ACTIVE telegram_chat_bindings row for the
--     numeric Telegram chat id, derives the driver from an ACTIVE
--     carrier_driver_relationships row scoped to that workspace, and then sets
--     the TRANSACTION-LOCAL JWT subject via
--       pg_catalog.set_config('request.jwt.claim.sub', <actor>::text, true)
--     immediately before invoking the EXISTING TG-1 RPC. auth.uid() reads
--     request.jwt.claim.sub first, so TG-1 performs its own unmodified dynamic
--     permission checks and records the real actor.
--   * TG-1 remains the single load-dispatch authority. These wrappers are thin:
--     they contain ZERO permission, numeric, location, date, status,
--     provenance, receipt, audit, or idempotency logic of their own, and they
--     never write to loads, load_events, or dispatch_command_receipts.
--   * Callers may never supply an actor id, a driver user id, a recruiter id,
--     a source channel, or a Telegram username. Every one of those is derived.
--
-- Deliberately NOT in this candidate:
--   * ZERO new tables, types, policies, triggers, indexes;
--   * ZERO Telegram webhook/update receipt table (that is TG-2D);
--   * ZERO bot token, API token, connector id, gateway URL, HTTP extension,
--     webhook registration, Edge Function, or secret configuration;
--   * ZERO CREATE OR REPLACE / ALTER / DROP / GRANT / REVOKE against any TG-1
--     or TG-2B object, and no change to auth.uid().
--
-- Functions are created with plain CREATE (never CREATE OR REPLACE) so that a
-- re-apply fails loudly rather than silently replacing an authorization-bearing
-- function.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. telegram_bind_dispatch_chat — bind a Telegram group to a workspace
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.telegram_bind_dispatch_chat(
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text,
  _recruiter_id uuid
)
RETURNS public.telegram_chat_bindings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $$
DECLARE
  _actor_user_id uuid;
  _existing public.telegram_chat_bindings%ROWTYPE;
  _row public.telegram_chat_bindings%ROWTYPE;
BEGIN
  IF _telegram_user_id IS NULL
     OR _telegram_user_id <= 0
     OR _telegram_chat_id IS NULL
     OR _telegram_chat_id = 0
     OR _recruiter_id IS NULL
     OR _chat_type IS NULL
     OR _chat_type NOT IN ('group', 'supergroup') THEN
    RAISE EXCEPTION 'telegram_bind_invalid_input';
  END IF;

  -- Actor identity is derived ONLY from an ACTIVE global Telegram link.
  SELECT l.user_id INTO _actor_user_id
    FROM public.telegram_user_links l
   WHERE l.telegram_user_id = _telegram_user_id
     AND l.status = 'active';

  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'telegram_actor_not_linked';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.status = 'active'
  ) THEN
    RAISE EXCEPTION 'telegram_workspace_not_available';
  END IF;

  -- Transaction-local actor context. Never session-persistent, never a JWT.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', _actor_user_id::text, true);

  -- Dynamic permission resolution against the live recruiter permission
  -- system. No role-label shortcut, no copied/cached permission set.
  IF NOT public.current_user_has_recruiter_permission(_recruiter_id, 'loads_dispatch') THEN
    RAISE EXCEPTION 'telegram_dispatch_not_authorized';
  END IF;

  SELECT * INTO _existing
    FROM public.telegram_chat_bindings b
   WHERE b.telegram_chat_id = _telegram_chat_id
     AND b.status = 'active'
   FOR UPDATE;

  IF FOUND THEN
    IF _existing.recruiter_id = _recruiter_id AND _existing.chat_type = _chat_type THEN
      RETURN _existing;
    END IF;
    RAISE EXCEPTION 'telegram_chat_already_bound';
  END IF;

  INSERT INTO public.telegram_chat_bindings (
    telegram_chat_id, recruiter_id, chat_type, bound_by_user_id, status, bound_at, revoked_at
  ) VALUES (
    _telegram_chat_id, _recruiter_id, _chat_type, _actor_user_id, 'active', now(), NULL
  )
  RETURNING * INTO _row;

  RETURN _row;
EXCEPTION
  WHEN unique_violation THEN
    -- A concurrent transaction won the partial ACTIVE unique index. Fail
    -- closed: do not pick a winner and do not rebind the chat.
    RAISE EXCEPTION 'telegram_chat_bind_conflict';
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_bind_dispatch_chat(bigint, bigint, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_bind_dispatch_chat(bigint, bigint, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_bind_dispatch_chat(bigint, bigint, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_bind_dispatch_chat(bigint, bigint, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- B. telegram_revoke_dispatch_chat — unbind a Telegram group
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.telegram_revoke_dispatch_chat(
  _telegram_user_id bigint,
  _telegram_chat_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $$
DECLARE
  _actor_user_id uuid;
  _binding public.telegram_chat_bindings%ROWTYPE;
BEGIN
  IF _telegram_user_id IS NULL
     OR _telegram_user_id <= 0
     OR _telegram_chat_id IS NULL
     OR _telegram_chat_id = 0 THEN
    RAISE EXCEPTION 'telegram_bind_invalid_input';
  END IF;

  SELECT l.user_id INTO _actor_user_id
    FROM public.telegram_user_links l
   WHERE l.telegram_user_id = _telegram_user_id
     AND l.status = 'active';

  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'telegram_actor_not_linked';
  END IF;

  SELECT * INTO _binding
    FROM public.telegram_chat_bindings b
   WHERE b.telegram_chat_id = _telegram_chat_id
     AND b.status = 'active'
   FOR UPDATE;

  -- Nothing active to revoke: idempotent no-op, not an error.
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', _actor_user_id::text, true);

  IF NOT public.current_user_has_recruiter_permission(_binding.recruiter_id, 'loads_dispatch') THEN
    RAISE EXCEPTION 'telegram_dispatch_not_authorized';
  END IF;

  -- History is retained; the row is marked revoked, never deleted.
  UPDATE public.telegram_chat_bindings b
     SET status = 'revoked',
         revoked_at = now()
   WHERE b.id = _binding.id
     AND b.status = 'active';

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_revoke_dispatch_chat(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_revoke_dispatch_chat(bigint, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_revoke_dispatch_chat(bigint, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_revoke_dispatch_chat(bigint, bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- C. telegram_dispatch_create_driver_load — THIN bridge to the TG-1 create RPC
-- ---------------------------------------------------------------------------
-- The caller supplies Telegram context, the relationship, an idempotency key
-- and pure load-business fields. Recruiter workspace, driver user, actor and
-- source channel are all DERIVED. TG-1 remains the authority for permissions,
-- numeric/location/date validation, status, provenance, receipts, audit and
-- idempotency; its errors propagate unchanged.
CREATE FUNCTION public.telegram_dispatch_create_driver_load(
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _relationship_id uuid,
  _idempotency_key text,
  _load_date date,
  _pickup_location text,
  _dropoff_location text,
  _load_reference text DEFAULT NULL::text,
  _dropoff_date date DEFAULT NULL::date,
  _loaded_miles numeric DEFAULT 0,
  _deadhead_miles numeric DEFAULT 0,
  _total_miles numeric DEFAULT NULL::numeric,
  _rate_per_mile numeric DEFAULT 0,
  _pay_model text DEFAULT NULL::text,
  _flat_rate_amount numeric DEFAULT NULL::numeric,
  _deadhead_rate_per_mile numeric DEFAULT NULL::numeric,
  _wait_fee numeric DEFAULT 0,
  _detention_fee numeric DEFAULT 0,
  _other_fees numeric DEFAULT 0,
  _estimated_pay numeric DEFAULT NULL::numeric,
  _notes text DEFAULT NULL::text
)
RETURNS public.loads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $$
DECLARE
  _actor_user_id uuid;
  _binding public.telegram_chat_bindings%ROWTYPE;
  _driver_user_id uuid;
  _row public.loads%ROWTYPE;
BEGIN
  IF _telegram_user_id IS NULL
     OR _telegram_user_id <= 0
     OR _telegram_chat_id IS NULL
     OR _telegram_chat_id = 0
     OR _relationship_id IS NULL THEN
    RAISE EXCEPTION 'telegram_dispatch_invalid_context';
  END IF;

  SELECT l.user_id INTO _actor_user_id
    FROM public.telegram_user_links l
   WHERE l.telegram_user_id = _telegram_user_id
     AND l.status = 'active';

  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'telegram_actor_not_linked';
  END IF;

  SELECT * INTO _binding
    FROM public.telegram_chat_bindings b
   WHERE b.telegram_chat_id = _telegram_chat_id
     AND b.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telegram_chat_not_bound';
  END IF;

  -- Driver identity is DERIVED from an ACTIVE relationship scoped to the bound
  -- workspace. A typed driver user id is never accepted.
  SELECT r.driver_user_id INTO _driver_user_id
    FROM public.carrier_driver_relationships r
   WHERE r.id = _relationship_id
     AND r.recruiter_id = _binding.recruiter_id
     AND r.status = 'active';

  IF _driver_user_id IS NULL THEN
    RAISE EXCEPTION 'telegram_driver_relationship_not_available';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', _actor_user_id::text, true);

  SELECT * INTO _row
    FROM public.dispatch_create_driver_load(
      _binding.recruiter_id,
      _relationship_id,
      _driver_user_id,
      _idempotency_key,
      'telegram',
      _load_date,
      _pickup_location,
      _dropoff_location,
      _load_reference,
      _dropoff_date,
      _loaded_miles,
      _deadhead_miles,
      _total_miles,
      _rate_per_mile,
      _pay_model,
      _flat_rate_amount,
      _deadhead_rate_per_mile,
      _wait_fee,
      _detention_fee,
      _other_fees,
      _estimated_pay,
      _notes
    );

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_dispatch_create_driver_load(bigint, bigint, uuid, text, date, text, text, text, date, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_dispatch_create_driver_load(bigint, bigint, uuid, text, date, text, text, text, date, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_dispatch_create_driver_load(bigint, bigint, uuid, text, date, text, text, text, date, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_dispatch_create_driver_load(bigint, bigint, uuid, text, date, text, text, text, date, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, text) TO service_role;

-- ---------------------------------------------------------------------------
-- D. telegram_dispatch_update_driver_load_status — THIN bridge to TG-1 status
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.telegram_dispatch_update_driver_load_status(
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _relationship_id uuid,
  _load_id uuid,
  _new_status text,
  _idempotency_key text
)
RETURNS public.loads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $$
DECLARE
  _actor_user_id uuid;
  _binding public.telegram_chat_bindings%ROWTYPE;
  _driver_user_id uuid;
  _row public.loads%ROWTYPE;
BEGIN
  IF _telegram_user_id IS NULL
     OR _telegram_user_id <= 0
     OR _telegram_chat_id IS NULL
     OR _telegram_chat_id = 0
     OR _relationship_id IS NULL
     OR _load_id IS NULL THEN
    RAISE EXCEPTION 'telegram_dispatch_invalid_context';
  END IF;

  SELECT l.user_id INTO _actor_user_id
    FROM public.telegram_user_links l
   WHERE l.telegram_user_id = _telegram_user_id
     AND l.status = 'active';

  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'telegram_actor_not_linked';
  END IF;

  SELECT * INTO _binding
    FROM public.telegram_chat_bindings b
   WHERE b.telegram_chat_id = _telegram_chat_id
     AND b.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telegram_chat_not_bound';
  END IF;

  SELECT r.driver_user_id INTO _driver_user_id
    FROM public.carrier_driver_relationships r
   WHERE r.id = _relationship_id
     AND r.recruiter_id = _binding.recruiter_id
     AND r.status = 'active';

  IF _driver_user_id IS NULL THEN
    RAISE EXCEPTION 'telegram_driver_relationship_not_available';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', _actor_user_id::text, true);

  SELECT * INTO _row
    FROM public.dispatch_update_driver_load_status(
      _binding.recruiter_id,
      _relationship_id,
      _driver_user_id,
      _load_id,
      _new_status,
      _idempotency_key,
      'telegram'
    );

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_dispatch_update_driver_load_status(bigint, bigint, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_dispatch_update_driver_load_status(bigint, bigint, uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_dispatch_update_driver_load_status(bigint, bigint, uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_dispatch_update_driver_load_status(bigint, bigint, uuid, uuid, text, text) TO service_role;

COMMIT;
