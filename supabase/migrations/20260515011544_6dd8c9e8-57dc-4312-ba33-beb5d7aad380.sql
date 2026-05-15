-- Phase 5 hardening: reserve driver_review_failed action and enforce one driver decision per version

CREATE OR REPLACE FUNCTION public.contract_audit_log_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_privileged boolean := (
    current_setting('request.jwt.claim.role', true) = 'service_role'
    OR auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
  );
BEGIN
  IF is_privileged THEN
    RETURN NEW;
  END IF;

  IF NEW.action IN (
    'ai_review_started','ai_review_completed','ai_review_failed',
    'version_created','archived','expired',
    'parse_started','parse_completed','parse_failed',
    'driver_reviewed','driver_review_failed','approved','rejected','changes_requested'
  ) THEN
    RAISE EXCEPTION 'Reserved system action: %', NEW.action USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('driver','recruiter') THEN
    NEW.actor_role := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- One driver decision per (contract_id, version_id)
CREATE UNIQUE INDEX IF NOT EXISTS contract_reviews_driver_unique_per_version
  ON public.contract_reviews(contract_id, version_id)
  WHERE reviewer_role = 'driver';
