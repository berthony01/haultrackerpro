-- ===========================================================================
-- PHASE TG-G1B — DISPATCH GROUP REVIEW QUEUE (intake + review callback)
-- CANDIDATE ONLY — NOT APPLIED LIVE.
-- ===========================================================================
--
-- Purpose
-- -------
-- TG-G1A shipped a pure, deterministic parser/resolver for dispatch-group
-- messages ("Load REF-123 delivered"). This candidate stages the DB half:
--
--   1. public.telegram_dispatch_review_proposals — a time-limited review
--      queue storing ONLY structured metadata. No raw message text, driver
--      names, chat titles, usernames, tokens or Telegram JSON is ever stored.
--   2. public.telegram_process_dispatch_group_update(...) — service-role-only
--      atomic intake. Lease check + receipt dedupe + bound-chat scoping +
--      exactly-one-load resolution + proposal insert + terminal receipt in ONE
--      transaction. It NEVER mutates a load.
--   3. public.telegram_process_dispatch_review_action(...) — service-role-only
--      atomic review callback. Proposal + load row locks, exact expected prior
--      status, live binding, linked reviewer, active relationship, and the
--      EXISTING public.telegram_dispatch_update_driver_load_status wrapper
--      (which owns permission `loads_update_status`, idempotency and
--      load_events) all inside the same transaction as the receipt.
--
-- What this candidate deliberately does NOT do
-- --------------------------------------------
--   * It does NOT modify telegram_dispatch_update_driver_load_status,
--     dispatch_update_driver_load_status, or any TG-1/TG-2 function.
--   * It does NOT insert load_events (the canonical dispatch path owns that).
--   * It does NOT touch receipt columns, status constraint, poll cursor or
--     lease; it ONLY replaces the result_code vocabulary check ADDITIVELY —
--     every live value is preserved exactly.
--   * It grants nothing to anon/authenticated. RLS is enabled with NO
--     policies, so the table is unreachable from the Data API.
--   * It trusts no chat-supplied recruiter, driver, load or user id. The
--     reviewer is the Telegram `callback_query.from.id` forwarded by the
--     trusted poller, resolved through an ACTIVE telegram_user_links row.
--
-- Activation requires (separately approved): applying this file, deploying
-- the poller with the compile-time gate flipped, Telegram privacy-mode setup,
-- real sanitized message examples, and live E2E.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Review proposal table
-- ---------------------------------------------------------------------------
CREATE TABLE public.telegram_dispatch_review_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_key text NOT NULL,
  binding_id uuid NOT NULL REFERENCES public.telegram_chat_bindings(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL,
  telegram_chat_id bigint NOT NULL,
  source_update_id bigint NOT NULL,
  source_payload_hash text NOT NULL,
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  load_reference text NOT NULL,
  relationship_id uuid NOT NULL REFERENCES public.carrier_driver_relationships(id) ON DELETE CASCADE,
  expected_previous_status text NOT NULL,
  proposed_status text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  decided_at timestamptz,
  reviewer_user_id uuid,
  reviewer_telegram_user_id bigint,
  decision_update_id bigint,
  CONSTRAINT telegram_dispatch_review_proposals_key_unique UNIQUE (proposal_key),
  CONSTRAINT telegram_dispatch_review_proposals_chat_update_unique UNIQUE (telegram_chat_id, source_update_id),
  CONSTRAINT telegram_dispatch_review_proposals_key_format_check
    CHECK (proposal_key ~ '^tg-dg:v1:-?[0-9]+:[0-9]+:[0-9a-f-]{36}:(completed|cancelled)$'
           AND char_length(proposal_key) <= 160),
  CONSTRAINT telegram_dispatch_review_proposals_chat_check CHECK (telegram_chat_id <> 0),
  CONSTRAINT telegram_dispatch_review_proposals_update_check CHECK (source_update_id > 0),
  CONSTRAINT telegram_dispatch_review_proposals_hash_check CHECK (source_payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT telegram_dispatch_review_proposals_reference_check
    CHECK (load_reference ~ '^(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{2,22}[A-Z0-9]$'),
  CONSTRAINT telegram_dispatch_review_proposals_prev_check
    CHECK (expected_previous_status IN ('pending','en_route')),
  CONSTRAINT telegram_dispatch_review_proposals_target_check
    CHECK (proposed_status IN ('completed','cancelled')),
  CONSTRAINT telegram_dispatch_review_proposals_status_check
    CHECK (status IN ('pending','accepted','rejected','expired','stale')),
  CONSTRAINT telegram_dispatch_review_proposals_window_check
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes'),
  CONSTRAINT telegram_dispatch_review_proposals_decision_check CHECK (
    (status = 'pending' AND decided_at IS NULL AND reviewer_user_id IS NULL
       AND reviewer_telegram_user_id IS NULL AND decision_update_id IS NULL)
    OR (status IN ('accepted','rejected') AND decided_at IS NOT NULL
       AND reviewer_user_id IS NOT NULL AND reviewer_telegram_user_id > 0
       AND decision_update_id > 0)
    OR (status IN ('expired','stale') AND decided_at IS NOT NULL)
  )
);

-- Cap: at most ONE pending proposal per load at a time.
CREATE UNIQUE INDEX telegram_dispatch_review_proposals_one_pending_per_load
  ON public.telegram_dispatch_review_proposals (load_id)
  WHERE status = 'pending';

CREATE INDEX telegram_dispatch_review_proposals_chat_status_idx
  ON public.telegram_dispatch_review_proposals (telegram_chat_id, status, created_at);

-- Service role only. No anon / authenticated access of any kind.
REVOKE ALL ON public.telegram_dispatch_review_proposals FROM PUBLIC;
REVOKE ALL ON public.telegram_dispatch_review_proposals FROM anon;
REVOKE ALL ON public.telegram_dispatch_review_proposals FROM authenticated;
GRANT ALL ON public.telegram_dispatch_review_proposals TO service_role;

ALTER TABLE public.telegram_dispatch_review_proposals ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: fail-closed for every non-service role.

-- ---------------------------------------------------------------------------
-- B. Additive result-code vocabulary
-- ---------------------------------------------------------------------------
-- All 39 live values are preserved EXACTLY; nine dispatch_review_* codes added.
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
    'menu_linked_unsupported',
    'conversation_accepted',
    'conversation_passed',
    'conversation_already_handled',
    'conversation_action_unavailable',
    'conversation_action_denied',
    'conversation_action_invalid',
    'conversation_reply_sent',
    'conversation_reply_denied',
    'conversation_reply_unavailable',
    'conversation_reply_invalid',
    'conversation_reply_unroutable',
    'quick_post_started',
    'quick_post_denied',
    'quick_post_unavailable',
    'quick_post_source_reserved',
    'quick_post_source_rejected',
    'quick_post_created',
    'quick_post_already_completed',
    'quick_post_create_blocked',
    'quick_post_cancelled',
    'quick_post_restarted',
    'quick_post_review_refreshed',
    'quick_post_action_invalid',
    'quick_post_action_denied',
    'quick_post_action_unavailable',
    'dispatch_review_proposed',
    'dispatch_review_no_action',
    'dispatch_review_accepted',
    'dispatch_review_rejected',
    'dispatch_review_already_handled',
    'dispatch_review_expired',
    'dispatch_review_stale',
    'dispatch_review_denied',
    'dispatch_review_invalid'
  ]));

-- ---------------------------------------------------------------------------
-- C. telegram_process_dispatch_group_update(...) — intake, NO load mutation
-- ---------------------------------------------------------------------------
-- `_reference` / `_proposed_status` are the TG-G1A parser output, NOT raw
-- text. Both NULL means "parser found nothing actionable" and records a
-- terminal `dispatch_review_no_action` receipt so the lease cannot jam.
CREATE FUNCTION public.telegram_process_dispatch_group_update(
  _lease_token uuid,
  _update_id bigint,
  _payload_hash text,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text,
  _reference text,
  _proposed_status text
)
RETURNS TABLE(is_new boolean, result_code text, proposal_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  _existing public.telegram_update_receipts%ROWTYPE;
  _binding public.telegram_chat_bindings%ROWTYPE;
  _match_count integer;
  _load_id uuid;
  _load_status text;
  _relationship_id uuid;
  _key text;
  _outcome text := 'dispatch_review_no_action';
  _new_id uuid;
  _new_expires timestamptz;
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
     OR ((_reference IS NULL) <> (_proposed_status IS NULL))
     OR (_reference IS NOT NULL AND _reference !~ '^(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{2,22}[A-Z0-9]$')
     OR (_proposed_status IS NOT NULL AND _proposed_status NOT IN ('completed','cancelled')) THEN
    RAISE EXCEPTION 'telegram_update_invalid';
  END IF;

  IF _lease_token IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.telegram_poll_state s
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
       AND _existing.result_code = ANY (ARRAY['dispatch_review_proposed','dispatch_review_no_action']) THEN
      SELECT p.id, p.expires_at INTO _new_id, _new_expires
        FROM public.telegram_dispatch_review_proposals p
       WHERE p.telegram_chat_id = _telegram_chat_id
         AND p.source_update_id = _update_id;
      is_new := false;
      result_code := _existing.result_code;
      proposal_id := _new_id;
      expires_at := _new_expires;
      RETURN NEXT;
      RETURN;
    END IF;
    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  IF _reference IS NOT NULL THEN
    SELECT * INTO _binding
      FROM public.telegram_chat_bindings b
     WHERE b.telegram_chat_id = _telegram_chat_id
       AND b.status = 'active';

    IF FOUND THEN
      -- ONLY loads of the bound recruiter's ACTIVE relationships, owned by
      -- that relationship's driver, with an exact normalized reference.
      SELECT count(*), min(l.id::text)::uuid
        INTO _match_count, _load_id
        FROM public.loads l
        JOIN public.carrier_driver_relationships r
          ON r.id = l.carrier_driver_relationship_id
       WHERE r.recruiter_id = _binding.recruiter_id
         AND r.status = 'active'
         AND l.user_id = r.driver_user_id
         AND upper(btrim(l.load_reference)) = _reference;

      IF _match_count = 1 THEN
        SELECT l.status, l.carrier_driver_relationship_id
          INTO _load_status, _relationship_id
          FROM public.loads l
         WHERE l.id = _load_id
         FOR UPDATE;

        IF _load_status IN ('pending','en_route') THEN
          -- Retire this load's expired pending proposal so the per-load cap
          -- does not block a fresh, legitimate report.
          UPDATE public.telegram_dispatch_review_proposals p
             SET status = 'expired', decided_at = now()
           WHERE p.load_id = _load_id
             AND p.status = 'pending'
             AND p.expires_at <= now();

          IF NOT EXISTS (
            SELECT 1 FROM public.telegram_dispatch_review_proposals p
             WHERE p.load_id = _load_id AND p.status = 'pending'
          ) THEN
            _key := 'tg-dg:v1:' || _telegram_chat_id::text || ':' || _update_id::text
                    || ':' || _load_id::text || ':' || _proposed_status;

            INSERT INTO public.telegram_dispatch_review_proposals (
              proposal_key, binding_id, recruiter_id, telegram_chat_id,
              source_update_id, source_payload_hash, load_id, load_reference,
              relationship_id, expected_previous_status, proposed_status
            ) VALUES (
              _key, _binding.id, _binding.recruiter_id, _telegram_chat_id,
              _update_id, _payload_hash, _load_id, _reference,
              _relationship_id, _load_status, _proposed_status
            )
            RETURNING id, telegram_dispatch_review_proposals.expires_at
              INTO _new_id, _new_expires;

            _outcome := 'dispatch_review_proposed';
          END IF;
        END IF;
      END IF;
    END IF;
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
  proposal_id := _new_id;
  expires_at := _new_expires;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_process_dispatch_group_update(uuid, bigint, text, bigint, bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_process_dispatch_group_update(uuid, bigint, text, bigint, bigint, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_process_dispatch_group_update(uuid, bigint, text, bigint, bigint, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_process_dispatch_group_update(uuid, bigint, text, bigint, bigint, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- D. telegram_process_dispatch_review_action(...) — review callback
-- ---------------------------------------------------------------------------
-- `_action` is 'accept' | 'reject' | NULL (malformed payload). `_proposal_id`
-- is an UNTRUSTED locator; every authority fact is re-derived here.
CREATE FUNCTION public.telegram_process_dispatch_review_action(
  _lease_token uuid,
  _update_id bigint,
  _payload_hash text,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text,
  _action text,
  _proposal_id uuid
)
RETURNS TABLE(is_new boolean, result_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $$
DECLARE
  _existing public.telegram_update_receipts%ROWTYPE;
  _p public.telegram_dispatch_review_proposals%ROWTYPE;
  _binding public.telegram_chat_bindings%ROWTYPE;
  _reviewer uuid;
  _driver_user_id uuid;
  _load_status text;
  _load_rel uuid;
  _load_owner uuid;
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
     OR _telegram_chat_id = 0 THEN
    RAISE EXCEPTION 'telegram_update_invalid';
  END IF;

  IF _lease_token IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.telegram_poll_state s
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
       AND _existing.update_type = 'callback_query'
       AND _existing.telegram_user_id IS NOT DISTINCT FROM _telegram_user_id
       AND _existing.telegram_chat_id IS NOT DISTINCT FROM _telegram_chat_id
       AND _existing.status = 'processed'
       AND _existing.result_code LIKE 'dispatch_review_%'
       AND _existing.result_code NOT IN ('dispatch_review_proposed','dispatch_review_no_action') THEN
      is_new := false;
      result_code := _existing.result_code;
      RETURN NEXT;
      RETURN;
    END IF;
    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  _outcome := NULL;

  IF _action IS NULL OR _action NOT IN ('accept','reject') OR _proposal_id IS NULL
     OR _chat_type IS NULL OR _chat_type NOT IN ('group','supergroup') THEN
    _outcome := 'dispatch_review_invalid';
  END IF;

  IF _outcome IS NULL THEN
    SELECT * INTO _p
      FROM public.telegram_dispatch_review_proposals p
     WHERE p.id = _proposal_id
     FOR UPDATE;

    -- Unknown id and another chat's proposal are indistinguishable.
    IF NOT FOUND OR _p.telegram_chat_id <> _telegram_chat_id THEN
      _outcome := 'dispatch_review_invalid';
    ELSIF _p.status <> 'pending' THEN
      _outcome := 'dispatch_review_already_handled';
    ELSIF _p.expires_at <= now() THEN
      UPDATE public.telegram_dispatch_review_proposals
         SET status = 'expired', decided_at = now()
       WHERE id = _p.id;
      _outcome := 'dispatch_review_expired';
    END IF;
  END IF;

  IF _outcome IS NULL THEN
    SELECT * INTO _binding
      FROM public.telegram_chat_bindings b
     WHERE b.telegram_chat_id = _telegram_chat_id
       AND b.status = 'active';

    SELECT l.user_id INTO _reviewer
      FROM public.telegram_user_links l
     WHERE l.telegram_user_id = _telegram_user_id
       AND l.status = 'active';

    SELECT r.driver_user_id INTO _driver_user_id
      FROM public.carrier_driver_relationships r
     WHERE r.id = _p.relationship_id
       AND r.recruiter_id = _p.recruiter_id
       AND r.status = 'active';

    IF _binding.id IS NULL
       OR _binding.id <> _p.binding_id
       OR _binding.recruiter_id <> _p.recruiter_id
       OR _reviewer IS NULL
       OR _driver_user_id IS NULL THEN
      _outcome := 'dispatch_review_denied';
    END IF;
  END IF;

  IF _outcome IS NULL THEN
    SELECT l.status, l.carrier_driver_relationship_id, l.user_id
      INTO _load_status, _load_rel, _load_owner
      FROM public.loads l
     WHERE l.id = _p.load_id
     FOR UPDATE;

    IF NOT FOUND
       OR _load_rel IS DISTINCT FROM _p.relationship_id
       OR _load_owner IS DISTINCT FROM _driver_user_id
       OR _load_status IS DISTINCT FROM _p.expected_previous_status THEN
      UPDATE public.telegram_dispatch_review_proposals
         SET status = 'stale', decided_at = now()
       WHERE id = _p.id;
      _outcome := 'dispatch_review_stale';
    END IF;
  END IF;

  IF _outcome IS NULL THEN
    -- Same actor-claim pattern the existing TG-2C wrapper uses (local only).
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', _reviewer::text, true);

    IF _action = 'reject' THEN
      IF public.current_user_can_dispatch_load_action(
           _p.recruiter_id, _p.relationship_id, _driver_user_id, 'loads_update_status'
         ) THEN
        UPDATE public.telegram_dispatch_review_proposals
           SET status = 'rejected', decided_at = now(),
               reviewer_user_id = _reviewer,
               reviewer_telegram_user_id = _telegram_user_id,
               decision_update_id = _update_id
         WHERE id = _p.id;
        _outcome := 'dispatch_review_rejected';
      ELSE
        _outcome := 'dispatch_review_denied';
      END IF;
    ELSE
      BEGIN
        -- Existing canonical wrapper: re-verifies link, binding, relationship
        -- and `loads_update_status`, owns idempotency + load_events.
        PERFORM public.telegram_dispatch_update_driver_load_status(
          _telegram_user_id,
          _telegram_chat_id,
          _p.relationship_id,
          _p.load_id,
          _p.proposed_status,
          'tg-dg-review:v1:' || _p.id::text
        );
        UPDATE public.telegram_dispatch_review_proposals
           SET status = 'accepted', decided_at = now(),
               reviewer_user_id = _reviewer,
               reviewer_telegram_user_id = _telegram_user_id,
               decision_update_id = _update_id
         WHERE id = _p.id;
        _outcome := 'dispatch_review_accepted';
      EXCEPTION
        WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS
            _sqlstate = RETURNED_SQLSTATE,
            _message  = MESSAGE_TEXT;
          -- ONLY expected authorization/business outcomes become a terminal
          -- denial (the proposal stays pending for an authorized reviewer).
          -- Anything else re-raises: whole transaction rolls back, no
          -- receipt, cursor does not advance, retried next tick.
          IF _sqlstate = 'P0001' AND _message = ANY (ARRAY[
               'dispatch_not_authorized',
               'telegram_actor_not_linked',
               'telegram_chat_not_bound',
               'telegram_driver_relationship_not_available',
               'dispatch_load_not_found',
               'dispatch_invalid_status_transition',
               'dispatch_idempotency_conflict'
             ]) THEN
            _outcome := 'dispatch_review_denied';
          ELSE
            RAISE;
          END IF;
      END;
    END IF;
  END IF;

  INSERT INTO public.telegram_update_receipts (
    update_id, payload_hash, update_type,
    telegram_user_id, telegram_chat_id, status, result_code
  ) VALUES (
    _update_id, _payload_hash, 'callback_query',
    _telegram_user_id, _telegram_chat_id, 'processed', _outcome
  );

  is_new := true;
  result_code := _outcome;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_process_dispatch_review_action(uuid, bigint, text, bigint, bigint, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_process_dispatch_review_action(uuid, bigint, text, bigint, bigint, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_process_dispatch_review_action(uuid, bigint, text, bigint, bigint, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_process_dispatch_review_action(uuid, bigint, text, bigint, bigint, text, text, uuid) TO service_role;

COMMIT;
