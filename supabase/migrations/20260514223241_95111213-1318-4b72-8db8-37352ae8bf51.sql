-- =========================================================================
-- PHASE 1 HARDENING — Contract Protection System
-- No UI / workflow changes. Only adds FKs, immutability + system-field guards,
-- and tightens audit log inserts.
-- =========================================================================

-- ---------- 1. Foreign keys on public.contracts ----------
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_application_fk
    FOREIGN KEY (application_id)
    REFERENCES public.opportunity_applications(id) ON DELETE CASCADE,
  ADD CONSTRAINT contracts_opportunity_fk
    FOREIGN KEY (opportunity_id)
    REFERENCES public.opportunities(id) ON DELETE CASCADE,
  ADD CONSTRAINT contracts_recruiter_fk
    FOREIGN KEY (recruiter_id)
    REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT contracts_driver_user_fk
    FOREIGN KEY (driver_user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT contracts_recruiter_user_fk
    FOREIGN KEY (recruiter_user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE;

-- ---------- 2 + 3. Identity immutability + system-field guard on contracts ----------
CREATE OR REPLACE FUNCTION public.contracts_field_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contracts_field_guard
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_field_guard();

-- ---------- 3. System-field guard on contract_versions ----------
CREATE OR REPLACE FUNCTION public.contract_versions_field_guard()
RETURNS TRIGGER
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

  IF TG_OP = 'INSERT' THEN
    -- Force safe defaults; only the backend pipeline may set parsed output
    NEW.extracted_text := NULL;
    NEW.parse_status   := 'pending';
    NEW.parse_error    := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: lock parsing/extraction fields + identity
  NEW.contract_id    := OLD.contract_id;
  NEW.version_number := OLD.version_number;
  NEW.storage_bucket := OLD.storage_bucket;
  NEW.storage_path   := OLD.storage_path;
  NEW.uploaded_by    := OLD.uploaded_by;
  NEW.created_at     := OLD.created_at;
  NEW.extracted_text := OLD.extracted_text;
  NEW.parse_status   := OLD.parse_status;
  NEW.parse_error    := OLD.parse_error;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contract_versions_field_guard
  BEFORE INSERT OR UPDATE ON public.contract_versions
  FOR EACH ROW EXECUTE FUNCTION public.contract_versions_field_guard();

-- ---------- 4. Lock contract_clauses to admins / service_role only ----------
-- Drop the SELECT-only "Parties view clauses" stays intact; remove the
-- previous broad "Admins manage clauses" ALL policy and replace with explicit
-- ones so non-admins have no INSERT/UPDATE/DELETE path at all.
DROP POLICY IF EXISTS "Admins manage clauses" ON public.contract_clauses;

CREATE POLICY "Admins insert clauses"
  ON public.contract_clauses FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins update clauses"
  ON public.contract_clauses FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins delete clauses"
  ON public.contract_clauses FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));
-- service_role bypasses RLS, so the AI pipeline retains write access.

-- ---------- 5. Audit log: reserve system actions for admin/service_role ----------
CREATE OR REPLACE FUNCTION public.contract_audit_log_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _is_privileged BOOLEAN := (
    current_setting('request.jwt.claim.role', true) = 'service_role'
    OR auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
  );
BEGIN
  IF _is_privileged THEN
    RETURN NEW;
  END IF;

  -- Reserved system/AI actions
  IF NEW.action IN (
    'ai_review_started',
    'ai_review_completed',
    'version_created',
    'archived',
    'expired'
  ) THEN
    RAISE EXCEPTION 'Action % is reserved for the system', NEW.action
      USING ERRCODE = '42501';
  END IF;

  -- Force role honesty for client-inserted entries
  IF NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('driver','recruiter') THEN
    NEW.actor_role := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contract_audit_log_guard
  BEFORE INSERT ON public.contract_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.contract_audit_log_guard();
