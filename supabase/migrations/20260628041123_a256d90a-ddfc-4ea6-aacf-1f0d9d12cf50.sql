-- ============================================================================
-- DRIVER ASSISTANTS — PHASE 1 HARDENING
-- ============================================================================

ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS assistant_delegate_id uuid REFERENCES public.driver_assistants(id) ON DELETE SET NULL;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS assistant_delegate_id uuid REFERENCES public.driver_assistants(id) ON DELETE SET NULL;

ALTER TABLE public.fuel_logs
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS assistant_delegate_id uuid REFERENCES public.driver_assistants(id) ON DELETE SET NULL;

ALTER TABLE public.load_stops
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS assistant_delegate_id uuid REFERENCES public.driver_assistants(id) ON DELETE SET NULL;

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

REVOKE ALL ON FUNCTION public.tg_assistant_audit_and_metadata() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS tg_assistant_audit_loads ON public.loads;
CREATE TRIGGER tg_assistant_audit_loads
  BEFORE INSERT OR UPDATE ON public.loads
  FOR EACH ROW EXECUTE FUNCTION public.tg_assistant_audit_and_metadata();

DROP TRIGGER IF EXISTS tg_assistant_audit_expenses ON public.expenses;
CREATE TRIGGER tg_assistant_audit_expenses
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_assistant_audit_and_metadata();

DROP TRIGGER IF EXISTS tg_assistant_audit_fuel_logs ON public.fuel_logs;
CREATE TRIGGER tg_assistant_audit_fuel_logs
  BEFORE INSERT OR UPDATE ON public.fuel_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_assistant_audit_and_metadata();

DROP TRIGGER IF EXISTS tg_assistant_audit_load_stops ON public.load_stops;
CREATE TRIGGER tg_assistant_audit_load_stops
  BEFORE INSERT OR UPDATE ON public.load_stops
  FOR EACH ROW EXECUTE FUNCTION public.tg_assistant_audit_and_metadata();

DROP POLICY IF EXISTS "loads_assistant_select" ON public.loads;
CREATE POLICY "loads_assistant_select" ON public.loads
  FOR SELECT TO authenticated
  USING (
    public.assistant_has_permission(auth.uid(), user_id, 'manage_loads')
    OR public.assistant_has_permission(auth.uid(), user_id, 'view_reports')
    OR public.assistant_has_permission(auth.uid(), user_id, 'view_dashboard')
    OR public.assistant_has_permission(auth.uid(), user_id, 'export_reports')
  );

DROP POLICY IF EXISTS "load_stops_assistant_select" ON public.load_stops;
CREATE POLICY "load_stops_assistant_select" ON public.load_stops
  FOR SELECT TO authenticated
  USING (
    public.assistant_has_permission(auth.uid(), user_id, 'manage_loads')
    OR public.assistant_has_permission(auth.uid(), user_id, 'view_reports')
    OR public.assistant_has_permission(auth.uid(), user_id, 'view_dashboard')
    OR public.assistant_has_permission(auth.uid(), user_id, 'export_reports')
  );

DROP POLICY IF EXISTS "expenses_assistant_select" ON public.expenses;
CREATE POLICY "expenses_assistant_select" ON public.expenses
  FOR SELECT TO authenticated
  USING (
    public.assistant_has_permission(auth.uid(), user_id, 'manage_expenses')
    OR public.assistant_has_permission(auth.uid(), user_id, 'view_reports')
    OR public.assistant_has_permission(auth.uid(), user_id, 'view_dashboard')
    OR public.assistant_has_permission(auth.uid(), user_id, 'export_reports')
  );

DROP POLICY IF EXISTS "fuel_logs_assistant_select" ON public.fuel_logs;
CREATE POLICY "fuel_logs_assistant_select" ON public.fuel_logs
  FOR SELECT TO authenticated
  USING (
    public.assistant_has_permission(auth.uid(), user_id, 'manage_fuel')
    OR public.assistant_has_permission(auth.uid(), user_id, 'view_reports')
    OR public.assistant_has_permission(auth.uid(), user_id, 'view_dashboard')
    OR public.assistant_has_permission(auth.uid(), user_id, 'export_reports')
  );

DROP POLICY IF EXISTS "cost_profile_assistant_select" ON public.cost_profile;
CREATE POLICY "cost_profile_assistant_select" ON public.cost_profile
  FOR SELECT TO authenticated
  USING (
    public.assistant_has_permission(auth.uid(), user_id, 'manage_settings_limited')
    OR public.assistant_has_permission(auth.uid(), user_id, 'view_dashboard')
    OR public.assistant_has_permission(auth.uid(), user_id, 'view_reports')
  );

DROP POLICY IF EXISTS "cost_profile_assistant_insert" ON public.cost_profile;
CREATE POLICY "cost_profile_assistant_insert" ON public.cost_profile
  FOR INSERT TO authenticated
  WITH CHECK (
    public.assistant_has_permission(auth.uid(), user_id, 'manage_settings_limited')
  );

DROP POLICY IF EXISTS "cost_profile_assistant_update" ON public.cost_profile;
CREATE POLICY "cost_profile_assistant_update" ON public.cost_profile
  FOR UPDATE TO authenticated
  USING (public.assistant_has_permission(auth.uid(), user_id, 'manage_settings_limited'))
  WITH CHECK (public.assistant_has_permission(auth.uid(), user_id, 'manage_settings_limited'));

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
