
-- ============================================================================
-- DRIVER ASSISTANTS — PHASE 1
-- ============================================================================

-- Status enum
DO $$ BEGIN
  CREATE TYPE public.assistant_status AS ENUM ('pending','active','revoked','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- TABLE: driver_assistants
-- ----------------------------------------------------------------------------
CREATE TABLE public.driver_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL,
  assistant_user_id uuid,
  invite_email text NOT NULL,
  invite_token_hash text,
  status public.assistant_status NOT NULL DEFAULT 'pending',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX driver_assistants_driver_idx ON public.driver_assistants(driver_user_id);
CREATE INDEX driver_assistants_assistant_idx ON public.driver_assistants(assistant_user_id) WHERE assistant_user_id IS NOT NULL;
CREATE INDEX driver_assistants_token_idx ON public.driver_assistants(invite_token_hash) WHERE invite_token_hash IS NOT NULL;
CREATE UNIQUE INDEX driver_assistants_active_pair_uq
  ON public.driver_assistants(driver_user_id, lower(invite_email))
  WHERE status IN ('pending','active');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_assistants TO authenticated;
GRANT ALL ON public.driver_assistants TO service_role;

ALTER TABLE public.driver_assistants ENABLE ROW LEVEL SECURITY;

-- Drivers can see/manage rows where they are the driver
CREATE POLICY "driver_assistants_driver_select" ON public.driver_assistants
  FOR SELECT TO authenticated
  USING (auth.uid() = driver_user_id);

-- Assistants can see rows where they themselves are the assistant
CREATE POLICY "driver_assistants_assistant_select" ON public.driver_assistants
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = assistant_user_id);

-- All writes are routed through SECURITY DEFINER RPCs; no direct INSERT/UPDATE/DELETE.

-- ----------------------------------------------------------------------------
-- TABLE: assistant_audit_log
-- ----------------------------------------------------------------------------
CREATE TABLE public.assistant_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegate_id uuid NOT NULL REFERENCES public.driver_assistants(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  assistant_user_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_audit_driver_idx ON public.assistant_audit_log(driver_user_id, created_at DESC);
CREATE INDEX assistant_audit_assistant_idx ON public.assistant_audit_log(assistant_user_id, created_at DESC);

GRANT SELECT ON public.assistant_audit_log TO authenticated;
GRANT ALL ON public.assistant_audit_log TO service_role;

ALTER TABLE public.assistant_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assistant_audit_driver_select" ON public.assistant_audit_log
  FOR SELECT TO authenticated USING (auth.uid() = driver_user_id);

CREATE POLICY "assistant_audit_assistant_select" ON public.assistant_audit_log
  FOR SELECT TO authenticated USING (auth.uid() = assistant_user_id);

-- ----------------------------------------------------------------------------
-- HELPER: assistant_has_permission
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assistant_has_permission(_assistant uuid, _driver uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.driver_assistants da
    WHERE da.assistant_user_id = _assistant
      AND da.driver_user_id    = _driver
      AND da.status            = 'active'
      AND COALESCE((da.permissions ->> _perm)::boolean, false) = true
  );
$$;

REVOKE ALL ON FUNCTION public.assistant_has_permission(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_has_permission(uuid,uuid,text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- ADDITIVE RLS: assistants on loads / expenses / fuel_logs / load_stops
-- Existing owner policies are NOT modified.
-- No DELETE policy for assistants in Phase 1.
-- ----------------------------------------------------------------------------

-- loads: assistants with manage_loads
CREATE POLICY "loads_assistant_select" ON public.loads
  FOR SELECT TO authenticated
  USING (public.assistant_has_permission(auth.uid(), user_id, 'manage_loads'));
CREATE POLICY "loads_assistant_insert" ON public.loads
  FOR INSERT TO authenticated
  WITH CHECK (public.assistant_has_permission(auth.uid(), user_id, 'manage_loads'));
CREATE POLICY "loads_assistant_update" ON public.loads
  FOR UPDATE TO authenticated
  USING (public.assistant_has_permission(auth.uid(), user_id, 'manage_loads'))
  WITH CHECK (public.assistant_has_permission(auth.uid(), user_id, 'manage_loads'));

-- load_stops: same permission as parent load
CREATE POLICY "load_stops_assistant_select" ON public.load_stops
  FOR SELECT TO authenticated
  USING (public.assistant_has_permission(auth.uid(), user_id, 'manage_loads'));
CREATE POLICY "load_stops_assistant_insert" ON public.load_stops
  FOR INSERT TO authenticated
  WITH CHECK (
    public.assistant_has_permission(auth.uid(), user_id, 'manage_loads')
    AND EXISTS (SELECT 1 FROM public.loads l WHERE l.id = load_stops.load_id AND l.user_id = load_stops.user_id)
  );
CREATE POLICY "load_stops_assistant_update" ON public.load_stops
  FOR UPDATE TO authenticated
  USING (public.assistant_has_permission(auth.uid(), user_id, 'manage_loads'))
  WITH CHECK (
    public.assistant_has_permission(auth.uid(), user_id, 'manage_loads')
    AND EXISTS (SELECT 1 FROM public.loads l WHERE l.id = load_stops.load_id AND l.user_id = load_stops.user_id)
  );

-- expenses: assistants with manage_expenses
CREATE POLICY "expenses_assistant_select" ON public.expenses
  FOR SELECT TO authenticated
  USING (public.assistant_has_permission(auth.uid(), user_id, 'manage_expenses'));
CREATE POLICY "expenses_assistant_insert" ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (public.assistant_has_permission(auth.uid(), user_id, 'manage_expenses'));
CREATE POLICY "expenses_assistant_update" ON public.expenses
  FOR UPDATE TO authenticated
  USING (public.assistant_has_permission(auth.uid(), user_id, 'manage_expenses'))
  WITH CHECK (public.assistant_has_permission(auth.uid(), user_id, 'manage_expenses'));

-- fuel_logs: assistants with manage_fuel
CREATE POLICY "fuel_logs_assistant_select" ON public.fuel_logs
  FOR SELECT TO authenticated
  USING (public.assistant_has_permission(auth.uid(), user_id, 'manage_fuel'));
CREATE POLICY "fuel_logs_assistant_insert" ON public.fuel_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.assistant_has_permission(auth.uid(), user_id, 'manage_fuel'));
CREATE POLICY "fuel_logs_assistant_update" ON public.fuel_logs
  FOR UPDATE TO authenticated
  USING (public.assistant_has_permission(auth.uid(), user_id, 'manage_fuel'))
  WITH CHECK (public.assistant_has_permission(auth.uid(), user_id, 'manage_fuel'));

-- ----------------------------------------------------------------------------
-- RPC: invite_assistant
-- ----------------------------------------------------------------------------
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
    'manage_loads','manage_expenses','manage_fuel','manage_receipts',
    'view_reports','export_reports','manage_documents','view_dashboard',
    'manage_settings_limited'
  ];
  _clean jsonb := '{}'::jsonb;
  _k text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
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

  -- Sanitize permissions: keep only known keys with boolean true.
  FOREACH _k IN ARRAY _allowed_keys LOOP
    IF COALESCE((_permissions ->> _k)::boolean, false) THEN
      _clean := _clean || jsonb_build_object(_k, true);
    END IF;
  END LOOP;

  -- Generate token; store only the hash.
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

  RETURN jsonb_build_object(
    'id', _row.id,
    'invite_token', _token,
    'invite_email', _row.invite_email,
    'status', _row.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invite_assistant(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_assistant(text,jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: accept_assistant_invite
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_assistant_invite(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _email text;
  _hash text;
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

  RETURN jsonb_build_object(
    'id', _row.id,
    'driver_user_id', _row.driver_user_id,
    'status', _row.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_assistant_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_assistant_invite(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: revoke_assistant
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_assistant(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.driver_assistants
     SET status            = 'revoked',
         revoked_at        = now(),
         invite_token_hash = NULL,
         updated_at        = now()
   WHERE id = _id AND driver_user_id = _uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_assistant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_assistant(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: update_assistant_permissions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_assistant_permissions(_id uuid, _permissions jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed_keys text[] := ARRAY[
    'manage_loads','manage_expenses','manage_fuel','manage_receipts',
    'view_reports','export_reports','manage_documents','view_dashboard',
    'manage_settings_limited'
  ];
  _clean jsonb := '{}'::jsonb;
  _k text;
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
     AND status IN ('pending','active');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant not found or not editable' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_assistant_permissions(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_assistant_permissions(uuid,jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: list_my_assistants  (driver-side)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_assistants()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', da.id,
    'assistant_user_id', da.assistant_user_id,
    'invite_email', da.invite_email,
    'status', da.status,
    'permissions', da.permissions,
    'invited_at', da.invited_at,
    'accepted_at', da.accepted_at,
    'revoked_at', da.revoked_at,
    'last_active_at', da.last_active_at
  )
  FROM public.driver_assistants da
  WHERE da.driver_user_id = _uid
  ORDER BY da.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_assistants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_assistants() TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: get_my_managed_drivers  (assistant-side)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_managed_drivers()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'delegate_id', da.id,
    'driver_user_id', da.driver_user_id,
    'driver_email', lower(u.email),
    'driver_name', COALESCE(p.display_name, p.full_name, lower(u.email)),
    'permissions', da.permissions,
    'accepted_at', da.accepted_at,
    'last_active_at', da.last_active_at
  )
  FROM public.driver_assistants da
  JOIN auth.users u ON u.id = da.driver_user_id
  LEFT JOIN public.profiles p ON p.user_id = da.driver_user_id
  WHERE da.assistant_user_id = _uid
    AND da.status = 'active'
  ORDER BY da.accepted_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_managed_drivers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_managed_drivers() TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: log_assistant_action
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_assistant_action(
  _driver uuid,
  _action text,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _delegate_id uuid;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO _delegate_id FROM public.driver_assistants
   WHERE assistant_user_id = _uid AND driver_user_id = _driver AND status = 'active'
   LIMIT 1;
  IF _delegate_id IS NULL THEN
    RAISE EXCEPTION 'Not an active assistant for that driver' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES (_delegate_id, _driver, _uid, left(_action, 80), left(_entity_type, 40), _entity_id, COALESCE(_metadata,'{}'::jsonb))
  RETURNING id INTO _id;

  UPDATE public.driver_assistants
     SET last_active_at = now()
   WHERE id = _delegate_id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_assistant_action(uuid,text,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_assistant_action(uuid,text,text,uuid,jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
CREATE TRIGGER driver_assistants_updated_at
  BEFORE UPDATE ON public.driver_assistants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
