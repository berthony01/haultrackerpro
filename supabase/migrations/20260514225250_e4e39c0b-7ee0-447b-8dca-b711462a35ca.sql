-- 1. Unique constraint: one contract per application
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_application_id_key UNIQUE (application_id);

-- 2. Upload tracking columns on contract_versions
ALTER TABLE public.contract_versions
  ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'pending_upload',
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz NULL;

ALTER TABLE public.contract_versions
  ADD CONSTRAINT contract_versions_upload_status_chk
  CHECK (upload_status IN ('pending_upload','uploaded','failed'));

-- Backfill: any pre-existing rows are assumed already uploaded
UPDATE public.contract_versions
SET upload_status = 'uploaded',
    uploaded_at = COALESCE(uploaded_at, created_at)
WHERE upload_status = 'pending_upload'
  AND created_at < now() - interval '1 second';

-- 3. Strengthen field guard: lock upload_status / uploaded_at for non-privileged callers
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
    NEW.extracted_text := NULL;
    NEW.parse_status   := 'pending';
    NEW.parse_error    := NULL;
    NEW.upload_status  := 'pending_upload';
    NEW.uploaded_at    := NULL;
    RETURN NEW;
  END IF;

  NEW.contract_id    := OLD.contract_id;
  NEW.version_number := OLD.version_number;
  NEW.storage_bucket := OLD.storage_bucket;
  NEW.storage_path   := OLD.storage_path;
  NEW.uploaded_by    := OLD.uploaded_by;
  NEW.created_at     := OLD.created_at;
  NEW.extracted_text := OLD.extracted_text;
  NEW.parse_status   := OLD.parse_status;
  NEW.parse_error    := OLD.parse_error;
  NEW.upload_status  := OLD.upload_status;
  NEW.uploaded_at    := OLD.uploaded_at;
  RETURN NEW;
END;
$$;

-- 4. Audit guard: allow 'admin' actor_role when the caller is actually an admin
CREATE OR REPLACE FUNCTION public.contract_audit_log_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
    'ai_review_started','ai_review_completed','version_created','archived','expired'
  ) THEN
    RAISE EXCEPTION 'Reserved system action: %', NEW.action USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('driver','recruiter') THEN
    NEW.actor_role := NULL;
  END IF;

  RETURN NEW;
END;
$$;