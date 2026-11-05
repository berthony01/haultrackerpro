-- Apply as one transaction. The two invitation functions keep their existing
-- authorization, privileges and search paths. Only the pgcrypto calls change.
DO $invite_crypto$
DECLARE
  _invite text := pg_get_functiondef('public.invite_assistant(text,jsonb)'::regprocedure);
  _accept text := pg_get_functiondef('public.accept_assistant_invite(text)'::regprocedure);
BEGIN
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL
     OR to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Expected pgcrypto functions in extensions';
  END IF;

  IF position('extensions.gen_random_bytes(24)' IN _invite) = 0 THEN
    IF position('encode(gen_random_bytes(24),' IN _invite) = 0 THEN
      RAISE EXCEPTION 'Unexpected invite_assistant token generator';
    END IF;
    _invite := replace(_invite, 'encode(gen_random_bytes(24),', 'encode(extensions.gen_random_bytes(24),');
  END IF;
  IF position('extensions.digest(_token,' IN _invite) = 0 THEN
    IF position('encode(digest(_token,' IN _invite) = 0 THEN
      RAISE EXCEPTION 'Unexpected invite_assistant token hash';
    END IF;
    _invite := replace(_invite, 'encode(digest(_token,', 'encode(extensions.digest(_token,');
  END IF;
  IF position('extensions.digest(_token,' IN _accept) = 0 THEN
    IF position('encode(digest(_token,' IN _accept) = 0 THEN
      RAISE EXCEPTION 'Unexpected accept_assistant_invite token hash';
    END IF;
    _accept := replace(_accept, 'encode(digest(_token,', 'encode(extensions.digest(_token,');
  END IF;

  EXECUTE _invite;
  EXECUTE _accept;
END
$invite_crypto$;

CREATE SCHEMA IF NOT EXISTS htp_hiring_private;
REVOKE ALL ON SCHEMA htp_hiring_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA htp_hiring_private TO authenticated;

-- A client-controlled setting is never authority by itself. The trigger
-- accepts only an application-bound marker with the server-only secret,
-- following the existing offer-workflow token pattern.
CREATE TABLE IF NOT EXISTS htp_hiring_private.workflow_secret (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  token uuid NOT NULL DEFAULT gen_random_uuid()
);
ALTER TABLE htp_hiring_private.workflow_secret ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE htp_hiring_private.workflow_secret FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO htp_hiring_private.workflow_secret (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION htp_hiring_private.complete_approved_contract_hire(_application_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $hire$
DECLARE
  _actor uuid := auth.uid();
  _app public.opportunity_applications%ROWTYPE;
  _contract public.contracts%ROWTYPE;
  _marker text;
  _result text;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Installations with the full offer workflow retain its accepted-offer
  -- requirements and transition semantics.
  IF to_regprocedure('public.complete_hiring(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT result_code FROM public.complete_hiring($1)' INTO _result USING _application_id;
    RETURN _result;
  END IF;

  SELECT a.* INTO _app
  FROM public.opportunity_applications a
  JOIN public.recruiter_profiles r ON r.id = a.recruiter_id
  WHERE a.id = _application_id AND r.user_id = _actor
  FOR UPDATE OF a FOR SHARE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.current_user_can_manage_recruiter_opportunities(_app.recruiter_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF _app.application_type <> 'apply' THEN
    RAISE EXCEPTION 'Hiring requires a formal application.' USING ERRCODE = '42501';
  END IF;
  IF _app.status = 'hired' THEN
    RETURN 'already_hired';
  END IF;
  IF _app.status NOT IN ('offer_sent', 'onboarding') THEN
    RAISE EXCEPTION 'Send an offer before completing hire.' USING ERRCODE = '42501';
  END IF;

  -- Serialize with contract changes. The original hire trigger also verifies
  -- the current uploaded version before the application update can commit.
  SELECT c.* INTO _contract
  FROM public.contracts c
  WHERE c.application_id = _app.id
    AND c.opportunity_id = _app.opportunity_id
    AND c.recruiter_id = _app.recruiter_id
    AND c.recruiter_user_id = _actor
    AND c.driver_user_id = _app.driver_user_id
  FOR UPDATE;
  IF NOT FOUND OR _contract.status NOT IN ('approved', 'signed') THEN
    RAISE EXCEPTION 'The driver must approve the current contract before you can complete hire.'
      USING ERRCODE = '42501', HINT = 'contract_required';
  END IF;

  PERFORM 1
  FROM public.contract_versions v
  WHERE v.id = _contract.current_version_id
    AND v.contract_id = _contract.id
    AND v.upload_status = 'uploaded'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The driver must approve the current contract before you can complete hire.'
      USING ERRCODE = '42501', HINT = 'contract_required';
  END IF;

  SELECT token::text || ':' || _app.id::text INTO STRICT _marker
  FROM htp_hiring_private.workflow_secret
  WHERE singleton;

  PERFORM set_config('app.approved_contract_hire', _marker, true);
  UPDATE public.opportunity_applications SET status = 'hired' WHERE id = _app.id;
  PERFORM set_config('app.approved_contract_hire', '', true);

  -- Existing triggers advance the referral and emit the application event
  -- and notification as part of the same transaction.
  RETURN 'hiring_completed';
END
$hire$;

REVOKE ALL ON FUNCTION htp_hiring_private.complete_approved_contract_hire(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION htp_hiring_private.complete_approved_contract_hire(uuid) TO authenticated;

-- Keep the preexisting transition and field guards verbatim. Insert the
-- exception at the legacy workflow denial only, and stop on schema drift.
DO $legacy_guard$
DECLARE
  _definition text := pg_get_functiondef('public.opportunity_applications_update_guard()'::regprocedure);
  _original constant text := '    IF NEW.status IN (''onboarding'',''hired'') THEN';
  _addition constant text := $guard$    IF NEW.status = 'hired'
       AND OLD.status IN ('offer_sent', 'onboarding')
       AND OLD.application_type = 'apply'
       AND EXISTS (
         SELECT 1
         FROM htp_hiring_private.workflow_secret s
         WHERE s.singleton
           AND current_setting('app.approved_contract_hire', true) =
               (s.token::text || ':' || OLD.id::text)
       ) THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;

$guard$;
BEGIN
  IF to_regprocedure('public.complete_hiring(uuid)') IS NOT NULL
     OR position(_addition IN _definition) > 0 THEN
    RETURN;
  END IF;
  IF position(_original IN _definition) = 0
     OR position('Only server-authorized workflow can set' IN _definition) = 0
     OR position('Terminal application status cannot be changed' IN _definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected legacy application update guard';
  END IF;

  EXECUTE replace(_definition, _original, _addition || _original);
END
$legacy_guard$;

CREATE OR REPLACE FUNCTION public.complete_approved_contract_hire(_application_id uuid)
RETURNS text
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $public_hire$
  SELECT htp_hiring_private.complete_approved_contract_hire(_application_id);
$public_hire$;
REVOKE ALL ON FUNCTION public.complete_approved_contract_hire(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_approved_contract_hire(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
