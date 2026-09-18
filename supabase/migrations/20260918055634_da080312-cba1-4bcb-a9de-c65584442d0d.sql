-- CANDIDATE MIGRATION — Phase RB-3A.
-- Telegram text-only recruiter Quick Post: draft workflow + review/confirm.
--
-- Scope contract:
--   * NO second opportunity creation implementation. The row is written
--     EXCLUSIVELY by the existing canonical
--     public.create_recruiter_opportunity_as_actor -> create_recruiter_opportunity
--     chain, under the delegated recruiter's own identity, so every existing
--     BEFORE INSERT guard (authorization, validation, billing/active limit,
--     canonical publication) fires unchanged.
--   * NO second extractor. The model call stays in the ai-insight Edge
--     Function's canonical parse_opportunity delegated mode. This migration
--     only reserves the source update and persists the whitelisted result.
--   * Nothing is created before an explicit Confirm tap.
--   * Every terminal Telegram outcome shares its transaction with the work it
--     describes, exactly as in RB-2B / RB-2C / RB-2D.
--   * Caller-supplied draft ids are UNTRUSTED locators: ownership, chat,
--     actor and recruiter capability are all re-derived server-side.
--   * Drafts are service-role-only transport state: RLS on, no policies, no
--     anon/authenticated grants, TTL enforced.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Draft workflow state
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.telegram_opportunity_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL,
  telegram_chat_id bigint NOT NULL,
  state text NOT NULL DEFAULT 'awaiting_input',
  raw_source_text text NULL,
  extracted_payload jsonb NULL,
  source_update_id bigint NULL,
  created_opportunity_id uuid NULL REFERENCES public.opportunities(id) ON DELETE SET NULL,
  last_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 hours',
  CONSTRAINT telegram_opportunity_drafts_state_check CHECK (
    state = ANY (ARRAY[
      'awaiting_input'::text,
      'extracting'::text,
      'review'::text,
      'confirmed'::text,
      'cancelled'::text,
      'expired'::text,
      'failed'::text
    ])
  ),
  CONSTRAINT telegram_opportunity_drafts_user_positive_check
    CHECK (telegram_user_id > 0),
  CONSTRAINT telegram_opportunity_drafts_chat_nonzero_check
    CHECK (telegram_chat_id <> 0),
  CONSTRAINT telegram_opportunity_drafts_source_update_check
    CHECK (source_update_id IS NULL OR source_update_id > 0),
  -- Bounded machine code only. Never raw model output, provider text, or any
  -- secret.
  CONSTRAINT telegram_opportunity_drafts_error_code_check
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{3,64}$'),
  CONSTRAINT telegram_opportunity_drafts_payload_object_check
    CHECK (extracted_payload IS NULL OR jsonb_typeof(extracted_payload) = 'object')
);

-- One live draft per acting Telegram account per chat.
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_opportunity_drafts_live_actor_chat
  ON public.telegram_opportunity_drafts (telegram_user_id, telegram_chat_id)
  WHERE state = ANY (ARRAY['awaiting_input'::text, 'extracting'::text, 'review'::text]);

-- Extraction idempotency: one Telegram source update can be reserved once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_opportunity_drafts_source_update
  ON public.telegram_opportunity_drafts (source_update_id)
  WHERE source_update_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_telegram_opportunity_drafts_actor
  ON public.telegram_opportunity_drafts (actor_user_id, created_at DESC);

-- Service-role-only transport state. No Data API exposure whatsoever.
REVOKE ALL ON TABLE public.telegram_opportunity_drafts FROM PUBLIC;
REVOKE ALL ON TABLE public.telegram_opportunity_drafts FROM anon;
REVOKE ALL ON TABLE public.telegram_opportunity_drafts FROM authenticated;
GRANT ALL ON TABLE public.telegram_opportunity_drafts TO service_role;

ALTER TABLE public.telegram_opportunity_drafts ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies: no end-user role may read or write this table.

DROP TRIGGER IF EXISTS update_telegram_opportunity_drafts_updated_at
  ON public.telegram_opportunity_drafts;
CREATE TRIGGER update_telegram_opportunity_drafts_updated_at
  BEFORE UPDATE ON public.telegram_opportunity_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.telegram_opportunity_drafts IS
  'RB-3A: service-role-only Telegram Quick Post workflow state. Holds the recruiter-submitted source text and the whitelisted extracted payload until an explicit Confirm delegates creation to the canonical opportunity RPC. RLS on, no policies, TTL enforced.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Receipt vocabulary — narrow extension only
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.telegram_update_receipts
  DROP CONSTRAINT telegram_update_receipts_result_code_check;
ALTER TABLE public.telegram_update_receipts
  ADD CONSTRAINT telegram_update_receipts_result_code_check
  CHECK (result_code = ANY (ARRAY[
    'link_success'::text,
    'link_rejected'::text,
    'non_private_message'::text,
    'non_start_message'::text,
    'invalid_start_command'::text,
    'invalid_update_shape'::text,
    'bind_success'::text,
    'bind_rejected'::text,
    'menu_recruiter'::text,
    'menu_linked_no_workspace'::text,
    'menu_unlinked'::text,
    'menu_driver'::text,
    'menu_multi_role'::text,
    'menu_linked_unsupported'::text,
    'conversation_accepted'::text,
    'conversation_passed'::text,
    'conversation_already_handled'::text,
    'conversation_action_unavailable'::text,
    'conversation_action_denied'::text,
    'conversation_action_invalid'::text,
    'conversation_reply_sent'::text,
    'conversation_reply_denied'::text,
    'conversation_reply_unavailable'::text,
    'conversation_reply_invalid'::text,
    'conversation_reply_unroutable'::text,
    'quick_post_started'::text,
    'quick_post_denied'::text,
    'quick_post_unavailable'::text,
    'quick_post_source_reserved'::text,
    'quick_post_source_rejected'::text,
    'quick_post_created'::text,
    'quick_post_already_completed'::text,
    'quick_post_create_blocked'::text,
    'quick_post_cancelled'::text,
    'quick_post_restarted'::text,
    'quick_post_action_invalid'::text,
    'quick_post_action_denied'::text,
    'quick_post_action_unavailable'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Internal helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- The ONE recruiter workspace this Telegram account may Quick Post into.
-- Reuses the live RB-1A resolver verbatim: no role shortcut, no cached copy,
-- no caller override. Ambiguity (0 or >1 eligible workspaces) yields NULL and
-- the caller fails closed.
CREATE OR REPLACE FUNCTION public._telegram_quick_post_recruiter(
  _telegram_user_id bigint
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _recruiter_id uuid;
  _count integer;
BEGIN
  SELECT count(*)::int, min(r.recruiter_id)
    INTO _count, _recruiter_id
    FROM public.telegram_resolve_recruiter_actor(_telegram_user_id) r
   WHERE r.can_manage_opportunities IS TRUE;

  IF _count <> 1 THEN
    RETURN NULL;
  END IF;

  RETURN _recruiter_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._telegram_quick_post_recruiter(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._telegram_quick_post_recruiter(bigint) FROM anon;
REVOKE ALL ON FUNCTION public._telegram_quick_post_recruiter(bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._telegram_quick_post_recruiter(bigint) TO service_role;

-- Whitelist of the EXACT canonical parse_opportunity output fields. Every key
-- is an existing opportunities column already accepted by the canonical create
-- whitelist. Anything else is discarded deterministically and can never reach
-- the create RPC.
CREATE OR REPLACE FUNCTION public._telegram_quick_post_filter_payload(
  _payload jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT jsonb_object_agg(e.key, e.value)
        FROM jsonb_each(COALESCE(_payload, '{}'::jsonb)) e
       WHERE jsonb_typeof(COALESCE(_payload, '{}'::jsonb)) = 'object'
         AND e.value <> 'null'::jsonb
         AND e.key = ANY (ARRAY[
           'title','company_name','hiring_city','hiring_state','hiring_states',
           'driver_type','route_type','trailer_type','description','pay_model',
           'cpm','percentage_pay','flat_weekly_pay','estimated_weekly_gross',
           'estimated_weekly_miles','estimated_loaded_miles',
           'estimated_deadhead_miles','deadhead_paid','detention_pay',
           'layover_pay','sign_on_bonus','fuel_paid_by','insurance_deductions',
           'escrow_required','escrow_amount','lease_payment',
           'maintenance_deductions','other_deductions','home_time',
           'forced_dispatch','pets_allowed','riders_allowed','equipment_year',
           'typical_lanes','requirements','min_years_experience',
           'required_cdl_class','required_endorsements'
         ])
    ),
    '{}'::jsonb
  );
$function$;

REVOKE ALL ON FUNCTION public._telegram_quick_post_filter_payload(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._telegram_quick_post_filter_payload(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public._telegram_quick_post_filter_payload(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._telegram_quick_post_filter_payload(jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. `/post` — start a draft
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.telegram_process_quick_post_command_update(
  _lease_token uuid,
  _update_id bigint,
  _payload_hash text,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text
)
RETURNS TABLE(is_new boolean, result_code text, draft_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _existing public.telegram_update_receipts%ROWTYPE;
  _actor_user_id uuid;
  _linked_chat_id bigint;
  _recruiter_id uuid;
  _outcome text;
  _draft_id uuid;
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
       AND _existing.result_code = ANY (ARRAY[
             'quick_post_started', 'quick_post_denied', 'quick_post_unavailable'
           ]) THEN
      is_new := false;
      result_code := _existing.result_code;
      draft_id := NULL;
      RETURN NEXT;
      RETURN;
    END IF;

    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  IF _chat_type IS DISTINCT FROM 'private' THEN
    -- A group can never start a Quick Post.
    _outcome := 'quick_post_denied';
  ELSE
    SELECT l.user_id, l.telegram_user_id INTO _actor_user_id, _linked_chat_id
      FROM public.telegram_user_links l
     WHERE l.telegram_user_id = _telegram_user_id
       AND l.status = 'active';

    IF _actor_user_id IS NULL OR _linked_chat_id IS DISTINCT FROM _telegram_chat_id THEN
      _outcome := 'quick_post_denied';
    ELSE
      _recruiter_id := public._telegram_quick_post_recruiter(_telegram_user_id);

      IF _recruiter_id IS NULL THEN
        -- Not a recruiter with create capability, or more than one eligible
        -- workspace: this bot flow refuses to guess a tenant.
        _outcome := 'quick_post_unavailable';
      ELSE
        -- Starting again abandons any live draft for this account+chat. A
        -- confirmed draft is terminal and is never touched.
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
        RETURNING id INTO _draft_id;

        _outcome := 'quick_post_started';
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
  draft_id := _draft_id;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_process_quick_post_command_update(uuid, bigint, text, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_process_quick_post_command_update(uuid, bigint, text, bigint, bigint, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_process_quick_post_command_update(uuid, bigint, text, bigint, bigint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_process_quick_post_command_update(uuid, bigint, text, bigint, bigint, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Source capture — atomic reservation of exactly one Telegram update
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Ordinary private non-reply text reaches this processor. It becomes Quick Post
-- source ONLY when the same account+chat holds a live awaiting_input draft;
-- otherwise the pre-existing `non_start_message` outcome is recorded unchanged
-- and NOTHING is extracted.

CREATE OR REPLACE FUNCTION public.telegram_process_quick_post_source_update(
  _lease_token uuid,
  _update_id bigint,
  _payload_hash text,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text,
  _text text
)
RETURNS TABLE(is_new boolean, result_code text, draft_id uuid, actor_user_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _existing public.telegram_update_receipts%ROWTYPE;
  _draft public.telegram_opportunity_drafts%ROWTYPE;
  _linked_user_id uuid;
  _recruiter_id uuid;
  _outcome text;
  _trimmed text;
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
       AND _existing.result_code = ANY (ARRAY[
             'quick_post_source_reserved',
             'quick_post_source_rejected',
             'non_start_message'
           ]) THEN
      -- A duplicate delivery of the same update NEVER reserves a second time
      -- and therefore never spends a second model call.
      is_new := false;
      result_code := _existing.result_code;
      draft_id := NULL;
      actor_user_id := NULL;
      RETURN NEXT;
      RETURN;
    END IF;

    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  _trimmed := btrim(COALESCE(_text, ''));

  IF _chat_type IS DISTINCT FROM 'private' OR _trimmed = '' THEN
    _outcome := 'non_start_message';
  ELSE
    SELECT * INTO _draft
      FROM public.telegram_opportunity_drafts d
     WHERE d.telegram_user_id = _telegram_user_id
       AND d.telegram_chat_id = _telegram_chat_id
       AND d.state = 'awaiting_input'
       AND d.expires_at > now()
     FOR UPDATE;

    IF NOT FOUND THEN
      -- No live draft: unchanged pre-RB-3A behaviour. No extraction, ever.
      _outcome := 'non_start_message';
    ELSE
      SELECT l.user_id INTO _linked_user_id
        FROM public.telegram_user_links l
       WHERE l.telegram_user_id = _telegram_user_id
         AND l.status = 'active';

      _recruiter_id := public._telegram_quick_post_recruiter(_telegram_user_id);

      IF _linked_user_id IS NULL
         OR _linked_user_id IS DISTINCT FROM _draft.actor_user_id
         OR _recruiter_id IS NULL
         OR _recruiter_id IS DISTINCT FROM _draft.recruiter_id THEN
        -- Link revoked, account changed, or capability lost since /post.
        UPDATE public.telegram_opportunity_drafts
           SET state = 'failed', last_error_code = 'permission_revoked'
         WHERE id = _draft.id;
        _outcome := 'quick_post_source_rejected';
      ELSIF length(_trimmed) < 30 OR length(_trimmed) > 8000 THEN
        -- Bounded input. The draft stays open so the recruiter can paste again.
        UPDATE public.telegram_opportunity_drafts
           SET last_error_code = 'source_length_invalid'
         WHERE id = _draft.id;
        _outcome := 'quick_post_source_rejected';
      ELSE
        UPDATE public.telegram_opportunity_drafts
           SET state = 'extracting',
               raw_source_text = _trimmed,
               source_update_id = _update_id,
               last_error_code = NULL
         WHERE id = _draft.id;

        draft_id := _draft.id;
        actor_user_id := _draft.actor_user_id;
        _outcome := 'quick_post_source_reserved';
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
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_process_quick_post_source_update(uuid, bigint, text, bigint, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_process_quick_post_source_update(uuid, bigint, text, bigint, bigint, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_process_quick_post_source_update(uuid, bigint, text, bigint, bigint, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_process_quick_post_source_update(uuid, bigint, text, bigint, bigint, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Extraction outcome — persist ONLY whitelisted canonical extractor fields
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.telegram_complete_quick_post_extraction(
  _draft_id uuid,
  _extracted jsonb,
  _error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _draft public.telegram_opportunity_drafts%ROWTYPE;
  _filtered jsonb;
  _code text;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'delegation_denied' USING ERRCODE = '42501';
  END IF;

  IF _draft_id IS NULL THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;

  SELECT * INTO _draft
    FROM public.telegram_opportunity_drafts d
   WHERE d.id = _draft_id
     AND d.state = 'extracting'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;

  IF _error_code IS NOT NULL THEN
    _code := CASE WHEN _error_code ~ '^[a-z0-9_]{3,64}$'
                  THEN _error_code ELSE 'extraction_failed' END;
    UPDATE public.telegram_opportunity_drafts
       SET state = 'failed', last_error_code = _code, raw_source_text = NULL
     WHERE id = _draft.id;
    RETURN jsonb_build_object('state', 'failed', 'draft_id', _draft.id);
  END IF;

  _filtered := public._telegram_quick_post_filter_payload(_extracted);

  UPDATE public.telegram_opportunity_drafts
     SET state = 'review',
         extracted_payload = _filtered,
         raw_source_text = NULL,
         last_error_code = NULL
   WHERE id = _draft.id;

  RETURN jsonb_build_object(
    'state', 'review',
    'draft_id', _draft.id,
    'payload', _filtered
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_complete_quick_post_extraction(uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_complete_quick_post_extraction(uuid, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_complete_quick_post_extraction(uuid, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_complete_quick_post_extraction(uuid, jsonb, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Confirm / Start Over / Cancel — exactly-once, canonical creation only
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.telegram_process_quick_post_action_update(
  _lease_token uuid,
  _update_id bigint,
  _payload_hash text,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text,
  _action text,
  _draft_id uuid
)
RETURNS TABLE(is_new boolean, result_code text, draft_id uuid)
LANGUAGE plpgsql
VOLATILE
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
  -- ALREADY RECORDED outcome and can never create a second opportunity.
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
     OR _action NOT IN ('new', 'confirm', 'restart', 'cancel')
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
          -- Terminal. Repeated Confirm / Cancel / Start Over after success is
          -- reported as already completed and mutates nothing.
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
                     created_opportunity_id = (_created->>'id')::uuid,
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

REVOKE ALL ON FUNCTION public.telegram_process_quick_post_action_update(uuid, bigint, text, bigint, bigint, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_process_quick_post_action_update(uuid, bigint, text, bigint, bigint, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_process_quick_post_action_update(uuid, bigint, text, bigint, bigint, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_process_quick_post_action_update(uuid, bigint, text, bigint, bigint, text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.telegram_process_quick_post_action_update(uuid, bigint, text, bigint, bigint, text, text, uuid) IS
  'RB-3A: private-chat Quick Post Confirm / Start Over / Cancel. Service-role only. Re-derives the acting account and recruiter capability, treats the draft id as an untrusted locator, and delegates creation exclusively to create_recruiter_opportunity_as_actor. Creation and terminal receipt share one transaction, so a duplicate callback can never create a second opportunity.';

COMMIT;