-- Replace apply_recruiter_intent with an eligibility-gated version.
-- Existing drivers tampering with ?intent=recruiter no longer get a silent
-- intended_role flip. Only fresh signups (or existing recruiters re-confirming)
-- are eligible.

DROP FUNCTION IF EXISTS public.apply_recruiter_intent();

CREATE OR REPLACE FUNCTION public.apply_recruiter_intent()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _created_at timestamptz;
  _current_intent text;
  _has_recruiter boolean := false;
  _has_loads boolean := false;
  _has_expenses boolean := false;
  _has_fuel boolean := false;
  _is_fresh boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Branch 1: already a recruiter — idempotent re-confirmation, always eligible.
  SELECT EXISTS (
    SELECT 1 FROM public.recruiter_profiles WHERE user_id = _uid
  ) INTO _has_recruiter;

  IF NOT _has_recruiter THEN
    -- Branch 2: fresh new signup.
    SELECT u.created_at INTO _created_at FROM auth.users u WHERE u.id = _uid;
    SELECT p.intended_role INTO _current_intent
      FROM public.profiles p WHERE p.user_id = _uid;

    SELECT EXISTS (SELECT 1 FROM public.loads    WHERE user_id = _uid) INTO _has_loads;
    SELECT EXISTS (SELECT 1 FROM public.expenses WHERE user_id = _uid) INTO _has_expenses;
    SELECT EXISTS (SELECT 1 FROM public.fuel_logs WHERE user_id = _uid) INTO _has_fuel;

    _is_fresh := (
      _created_at IS NOT NULL
      AND _created_at > (now() - interval '30 minutes')
      AND COALESCE(_current_intent, 'driver') = 'driver'
      AND NOT _has_loads
      AND NOT _has_expenses
      AND NOT _has_fuel
    );

    IF NOT _is_fresh THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'not_eligible');
    END IF;
  END IF;

  -- Eligible path: bypass guard trigger and upsert recruiter intent.
  PERFORM set_config('app.allow_intended_role_change', 'true', true);

  INSERT INTO public.profiles (user_id, intended_role)
  VALUES (_uid, 'recruiter')
  ON CONFLICT (user_id) DO UPDATE
    SET intended_role = 'recruiter'
    WHERE public.profiles.intended_role IS DISTINCT FROM 'recruiter';

  PERFORM set_config('app.allow_intended_role_change', 'false', true);

  RETURN jsonb_build_object('applied', true, 'reason',
    CASE WHEN _has_recruiter THEN 'recruiter_profile' ELSE 'fresh_signup' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_recruiter_intent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_recruiter_intent() TO authenticated;