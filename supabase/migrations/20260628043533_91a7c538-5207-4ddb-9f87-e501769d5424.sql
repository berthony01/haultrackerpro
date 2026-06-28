-- Phase 1 Final Cleanup: complete audit logging + stamp delegate id on UPDATE

-- Trigger: also stamp assistant_delegate_id on UPDATE by an assistant
CREATE OR REPLACE FUNCTION public.tg_assistant_audit_and_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _delegate_id uuid;
  _action text;
BEGIN
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF _uid = NEW.user_id THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by_user_id := COALESCE(NEW.created_by_user_id, _uid);
    END IF;
    NEW.updated_by_user_id := _uid;
    RETURN NEW;
  END IF;

  SELECT id INTO _delegate_id
    FROM public.driver_assistants
   WHERE assistant_user_id = _uid
     AND driver_user_id    = NEW.user_id
     AND status            = 'active'
   LIMIT 1;

  IF _delegate_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id    := _uid;
    NEW.assistant_delegate_id := _delegate_id;
    _action := 'create_' || TG_TABLE_NAME;
  ELSE
    -- Stamp delegate id on updates too so post-hoc audits can attribute the change.
    NEW.assistant_delegate_id := _delegate_id;
    _action := 'update_' || TG_TABLE_NAME;
  END IF;
  NEW.updated_by_user_id := _uid;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES
    (_delegate_id, NEW.user_id, _uid, _action, TG_TABLE_NAME, NEW.id, '{}'::jsonb);

  UPDATE public.driver_assistants
     SET last_active_at = now()
   WHERE id = _delegate_id;

  RETURN NEW;
END;
$$;

-- invite_assistant: append audit row (action: invite_created)
CREATE OR REPLACE FUNCTION public.invite_assistant(_email text, _permissions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _email_norm text := lower(btrim(coalesce(_email,'')));
  _token text;
  _token_hash text;
  _row public.driver_assistants;
  _allowed_keys text[] := ARRAY[
    'manage_loads','manage_expenses','manage_fuel',
    'view_reports','export_reports','view_dashboard',
    'manage_settings_limited'
  ];
  _clean jsonb := '{}'::jsonb;
  _k text;
  _is_pro boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT
    public.is_admin(_uid)
    OR EXISTS (
      SELECT 1 FROM public.subscriptions s
       WHERE s.user_id = _uid
         AND s.status = 'active'
         AND s.plan_key IN ('pro_monthly','pro_yearly')
    )
  INTO _is_pro;

  IF NOT _is_pro THEN
    RAISE EXCEPTION 'Driver Assistants require a Pro plan. Upgrade to invite an assistant.'
      USING ERRCODE = '42501';
  END IF;

  IF _email_norm = '' OR length(_email_norm) > 255
     OR _email_norm !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = _uid AND lower(u.email) = _email_norm
  ) THEN
    RAISE EXCEPTION 'You cannot invite yourself' USING ERRCODE = '22023';
  END IF;

  FOREACH _k IN ARRAY _allowed_keys LOOP
    IF COALESCE((_permissions ->> _k)::boolean, false) THEN
      _clean := _clean || jsonb_build_object(_k, true);
    END IF;
  END LOOP;

  _token := encode(gen_random_bytes(24), 'hex');
  _token_hash := encode(digest(_token, 'sha256'), 'hex');

  INSERT INTO public.driver_assistants
    (driver_user_id, invite_email, invite_token_hash, status, permissions)
  VALUES (_uid, _email_norm, _token_hash, 'pending', _clean)
  ON CONFLICT (driver_user_id, lower(invite_email))
    WHERE status IN ('pending','active')
  DO UPDATE SET
    permissions      = EXCLUDED.permissions,
    invite_token_hash = EXCLUDED.invite_token_hash,
    invited_at       = now(),
    updated_at       = now()
  RETURNING * INTO _row;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES
    (_row.id, _uid, _uid, 'invite_created', 'driver_assistants', _row.id,
     jsonb_build_object('invite_email', _row.invite_email, 'permissions', _clean));

  RETURN jsonb_build_object(
    'id', _row.id,
    'invite_token', _token,
    'invite_email', _row.invite_email,
    'status', _row.status
  );
END;
$$;

-- accept_assistant_invite: append audit row (action: invite_accepted)
CREATE OR REPLACE FUNCTION public.accept_assistant_invite(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _hash text;
  _email text;
  _row public.driver_assistants;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _token IS NULL OR length(_token) < 16 THEN
    RAISE EXCEPTION 'Invalid token' USING ERRCODE = '22023';
  END IF;

  _hash := encode(digest(_token, 'sha256'), 'hex');
  SELECT lower(u.email) INTO _email FROM auth.users u WHERE u.id = _uid;

  SELECT * INTO _row FROM public.driver_assistants
   WHERE invite_token_hash = _hash AND status = 'pending'
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or already used' USING ERRCODE = 'P0002';
  END IF;
  IF _row.invite_email <> _email THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address' USING ERRCODE = '42501';
  END IF;
  IF _row.driver_user_id = _uid THEN
    RAISE EXCEPTION 'You cannot accept your own invitation' USING ERRCODE = '22023';
  END IF;

  UPDATE public.driver_assistants
     SET assistant_user_id = _uid,
         status            = 'active',
         accepted_at       = now(),
         invite_token_hash = NULL,
         updated_at        = now()
   WHERE id = _row.id
  RETURNING * INTO _row;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES
    (_row.id, _row.driver_user_id, _uid, 'invite_accepted', 'driver_assistants', _row.id, '{}'::jsonb);

  RETURN jsonb_build_object(
    'id', _row.id,
    'driver_user_id', _row.driver_user_id,
    'status', _row.status
  );
END;
$$;

-- update_assistant_permissions: append audit row (action: permissions_updated)
CREATE OR REPLACE FUNCTION public.update_assistant_permissions(_id uuid, _permissions jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed_keys text[] := ARRAY[
    'manage_loads','manage_expenses','manage_fuel',
    'view_reports','export_reports','view_dashboard',
    'manage_settings_limited'
  ];
  _clean jsonb := '{}'::jsonb;
  _k text;
  _row public.driver_assistants;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  FOREACH _k IN ARRAY _allowed_keys LOOP
    IF COALESCE((_permissions ->> _k)::boolean, false) THEN
      _clean := _clean || jsonb_build_object(_k, true);
    END IF;
  END LOOP;

  UPDATE public.driver_assistants
     SET permissions = _clean,
         updated_at  = now()
   WHERE id = _id AND driver_user_id = _uid
     AND status IN ('pending','active')
  RETURNING * INTO _row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant not found or not editable' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES
    (_row.id, _uid, COALESCE(_row.assistant_user_id, _uid),
     'permissions_updated', 'driver_assistants', _row.id,
     jsonb_build_object('permissions', _clean));
END;
$$;

-- revoke_assistant: append audit row (action: assistant_revoked)
CREATE OR REPLACE FUNCTION public.revoke_assistant(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.driver_assistants;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.driver_assistants
     SET status            = 'revoked',
         revoked_at        = now(),
         invite_token_hash = NULL,
         updated_at        = now()
   WHERE id = _id AND driver_user_id = _uid
  RETURNING * INTO _row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES
    (_row.id, _uid, COALESCE(_row.assistant_user_id, _uid),
     'assistant_revoked', 'driver_assistants', _row.id, '{}'::jsonb);
END;
$$;

-- assistant_delete_load_stops: append audit row per deletion batch
CREATE OR REPLACE FUNCTION public.assistant_delete_load_stops(_driver uuid, _load_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _deleted integer;
  _delegate_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.assistant_has_permission(_uid, _driver, 'manage_loads') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.loads WHERE id = _load_id AND user_id = _driver) THEN
    RAISE EXCEPTION 'Load not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO _delegate_id FROM public.driver_assistants
   WHERE assistant_user_id = _uid AND driver_user_id = _driver AND status = 'active'
   LIMIT 1;

  WITH d AS (
    DELETE FROM public.load_stops
     WHERE user_id = _driver AND load_id = _load_id
    RETURNING 1
  )
  SELECT count(*)::int INTO _deleted FROM d;

  IF COALESCE(_deleted,0) > 0 AND _delegate_id IS NOT NULL THEN
    INSERT INTO public.assistant_audit_log
      (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
    VALUES
      (_delegate_id, _driver, _uid, 'delete_load_stops', 'load_stops', _load_id,
       jsonb_build_object('deleted_count', _deleted));
    UPDATE public.driver_assistants
       SET last_active_at = now()
     WHERE id = _delegate_id;
  END IF;

  RETURN COALESCE(_deleted, 0);
END;
$$;
