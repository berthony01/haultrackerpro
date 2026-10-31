-- UNAPPLIED CANDIDATE. No runtime routing or global dispatch activation.
-- Exact live prosrc hashes verified 2026-10-31. No table/data changes.
-- Scope is pinned once, from the QA load's unique active binding, at application.
-- Ordinary RPC calls retain their accepted behavior. QA entry points are service-only.
-- Rollback: restore the three reviewed original bodies, then drop QA helpers/wrappers.
BEGIN;
DO $validate$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='public' AND p.prosecdef AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
 AND ((p.oid='public.telegram_process_dispatch_group_update(uuid,bigint,text,bigint,bigint,text,text,text)'::regprocedure AND md5(p.prosrc)='eb3cde47e30259d760cf8afab290355f' AND p.proconfig=ARRAY['search_path=pg_catalog, public'])
 OR (p.oid='public.telegram_process_dispatch_review_action(uuid,bigint,text,bigint,bigint,text,text,uuid)'::regprocedure AND md5(p.prosrc)='552e8ae2a760e77c67b6c83a027c3458' AND p.proconfig=ARRAY['search_path=pg_catalog, public, auth'])
 OR (p.oid='public.telegram_claim_dispatch_review_delivery()'::regprocedure AND md5(p.prosrc)='1ce05efedd67ef1adf8eb1da02bb6ff2' AND p.proconfig=ARRAY['search_path=pg_catalog, public']));
 IF n<>3 THEN RAISE EXCEPTION 'qa_dispatch_version_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('telegram_process_dispatch_group_update','telegram_process_dispatch_review_action','telegram_claim_dispatch_review_delivery')
 AND a.privilege_type='EXECUTE' AND (a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated'))))
 THEN RAISE EXCEPTION 'qa_dispatch_unsafe_grants'; END IF;
END;
$validate$;

-- Service-only immutable provenance; no Telegram identifiers are returned.
DO $pin$
DECLARE x record; n integer;
BEGIN
 LOCK TABLE public.loads,public.carrier_driver_relationships,public.telegram_chat_bindings,public.recruiter_profiles IN SHARE MODE;
 SELECT count(*) INTO n FROM public.loads l
 JOIN public.carrier_driver_relationships r ON r.id=l.carrier_driver_relationship_id
 JOIN public.recruiter_profiles rp ON rp.id=r.recruiter_id
 JOIN public.telegram_chat_bindings b ON b.recruiter_id=r.recruiter_id
 WHERE l.id='cb3d3a90-ac48-4d20-af52-d6710d854e81' AND l.load_reference='HTP-QA-L2'
 AND l.status='pending' AND l.user_id=r.driver_user_id AND r.status='active' AND rp.status='active'
 AND b.status='active' AND b.revoked_at IS NULL AND b.telegram_chat_id<0 AND b.chat_type IN ('group','supergroup');
 IF n<>1 OR clock_timestamp()>='2026-11-02 23:59:59+00'::timestamptz THEN RAISE EXCEPTION 'qa_dispatch_provenance_unavailable'; END IF;
 SELECT r.id relationship_id,r.recruiter_id,b.id binding_id,b.telegram_chat_id,b.chat_type INTO STRICT x
 FROM public.loads l JOIN public.carrier_driver_relationships r ON r.id=l.carrier_driver_relationship_id
 JOIN public.telegram_chat_bindings b ON b.recruiter_id=r.recruiter_id
 WHERE l.id='cb3d3a90-ac48-4d20-af52-d6710d854e81' AND b.status='active' AND b.revoked_at IS NULL;
 EXECUTE format($ddl$CREATE FUNCTION public._telegram_qa_dispatch_scope()
 RETURNS TABLE(relationship_id uuid,recruiter_id uuid,binding_id uuid,chat_id bigint,chat_type text)
 LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'
 AS %L$ddl$,format('SELECT %L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::text',x.relationship_id,x.recruiter_id,x.binding_id,x.telegram_chat_id,x.chat_type));
END;
$pin$;

CREATE FUNCTION public._telegram_qa_dispatch_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $$ SELECT current_setting('haultracker.qa_dispatch_scope',true)='single-load-v1' $$;

-- Post-lock live validation. Throws to roll back the entire QA transaction on expiry.
CREATE FUNCTION public._telegram_qa_dispatch_assert(_chat bigint DEFAULT NULL,_type text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $$
BEGIN
 PERFORM 1 FROM public._telegram_qa_dispatch_scope() s
 JOIN public.telegram_chat_bindings b ON b.id=s.binding_id
 JOIN public.carrier_driver_relationships r ON r.id=s.relationship_id
 JOIN public.recruiter_profiles rp ON rp.id=s.recruiter_id
 JOIN public.loads l ON l.id='cb3d3a90-ac48-4d20-af52-d6710d854e81'
 WHERE b.status='active' AND b.revoked_at IS NULL AND b.telegram_chat_id=s.chat_id AND b.chat_type=s.chat_type AND b.recruiter_id=s.recruiter_id
 AND r.status='active' AND r.recruiter_id=s.recruiter_id AND rp.status='active'
 AND l.load_reference='HTP-QA-L2' AND l.carrier_driver_relationship_id=s.relationship_id AND l.user_id=r.driver_user_id
 AND (_chat IS NULL OR _chat=s.chat_id) AND (_type IS NULL OR _type=s.chat_type)
 FOR SHARE OF b,r,rp,l;
 IF NOT FOUND THEN RAISE EXCEPTION 'qa_dispatch_scope_denied'; END IF;
 IF clock_timestamp()>='2026-11-02 23:59:59+00'::timestamptz THEN RAISE EXCEPTION 'qa_dispatch_expired'; END IF;
END;
$$;
CREATE FUNCTION public._telegram_qa_dispatch_proposal(_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $$ SELECT EXISTS(SELECT 1 FROM public.telegram_dispatch_review_proposals p CROSS JOIN public._telegram_qa_dispatch_scope() s
 WHERE p.id=_id AND p.load_id='cb3d3a90-ac48-4d20-af52-d6710d854e81' AND p.load_reference='HTP-QA-L2' AND p.proposed_status='cancelled'
 AND p.binding_id=s.binding_id AND p.telegram_chat_id=s.chat_id AND p.recruiter_id=s.recruiter_id AND p.relationship_id=s.relationship_id) $$;

CREATE FUNCTION public._telegram_qa_dispatch_actor(_actor bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $$ DECLARE actor_user uuid; s record; driver_user uuid;
 previous_actor text:=current_setting('request.jwt.claim.sub',true);
BEGIN
 SELECT l.user_id INTO actor_user FROM public.telegram_user_links l
 WHERE l.telegram_user_id=_actor AND l.status='active' AND l.revoked_at IS NULL FOR SHARE;
 IF actor_user IS NULL THEN RAISE EXCEPTION 'qa_dispatch_actor_denied'; END IF;
 SELECT * INTO STRICT s FROM public._telegram_qa_dispatch_scope();
 PERFORM 1 FROM public.recruiter_profiles WHERE id=s.recruiter_id FOR SHARE;
 PERFORM 1 FROM public.recruiter_members WHERE recruiter_id=s.recruiter_id FOR SHARE;
 SELECT r.driver_user_id INTO driver_user FROM public.carrier_driver_relationships r WHERE r.id=s.relationship_id FOR SHARE;
 PERFORM set_config('request.jwt.claim.sub',actor_user::text,true);
 IF NOT public.current_user_can_dispatch_load_action(s.recruiter_id,s.relationship_id,driver_user,'loads_update_status') THEN
  RAISE EXCEPTION 'qa_dispatch_actor_denied';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',COALESCE(previous_actor,''),true);
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claim.sub',COALESCE(previous_actor,''),true); RAISE;
END; $$;

CREATE OR REPLACE FUNCTION public.telegram_process_dispatch_group_update(_lease_token uuid, _update_id bigint, _payload_hash text, _telegram_user_id bigint, _telegram_chat_id bigint, _chat_type text, _reference text, _proposed_status text)
 RETURNS TABLE(is_new boolean, result_code text, proposal_id uuid, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
       AND s.lease_expires_at > clock_timestamp()
     FOR SHARE
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
         AND p.source_update_id = _update_id
         AND (NOT COALESCE(public._telegram_qa_dispatch_active(),false) OR public._telegram_qa_dispatch_proposal(p.id));
      is_new := false;
      result_code := _existing.result_code;
      proposal_id := _new_id;
      expires_at := _new_expires;
      RETURN NEXT;
      RETURN;
    END IF;
    RAISE EXCEPTION 'telegram_update_conflict';
  END IF;

  IF public._telegram_qa_dispatch_active() AND (_reference IS DISTINCT FROM 'HTP-QA-L2' OR _proposed_status IS DISTINCT FROM 'cancelled') THEN RAISE EXCEPTION 'qa_dispatch_scope_denied'; END IF;
  IF public._telegram_qa_dispatch_active() THEN PERFORM public._telegram_qa_dispatch_actor(_telegram_user_id); END IF;
  IF _reference IS NOT NULL THEN
    SELECT * INTO _binding
      FROM public.telegram_chat_bindings b
     WHERE b.telegram_chat_id = _telegram_chat_id
       AND b.status = 'active'
     FOR SHARE;

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
         AND upper(btrim(l.load_reference)) = _reference
         AND (NOT COALESCE(public._telegram_qa_dispatch_active(),false) OR l.id='cb3d3a90-ac48-4d20-af52-d6710d854e81');

      IF _match_count = 1 THEN
        SELECT l.status, l.carrier_driver_relationship_id
          INTO _load_status, _relationship_id
          FROM public.loads l
         WHERE l.id = _load_id
         FOR UPDATE;

        IF _load_status IN ('pending','en_route') AND EXISTS (
          SELECT 1 FROM public.loads l
          JOIN public.carrier_driver_relationships r ON r.id=l.carrier_driver_relationship_id
          WHERE l.id=_load_id AND r.recruiter_id=_binding.recruiter_id
            AND r.status='active' AND l.user_id=r.driver_user_id
            AND upper(btrim(l.load_reference))=_reference FOR SHARE OF r
        ) THEN
          -- Retire this load's expired pending proposal so the per-load cap
          -- does not block a fresh, legitimate report.
          UPDATE public.telegram_dispatch_review_proposals p
             SET status = 'expired', decided_at = now()
           WHERE p.load_id = _load_id
             AND p.status = 'pending'
             AND p.expires_at <= clock_timestamp();

          IF NOT EXISTS (
            SELECT 1 FROM public.telegram_dispatch_review_proposals p
             WHERE p.load_id = _load_id AND p.status = 'pending'
          ) THEN
            _key := 'tg-dg:v1:' || _telegram_chat_id::text || ':' || _update_id::text
                    || ':' || _load_id::text || ':' || _proposed_status;

            IF public._telegram_qa_dispatch_active() THEN
              PERFORM public._telegram_qa_dispatch_actor(_telegram_user_id);
              PERFORM public._telegram_qa_dispatch_assert(_telegram_chat_id,_chat_type);
            END IF;
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

            INSERT INTO public.telegram_dispatch_review_outbox(proposal_id) VALUES (_new_id);

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
$function$;

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
  UPDATE public.telegram_dispatch_review_outbox o
    SET delivery_state='sending', attempt_count=attempt_count+1, claim_token=_token,
        lease_expires_at=_now+interval '60 seconds', updated_at=_now
    WHERE o.id=_id;
  RETURN QUERY SELECT o.id,o.claim_token,p.id,p.telegram_chat_id,p.load_reference,p.proposed_status,p.expires_at
    FROM public.telegram_dispatch_review_outbox o
    JOIN public.telegram_dispatch_review_proposals p ON p.id=o.proposal_id WHERE o.id=_id;
END;
$function$;

CREATE FUNCTION public.telegram_qa_process_dispatch_group_update(_lease_token uuid,_update_id bigint,_payload_hash text,_telegram_user_id bigint,_telegram_chat_id bigint,_chat_type text,_reference text,_proposed_status text) RETURNS TABLE(is_new boolean,result_code text,proposal_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $$ DECLARE previous_scope text:=current_setting('haultracker.qa_dispatch_scope',true);
BEGIN
 PERFORM set_config('haultracker.qa_dispatch_scope','single-load-v1',true);
 RETURN QUERY SELECT * FROM public.telegram_process_dispatch_group_update(_lease_token,_update_id,_payload_hash,_telegram_user_id,_telegram_chat_id,_chat_type,_reference,_proposed_status);
 PERFORM set_config('haultracker.qa_dispatch_scope',COALESCE(previous_scope,''),true);
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('haultracker.qa_dispatch_scope',COALESCE(previous_scope,''),true); RAISE;
END; $$;

CREATE FUNCTION public.telegram_qa_process_dispatch_review_action(_lease_token uuid,_update_id bigint,_payload_hash text,_telegram_user_id bigint,_telegram_chat_id bigint,_chat_type text,_action text,_proposal_id uuid) RETURNS TABLE(is_new boolean,result_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $$ DECLARE previous_scope text:=current_setting('haultracker.qa_dispatch_scope',true);
BEGIN
 PERFORM set_config('haultracker.qa_dispatch_scope','single-load-v1',true);
 RETURN QUERY SELECT * FROM public.telegram_process_dispatch_review_action(_lease_token,_update_id,_payload_hash,_telegram_user_id,_telegram_chat_id,_chat_type,_action,_proposal_id);
 PERFORM set_config('haultracker.qa_dispatch_scope',COALESCE(previous_scope,''),true);
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('haultracker.qa_dispatch_scope',COALESCE(previous_scope,''),true); RAISE;
END; $$;

CREATE FUNCTION public.telegram_qa_claim_dispatch_review_delivery() RETURNS TABLE(outbox_id uuid,claim_token uuid,proposal_id uuid,telegram_chat_id bigint,load_reference text,proposed_status text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $$ DECLARE previous_scope text:=current_setting('haultracker.qa_dispatch_scope',true);
BEGIN
 PERFORM set_config('haultracker.qa_dispatch_scope','single-load-v1',true);
 RETURN QUERY SELECT * FROM public.telegram_claim_dispatch_review_delivery();
 PERFORM set_config('haultracker.qa_dispatch_scope',COALESCE(previous_scope,''),true);
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('haultracker.qa_dispatch_scope',COALESCE(previous_scope,''),true); RAISE;
END; $$;

DO $acl$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace
 AND (p.proname LIKE '\_telegram\_qa\_dispatch\_%' ESCAPE '\' OR p.proname IN ('telegram_qa_process_dispatch_group_update','telegram_qa_process_dispatch_review_action','telegram_qa_claim_dispatch_review_delivery'))
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig); END LOOP;
END; $acl$;
COMMIT;
