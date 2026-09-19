-- ─────────────────────────────────────────────────────────────────────────────
-- Phase RB-3B-B — Editable Telegram Quick Post draft handoff
--
-- Scope (candidate migration — NOT applied in this build turn):
--   1. Receipt vocabulary gains exactly one code: quick_post_review_refreshed.
--   2. The quick-post payload filter is widened to the SAME canonical writable
--      field set already accepted by create_recruiter_opportunity, so values
--      corrected in the web authoring form survive Confirm.
--   3. Two AUTHENTICATED, actor-scoped SECURITY DEFINER RPCs let the owning
--      recruiter read and re-save the draft payload from the web form. The
--      draft id is an untrusted locator: possession is never authorization.
--      Telegram identity, raw source text and the source update id are NEVER
--      returned. Neither RPC touches public.opportunities.
--   4. A service-role-only snapshot RPC lets the poller re-render the review
--      from the CURRENT payload (Refresh Review) with zero model calls.
--   5. The existing action RPC gains a single 'refresh' branch. Confirm,
--      Start Over and Cancel semantics are untouched.
--
-- The draft table itself is unchanged: still RLS-enabled with NO authenticated
-- policies, still service-role-only for direct access. All authenticated access
-- flows exclusively through the two definer RPCs below.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Receipt vocabulary — one narrow addition
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
    'quick_post_review_refreshed'::text,
    'quick_post_action_invalid'::text,
    'quick_post_action_denied'::text,
    'quick_post_action_unavailable'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Canonical quick-post writable field set
-- ─────────────────────────────────────────────────────────────────────────────

-- The EXACT write whitelist of create_recruiter_opportunity. Every server-managed
-- column (id, recruiter_id, admin_review_status, featured, view_count,
-- created_at, updated_at, published_at) is absent by construction.
CREATE OR REPLACE FUNCTION public._telegram_quick_post_editable_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT ARRAY[
    'title','company_name','hiring_city','hiring_state','hiring_states',
    'driver_type','route_type','trailer_type','pay_model','cpm',
    'percentage_pay','flat_weekly_pay','estimated_weekly_gross',
    'estimated_weekly_miles','estimated_loaded_miles','estimated_deadhead_miles',
    'deadhead_paid','detention_pay','layover_pay','sign_on_bonus','fuel_paid_by',
    'insurance_deductions','escrow_required','escrow_amount','lease_payment',
    'maintenance_deductions','other_deductions','home_time','forced_dispatch',
    'pets_allowed','riders_allowed','equipment_year','benefits','description',
    'transparency_confirmed','status','canonical_version','employment_model',
    'team_configuration','percentage_basis_label',
    'percentage_weekly_revenue_basis','salary_amount','salary_frequency',
    'mixed_pay_components','other_pay_method_label','other_weekly_gross',
    'insurance_deduction_frequency','escrow_required_state',
    'escrow_amount_frequency','lease_payment_frequency',
    'maintenance_deduction_frequency','other_deduction_frequency',
    'typical_lanes','requirements','actual_benefits','min_years_experience',
    'required_cdl_class','required_endorsements'
  ]::text[];
$function$;

REVOKE ALL ON FUNCTION public._telegram_quick_post_editable_keys() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._telegram_quick_post_editable_keys() FROM anon;
-- Internal whitelist helper. The authenticated web RPCs reach it through
-- SECURITY DEFINER ownership, so `authenticated` gets no direct execute.
REVOKE ALL ON FUNCTION public._telegram_quick_post_editable_keys() FROM authenticated;
GRANT EXECUTE ON FUNCTION public._telegram_quick_post_editable_keys() TO service_role;

-- Widened to the canonical writable set so web-corrected canonical fields
-- (employment_model, team_configuration, pay frequencies, mixed pay, benefits,
-- transparency) survive into Confirm. Nothing outside the create whitelist can
-- pass, and NULL values are still dropped so column defaults keep applying.
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
         AND e.key = ANY (public._telegram_quick_post_editable_keys())
    ),
    '{}'::jsonb
  );
$function$;

REVOKE ALL ON FUNCTION public._telegram_quick_post_filter_payload(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._telegram_quick_post_filter_payload(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public._telegram_quick_post_filter_payload(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._telegram_quick_post_filter_payload(jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Authenticated, actor-scoped web edit RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- Read. Fails CLOSED to a generic unavailable result: an unowned, expired,
-- already-created, wrong-state or non-existent locator is indistinguishable.
CREATE OR REPLACE FUNCTION public.get_telegram_opportunity_draft_for_edit(
  _draft_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _actor uuid;
  _draft public.telegram_opportunity_drafts%ROWTYPE;
BEGIN
  _actor := auth.uid();
  IF _actor IS NULL OR _draft_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  SELECT * INTO _draft
    FROM public.telegram_opportunity_drafts d
   WHERE d.id = _draft_id
     AND d.actor_user_id = _actor;

  IF NOT FOUND
     OR _draft.state <> 'review'
     OR _draft.created_opportunity_id IS NOT NULL
     OR _draft.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  IF NOT public.current_user_can_recruiter_opportunity_action(
       _draft.recruiter_id,
       'opportunities_create'::public.recruiter_workspace_permission
     ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  -- Only editor-safe fields. No telegram_user_id, no telegram_chat_id, no
  -- raw_source_text, no source_update_id.
  RETURN jsonb_build_object(
    'ok', true,
    'draft_id', _draft.id,
    'state', _draft.state,
    'recruiter_id', _draft.recruiter_id,
    'expires_at', _draft.expires_at,
    'payload', public._telegram_quick_post_filter_payload(_draft.extracted_payload)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_telegram_opportunity_draft_for_edit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_telegram_opportunity_draft_for_edit(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_telegram_opportunity_draft_for_edit(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_telegram_opportunity_draft_for_edit(uuid) IS
  'RB-3B-B: authenticated, actor-scoped read of a reviewable Telegram Quick Post draft for the web authoring form. Draft id is an untrusted locator. Returns only editor-safe fields and fails closed to a generic unavailable result.';

-- Save. Updates ONLY extracted_payload (plus clearing the bounded error code)
-- on the caller's own reviewable draft. Never creates or updates an opportunity.
CREATE OR REPLACE FUNCTION public.save_telegram_opportunity_draft_payload(
  _draft_id uuid,
  _payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _actor uuid;
  _draft public.telegram_opportunity_drafts%ROWTYPE;
  _key text;
  _filtered jsonb;
BEGIN
  _actor := auth.uid();
  IF _actor IS NULL OR _draft_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  IF _payload IS NULL OR jsonb_typeof(_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  -- Fail closed on ANY field outside the canonical write whitelist. Ownership,
  -- recruiter identity, Telegram identity, state and creation linkage can never
  -- be supplied by a caller.
  FOR _key IN SELECT jsonb_object_keys(_payload) LOOP
    IF NOT (_key = ANY (public._telegram_quick_post_editable_keys())) THEN
      RAISE EXCEPTION 'unknown_field' USING ERRCODE = '22023', DETAIL = _key;
    END IF;
  END LOOP;

  -- Lifecycle stays server-owned: the web editor can never raise a Quick Post
  -- draft to an active/published status. Confirm remains the only creator and
  -- keeps producing a draft opportunity.
  _payload := _payload - 'status';

  SELECT * INTO _draft
    FROM public.telegram_opportunity_drafts d
   WHERE d.id = _draft_id
     AND d.actor_user_id = _actor
   FOR UPDATE;

  IF NOT FOUND
     OR _draft.state <> 'review'
     OR _draft.created_opportunity_id IS NOT NULL
     OR _draft.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  IF NOT public.current_user_can_recruiter_opportunity_action(
       _draft.recruiter_id,
       'opportunities_create'::public.recruiter_workspace_permission
     ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  _filtered := public._telegram_quick_post_filter_payload(_payload);

  UPDATE public.telegram_opportunity_drafts
     SET extracted_payload = _filtered,
         last_error_code = NULL
   WHERE id = _draft.id
     AND state = 'review'
     AND created_opportunity_id IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'draft_id', _draft.id,
    'state', 'review',
    'payload', _filtered
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_telegram_opportunity_draft_payload(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_telegram_opportunity_draft_payload(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_telegram_opportunity_draft_payload(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.save_telegram_opportunity_draft_payload(uuid, jsonb) IS
  'RB-3B-B: authenticated, actor-scoped save of corrected Quick Post draft values. Writes only extracted_payload on the caller''s own reviewable draft, filtered through the canonical opportunity write whitelist. Never creates or updates an opportunity.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Service-role review snapshot (Refresh Review)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.telegram_quick_post_review_snapshot(
  _draft_id uuid,
  _telegram_user_id bigint,
  _telegram_chat_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _draft public.telegram_opportunity_drafts%ROWTYPE;
BEGIN
  IF _draft_id IS NULL OR _telegram_user_id IS NULL OR _telegram_chat_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _draft
    FROM public.telegram_opportunity_drafts d
   WHERE d.id = _draft_id
     AND d.telegram_user_id = _telegram_user_id
     AND d.telegram_chat_id = _telegram_chat_id
     AND d.state = 'review'
     AND d.created_opportunity_id IS NULL
     AND d.expires_at > now();

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN public._telegram_quick_post_filter_payload(_draft.extracted_payload);
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_quick_post_review_snapshot(uuid, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_quick_post_review_snapshot(uuid, bigint, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_quick_post_review_snapshot(uuid, bigint, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_quick_post_review_snapshot(uuid, bigint, bigint) TO service_role;

COMMENT ON FUNCTION public.telegram_quick_post_review_snapshot(uuid, bigint, bigint) IS
  'RB-3B-B: service-role read of the CURRENT filtered payload of a reviewable Quick Post draft, scoped to the owning Telegram account and chat. Read-only: no model call, no mutation.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Action RPC — single 'refresh' branch
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
  'RB-3A/RB-3B-B: private-chat Quick Post Confirm / Start Over / Cancel / Refresh Review. Service-role only. Re-derives the acting account and recruiter capability, treats the draft id as an untrusted locator, and delegates creation exclusively to create_recruiter_opportunity_as_actor. Refresh is read-only.';