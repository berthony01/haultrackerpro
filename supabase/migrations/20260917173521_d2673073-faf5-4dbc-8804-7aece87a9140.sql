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
    'menu_unlinked',
    'menu_driver',
    'menu_multi_role',
    'menu_linked_unsupported'
  ]));

CREATE FUNCTION public.telegram_resolve_account_role(
  _telegram_user_id bigint
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $$
DECLARE
  _actor_user_id uuid;
  _intended_role text;
BEGIN
  IF _telegram_user_id IS NULL OR _telegram_user_id <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT l.user_id INTO _actor_user_id
    FROM public.telegram_user_links l
   WHERE l.telegram_user_id = _telegram_user_id
     AND l.status = 'active';

  IF _actor_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.intended_role INTO _intended_role
    FROM public.profiles p
   WHERE p.user_id = _actor_user_id;

  IF _intended_role IN ('driver', 'recruiter') THEN
    RETURN _intended_role;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_resolve_account_role(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telegram_resolve_account_role(bigint) FROM anon;
REVOKE ALL ON FUNCTION public.telegram_resolve_account_role(bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_resolve_account_role(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.telegram_process_menu_update(
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
  _account_role text;
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
             'menu_unlinked',
             'menu_driver',
             'menu_multi_role',
             'menu_linked_unsupported'
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
    _account_role := public.telegram_resolve_account_role(_telegram_user_id);

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
    _account_role := NULL;
    _workspaces := '[]'::jsonb;
  END IF;

  IF NOT _actor_linked THEN
    _outcome := 'menu_unlinked';
  ELSIF jsonb_array_length(_workspaces) > 0 THEN
    _outcome := CASE
      WHEN _account_role = 'driver' THEN 'menu_multi_role'
      ELSE 'menu_recruiter'
    END;
  ELSE
    _outcome := CASE
      WHEN _account_role = 'driver' THEN 'menu_driver'
      WHEN _account_role = 'recruiter' THEN 'menu_linked_no_workspace'
      ELSE 'menu_linked_unsupported'
    END;
  END IF;

  IF _outcome NOT IN ('menu_recruiter', 'menu_multi_role') THEN
    _workspaces := '[]'::jsonb;
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