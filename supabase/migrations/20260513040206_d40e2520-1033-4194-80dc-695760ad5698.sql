
-- Fix: allow withdraw_opportunity_application() RPC to bypass the trigger block
-- while keeping recruiters from setting withdrawn directly

-- Update the trigger to recognize a safe local config flag set by the RPC
CREATE OR REPLACE FUNCTION public.opportunity_applications_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_rank int;
  _new_rank int;
  _allow_withdraw boolean;
BEGIN
  -- Admins bypass restrictions
  IF public.is_admin(auth.uid()) THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Block edits to protected fields
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
     OR NEW.driver_user_id IS DISTINCT FROM OLD.driver_user_id
     OR NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id
     OR NEW.driver_profile_id IS DISTINCT FROM OLD.driver_profile_id
     OR NEW.application_type IS DISTINCT FROM OLD.application_type
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.preferred_contact_method IS DISTINCT FROM OLD.preferred_contact_method
     OR NEW.driver_phone_snapshot IS DISTINCT FROM OLD.driver_phone_snapshot
     OR NEW.driver_email_snapshot IS DISTINCT FROM OLD.driver_email_snapshot
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Recruiters may only update application status.'
      USING ERRCODE = '42501';
  END IF;

  -- Status change rules
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Check if this is a trusted driver withdraw via RPC
    _allow_withdraw := (current_setting('app.allow_driver_withdraw', true) = 'true');

    IF _allow_withdraw AND NEW.status = 'withdrawn' THEN
      -- Skip remaining checks; driver withdraw is pre-validated by the RPC
      NEW.updated_at := now();
      RETURN NEW;
    END IF;

    -- Block any change from a terminal status
    IF OLD.status IN ('withdrawn','hired','rejected') THEN
      RAISE EXCEPTION 'Terminal application status cannot be changed.'
        USING ERRCODE = '42501';
    END IF;

    -- Recruiters (and non-RPC callers) cannot set withdrawn
    IF NEW.status = 'withdrawn' THEN
      RAISE EXCEPTION 'Only the driver can withdraw an application.'
        USING ERRCODE = '42501';
    END IF;

    -- Forward-only flow
    _old_rank := CASE OLD.status
      WHEN 'new' THEN 1
      WHEN 'viewed' THEN 2
      WHEN 'contacted' THEN 3
      WHEN 'interviewing' THEN 4
      WHEN 'hired' THEN 5
      WHEN 'rejected' THEN 5
      ELSE 0
    END;

    _new_rank := CASE NEW.status
      WHEN 'new' THEN 1
      WHEN 'viewed' THEN 2
      WHEN 'contacted' THEN 3
      WHEN 'interviewing' THEN 4
      WHEN 'hired' THEN 5
      WHEN 'rejected' THEN 5
      ELSE 0
    END;

    IF _new_rank = 0 THEN
      RAISE EXCEPTION 'Invalid application status.'
        USING ERRCODE = '22023';
    END IF;

    IF _new_rank < _old_rank THEN
      RAISE EXCEPTION 'Application status cannot move backward.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Update the withdraw RPC to set the safe config flag before UPDATE
CREATE OR REPLACE FUNCTION public.withdraw_opportunity_application(application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.opportunity_applications;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _row FROM public.opportunity_applications WHERE id = application_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002';
  END IF;

  IF _row.driver_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _row.status IN ('hired','rejected','withdrawn') THEN
    RAISE EXCEPTION 'Cannot withdraw a terminal application' USING ERRCODE = '22023';
  END IF;

  -- Set local flag so the trigger allows this update
  PERFORM set_config('app.allow_driver_withdraw', 'true', true);

  UPDATE public.opportunity_applications
  SET status = 'withdrawn', updated_at = now()
  WHERE id = application_id;
END;
$$;

COMMENT ON FUNCTION public.withdraw_opportunity_application(uuid) IS
'Driver-only RPC to withdraw an application. Sets a transaction-local config flag so opportunity_applications_update_guard allows the status change.';

COMMENT ON FUNCTION public.opportunity_applications_update_guard() IS
'Trigger guard for opportunity_applications. Allows driver withdraw via RPC config flag; otherwise enforces terminal-status protection and forward-only recruiter flow.';

-- Ensure trigger is attached (idempotent)
DROP TRIGGER IF EXISTS opportunity_applications_update_guard_trigger
  ON public.opportunity_applications;

CREATE TRIGGER opportunity_applications_update_guard_trigger
  BEFORE UPDATE ON public.opportunity_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.opportunity_applications_update_guard();

SELECT tgname, proname
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE tgrelid = 'public.opportunity_applications'::regclass
  AND NOT tgisinternal;

SELECT proname, pg_get_function_identity_arguments(oid) as args
FROM pg_proc
WHERE proname IN ('withdraw_opportunity_application', 'opportunity_applications_update_guard');

SELECT 'Migration applied successfully' as status;
