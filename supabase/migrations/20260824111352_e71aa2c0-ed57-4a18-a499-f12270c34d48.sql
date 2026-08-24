-- ===========================================================================
-- PHASE TG-2F-B — SECURE DISPATCH-CHAT BIND TOKEN FOUNDATION
-- PRODUCTION MIGRATION — promoted from the certified TG-2F-A candidate.
-- ===========================================================================

BEGIN;

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

CREATE UNIQUE INDEX telegram_dispatch_bind_tokens_outstanding_pair_unique
  ON public.telegram_dispatch_bind_tokens (recruiter_id, issued_by_user_id)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX telegram_dispatch_bind_tokens_recruiter_expiry_idx
  ON public.telegram_dispatch_bind_tokens (recruiter_id, expires_at DESC);

ALTER TABLE public.telegram_dispatch_bind_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.telegram_dispatch_bind_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.telegram_dispatch_bind_tokens FROM anon;
REVOKE ALL ON TABLE public.telegram_dispatch_bind_tokens FROM authenticated;
GRANT ALL ON TABLE public.telegram_dispatch_bind_tokens TO service_role;

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

  IF NOT EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.status = 'active'
  ) THEN
    RAISE EXCEPTION 'telegram_workspace_not_available';
  END IF;

  IF NOT public.current_user_has_recruiter_permission(_recruiter_id, 'loads_dispatch') THEN
    RAISE EXCEPTION 'telegram_dispatch_not_authorized';
  END IF;

  UPDATE public.telegram_dispatch_bind_tokens t
     SET invalidated_at = now()
   WHERE t.recruiter_id = _recruiter_id
     AND t.issued_by_user_id = _uid
     AND t.consumed_at IS NULL
     AND t.invalidated_at IS NULL;

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

  _binding := public.telegram_bind_dispatch_chat(
    _telegram_user_id,
    _telegram_chat_id,
    _chat_type,
    _token.recruiter_id
  );

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