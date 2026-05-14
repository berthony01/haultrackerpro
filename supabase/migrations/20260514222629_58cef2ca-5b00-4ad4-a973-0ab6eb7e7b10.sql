-- =========================================================================
-- PHASE 1: CONTRACT PROTECTION SYSTEM — schema, storage, RLS only.
-- No UI. No workflow changes. No existing tables modified.
-- =========================================================================

-- ---------- Lifecycle enum ----------
DO $$ BEGIN
  CREATE TYPE public.contract_status AS ENUM (
    'uploaded',
    'parsing',
    'parsed',
    'ai_reviewed',
    'driver_reviewing',
    'changes_requested',
    'rejected',
    'approved',
    'signed',
    'expired',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- contracts ----------
CREATE TABLE public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL,
  opportunity_id UUID NOT NULL,
  recruiter_id UUID NOT NULL,             -- recruiter_profiles.id
  recruiter_user_id UUID NOT NULL,        -- auth.users.id of recruiter owner
  driver_user_id UUID NOT NULL,           -- auth.users.id of driver applicant
  status public.contract_status NOT NULL DEFAULT 'uploaded',
  current_version_id UUID,
  risk_score NUMERIC,
  risk_tier TEXT,
  title TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contracts_application ON public.contracts(application_id);
CREATE INDEX idx_contracts_opportunity ON public.contracts(opportunity_id);
CREATE INDEX idx_contracts_recruiter ON public.contracts(recruiter_id);
CREATE INDEX idx_contracts_driver_user ON public.contracts(driver_user_id);
CREATE INDEX idx_contracts_recruiter_user ON public.contracts(recruiter_user_id);

-- ---------- contract_versions ----------
CREATE TABLE public.contract_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'contract-documents',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  page_count INTEGER,
  extracted_text TEXT,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  parse_error TEXT,
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, version_number)
);
CREATE INDEX idx_contract_versions_contract ON public.contract_versions(contract_id);

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES public.contract_versions(id) ON DELETE SET NULL;

-- ---------- contract_clauses (AI-extracted findings, future use) ----------
CREATE TABLE public.contract_clauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES public.contract_versions(id) ON DELETE CASCADE,
  clause_type TEXT NOT NULL,        -- e.g. escrow, forced_dispatch, deductions, liability
  severity TEXT NOT NULL DEFAULT 'info', -- info, low, medium, high, severe
  summary TEXT,
  raw_excerpt TEXT,
  page_ref INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contract_clauses_contract ON public.contract_clauses(contract_id);
CREATE INDEX idx_contract_clauses_version ON public.contract_clauses(version_id);

-- ---------- contract_reviews (driver / AI / admin review snapshots) ----------
CREATE TABLE public.contract_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  version_id UUID REFERENCES public.contract_versions(id) ON DELETE SET NULL,
  reviewer_user_id UUID,            -- nullable: AI/system reviews
  reviewer_role TEXT NOT NULL,      -- driver, recruiter, admin, ai
  decision TEXT,                    -- approved, rejected, changes_requested, info
  notes TEXT,
  ai_summary TEXT,
  ai_findings JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contract_reviews_contract ON public.contract_reviews(contract_id);

-- ---------- contract_audit_log (append-only) ----------
CREATE TABLE public.contract_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  version_id UUID REFERENCES public.contract_versions(id) ON DELETE SET NULL,
  actor_user_id UUID,
  actor_role TEXT,
  action TEXT NOT NULL, -- uploaded, viewed, downloaded, version_created, ai_review_started, ai_review_completed, driver_reviewed, approved, rejected, signed, archived
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contract_audit_contract ON public.contract_audit_log(contract_id);
CREATE INDEX idx_contract_audit_action ON public.contract_audit_log(action);

-- ---------- contract_signatures (future-ready, no UI yet) ----------
CREATE TABLE public.contract_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES public.contract_versions(id) ON DELETE CASCADE,
  signer_user_id UUID NOT NULL,
  signer_role TEXT NOT NULL,        -- driver, recruiter
  signature_method TEXT NOT NULL DEFAULT 'typed', -- typed, drawn, e_sign_provider
  signed_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contract_signatures_contract ON public.contract_signatures(contract_id);

-- =========================================================================
-- updated_at triggers (uses existing public.update_updated_at_column())
-- =========================================================================
CREATE TRIGGER trg_contracts_updated_at
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_contract_versions_updated_at
  BEFORE UPDATE ON public.contract_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_contract_reviews_updated_at
  BEFORE UPDATE ON public.contract_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- Forward-only status guard on contracts
-- =========================================================================
CREATE OR REPLACE FUNCTION public.contracts_status_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _old_rank INT;
  _new_rank INT;
BEGIN
  -- service_role and admins bypass
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  _old_rank := CASE OLD.status
    WHEN 'uploaded' THEN 1
    WHEN 'parsing' THEN 2
    WHEN 'parsed' THEN 3
    WHEN 'ai_reviewed' THEN 4
    WHEN 'driver_reviewing' THEN 5
    WHEN 'changes_requested' THEN 6
    WHEN 'rejected' THEN 9
    WHEN 'approved' THEN 7
    WHEN 'signed' THEN 8
    WHEN 'expired' THEN 9
    WHEN 'archived' THEN 10
  END;
  _new_rank := CASE NEW.status
    WHEN 'uploaded' THEN 1
    WHEN 'parsing' THEN 2
    WHEN 'parsed' THEN 3
    WHEN 'ai_reviewed' THEN 4
    WHEN 'driver_reviewing' THEN 5
    WHEN 'changes_requested' THEN 6
    WHEN 'rejected' THEN 9
    WHEN 'approved' THEN 7
    WHEN 'signed' THEN 8
    WHEN 'expired' THEN 9
    WHEN 'archived' THEN 10
  END;

  -- Allow changes_requested -> driver_reviewing loop, otherwise forward-only
  IF OLD.status = 'changes_requested' AND NEW.status IN ('driver_reviewing','rejected','archived') THEN
    RETURN NEW;
  END IF;

  IF _new_rank < _old_rank THEN
    RAISE EXCEPTION 'Contract status cannot move backward (% -> %)', OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contracts_status_guard
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_status_guard();

-- =========================================================================
-- Helper: is_application_party
-- =========================================================================
CREATE OR REPLACE FUNCTION public.is_application_party(_user_id UUID, _application_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.opportunity_applications oa
    LEFT JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id
    WHERE oa.id = _application_id
      AND (
        oa.driver_user_id = _user_id
        OR (rp.user_id = _user_id
            AND rp.status <> 'suspended'
            AND rp.verification_status <> 'suspended')
      )
  );
$$;

-- =========================================================================
-- Enable RLS
-- =========================================================================
ALTER TABLE public.contracts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_clauses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_reviews     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_audit_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_signatures  ENABLE ROW LEVEL SECURITY;

-- ---------- contracts policies ----------
CREATE POLICY "Driver views own contracts"
  ON public.contracts FOR SELECT TO authenticated
  USING (auth.uid() = driver_user_id);

CREATE POLICY "Recruiter views own contracts"
  ON public.contracts FOR SELECT TO authenticated
  USING (public.is_recruiter_owner(auth.uid(), recruiter_id));

CREATE POLICY "Admins view all contracts"
  ON public.contracts FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Recruiter inserts contracts on own applications"
  ON public.contracts FOR INSERT TO authenticated
  WITH CHECK (
    public.is_recruiter_owner(auth.uid(), recruiter_id)
    AND auth.uid() = recruiter_user_id
    AND EXISTS (
      SELECT 1 FROM public.opportunity_applications oa
      WHERE oa.id = application_id
        AND oa.recruiter_id = contracts.recruiter_id
        AND oa.opportunity_id = contracts.opportunity_id
        AND oa.driver_user_id = contracts.driver_user_id
    )
  );

CREATE POLICY "Recruiter updates own contracts"
  ON public.contracts FOR UPDATE TO authenticated
  USING (public.is_recruiter_owner(auth.uid(), recruiter_id))
  WITH CHECK (public.is_recruiter_owner(auth.uid(), recruiter_id));

CREATE POLICY "Driver updates review status on own contracts"
  ON public.contracts FOR UPDATE TO authenticated
  USING (auth.uid() = driver_user_id)
  WITH CHECK (auth.uid() = driver_user_id);

CREATE POLICY "Admins update all contracts"
  ON public.contracts FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins delete contracts"
  ON public.contracts FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- ---------- contract_versions policies ----------
CREATE POLICY "Parties view contract versions"
  ON public.contract_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_versions.contract_id
        AND (
          c.driver_user_id = auth.uid()
          OR public.is_recruiter_owner(auth.uid(), c.recruiter_id)
          OR public.is_admin(auth.uid())
        )
    )
  );

CREATE POLICY "Recruiter inserts versions on own contracts"
  ON public.contract_versions FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_versions.contract_id
        AND public.is_recruiter_owner(auth.uid(), c.recruiter_id)
    )
  );

CREATE POLICY "Admins update versions"
  ON public.contract_versions FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins delete versions"
  ON public.contract_versions FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- ---------- contract_clauses policies (AI/system writes via service role) ----------
CREATE POLICY "Parties view clauses"
  ON public.contract_clauses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_clauses.contract_id
        AND (
          c.driver_user_id = auth.uid()
          OR public.is_recruiter_owner(auth.uid(), c.recruiter_id)
          OR public.is_admin(auth.uid())
        )
    )
  );

CREATE POLICY "Admins manage clauses"
  ON public.contract_clauses FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ---------- contract_reviews policies ----------
CREATE POLICY "Parties view reviews"
  ON public.contract_reviews FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_reviews.contract_id
        AND (
          c.driver_user_id = auth.uid()
          OR public.is_recruiter_owner(auth.uid(), c.recruiter_id)
          OR public.is_admin(auth.uid())
        )
    )
  );

CREATE POLICY "Driver inserts own review"
  ON public.contract_reviews FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_user_id = auth.uid()
    AND reviewer_role = 'driver'
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_reviews.contract_id
        AND c.driver_user_id = auth.uid()
    )
  );

CREATE POLICY "Recruiter inserts own review"
  ON public.contract_reviews FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_user_id = auth.uid()
    AND reviewer_role = 'recruiter'
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_reviews.contract_id
        AND public.is_recruiter_owner(auth.uid(), c.recruiter_id)
    )
  );

CREATE POLICY "Admins manage reviews"
  ON public.contract_reviews FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ---------- contract_audit_log policies (append-only; reads to parties+admins) ----------
CREATE POLICY "Parties view contract audit"
  ON public.contract_audit_log FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_audit_log.contract_id
        AND (
          c.driver_user_id = auth.uid()
          OR public.is_recruiter_owner(auth.uid(), c.recruiter_id)
          OR public.is_admin(auth.uid())
        )
    )
  );

CREATE POLICY "Parties insert audit entries"
  ON public.contract_audit_log FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_audit_log.contract_id
        AND (
          c.driver_user_id = auth.uid()
          OR public.is_recruiter_owner(auth.uid(), c.recruiter_id)
          OR public.is_admin(auth.uid())
        )
    )
  );
-- No UPDATE/DELETE policies → append-only for non-service-role.

-- ---------- contract_signatures policies (future use; locked down now) ----------
CREATE POLICY "Parties view signatures"
  ON public.contract_signatures FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_signatures.contract_id
        AND (
          c.driver_user_id = auth.uid()
          OR public.is_recruiter_owner(auth.uid(), c.recruiter_id)
          OR public.is_admin(auth.uid())
        )
    )
  );

CREATE POLICY "Signer inserts own signature"
  ON public.contract_signatures FOR INSERT TO authenticated
  WITH CHECK (
    signer_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_signatures.contract_id
        AND (
          (signer_role = 'driver'    AND c.driver_user_id = auth.uid())
          OR (signer_role = 'recruiter' AND public.is_recruiter_owner(auth.uid(), c.recruiter_id))
        )
    )
  );

CREATE POLICY "Admins manage signatures"
  ON public.contract_signatures FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- =========================================================================
-- Private storage bucket
-- =========================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contract-documents',
  'contract-documents',
  false,
  26214400, -- 25 MB
  ARRAY['application/pdf','image/png','image/jpeg','image/jpg','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Object paths: contracts/{application_id}/{contract_id}/{version_id}/filename
-- foldername()[1] = 'contracts', [2] = application_id

CREATE POLICY "Contract objects: parties read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'contract-documents'
    AND (storage.foldername(name))[1] = 'contracts'
    AND (
      public.is_admin(auth.uid())
      OR public.is_application_party(auth.uid(), ((storage.foldername(name))[2])::uuid)
    )
  );

CREATE POLICY "Contract objects: recruiter writes own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contract-documents'
    AND (storage.foldername(name))[1] = 'contracts'
    AND EXISTS (
      SELECT 1 FROM public.opportunity_applications oa
      JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id
      WHERE oa.id = ((storage.foldername(name))[2])::uuid
        AND rp.user_id = auth.uid()
        AND rp.status <> 'suspended'
        AND rp.verification_status <> 'suspended'
    )
  );

CREATE POLICY "Contract objects: admin manage"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'contract-documents'
    AND public.is_admin(auth.uid())
  )
  WITH CHECK (
    bucket_id = 'contract-documents'
    AND public.is_admin(auth.uid())
  );
