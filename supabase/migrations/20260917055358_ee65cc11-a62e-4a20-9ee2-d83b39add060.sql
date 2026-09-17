BEGIN;

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
    'menu_unlinked'
  ]));

CREATE FUNCTION public.telegram_resolve_recruiter_actor(
  _telegram_user_id bigint
)
RETURNS TABLE(
  recruiter_id uuid,
  workspace_name text,
  role text,
  can_manage_opportunities boolean,
  active_opportunity_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $$
DECLARE
  _actor_user_id uuid;
BEGIN
  IF _telegram_user_id IS NULL OR _telegram_user_id <= 0 THEN
    RETURN;
  END IF;

  SELECT l.user_id INTO _actor_user_id
    FROM public.telegram_user_links l
   WHERE l.telegram_user_id = _telegram_user_id
     AND l.status = 'active';

  IF _actor_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', _actor_user_id::text, true);

  RETURN QUERY
  SELECT
    rp.id,
    rp.company_name,
    CASE WHEN rp.user_id = _actor_user_id THEN 'owner' ELSE m.role::text END,
    (
      public.recruiter_profile_can_manage_opportunities(rp.id)
      AND public.current_user_has_recruiter_permission(rp.id, 'opportunities_create')
    ),
    (
      SELECT count(*)::integer
        FROM public.opportunities o
       WHERE o.recruiter_id = rp.id
         AND o.status = 'active'
    )
  FROM public.recruiter_profiles rp
  LEFT JOIN public.recruiter_members m
    ON m.recruiter_id = rp.id
   AND m.member_user_id = _actor_user_id
   AND m.status = 'active'
  WHERE rp.status = 'active'
    AND (
      rp.user_id = _actor_user_id
      OR (
        m.id IS NOT NULL
        AND public.current_user_has_recruiter_permission(rp.id, 'opportunities_view')
      )
    )
  ORDER BY rp.company_name, rp.id;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_resolve_recruiter_actor(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_resolve_recruiter_actor(bigint) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_resolve_recruiter_actor(bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_resolve_recruiter_actor(bigint) TO service_role;

CREATE FUNCTION public.telegram_process_menu_update(
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
    IF _existing.payload_hash = _payload_hash
       AND _existing.update_type = 'message'
       AND _existing.telegram_user_id IS NOT DISTINCT FROM _telegram_user_id
       AND _existing.telegram_chat_id IS NOT DISTINCT FROM _telegram_chat_id
       AND _existing.status = 'processed'
       AND _existing.result_code = ANY (ARRAY[
             'menu_recruiter',
             'menu_linked_no_workspace',
             'menu_unlinked'
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
    _workspaces := '[]'::jsonb;
  END IF;

  IF NOT _actor_linked THEN
    _outcome := 'menu_unlinked';
  ELSIF jsonb_array_length(_workspaces) = 0 THEN
    _outcome := 'menu_linked_no_workspace';
  ELSE
    _outcome := 'menu_recruiter';
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

REVOKE ALL ON FUNCTION public.telegram_process_menu_update(uuid, bigint, text, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_process_menu_update(uuid, bigint, text, bigint, bigint, text) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_process_menu_update(uuid, bigint, text, bigint, bigint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_process_menu_update(uuid, bigint, text, bigint, bigint, text) TO service_role;

COMMIT;