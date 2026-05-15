-- Phase 8 hardening: lock contract status writes & signature inserts to service-role/admin

-- 1) Block non-admin/non-service from changing contracts.status directly
CREATE OR REPLACE FUNCTION public.contracts_status_client_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Contract status can only be changed by the system.'
      USING ERRCODE = '42501', HINT = 'service_role_required';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contracts_status_client_lock_trg ON public.contracts;
CREATE TRIGGER contracts_status_client_lock_trg
BEFORE UPDATE ON public.contracts
FOR EACH ROW
EXECUTE FUNCTION public.contracts_status_client_lock();

-- 2) Drop direct signer insert policy (only sign-contract edge function may insert)
DROP POLICY IF EXISTS "Signer inserts own signature" ON public.contract_signatures;

-- 3) Validation trigger for signatures: version must belong to contract,
--    driver role must match contracts.driver_user_id, recruiter role disallowed in Phase 8
CREATE OR REPLACE FUNCTION public.contract_signatures_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _c public.contracts;
  _v public.contract_versions;
BEGIN
  SELECT * INTO _c FROM public.contracts WHERE id = NEW.contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found for signature' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO _v FROM public.contract_versions
   WHERE id = NEW.version_id AND contract_id = NEW.contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signature version_id must belong to the same contract'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.signer_role = 'driver' THEN
    IF NEW.signer_user_id IS DISTINCT FROM _c.driver_user_id THEN
      RAISE EXCEPTION 'Driver signature must match assigned driver'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.signer_role = 'recruiter' THEN
    RAISE EXCEPTION 'Recruiter signatures are not allowed in this phase'
      USING ERRCODE = '42501';
  ELSE
    RAISE EXCEPTION 'Invalid signer_role: %', NEW.signer_role
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contract_signatures_validate_trg ON public.contract_signatures;
CREATE TRIGGER contract_signatures_validate_trg
BEFORE INSERT OR UPDATE ON public.contract_signatures
FOR EACH ROW
EXECUTE FUNCTION public.contract_signatures_validate();