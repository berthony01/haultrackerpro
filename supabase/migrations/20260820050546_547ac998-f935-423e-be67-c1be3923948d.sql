-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase TG-2B — Telegram identity + linking foundation.
--
-- Scope: exactly three new public tables and exactly three SECURITY DEFINER
-- RPCs that together establish how a Telegram numeric user identity is bound
-- to a HaulTracker Pro account, and how a Telegram group chat is bound to a
-- recruiter workspace. Nothing here dispatches a load, reads a load, or
-- touches any TG-1 object.
--
-- ARCHITECTURAL RULING (ChatGPT, TG-2B):
--   * Telegram identity is GLOBAL to the HaulTracker account, never duplicated
--     per recruiter workspace. `telegram_user_links` therefore carries NO
--     recruiter_id: one ACTIVE Telegram numeric id <-> one ACTIVE auth user.
--   * Workspace context lives separately in `telegram_chat_bindings`, which
--     maps an ACTIVE Telegram group/supergroup chat to one recruiter workspace.
--   * Recruiter workspace authorization is NEVER copied into either table.
--     Permissions continue to be resolved dynamically, later, from the
--     existing recruiter permission system. A link is identity, not authority.
--   * Telegram usernames are user-mutable and re-assignable, so they are NEVER
--     an identity key and are not stored anywhere in this foundation.
--   * V1 does NOT link drivers. This foundation is company-side only; drivers
--     remain selected later through ACTIVE carrier_driver_relationships.
--
-- Deliberately NOT in this candidate:
--   * ZERO chat bind/unbind RPCs — `telegram_chat_bindings` is schema-only in
--     TG-2B; its write path needs the external-actor permission design that is
--     the subject of TG-2C;
--   * ZERO Edge Function, webhook, bot token, secret, connector or UI surface;
--   * ZERO changes to loads / load_events / dispatch_command_receipts /
--     dispatch_create_driver_load / dispatch_update_driver_load_status /
--     recruiter permission resolvers, or any other TG-1 object;
--   * ZERO DML or backfill outside the function bodies.
--
-- Security properties enforced below:
--   * the raw deep-link challenge is NEVER stored: only its SHA-256 hex digest
--     is persisted, so a database read can never replay a pending link;
--   * every failure raises a FIXED machine-readable message; raw Postgres error
--     text is never surfaced to the caller;
--   * `telegram_link_tokens` and `telegram_chat_bindings` have ZERO client
--     policies and ZERO client privileges: the web app reaches tokens only
--     through issue/revoke RPCs, never by reading the table;
--   * `consume_telegram_link_token` is service_role-only — an authenticated
--     end user can never assert which Telegram id they are;
--   * a partial UNIQUE index on ACTIVE rows is the real enforcement; the
--     in-function pre-checks are a friendly-error layer over it, and the
--     unique_violation handler fails closed rather than picking a race winner.
--
-- This candidate intentionally does NOT use CREATE OR REPLACE or DROP for the
-- functions: a re-apply must fail loudly rather than silently replace an
-- authorization-bearing function.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. public.telegram_user_links — GLOBAL Telegram identity binding
-- ---------------------------------------------------------------------------
-- No recruiter_id, no username, no first/last name, no phone, no chat id, no
-- bot token, no free-form JSON metadata. Identity only.
CREATE TABLE public.telegram_user_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  linked_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  CONSTRAINT telegram_user_links_telegram_user_id_positive_check
    CHECK (telegram_user_id > 0),
  CONSTRAINT telegram_user_links_status_check
    CHECK (status = ANY (ARRAY['active','revoked'])),
  CONSTRAINT telegram_user_links_status_shape_check
    CHECK (
      (status = 'active'  AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL)
    )
);

-- One ACTIVE Telegram identity may map to at most one account, and one account
-- may hold at most one ACTIVE Telegram identity. Revoked history is retained
-- and deliberately NOT covered by either unique index.
CREATE UNIQUE INDEX telegram_user_links_active_telegram_user_id_unique
  ON public.telegram_user_links (telegram_user_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX telegram_user_links_active_user_id_unique
  ON public.telegram_user_links (user_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- B. public.telegram_chat_bindings — chat -> recruiter workspace
-- ---------------------------------------------------------------------------
-- Schema-only in TG-2B: no RPC writes it yet. A recruiter workspace may later
-- bind MORE THAN ONE chat, so there is deliberately NO unique index on
-- recruiter_id. Chat username/title are display data, never identity, and are
-- not stored.
CREATE TABLE public.telegram_chat_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id bigint NOT NULL,
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  chat_type text NOT NULL,
  bound_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  bound_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  CONSTRAINT telegram_chat_bindings_telegram_chat_id_nonzero_check
    CHECK (telegram_chat_id <> 0),
  CONSTRAINT telegram_chat_bindings_chat_type_check
    CHECK (chat_type = ANY (ARRAY['group','supergroup'])),
  CONSTRAINT telegram_chat_bindings_status_check
    CHECK (status = ANY (ARRAY['active','revoked'])),
  CONSTRAINT telegram_chat_bindings_status_shape_check
    CHECK (
      (status = 'active'  AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL)
    )
);

-- A chat can be bound to at most ONE workspace at a time. Note the asymmetry:
-- one chat -> one recruiter, but one recruiter -> many chats.
CREATE UNIQUE INDEX telegram_chat_bindings_active_chat_id_unique
  ON public.telegram_chat_bindings (telegram_chat_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- C. public.telegram_link_tokens — HASHES ONLY
-- ---------------------------------------------------------------------------
-- There is deliberately no raw-token column anywhere in this schema. The raw
-- challenge exists only in the issuing RPC's return value and in the user's
-- own deep link. No recruiter_id and no Telegram id live here: the token
-- proves "this HaulTracker account initiated a link", nothing more.
CREATE TABLE public.telegram_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  invalidated_at timestamptz NULL,
  CONSTRAINT telegram_link_tokens_token_hash_format_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT telegram_link_tokens_expiry_after_creation_check
    CHECK (expires_at > created_at),
  CONSTRAINT telegram_link_tokens_consumed_after_creation_check
    CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT telegram_link_tokens_invalidated_after_creation_check
    CHECK (invalidated_at IS NULL OR invalidated_at >= created_at),
  -- A token is consumed XOR invalidated; never both.
  CONSTRAINT telegram_link_tokens_terminal_state_exclusive_check
    CHECK (NOT (consumed_at IS NOT NULL AND invalidated_at IS NOT NULL))
);

CREATE INDEX telegram_link_tokens_user_expiry_idx
  ON public.telegram_link_tokens (user_id, expires_at DESC);

-- ---------------------------------------------------------------------------
-- D. RLS + direct table privileges
-- ---------------------------------------------------------------------------
ALTER TABLE public.telegram_user_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_chat_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;

-- telegram_user_links: read-only to its owner, never client-writable.
REVOKE ALL ON TABLE public.telegram_user_links FROM PUBLIC;
REVOKE ALL ON TABLE public.telegram_user_links FROM anon;
REVOKE ALL ON TABLE public.telegram_user_links FROM authenticated;
GRANT SELECT ON TABLE public.telegram_user_links TO authenticated;
GRANT ALL ON TABLE public.telegram_user_links TO service_role;

-- Exactly one client policy in this entire candidate. No INSERT/UPDATE/DELETE
-- policy exists for any role, so every write goes through the RPCs below.
CREATE POLICY "Users read their own telegram link"
  ON public.telegram_user_links FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- telegram_chat_bindings: zero client policies, zero client privileges.
REVOKE ALL ON TABLE public.telegram_chat_bindings FROM PUBLIC;
REVOKE ALL ON TABLE public.telegram_chat_bindings FROM anon;
REVOKE ALL ON TABLE public.telegram_chat_bindings FROM authenticated;
GRANT ALL ON TABLE public.telegram_chat_bindings TO service_role;

-- telegram_link_tokens: zero client policies, zero client privileges. The web
-- app never reads this table; it only calls issue/revoke.
REVOKE ALL ON TABLE public.telegram_link_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.telegram_link_tokens FROM anon;
REVOKE ALL ON TABLE public.telegram_link_tokens FROM authenticated;
GRANT ALL ON TABLE public.telegram_link_tokens TO service_role;

-- ---------------------------------------------------------------------------
-- E. issue_telegram_link_token() — authenticated user starts a link
-- ---------------------------------------------------------------------------
-- Returns the RAW challenge exactly once, to the caller only. The raw value is
-- never persisted; only its SHA-256 hex digest is stored.
CREATE FUNCTION public.issue_telegram_link_token()
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

  -- An account already holding an ACTIVE Telegram identity must revoke first.
  IF EXISTS (
    SELECT 1
    FROM public.telegram_user_links l
    WHERE l.user_id = _uid
      AND l.status = 'active'
  ) THEN
    RAISE EXCEPTION 'telegram_already_linked';
  END IF;

  -- Issuing a new challenge retires every outstanding one, so at most one
  -- live token per account can ever be redeemed.
  UPDATE public.telegram_link_tokens t
     SET invalidated_at = now()
   WHERE t.user_id = _uid
     AND t.consumed_at IS NULL
     AND t.invalidated_at IS NULL;

  -- 32 cryptographically random bytes -> exactly 64 lowercase hex chars, which
  -- is within Telegram's `start` deep-link parameter rules.
  _raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  _token_hash := encode(extensions.digest(_raw_token, 'sha256'), 'hex');

  INSERT INTO public.telegram_link_tokens (
    user_id, token_hash, expires_at
  ) VALUES (
    _uid, _token_hash, now() + interval '15 minutes'
  );

  RETURN _raw_token;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_telegram_link_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_telegram_link_token() FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_telegram_link_token() TO authenticated;

-- ---------------------------------------------------------------------------
-- F. consume_telegram_link_token(_raw_token, _telegram_user_id)
-- ---------------------------------------------------------------------------
-- Backend/webhook only. This is the single most sensitive entry point in the
-- foundation: it asserts "this Telegram numeric id IS this account". An
-- authenticated end user must never be able to call it, so it is granted to
-- service_role ONLY.
CREATE FUNCTION public.consume_telegram_link_token(
  _raw_token text,
  _telegram_user_id bigint
)
RETURNS public.telegram_user_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'extensions'
AS $$
DECLARE
  _token_hash text;
  _token public.telegram_link_tokens%ROWTYPE;
  _row public.telegram_user_links%ROWTYPE;
BEGIN
  -- Shape validation first: a malformed challenge must be indistinguishable
  -- from an unknown one.
  IF _raw_token IS NULL
     OR _telegram_user_id IS NULL
     OR _telegram_user_id <= 0
     OR _raw_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'telegram_link_token_invalid';
  END IF;

  _token_hash := encode(extensions.digest(_raw_token, 'sha256'), 'hex');

  SELECT * INTO _token
    FROM public.telegram_link_tokens t
   WHERE t.token_hash = _token_hash
     AND t.consumed_at IS NULL
     AND t.invalidated_at IS NULL
     AND t.expires_at > now()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telegram_link_token_invalid';
  END IF;

  -- Fail closed on BOTH directions of the one-to-one rule. Neither identity is
  -- ever silently relinked or stolen from an existing binding.
  IF EXISTS (
    SELECT 1
    FROM public.telegram_user_links l
    WHERE l.telegram_user_id = _telegram_user_id
      AND l.status = 'active'
  ) THEN
    RAISE EXCEPTION 'telegram_user_already_linked';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.telegram_user_links l
    WHERE l.user_id = _token.user_id
      AND l.status = 'active'
  ) THEN
    RAISE EXCEPTION 'telegram_account_already_linked';
  END IF;

  INSERT INTO public.telegram_user_links (
    telegram_user_id, user_id, status, linked_at, revoked_at
  ) VALUES (
    _telegram_user_id, _token.user_id, 'active', now(), NULL
  )
  RETURNING * INTO _row;

  -- The token is burned only AFTER the link is durably established, so a
  -- failed link never silently destroys the user's outstanding challenge.
  UPDATE public.telegram_link_tokens t
     SET consumed_at = now()
   WHERE t.id = _token.id;

  RETURN _row;
EXCEPTION
  WHEN unique_violation THEN
    -- A concurrent transaction won one of the partial ACTIVE unique indexes.
    -- Fail closed: do not pick a winner, do not relink either identity.
    RAISE EXCEPTION 'telegram_link_conflict';
END;
$$;

REVOKE ALL ON FUNCTION public.consume_telegram_link_token(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_telegram_link_token(text, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.consume_telegram_link_token(text, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_telegram_link_token(text, bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- G. revoke_my_telegram_link() — caller unlinks their OWN identity
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.revoke_my_telegram_link()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _revoked_count integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'telegram_not_authenticated';
  END IF;

  -- Scoped to the caller's own row by auth.uid() alone. There is no parameter
  -- through which another account's link could be named.
  WITH revoked AS (
    UPDATE public.telegram_user_links l
       SET status = 'revoked',
           revoked_at = now()
     WHERE l.user_id = _uid
       AND l.status = 'active'
    RETURNING l.id
  )
  SELECT count(*) INTO _revoked_count FROM revoked;

  -- Unlinking also retires any challenge still in flight, so a stale deep link
  -- can never re-establish the binding the user just removed.
  UPDATE public.telegram_link_tokens t
     SET invalidated_at = now()
   WHERE t.user_id = _uid
     AND t.consumed_at IS NULL
     AND t.invalidated_at IS NULL;

  RETURN _revoked_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_my_telegram_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_my_telegram_link() FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_telegram_link() TO authenticated;

COMMIT;