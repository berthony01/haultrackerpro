-- Apply before deploying the matching poller. Both dispatch activation gates
-- and the installed review, outbox, and QA RPCs remain as they are.
BEGIN;

CREATE FUNCTION public.telegram_dispatch_group_is_connected(
  _telegram_chat_id bigint,
  _chat_type text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.telegram_chat_bindings b
    JOIN public.recruiter_profiles rp ON rp.id = b.recruiter_id
    WHERE _telegram_chat_id < 0
      AND _chat_type IN ('group', 'supergroup')
      AND b.telegram_chat_id = _telegram_chat_id AND b.chat_type = _chat_type
      AND b.status = 'active' AND b.revoked_at IS NULL
      AND rp.status = 'active'
  );
$function$;
REVOKE ALL ON FUNCTION public.telegram_dispatch_group_is_connected(bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_dispatch_group_is_connected(bigint,text) TO service_role;

-- In a DM the same live dispatch permission now allows setup guidance before
-- binding. In a group it still requires the exact active chat binding.
CREATE OR REPLACE FUNCTION public.telegram_get_dispatch_guidance(
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT _telegram_user_id > 0
    AND (
      (_chat_type = 'private' AND _telegram_chat_id IS NULL)
      OR (_chat_type IN ('group','supergroup') AND _telegram_chat_id < 0)
    )
    AND EXISTS (
      SELECT 1
      FROM public.telegram_user_links l
      JOIN public.recruiter_profiles rp ON rp.status = 'active'
      WHERE l.telegram_user_id = _telegram_user_id
        AND l.status = 'active' AND l.revoked_at IS NULL
        AND (
          rp.user_id = l.user_id
          OR (
            public.recruiter_team_workspace_within_limit(rp.id)
            AND EXISTS (
              SELECT 1
              FROM public.recruiter_members m
              WHERE m.recruiter_id = rp.id AND m.member_user_id = l.user_id
                AND m.status = 'active' AND m.revoked_at IS NULL
                AND jsonb_typeof(m.permissions) = 'object'
                AND m.permissions -> 'loads_update_status' = 'true'::jsonb
            )
          )
        )
        AND (_chat_type = 'private' OR public.telegram_dispatch_group_is_connected(
          _telegram_chat_id, _chat_type
        ) AND EXISTS (
          SELECT 1 FROM public.telegram_chat_bindings b
          WHERE b.recruiter_id = rp.id AND b.telegram_chat_id = _telegram_chat_id
            AND b.chat_type = _chat_type AND b.status = 'active' AND b.revoked_at IS NULL
        ))
    );
$function$;
REVOKE ALL ON FUNCTION public.telegram_get_dispatch_guidance(bigint,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_get_dispatch_guidance(bigint,bigint,text) TO service_role;

-- Patch only the reviewed production intake body. Preserve its existing
-- lease, replay, scope, proposal expiry, and outbox transaction behavior.
DO $migration$
DECLARE
  _oid regprocedure := 'public.telegram_process_dispatch_group_update(uuid,bigint,text,bigint,bigint,text,text,text)'::regprocedure;
  _definition text;
  _source_hash text;
BEGIN
  SELECT pg_get_functiondef(oid), md5(prosrc) INTO _definition, _source_hash
  FROM pg_proc WHERE oid = _oid AND prosecdef;
  IF _source_hash IS DISTINCT FROM '5fc195e441b15004bb7d1f7b67b95f3a' THEN
    RAISE EXCEPTION 'telegram_dispatch_intake_version_mismatch';
  END IF;

  _definition := replace(_definition, '  _relationship_id uuid;', $vars$  _relationship_id uuid;
  _driver_user_id uuid;
  _actor uuid;
  _previous_subject text;
  _can_submit boolean := false;$vars$);
  _definition := replace(_definition, '       AND b.status = ''active''',
    '       AND b.status = ''active'' AND b.revoked_at IS NULL AND b.chat_type = _chat_type');
  _definition := replace(_definition, 'SELECT l.status, l.carrier_driver_relationship_id
          INTO _load_status, _relationship_id',
    'SELECT l.status, l.carrier_driver_relationship_id, l.user_id
          INTO _load_status, _relationship_id, _driver_user_id');
  _definition := replace(_definition, '        IF _load_status IN', $authority$        -- Derive the submitter from the Telegram transport identity.
        SELECT l.user_id INTO _actor
          FROM public.telegram_user_links l
         WHERE l.telegram_user_id = _telegram_user_id
           AND l.status = 'active' AND l.revoked_at IS NULL
         FOR SHARE;
        IF _actor IS NOT NULL THEN
          PERFORM 1 FROM public.recruiter_profiles WHERE id = _binding.recruiter_id FOR SHARE;
          PERFORM 1 FROM public.recruiter_members WHERE recruiter_id = _binding.recruiter_id FOR SHARE;
          _previous_subject := current_setting('request.jwt.claim.sub', true);
          PERFORM set_config('request.jwt.claim.sub', _actor::text, true);
          _can_submit := public.current_user_can_dispatch_load_action(
            _binding.recruiter_id, _relationship_id, _driver_user_id, 'loads_update_status'
          );
          PERFORM set_config('request.jwt.claim.sub', COALESCE(_previous_subject, ''), true);
        END IF;

        IF _can_submit AND _load_status IN$authority$);
  EXECUTE _definition;
END;
$migration$;

COMMIT;
