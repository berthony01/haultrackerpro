-- Phase 8: prevent duplicate signatures per contract/version/signer/role
CREATE UNIQUE INDEX IF NOT EXISTS contract_signatures_unique_per_signer
  ON public.contract_signatures (contract_id, version_id, signer_user_id, signer_role);

-- Reserve the 'signed' audit action (system / service-role only)
CREATE OR REPLACE FUNCTION public.contract_audit_log_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    'driver_reviewed','driver_review_failed','approved','rejected','changes_requested',
    'admin_viewed','admin_note_added','admin_action',
    'signed','sign_failed'
  ) THEN
    RAISE EXCEPTION 'Reserved system action: %', NEW.action USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('driver','recruiter') THEN
    NEW.actor_role := NULL;
  END IF;

  RETURN NEW;
END;
$$;