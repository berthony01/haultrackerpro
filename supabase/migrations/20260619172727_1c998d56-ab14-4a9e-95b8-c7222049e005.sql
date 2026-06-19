-- Server-authoritative recruiter intent: lock client writes to profiles.intended_role,
-- and add a SECURITY DEFINER RPC that the client may call to set their own intent.

-- 1) Guard trigger: pin profiles.intended_role unless the SECURITY DEFINER RPC
--    explicitly opts-in via a request-scoped GUC, or the caller is service_role/admin.
CREATE OR REPLACE FUNCTION public.prevent_profile_intended_role_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _allow boolean := (
    COALESCE(current_setting('app.allow_intended_role_change', true), 'false') = 'true'
  );
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.intended_role IS DISTINCT FROM OLD.intended_role AND NOT _allow THEN
    NEW.intended_role := OLD.intended_role;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_intended_role_updates ON public.profiles;
CREATE TRIGGER trg_prevent_profile_intended_role_updates
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_intended_role_updates();

-- 2) Server-authoritative RPC: caller can mark THEIR OWN profile as recruiter intent.
--    No user_id input; idempotent; returns boolean success.
CREATE OR REPLACE FUNCTION public.apply_recruiter_intent()
RETURNS boolean
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

  -- Permit this single statement to bypass the guard trigger.
  PERFORM set_config('app.allow_intended_role_change', 'true', true);

  -- Upsert: handle_new_user usually inserted the row; covers race where it didn't.
  INSERT INTO public.profiles (user_id, intended_role)
  VALUES (_uid, 'recruiter')
  ON CONFLICT (user_id) DO UPDATE
    SET intended_role = 'recruiter'
    WHERE public.profiles.intended_role IS DISTINCT FROM 'recruiter';

  PERFORM set_config('app.allow_intended_role_change', 'false', true);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_recruiter_intent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_recruiter_intent() TO authenticated;