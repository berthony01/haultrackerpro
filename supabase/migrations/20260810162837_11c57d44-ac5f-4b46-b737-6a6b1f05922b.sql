-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Assistant settlement permission persistence repair.
--
-- Additive, single-purpose change: the three direct-assistant permission
-- write-path functions currently share the same seven-key allowlist and
-- therefore strip the settlement delegation permissions that the settlement
-- authorization layer already expects.
--
-- The ONLY functional delta is appending these three keys to each allowlist:
--   settlements_view, settlements_manage, settlements_finalize
--
-- Everything else (signatures, return types, language, volatility, security
-- behavior, search_path, authorization, slot limits, email validation, token
-- generation, conflict behavior, audit logging, error codes/messages) is
-- preserved byte-for-byte from the current live definitions.
-- No grants, no DDL, no data changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.clean_assistant_permissions(_p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  _allowed text[] := ARRAY['manage_loads','manage_expenses','manage_fuel',
    'view_reports','export_reports','view_dashboard','manage_settings_limited',
    'settlements_view','settlements_manage','settlements_finalize'];
  _out jsonb := '{}'::jsonb; _k text;
BEGIN
  IF _p IS NULL THEN RETURN _out; END IF;
  FOREACH _k IN ARRAY _allowed LOOP
    IF COALESCE((_p ->> _k)::boolean, false) THEN
      _out := _out || jsonb_build_object(_k, true);
    END IF;
  END LOOP;
  RETURN _out;
END $$;

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
  _existing public.driver_assistants;
  _allowed_keys text[] := ARRAY[
    'manage_loads','manage_expenses','manage_fuel',
    'view_reports','export_reports','view_dashboard',
    'manage_settings_limited',
    'settlements_view','settlements_manage','settlements_finalize'
  ];
  _clean jsonb := '{}'::jsonb;
  _k text;
  _is_pro boolean;
  _direct_max int;
  _direct_count int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT
    public.is_admin(_uid)
    OR EXISTS (
      SELECT 1 FROM public.subscriptions s
       WHERE s.user_id = _uid AND s.status = 'active'
         AND s.plan_key IN ('pro_monthly','pro_yearly')
    )
  INTO _is_pro;

  IF NOT _is_pro THEN
    RAISE EXCEPTION 'Inviting assistants requires Pro. Upgrade to invite an assistant.'
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

  -- Allow re-issuing token for an existing pending/active row for the same email.
  SELECT * INTO _existing
    FROM public.driver_assistants
   WHERE driver_user_id = _uid
     AND lower(invite_email) = _email_norm
     AND status IN ('pending','active')
   LIMIT 1;

  -- Enforce direct-assistant slot limit (excludes agency-delegated rows).
  _direct_max := 1;  -- Pro = 1 direct slot (active+pending combined).
  SELECT count(*) INTO _direct_count
    FROM public.driver_assistants
   WHERE driver_user_id = _uid
     AND status IN ('pending','active')
     AND agency_delegation_id IS NULL
     AND (_existing.id IS NULL OR id <> _existing.id);

  IF _direct_count >= _direct_max THEN
    RAISE EXCEPTION 'Your Pro plan includes 1 direct assistant. Revoke the current assistant before inviting another.'
      USING ERRCODE = '42501';
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
    permissions       = EXCLUDED.permissions,
    invite_token_hash = EXCLUDED.invite_token_hash,
    invited_at        = now(),
    updated_at        = now()
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
    'manage_settings_limited',
    'settlements_view','settlements_manage','settlements_finalize'
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

COMMIT;