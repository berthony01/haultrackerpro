CREATE OR REPLACE FUNCTION public.contracts_field_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- service_role and admins bypass
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Identity fields are immutable to clients
  NEW.application_id    := OLD.application_id;
  NEW.opportunity_id    := OLD.opportunity_id;
  NEW.recruiter_id      := OLD.recruiter_id;
  NEW.recruiter_user_id := OLD.recruiter_user_id;
  NEW.driver_user_id    := OLD.driver_user_id;
  NEW.created_at        := OLD.created_at;

  -- AI / system-controlled fields are immutable to clients
  NEW.risk_score := OLD.risk_score;
  NEW.risk_tier  := OLD.risk_tier;

  -- Active version pointer is system-controlled (set by upload/parse/admin flows)
  NEW.current_version_id := OLD.current_version_id;

  RETURN NEW;
END;
$function$;