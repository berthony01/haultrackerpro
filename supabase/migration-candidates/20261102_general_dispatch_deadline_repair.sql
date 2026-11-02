-- UNAPPLIED REPAIR CANDIDATE. Staging only; no activation or table writes.
-- Definitions exported with pg_get_functiondef from the compiled baseline fixture.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_catalog.pg_advisory_xact_lock(741029,1);
DO $guard$
DECLARE _ids oid[]:=ARRAY['public.telegram_process_dispatch_review_action(uuid,bigint,text,bigint,bigint,text,text,uuid)'::regprocedure::oid,'public.telegram_claim_dispatch_review_delivery()'::regprocedure::oid]; _metadata jsonb;
BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE (p.oid='public.telegram_process_dispatch_review_action(uuid,bigint,text,bigint,bigint,text,text,uuid)'::regprocedure AND md5(p.prosrc)='834d89f6186a920b3805e32bd42e8fef') OR (p.oid='public.telegram_claim_dispatch_review_delivery()'::regprocedure AND md5(p.prosrc)='5e38139dad516002d11804e8753c2e83'))<>2 THEN RAISE EXCEPTION 'general_deadline_version_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=ANY(_ids) AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql'))) THEN RAISE EXCEPTION 'general_deadline_metadata_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=ANY(_ids) AND a.privilege_type='EXECUTE' AND (a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated')))) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=ANY(_ids) AND NOT pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'general_deadline_unsafe_acl'; END IF;
 SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'security_definer',p.prosecdef,'config',p.proconfig,'language',p.prolang,'arguments',p.proargtypes::text,'all_arguments',p.proallargtypes,'modes',p.proargmodes,'names',p.proargnames,'return_type',p.prorettype,'returns_set',p.proretset,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'cost',p.procost,'rows',p.prorows) ORDER BY p.oid) INTO _metadata FROM pg_catalog.pg_proc p WHERE p.oid=ANY(ARRAY['public.telegram_process_dispatch_review_action(uuid,bigint,text,bigint,bigint,text,text,uuid)'::regprocedure::oid,'public.telegram_claim_dispatch_review_delivery()'::regprocedure::oid]);
 PERFORM pg_catalog.set_config('haultracker.general_deadline_metadata',_metadata::text,true);
END;
$guard$;

CREATE OR REPLACE FUNCTION public.telegram_process_dispatch_review_action(_lease_token uuid, _update_id bigint, _payload_hash text, _telegram_user_id bigint, _telegram_chat_id bigint, _chat_type text, _action text, _proposal_id uuid)
 RETURNS TABLE(is_new boolean, result_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  -- One workflow lock: consistent proposal/load/outbox order, absent receipt dedupe.
  -- Serializes G1B only; no changes to existing poller or dispatch authority.
  PERFORM pg_advisory_xact_lock(741029, 1);
  IF public._telegram_qa_dispatch_active() THEN
    PERFORM public._telegram_qa_dispatch_assert(_telegram_chat_id,_chat_type);
  END IF;
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
       AND s.lease_expires_at > clock_timestamp()
     FOR SHARE
  ) THEN
    RAISE EXCEPTION 'telegram_poll_lease_invalid';
  END IF;

  IF public._telegram_qa_dispatch_active() AND NOT public._telegram_qa_dispatch_proposal(_proposal_id) THEN RAISE EXCEPTION 'qa_dispatch_scope_denied'; END IF;
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

  IF public._telegram_qa_dispatch_active() AND NOT public._telegram_qa_dispatch_proposal(_proposal_id) THEN RAISE EXCEPTION 'qa_dispatch_scope_denied'; END IF;
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
    IF public._telegram_qa_dispatch_active() THEN
      PERFORM public._telegram_qa_dispatch_assert(_telegram_chat_id,_chat_type);
      IF NOT public._telegram_qa_dispatch_proposal(_proposal_id) THEN RAISE EXCEPTION 'qa_dispatch_scope_denied'; END IF;
    END IF;

    -- Unknown id and another chat's proposal are indistinguishable.
    IF NOT FOUND OR _p.telegram_chat_id <> _telegram_chat_id THEN
      _outcome := 'dispatch_review_invalid';
    ELSIF _p.status <> 'pending' THEN
      _outcome := 'dispatch_review_already_handled';
    ELSIF _p.expires_at <= clock_timestamp() THEN
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
       AND b.status = 'active'
     FOR SHARE;

    SELECT l.user_id INTO _reviewer
      FROM public.telegram_user_links l
     WHERE l.telegram_user_id = _telegram_user_id
       AND l.status = 'active'
     FOR SHARE;

    SELECT r.driver_user_id INTO _driver_user_id
      FROM public.carrier_driver_relationships r
     WHERE r.id = _p.relationship_id
       AND r.recruiter_id = _p.recruiter_id
       AND r.status = 'active'
     FOR SHARE;

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
    -- Freeze permission/membership revocation until this decision commits.
    PERFORM 1 FROM public.recruiter_profiles WHERE id=_p.recruiter_id FOR SHARE;
    PERFORM 1 FROM public.recruiter_members WHERE recruiter_id=_p.recruiter_id FOR SHARE;
    -- Same actor-claim pattern the existing TG-2C wrapper uses (local only).
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', _reviewer::text, true);

    IF public._telegram_qa_dispatch_active() THEN PERFORM public._telegram_qa_dispatch_assert(_telegram_chat_id,_chat_type); END IF;
    IF _p.expires_at <= clock_timestamp() THEN
      UPDATE public.telegram_dispatch_review_proposals
         SET status = 'expired', decided_at = now()
       WHERE id = _p.id;
      _outcome := 'dispatch_review_expired';
    ELSIF _action = 'reject' THEN
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
        IF public._telegram_qa_dispatch_active() THEN PERFORM public._telegram_qa_dispatch_assert(_telegram_chat_id,_chat_type); END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.telegram_claim_dispatch_review_delivery()
 RETURNS TABLE(outbox_id uuid, claim_token uuid, proposal_id uuid, telegram_chat_id bigint, load_reference text, proposed_status text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE _id uuid; _token uuid := gen_random_uuid(); _now timestamptz;
  _proposal_status text; _proposal_expires timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(741029, 1);
  IF public._telegram_qa_dispatch_active() THEN
    PERFORM public._telegram_qa_dispatch_assert();
  END IF;
  _now := clock_timestamp();
  -- Expired, decided, revoked, re-owned, stale or ended proposals are not sent.
  UPDATE public.telegram_dispatch_review_outbox o
    SET delivery_state='cancelled', claim_token=NULL, lease_expires_at=NULL,
        completed_at=_now, updated_at=_now, last_failure_code='proposal_closed'
    FROM public.telegram_dispatch_review_proposals p
    WHERE p.id=o.proposal_id AND (NOT COALESCE(public._telegram_qa_dispatch_active(),false) OR public._telegram_qa_dispatch_proposal(p.id)) AND o.delivery_state IN ('pending','sending','failed')
      AND (p.status<>'pending' OR p.expires_at<=_now OR NOT EXISTS (
        SELECT 1 FROM public.telegram_chat_bindings b
        JOIN public.carrier_driver_relationships r ON r.id=p.relationship_id
        JOIN public.loads l ON l.id=p.load_id
        WHERE b.id=p.binding_id AND b.telegram_chat_id=p.telegram_chat_id
          AND b.recruiter_id=p.recruiter_id AND b.status='active'
          AND r.recruiter_id=p.recruiter_id AND r.status='active'
          AND l.carrier_driver_relationship_id=r.id AND l.user_id=r.driver_user_id
          AND l.status=p.expected_previous_status));
  UPDATE public.telegram_dispatch_review_outbox o
    SET delivery_state='failed', claim_token=NULL, lease_expires_at=NULL,
        completed_at=_now, updated_at=_now, last_failure_code='attempts_exhausted'
    WHERE (NOT COALESCE(public._telegram_qa_dispatch_active(),false) OR public._telegram_qa_dispatch_proposal(o.proposal_id)) AND o.delivery_state='sending' AND o.lease_expires_at<=_now AND o.attempt_count>=o.max_attempts;
  SELECT o.id INTO _id FROM public.telegram_dispatch_review_outbox o
    WHERE (NOT COALESCE(public._telegram_qa_dispatch_active(),false) OR public._telegram_qa_dispatch_proposal(o.proposal_id)) AND (o.delivery_state='pending' AND o.next_attempt_at<=_now
       OR o.delivery_state='sending' AND o.lease_expires_at<=_now)
      AND o.attempt_count<o.max_attempts
    ORDER BY o.next_attempt_at,o.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF _id IS NULL THEN
    IF public._telegram_qa_dispatch_active() THEN PERFORM public._telegram_qa_dispatch_assert(); END IF;
    RETURN;
  END IF;
  IF public._telegram_qa_dispatch_active() THEN PERFORM public._telegram_qa_dispatch_assert(); END IF;
  SELECT p.status,p.expires_at INTO _proposal_status,_proposal_expires
    FROM public.telegram_dispatch_review_proposals p
    JOIN public.telegram_dispatch_review_outbox o ON o.proposal_id=p.id
    WHERE o.id=_id FOR SHARE OF p;
  _now := clock_timestamp();
  IF NOT FOUND OR _proposal_status IS DISTINCT FROM 'pending' OR _proposal_expires <= _now THEN
    UPDATE public.telegram_dispatch_review_outbox o
      SET delivery_state='cancelled', claim_token=NULL, lease_expires_at=NULL,
          completed_at=_now, updated_at=_now, last_failure_code='proposal_closed'
      WHERE o.id=_id;
    RETURN;
  END IF;
  UPDATE public.telegram_dispatch_review_outbox o
    SET delivery_state='sending', attempt_count=attempt_count+1, claim_token=_token,
        lease_expires_at=_now+interval '60 seconds', updated_at=_now
    WHERE o.id=_id;
  RETURN QUERY SELECT o.id,o.claim_token,p.id,p.telegram_chat_id,p.load_reference,p.proposed_status,p.expires_at
    FROM public.telegram_dispatch_review_outbox o
    JOIN public.telegram_dispatch_review_proposals p ON p.id=o.proposal_id WHERE o.id=_id;
END;
$function$;

DO $post$
DECLARE _ids oid[]:=ARRAY['public.telegram_process_dispatch_review_action(uuid,bigint,text,bigint,bigint,text,text,uuid)'::regprocedure::oid,'public.telegram_claim_dispatch_review_delivery()'::regprocedure::oid]; _metadata jsonb;
BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE (p.oid='public.telegram_process_dispatch_review_action(uuid,bigint,text,bigint,bigint,text,text,uuid)'::regprocedure AND md5(p.prosrc)='df914d4a72536fb05a33301ecc72701b') OR (p.oid='public.telegram_claim_dispatch_review_delivery()'::regprocedure AND md5(p.prosrc)='f249d3b36ee6a33ecd1b239ec9fb383d'))<>2 THEN RAISE EXCEPTION 'general_deadline_post_hash_mismatch'; END IF;
 SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'security_definer',p.prosecdef,'config',p.proconfig,'language',p.prolang,'arguments',p.proargtypes::text,'all_arguments',p.proallargtypes,'modes',p.proargmodes,'names',p.proargnames,'return_type',p.prorettype,'returns_set',p.proretset,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'cost',p.procost,'rows',p.prorows) ORDER BY p.oid) INTO _metadata FROM pg_catalog.pg_proc p WHERE p.oid=ANY(ARRAY['public.telegram_process_dispatch_review_action(uuid,bigint,text,bigint,bigint,text,text,uuid)'::regprocedure::oid,'public.telegram_claim_dispatch_review_delivery()'::regprocedure::oid]);
 IF _metadata IS DISTINCT FROM current_setting('haultracker.general_deadline_metadata')::jsonb THEN RAISE EXCEPTION 'general_deadline_metadata_changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=ANY(_ids) AND a.privilege_type='EXECUTE' AND (a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated')))) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=ANY(_ids) AND NOT pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'general_deadline_unsafe_acl'; END IF;
END;
$post$;
COMMIT;
