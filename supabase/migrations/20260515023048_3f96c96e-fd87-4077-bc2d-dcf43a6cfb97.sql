-- Phase 7B: Hard enforce contract-approved before hiring
CREATE OR REPLACE FUNCTION public.opportunity_applications_require_contract_for_hire()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c public.contracts;
  _v public.contract_versions;
BEGIN
  -- Only enforce when transitioning to hired
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'hired' THEN
    SELECT * INTO _c
    FROM public.contracts
    WHERE application_id = NEW.id
    ORDER BY updated_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Driver cannot be marked hired until the current contract is approved.'
        USING ERRCODE = '42501', HINT = 'contract_required';
    END IF;

    IF _c.current_version_id IS NULL
       OR _c.status NOT IN ('approved','signed') THEN
      RAISE EXCEPTION 'Driver cannot be marked hired until the current contract is approved.'
        USING ERRCODE = '42501', HINT = 'contract_required';
    END IF;

    SELECT * INTO _v
    FROM public.contract_versions
    WHERE id = _c.current_version_id;

    IF NOT FOUND OR _v.upload_status <> 'uploaded' THEN
      RAISE EXCEPTION 'Driver cannot be marked hired until the current contract is approved.'
        USING ERRCODE = '42501', HINT = 'contract_required';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_applications_require_contract_for_hire_trg
  ON public.opportunity_applications;

-- Run AFTER existing update guard so forward-only/field guards still apply first.
CREATE TRIGGER opportunity_applications_require_contract_for_hire_trg
BEFORE UPDATE ON public.opportunity_applications
FOR EACH ROW
EXECUTE FUNCTION public.opportunity_applications_require_contract_for_hire();