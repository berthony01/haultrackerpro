-- =============================================================================
-- RD-1 — Explicit Driver capability + driver-only bookkeeping write guard
-- CANDIDATE ONLY. NOT APPLIED. Requires separate owner authorization to apply.
--
-- Changes (schema/function/policy only — no row is inserted, updated or deleted):
--   1. _provision_driver_capability_for_new_user(): new signups get the
--      Driver capability ONLY when raw_user_meta_data.signup_capability is
--      exactly 'driver'. Recruiter / assistant / agency / OAuth-without-intent
--      signups get nothing. Existing capability rows are untouched.
--      (Signup metadata is user-supplied; it can only ever opt the user into
--      the low-privilege self Driver workspace, never anything privileged.)
--   2. has_active_driver_capability(uuid): SECURITY DEFINER helper used by
--      RLS (avoids recursion through user_capabilities RLS).
--   3. activate_my_driver_workspace(): self-only, idempotent, explicit opt-in.
--      Never reactivates a suspended/revoked row; never touches other users.
--   4. Own-record INSERT/UPDATE/DELETE policies on loads, expenses, fuel_logs,
--      load_stops, recurring_expense_templates additionally require an active
--      Driver capability. SELECT policies, assistant_* delegated policies and
--      SECURITY DEFINER / service-role dispatch paths are NOT changed.
-- =============================================================================

-- 1. Signup trigger function (trigger itself unchanged) ----------------------
CREATE OR REPLACE FUNCTION public._provision_driver_capability_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.raw_user_meta_data ->> 'signup_capability', '') = 'driver' THEN
    INSERT INTO public.user_capabilities (user_id, capability, status, activated_at)
    VALUES (NEW.id, 'driver'::public.user_capability_type,
                    'active'::public.user_capability_status, now())
    ON CONFLICT (user_id, capability) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._provision_driver_capability_for_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._provision_driver_capability_for_new_user() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._provision_driver_capability_for_new_user() TO service_role;

-- 2. RLS helper ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_active_driver_capability(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_capabilities
     WHERE user_id = _user_id
       AND capability = 'driver'::public.user_capability_type
       AND status = 'active'::public.user_capability_status
  )
$$;

REVOKE ALL ON FUNCTION public.has_active_driver_capability(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_active_driver_capability(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_active_driver_capability(uuid) TO authenticated, service_role;

-- 3. Explicit self opt-in -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_my_driver_workspace()
RETURNS public.user_capability_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing public.user_capability_status;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO _existing
    FROM public.user_capabilities
   WHERE user_id = _uid AND capability = 'driver'
   FOR UPDATE;

  IF FOUND AND _existing IN ('active','suspended','revoked') THEN
    -- Never unsuspend, never reverse revoked, never rewrite an active row.
    RETURN _existing;
  END IF;

  INSERT INTO public.user_capabilities (user_id, capability, status, activated_at)
  VALUES (_uid, 'driver'::public.user_capability_type,
                'active'::public.user_capability_status, now())
  ON CONFLICT (user_id, capability) DO UPDATE
    SET status = 'active'::public.user_capability_status,
        activated_at = COALESCE(public.user_capabilities.activated_at, now()),
        updated_at = now()
    WHERE public.user_capabilities.status = 'setup';

  SELECT status INTO _existing
    FROM public.user_capabilities
   WHERE user_id = _uid AND capability = 'driver';
  RETURN _existing;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_my_driver_workspace() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.activate_my_driver_workspace() FROM anon;
GRANT EXECUTE ON FUNCTION public.activate_my_driver_workspace() TO authenticated, service_role;

-- 4. Own-record write policies ----------------------------------------------
-- loads
DROP POLICY IF EXISTS "Users can insert own loads" ON public.loads;
CREATE POLICY "Users can insert own loads" ON public.loads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));
DROP POLICY IF EXISTS "Users can update own loads" ON public.loads;
CREATE POLICY "Users can update own loads" ON public.loads FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own loads" ON public.loads;
CREATE POLICY "Users can delete own loads" ON public.loads FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));

-- expenses
DROP POLICY IF EXISTS "Users can insert own expenses" ON public.expenses;
CREATE POLICY "Users can insert own expenses" ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));
DROP POLICY IF EXISTS "Users can update own expenses" ON public.expenses;
CREATE POLICY "Users can update own expenses" ON public.expenses FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own expenses" ON public.expenses;
CREATE POLICY "Users can delete own expenses" ON public.expenses FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));

-- fuel_logs
DROP POLICY IF EXISTS "Users can insert own fuel logs" ON public.fuel_logs;
CREATE POLICY "Users can insert own fuel logs" ON public.fuel_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));
DROP POLICY IF EXISTS "Users can update own fuel logs" ON public.fuel_logs;
CREATE POLICY "Users can update own fuel logs" ON public.fuel_logs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own fuel logs" ON public.fuel_logs;
CREATE POLICY "Users can delete own fuel logs" ON public.fuel_logs FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));

-- load_stops (keeps the existing parent-load ownership check)
DROP POLICY IF EXISTS "Users can insert own load stops" ON public.load_stops;
CREATE POLICY "Users can insert own load stops" ON public.load_stops FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid())
    AND EXISTS (SELECT 1 FROM public.loads WHERE loads.id = load_stops.load_id AND loads.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can update own load stops" ON public.load_stops;
CREATE POLICY "Users can update own load stops" ON public.load_stops FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid())
    AND EXISTS (SELECT 1 FROM public.loads WHERE loads.id = load_stops.load_id AND loads.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can delete own load stops" ON public.load_stops;
CREATE POLICY "Users can delete own load stops" ON public.load_stops FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));

-- recurring_expense_templates
DROP POLICY IF EXISTS "Users can insert own templates" ON public.recurring_expense_templates;
CREATE POLICY "Users can insert own templates" ON public.recurring_expense_templates FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));
DROP POLICY IF EXISTS "Users can update own templates" ON public.recurring_expense_templates;
CREATE POLICY "Users can update own templates" ON public.recurring_expense_templates FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own templates" ON public.recurring_expense_templates;
CREATE POLICY "Users can delete own templates" ON public.recurring_expense_templates FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_driver_capability(auth.uid()));
