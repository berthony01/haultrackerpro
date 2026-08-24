-- ===========================================================================
-- PHASE TG-2F-B — SECURE DISPATCH-CHAT BIND TOKEN FOUNDATION
-- PRODUCTION MIGRATION — promoted from the certified TG-2F-A candidate.
-- ===========================================================================
--
-- Promotion provenance
-- ---------------------
-- This is the TG-2F-B production migration, promoted verbatim from the
-- certified candidate `supabase/migration-candidates/20260824053000_phase_tg2f_dispatch_chat_bind_token_foundation.sql`.
-- The candidate passed 153/153 source-contract tests, `tsgo --noEmit`, and
-- 27/27 isolated real-PostgreSQL 17.9 tests (including both savepoint/
-- token-preservation cases). Production was independently verified to contain
-- none of the objects created here before this promotion.
--
-- The executable SQL below is copied byte-for-byte in behavior and statement
-- order from the certified TG-2F-A candidate; only these leading prose
-- comments were adjusted to accurately describe this as the promoted
-- production migration. No executable SQL, identifiers, grants, constraints,
-- indexes, function bodies, errors, TTL, permissions, transaction boundaries,
-- or ordering were altered.
--
-- Purpose
-- -------
-- A recruiter workspace cannot safely be named inside a Telegram group chat:
-- the only recruiter identifier that exists is an internal UUID, and pasting
-- one into a group is a disclosure defect. This migration adds the missing
-- prerequisite: a web-issued, hash-only, short-lived, one-time token that
-- carries recruiter workspace context SERVER-SIDE.
--
-- What this migration deliberately does NOT do
-- --------------------------------------------
--   * No Telegram command routing of any kind. The poller and the shared
--     ingest orchestrator are untouched by this phase.
--   * No recruiter slug, code, or other public workspace identifier.
--   * No change to any TG-1, TG-2B, TG-2C, TG-2D or TG-2E object. In
--     particular `telegram_bind_dispatch_chat` remains EXACTLY as authored and
--     remains the sole authority for linked-actor identity, live
--     `loads_dispatch` permission resolution, and chat-conflict handling.
--   * No write to `public.telegram_chat_bindings` from this file. Only the
--     existing TG-2C bind RPC inserts there.
--   * No load, load_event or dispatch-receipt surface is referenced.
--   * No DELETE anywhere: terminal token rows are retained as history. No
--     cleanup job ships in this phase.
--
-- Security shape (mirrors the proven TG-2B token pattern)
-- -------------------------------------------------------
--   * The raw token exists only as the issuing RPC's return value. There is
--     no raw-token column anywhere in this schema.
--   * The table stores no Telegram numeric id, no username, no chat title, no
--     message text and no raw JSON. It is a hash plus lifecycle timestamps.
--   * Consumption failures collapse to ONE fixed error so a caller cannot
--     distinguish "unknown" from "expired" from "already consumed".
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A. public.telegram_dispatch_bind_tokens — HASHES ONLY
-- ---------------------------------------------------------------------------
CREATE TABLE public.telegram_dispatch_bind_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  issued_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  invalidated_at timestamptz NULL,
  CONSTRAINT telegram_dispatch_bind_tokens_token_hash_format_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT telegram_dispatch_bind_tokens_expiry_after_creation_check
    CHECK (expires_at > created_at),
  CONSTRAINT telegram_dispatch_bind_tokens_consumed_after_creation_check
    CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT telegram_dispatch_bind_tokens_invalidated_after_creation_check
    CHECK (invalidated_at IS NULL OR invalidated_at >= created_at),
  -- A token is consumed XOR invalidated; never both.
  CONSTRAINT telegram_dispatch_bind_tokens_terminal_state_exclusive_check
    CHECK (NOT (consumed_at IS NOT NULL AND invalidated_at IS NOT NULL))
);

-- ---------------------------------------------------------------------------
-- B. Outstanding-token control
-- ---------------------------------------------------------------------------
-- At most ONE live, unconsumed, uninvalidated token may exist per
-- (recruiter_id, issued_by_user_id). The predicate is deliberately free of
-- now(): a time-dependent index predicate is not immutable, and an
-- expired-but-not-yet-invalidated row must still occupy the slot rather than
-- silently allowing a second live token. The issuing RPC retires any prior
-- outstanding token for the exact pair before inserting.
CREATE UNIQUE INDEX telegram_dispatch_bind_tokens_outstanding_pair_unique
  ON public.telegram_dispatch_bind_tokens (recruiter_id, issued_by_user_id)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX telegram_dispatch_bind_tokens_recruiter_expiry_idx
  ON public.telegram_dispatch_bind_tokens (recruiter_id, expires_at DESC);

-- ---------------------------------------------------------------------------
-- C. RLS + direct table privileges
-- ---------------------------------------------------------------------------
-- Zero client policies and zero client privileges. The web app never selects
-- from this table; it only calls the issuing RPC.
ALTER TABLE public.telegram_dispatch_bind_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.telegram_dispatch_bind_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.telegram_dispatch_bind_tokens FROM anon;
REVOKE ALL ON TABLE public.telegram_dispatch_bind_tokens FROM authenticated;
GRANT ALL ON TABLE public.telegram_dispatch_bind_tokens TO service_role;

-- ---------------------------------------------------------------------------
-- D1. issue_telegram_dispatch_bind_token(_recruiter_id)
-- ---------------------------------------------------------------------------
-- Authenticated recruiter-workspace surface. Returns the RAW token exactly
-- once, to the caller only. The raw value is never persisted; only its
-- SHA-256 hex digest is stored.
CREATE FUNCTION public.issue_telegram_dispatch_bind_token(
  _recruiter_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'extensions'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _raw_token text;
  _token_hash text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'telegram_not_authenticated';
  END IF;

  IF _recruiter_id IS NULL THEN
    RAISE EXCEPTION 'telegram_dispatch_bind_invalid_input';
  END IF;

  -- Existing recruiter-profile truth, identical to the TG-2C availability
  -- predicate. Nothing about the workspace is disclosed on failure.
  IF NOT EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.status = 'active'
  ) THEN
    RAISE EXCEPTION 'telegram_workspace_not_available';
  END IF;

  -- Dynamic permission resolution against the live recruiter permission
  -- system. No role-label shortcut, no copied or cached permission set.
  IF NOT public.current_user_has_recruiter_permission(_recruiter_id, 'loads_dispatch') THEN
    RAISE EXCEPTION 'telegram_dispatch_not_authorized';
  END IF;

  -- Issuing a new token retires every outstanding one for this exact
  -- recruiter + caller pair, so at most one live token can ever be redeemed.
  UPDATE public.telegram_dispatch_bind_tokens t
     SET invalidated_at = now()
   WHERE t.recruiter_id = _recruiter_id
     AND t.issued_by_user_id = _uid
     AND t.consumed_at IS NULL
     AND t.invalidated_at IS NULL;

  -- 32 cryptographically random bytes -> exactly 64 lowercase hex chars.
  _raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  _token_hash := encode(extensions.digest(_raw_token, 'sha256'), 'hex');

  INSERT INTO public.telegram_dispatch_bind_tokens (
    recruiter_id, issued_by_user_id, token_hash, expires_at
  ) VALUES (
    _recruiter_id, _uid, _token_hash, now() + interval '15 minutes'
  );

  RETURN _raw_token;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_telegram_dispatch_bind_token(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_telegram_dispatch_bind_token(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_telegram_dispatch_bind_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_telegram_dispatch_bind_token(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- D2. consume_telegram_dispatch_bind_token(...)
-- ---------------------------------------------------------------------------
-- Backend only. Redeems a live token presented from a Telegram group context
-- and delegates the actual binding decision, unchanged, to the existing TG-2C
-- authority. The recruiter workspace is NEVER supplied by the caller: it is
-- derived exclusively from the locked token row.
CREATE FUNCTION public.consume_telegram_dispatch_bind_token(
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text,
  _raw_token text
)
RETURNS public.telegram_chat_bindings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'extensions'
AS $$
DECLARE
  _token_hash text;
  _token public.telegram_dispatch_bind_tokens%ROWTYPE;
  _binding public.telegram_chat_bindings%ROWTYPE;
BEGIN
  IF _telegram_user_id IS NULL
     OR _telegram_user_id <= 0
     OR _telegram_chat_id IS NULL
     OR _telegram_chat_id = 0
     OR _chat_type IS NULL
     OR _chat_type NOT IN ('group', 'supergroup') THEN
    RAISE EXCEPTION 'telegram_dispatch_bind_invalid_input';
  END IF;

  -- Malformed secrets take the SAME exit as unknown/expired/terminal ones, so
  -- token validity is never distinguishable from the outside.
  IF _raw_token IS NULL OR _raw_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'telegram_dispatch_bind_token_invalid';
  END IF;

  _token_hash := encode(extensions.digest(_raw_token, 'sha256'), 'hex');

  SELECT * INTO _token
    FROM public.telegram_dispatch_bind_tokens t
   WHERE t.token_hash = _token_hash
     AND t.consumed_at IS NULL
     AND t.invalidated_at IS NULL
     AND t.expires_at > now()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telegram_dispatch_bind_token_invalid';
  END IF;

  -- The existing TG-2C bridge stays the authority for linked actor identity,
  -- workspace availability, live `loads_dispatch` permission and chat
  -- conflicts. Its fixed errors propagate unchanged and are NOT translated.
  _binding := public.telegram_bind_dispatch_chat(
    _telegram_user_id,
    _telegram_chat_id,
    _chat_type,
    _token.recruiter_id
  );

  -- Terminalize ONLY after a successful bind. Any bind failure raises, the
  -- transaction rolls back, and the token is therefore not burned.
  UPDATE public.telegram_dispatch_bind_tokens t
     SET consumed_at = now()
   WHERE t.id = _token.id;

  RETURN _binding;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_telegram_dispatch_bind_token(bigint, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_telegram_dispatch_bind_token(bigint, bigint, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.consume_telegram_dispatch_bind_token(bigint, bigint, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_telegram_dispatch_bind_token(bigint, bigint, text, text) TO service_role;

COMMIT;
