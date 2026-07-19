-- =====================================================================
-- Phase 1H-M2 CANDIDATE (Turn 2b-i remediation): Atomic offer,
-- withdrawal, onboarding, and hiring workflow RPCs.
--
-- STATUS: candidate — not applied live. Exercised end-to-end by
-- src/test/phase1hM2OfferWorkflow.test.ts against a fresh PGlite database
-- that also loads the canonical M1 migration.
--
-- Remediations closed in this pass:
--   * Authorization is performed BEFORE any idempotent state disclosure
--     (already_sent / already_accepted / already_declined / already_canceled
--     / already_hired). Foreign or ineligible callers can never learn
--     private offer/application state.
--   * transition / draft / send / cancel / complete_hiring all enforce
--     public.current_user_can_manage_recruiter_opportunities on the
--     application's recruiter_id in addition to ownership.
--   * Draft eligibility is a positive list: interviewing OR offer_sent
--     (replacement). Send eligibility is the same positive list.
--   * Client-spoofable app.workflow_bypass GUC is replaced by a
--     server-only per-DB secret token. The trigger accepts the workflow
--     bypass ONLY when current_setting('app.workflow_bypass_token') equals
--     public._m2_workflow_token() (a SECURITY DEFINER function whose row
--     is not visible to authenticated). Same treatment for driver
--     withdraw. Both settings default false via GUC scoping (SET LOCAL).
--   * hired guard validates: accepted offer, contract for application,
--     current_version_id set and matches a contract_versions row whose
--     upload_status='uploaded', contract.status IN ('approved','signed').
--   * Event / notification emission are consolidated through
--     _m2_insert_event_once and _m2_notify_once. Notification dedup is
--     keyed on (user_id, type, application_id, offer_id) so distinct
--     applications never suppress each other.
--   * Expiration flows through one canonical helper (_m2_expire_offer)
--     used by accept, decline, cancel, send-replacement reconciliation,
--     and the service_role sweep. Every expiration notifies both driver
--     and recruiter exactly once (deduped per application+offer).
--   * complete_hiring returns
--     (application_id, application_status, offer_id, offer_status,
--      result_code) and notifies the driver exactly once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Server-only workflow bypass token. Authenticated clients cannot read
-- the row (revoked) and cannot execute the helper. RPCs are SECURITY
-- DEFINER and execute nested calls as owner, which retains access.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._m2_workflow_secret (
  singleton boolean PRIMARY KEY DEFAULT true,
  token     uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT _m2_workflow_secret_singleton CHECK (singleton = true)
);
INSERT INTO public._m2_workflow_secret (singleton) VALUES (true)
  ON CONFLICT (singleton) DO NOTHING;
REVOKE ALL ON public._m2_workflow_secret FROM PUBLIC;
REVOKE ALL ON public._m2_workflow_secret FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._m2_workflow_token() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT token::text FROM public._m2_workflow_secret LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._m2_workflow_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._m2_workflow_token() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._m2_workflow_token() TO service_role;

-- Convenience: assert a bypass token is present in current session.
CREATE OR REPLACE FUNCTION public._m2_workflow_bypass_active() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
DECLARE v text; t text;
BEGIN
  v := current_setting('app.workflow_bypass_token', true);
  IF v IS NULL OR v = '' THEN RETURN false; END IF;
  SELECT token::text INTO t FROM public._m2_workflow_secret LIMIT 1;
  RETURN v = t;
END $$;
REVOKE ALL ON FUNCTION public._m2_workflow_bypass_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._m2_workflow_bypass_active() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._m2_workflow_bypass_active() TO service_role;

CREATE OR REPLACE FUNCTION public._m2_driver_withdraw_active() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
DECLARE v text; t text;
BEGIN
  v := current_setting('app.driver_withdraw_token', true);
  IF v IS NULL OR v = '' THEN RETURN false; END IF;
  SELECT token::text INTO t FROM public._m2_workflow_secret LIMIT 1;
  RETURN v = t;
END $$;
REVOKE ALL ON FUNCTION public._m2_driver_withdraw_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._m2_driver_withdraw_active() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._m2_driver_withdraw_active() TO service_role;

-- ---------------------------------------------------------------------
-- Uniqueness: exactly one accepted offer per application.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_offers_one_accepted_per_app_uidx
  ON public.opportunity_offers (application_id) WHERE status = 'accepted';

-- ---------------------------------------------------------------------
-- Application update guard (M2 hardened).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.opportunity_applications_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _driver_withdraw      boolean;
  _workflow             boolean;
  _actor                uuid;
  _recruiter_user_id    uuid;
  _current_sent_offer   uuid;
  _current_accepted     uuid;
  _c_id                 uuid;
  _c_status             text;
  _c_current_version    uuid;
  _v_status             text;
  _v_contract_id        uuid;
  _allowed              text[];
BEGIN
  _workflow := public._m2_workflow_bypass_active();
  _actor    := auth.uid();

  _driver_withdraw := (
    public._m2_driver_withdraw_active()
    AND _actor IS NOT NULL AND _actor = OLD.driver_user_id
    AND NEW.status = 'withdrawn'
    AND OLD.status NOT IN ('withdrawn','hired','rejected')
  );

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
     OR NEW.submission_snapshot IS DISTINCT FROM OLD.submission_snapshot
     OR NEW.snapshot_version IS DISTINCT FROM OLD.snapshot_version
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.contact_sharing_consent IS DISTINCT FROM OLD.contact_sharing_consent
     OR NEW.contact_sharing_consent_at IS DISTINCT FROM OLD.contact_sharing_consent_at
     OR (NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at AND NOT _driver_withdraw)
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.is_legacy IS DISTINCT FROM OLD.is_legacy THEN
    RAISE EXCEPTION 'Recruiters may only update application status.' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'withdrawn' THEN
      IF NOT _driver_withdraw THEN
        RAISE EXCEPTION 'Only the application owner may withdraw via the driver withdraw RPC.'
          USING ERRCODE = '42501';
      END IF;
      NEW.withdrawn_at := now();
      NEW.updated_at := now();
      RETURN NEW;
    END IF;

    IF OLD.status IN ('withdrawn','hired','rejected') THEN
      RAISE EXCEPTION 'Terminal application status cannot be changed.' USING ERRCODE = '42501';
    END IF;

    IF NEW.status IN ('offer_sent','onboarding','hired') THEN
      IF NOT _workflow THEN
        RAISE EXCEPTION 'Only server-authorized workflow can set %, not direct update.', NEW.status
          USING ERRCODE = '42501';
      END IF;

      SELECT rp.user_id INTO _recruiter_user_id
        FROM public.recruiter_profiles rp WHERE rp.id = OLD.recruiter_id;
      IF _actor IS NULL
         OR (_actor <> OLD.driver_user_id AND _actor IS DISTINCT FROM _recruiter_user_id) THEN
        RAISE EXCEPTION 'workflow actor is not authorized for application %', OLD.id
          USING ERRCODE = '42501';
      END IF;

      IF NEW.status = 'offer_sent' THEN
        SELECT o.id INTO _current_sent_offer
          FROM public.opportunity_offers o
         WHERE o.application_id = OLD.id AND o.status = 'sent'
         LIMIT 1;
        IF _current_sent_offer IS NULL THEN
          RAISE EXCEPTION 'offer_sent requires a matching sent offer' USING ERRCODE = '42501';
        END IF;
      ELSIF NEW.status = 'onboarding' THEN
        SELECT o.id INTO _current_accepted
          FROM public.opportunity_offers o
         WHERE o.application_id = OLD.id AND o.status = 'accepted'
         LIMIT 1;
        IF _current_accepted IS NULL THEN
          RAISE EXCEPTION 'onboarding requires an accepted offer' USING ERRCODE = '42501';
        END IF;
      ELSIF NEW.status = 'hired' THEN
        IF OLD.status <> 'onboarding' THEN
          RAISE EXCEPTION 'hired requires prior onboarding' USING ERRCODE = '42501';
        END IF;
        SELECT o.id INTO _current_accepted
          FROM public.opportunity_offers o
         WHERE o.application_id = OLD.id AND o.status = 'accepted'
         LIMIT 1;
        IF _current_accepted IS NULL THEN
          RAISE EXCEPTION 'hired requires an accepted offer' USING ERRCODE = '42501';
        END IF;
        -- Contract gate: must have a contract linked to this application
        -- whose current_version_id points to an uploaded version of the
        -- same contract, and whose status is approved or signed.
        SELECT c.id, c.status::text, c.current_version_id
          INTO _c_id, _c_status, _c_current_version
          FROM public.contracts c
         WHERE c.application_id = OLD.id
         ORDER BY c.updated_at DESC
         LIMIT 1;
        IF _c_id IS NULL THEN
          RAISE EXCEPTION 'hired requires a contract for this application' USING ERRCODE = '42501';
        END IF;
        IF _c_current_version IS NULL THEN
          RAISE EXCEPTION 'hired requires contract.current_version_id' USING ERRCODE = '42501';
        END IF;
        IF _c_status NOT IN ('approved','signed') THEN
          RAISE EXCEPTION 'hired requires contract status approved or signed' USING ERRCODE = '42501';
        END IF;
        SELECT cv.contract_id, cv.upload_status
          INTO _v_contract_id, _v_status
          FROM public.contract_versions cv
         WHERE cv.id = _c_current_version;
        IF _v_contract_id IS NULL OR _v_contract_id <> _c_id THEN
          RAISE EXCEPTION 'hired requires current version to belong to the contract' USING ERRCODE = '42501';
        END IF;
        IF _v_status <> 'uploaded' THEN
          RAISE EXCEPTION 'hired requires uploaded contract version' USING ERRCODE = '42501';
        END IF;
      END IF;

      NEW.updated_at := now();
      RETURN NEW;
    END IF;

    _allowed := CASE OLD.status
      WHEN 'new'               THEN ARRAY['viewed','contact_requested','rejected']
      WHEN 'viewed'            THEN ARRAY['contact_requested','rejected']
      WHEN 'contact_requested' THEN ARRAY['call_scheduled','rejected']
      WHEN 'contacted'         THEN ARRAY['call_scheduled','rejected']
      WHEN 'call_scheduled'    THEN ARRAY['waiting_documents','interviewing','rejected']
      WHEN 'waiting_documents' THEN ARRAY['interviewing','rejected']
      WHEN 'interviewing'      THEN ARRAY['rejected']
      WHEN 'offer_sent'        THEN ARRAY['rejected']
      WHEN 'onboarding'        THEN ARRAY['rejected']
      ELSE ARRAY[]::text[]
    END;

    IF NOT (NEW.status = ANY (_allowed)) THEN
      RAISE EXCEPTION 'Illegal application status transition from % to %.', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------
-- Offer guard (M2 hardened).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.opportunity_offers_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_app public.opportunity_applications%ROWTYPE;
BEGIN
  NEW.updated_at := now();

  SELECT * INTO v_app FROM public.opportunity_applications oa WHERE oa.id = NEW.application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found for offer' USING ERRCODE = '23503';
  END IF;

  IF v_app.application_type <> 'apply' THEN
    RAISE EXCEPTION 'offers require a formal application' USING ERRCODE = '22023';
  END IF;

  IF NEW.opportunity_id IS DISTINCT FROM v_app.opportunity_id
     OR NEW.driver_user_id IS DISTINCT FROM v_app.driver_user_id
     OR NEW.recruiter_id IS DISTINCT FROM v_app.recruiter_id THEN
    RAISE EXCEPTION 'offer identity must match application identity' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'sent' AND NEW.sent_at IS NULL THEN
    NEW.sent_at := now();
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
       OR NEW.driver_user_id IS DISTINCT FROM OLD.driver_user_id
       OR NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id THEN
      RAISE EXCEPTION 'offer identity is immutable' USING ERRCODE = '42501';
    END IF;

    IF OLD.status = 'accepted' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'accepted offers cannot change status' USING ERRCODE = '42501';
    END IF;

    IF OLD.status IN ('declined','expired','canceled','superseded')
       AND NEW.status IN ('draft','sent') THEN
      RAISE EXCEPTION 'terminal offer cannot revert to %', NEW.status USING ERRCODE = '42501';
    END IF;

    IF OLD.status IN ('sent','accepted','declined','expired','canceled','superseded') THEN
      IF NEW.pay_description IS DISTINCT FROM OLD.pay_description
         OR NEW.estimated_weekly_amount IS DISTINCT FROM OLD.estimated_weekly_amount
         OR NEW.route_summary IS DISTINCT FROM OLD.route_summary
         OR NEW.equipment_summary IS DISTINCT FROM OLD.equipment_summary
         OR NEW.home_time_terms IS DISTINCT FROM OLD.home_time_terms
         OR NEW.proposed_start_date IS DISTINCT FROM OLD.proposed_start_date
         OR NEW.orientation_details IS DISTINCT FROM OLD.orientation_details
         OR NEW.contingencies IS DISTINCT FROM OLD.contingencies
         OR NEW.recruiter_message IS DISTINCT FROM OLD.recruiter_message
         OR NEW.sent_snapshot IS DISTINCT FROM OLD.sent_snapshot
         OR NEW.snapshot_version IS DISTINCT FROM OLD.snapshot_version
         OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
         OR NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
        RAISE EXCEPTION 'offer terms are immutable once sent' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------
-- Internal helpers.
-- ---------------------------------------------------------------------

-- Event dedup includes (application_id, event_type, offer_id).
CREATE OR REPLACE FUNCTION public._m2_insert_event_once(
  _application_id uuid, _actor_type text, _actor uuid,
  _event_type text, _offer_id uuid, _metadata jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.application_events e
     WHERE e.application_id = _application_id
       AND e.event_type = _event_type
       AND (
         (_offer_id IS NULL AND (e.metadata ? 'offer_id') = false)
         OR (e.metadata->>'offer_id' = _offer_id::text)
       )
  ) THEN RETURN; END IF;
  INSERT INTO public.application_events (application_id, actor_type, actor_user_id, event_type, metadata)
  VALUES (_application_id, _actor_type, _actor, _event_type,
          COALESCE(_metadata,'{}'::jsonb)
            || CASE WHEN _offer_id IS NULL THEN '{}'::jsonb
                    ELSE jsonb_build_object('offer_id', _offer_id) END);
END;
$function$;
REVOKE ALL ON FUNCTION public._m2_insert_event_once(uuid,text,uuid,text,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._m2_insert_event_once(uuid,text,uuid,text,uuid,jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._m2_insert_event_once(uuid,text,uuid,text,uuid,jsonb) TO service_role;

-- Notification dedup includes (user_id, type, application_id, offer_id).
CREATE OR REPLACE FUNCTION public._m2_notify_once(
  _user_id uuid, _type text, _title text, _body text,
  _application_id uuid, _offer_id uuid, _payload jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _final_payload jsonb;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  _final_payload := COALESCE(_payload,'{}'::jsonb)
    || CASE WHEN _application_id IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('application_id', _application_id) END
    || CASE WHEN _offer_id IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('offer_id', _offer_id) END;
  IF EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.user_id = _user_id AND n.type = _type
       AND (
         (_application_id IS NULL AND (n.payload ? 'application_id') = false)
         OR (n.payload->>'application_id' = _application_id::text)
       )
       AND (
         (_offer_id IS NULL AND (n.payload ? 'offer_id') = false)
         OR (n.payload->>'offer_id' = _offer_id::text)
       )
  ) THEN RETURN; END IF;
  PERFORM public.create_notification(_user_id, _type, _title, _body, _final_payload);
END;
$function$;
REVOKE ALL ON FUNCTION public._m2_notify_once(uuid,text,text,text,uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._m2_notify_once(uuid,text,text,text,uuid,uuid,jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._m2_notify_once(uuid,text,text,text,uuid,uuid,jsonb) TO service_role;

-- Canonical expiration path. Marks a currently-sent offer expired and
-- notifies driver + recruiter exactly once (dedup on application_id+offer_id).
CREATE OR REPLACE FUNCTION public._m2_expire_offer(_offer_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _o public.opportunity_offers%ROWTYPE;
  _rp_user uuid;
  _now timestamptz := now();
BEGIN
  SELECT * INTO _o FROM public.opportunity_offers WHERE id = _offer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF _o.status <> 'sent' THEN RETURN false; END IF;

  UPDATE public.opportunity_offers SET status='expired', expired_at=_now WHERE id=_o.id;

  PERFORM public._m2_insert_event_once(_o.application_id, 'system', NULL,
    'offer_expired', _o.id, '{}'::jsonb);

  PERFORM public._m2_notify_once(_o.driver_user_id, 'offer_expired',
    'Offer expired', 'An offer you received has expired.',
    _o.application_id, _o.id,
    jsonb_build_object('opportunity_id', _o.opportunity_id));

  SELECT rp.user_id INTO _rp_user FROM public.recruiter_profiles rp WHERE rp.id = _o.recruiter_id;
  PERFORM public._m2_notify_once(_rp_user, 'offer_expired',
    'Offer expired', 'An offer you sent has expired.',
    _o.application_id, _o.id,
    jsonb_build_object('opportunity_id', _o.opportunity_id));

  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public._m2_expire_offer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._m2_expire_offer(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._m2_expire_offer(uuid) TO service_role;

-- Wrap a status update to opportunity_applications with the workflow
-- bypass token for the trigger. Confines the token to this LOCAL setting.
CREATE OR REPLACE FUNCTION public._m2_set_application_status(_app_id uuid, _status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _t text;
BEGIN
  SELECT token::text INTO _t FROM public._m2_workflow_secret LIMIT 1;
  PERFORM set_config('app.workflow_bypass_token', _t, true);
  UPDATE public.opportunity_applications SET status = _status WHERE id = _app_id;
  PERFORM set_config('app.workflow_bypass_token', '', true);
END;
$function$;
REVOKE ALL ON FUNCTION public._m2_set_application_status(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._m2_set_application_status(uuid,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._m2_set_application_status(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public._m2_set_application_withdrawn(_app_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _t text;
BEGIN
  SELECT token::text INTO _t FROM public._m2_workflow_secret LIMIT 1;
  PERFORM set_config('app.driver_withdraw_token', _t, true);
  UPDATE public.opportunity_applications SET status = 'withdrawn' WHERE id = _app_id;
  PERFORM set_config('app.driver_withdraw_token', '', true);
END;
$function$;
REVOKE ALL ON FUNCTION public._m2_set_application_withdrawn(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._m2_set_application_withdrawn(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._m2_set_application_withdrawn(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- RPC 1: transition_opportunity_application
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.transition_opportunity_application(uuid, text, text);
CREATE OR REPLACE FUNCTION public.transition_opportunity_application(
  _application_id uuid, _target_status text, _note text DEFAULT NULL
) RETURNS TABLE(
  application_id uuid, application_status text, offer_id uuid, offer_status text, result_code text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE
  _app public.opportunity_applications%ROWTYPE;
  _rp  public.recruiter_profiles%ROWTYPE;
  _actor uuid := auth.uid();
  _sent public.opportunity_offers%ROWTYPE;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF _target_status IS NULL THEN RAISE EXCEPTION 'target status required' USING ERRCODE = '22023'; END IF;
  IF _note IS NOT NULL AND char_length(_note) > 1000 THEN
    RAISE EXCEPTION 'note too long' USING ERRCODE = '22023'; END IF;

  SELECT * INTO _app FROM public.opportunity_applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO _rp FROM public.recruiter_profiles WHERE id = _app.recruiter_id;
  IF NOT FOUND OR _rp.user_id <> _actor THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.current_user_can_manage_recruiter_opportunities(_app.recruiter_id) THEN
    RAISE EXCEPTION 'recruiter not eligible' USING ERRCODE = '42501';
  END IF;

  IF _app.application_type <> 'apply' THEN
    RAISE EXCEPTION 'transitions only allowed on formal applications' USING ERRCODE = '42501';
  END IF;

  IF _target_status IN ('offer_sent','onboarding','hired','withdrawn') THEN
    RAISE EXCEPTION 'transition_opportunity_application cannot set %', _target_status USING ERRCODE = '42501';
  END IF;

  IF _app.status = _target_status THEN
    application_id := _app.id; application_status := _app.status;
    result_code := 'application_transitioned'; RETURN NEXT; RETURN;
  END IF;

  IF _target_status = 'rejected' AND _app.status = 'offer_sent' THEN
    SELECT * INTO _sent FROM public.opportunity_offers
      WHERE application_id = _app.id AND status = 'sent' FOR UPDATE;
    IF FOUND THEN
      UPDATE public.opportunity_offers SET status='canceled', canceled_at=now() WHERE id=_sent.id;
      PERFORM public._m2_insert_event_once(_app.id, 'recruiter', _actor,
        'offer_canceled', _sent.id, jsonb_build_object('reason','rejected','note',_note));
      PERFORM public._m2_notify_once(_app.driver_user_id, 'offer_canceled',
        'Offer canceled', 'The offer was canceled.',
        _app.id, _sent.id,
        jsonb_build_object('opportunity_id', _app.opportunity_id));
    END IF;
  END IF;

  IF _target_status = 'rejected' AND _app.status = 'onboarding' THEN
    IF _note IS NULL OR btrim(_note) = '' THEN
      RAISE EXCEPTION 'reason required to reject during onboarding' USING ERRCODE = '22023';
    END IF;
    PERFORM public._m2_insert_event_once(_app.id, 'recruiter', _actor,
      'onboarding_closed', NULL, jsonb_build_object('reason', _note));
  END IF;

  UPDATE public.opportunity_applications SET status = _target_status WHERE id = _app.id;

  IF _note IS NOT NULL AND btrim(_note) <> '' THEN
    INSERT INTO public.application_events(application_id, actor_type, actor_user_id, event_type, metadata)
    VALUES (_app.id, 'recruiter', _actor, 'application_note',
            jsonb_build_object('note', _note, 'to', _target_status));
  END IF;

  application_id := _app.id; application_status := _target_status;
  result_code := 'application_transitioned'; RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.transition_opportunity_application(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_opportunity_application(uuid,text,text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- RPC 2: save_opportunity_offer_draft
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_opportunity_offer_draft(
  uuid, text, numeric, text, text, text, date, text, text, text
);
CREATE OR REPLACE FUNCTION public.save_opportunity_offer_draft(
  _application_id uuid,
  _pay_description text DEFAULT NULL,
  _estimated_weekly_amount numeric DEFAULT NULL,
  _route_summary text DEFAULT NULL,
  _equipment_summary text DEFAULT NULL,
  _home_time_terms text DEFAULT NULL,
  _proposed_start_date date DEFAULT NULL,
  _orientation_details text DEFAULT NULL,
  _contingencies text DEFAULT NULL,
  _recruiter_message text DEFAULT NULL
) RETURNS TABLE(application_id uuid, offer_id uuid, offer_status text, result_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE
  _actor uuid := auth.uid();
  _app public.opportunity_applications%ROWTYPE;
  _rp  public.recruiter_profiles%ROWTYPE;
  _existing public.opportunity_offers%ROWTYPE;
  _lock_key text;
  _new_id uuid;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;

  IF _pay_description IS NOT NULL AND char_length(_pay_description) > 2000 THEN
    RAISE EXCEPTION 'pay_description too long' USING ERRCODE = '22023'; END IF;
  IF _route_summary IS NOT NULL AND char_length(_route_summary) > 2000 THEN
    RAISE EXCEPTION 'route_summary too long' USING ERRCODE = '22023'; END IF;
  IF _equipment_summary IS NOT NULL AND char_length(_equipment_summary) > 2000 THEN
    RAISE EXCEPTION 'equipment_summary too long' USING ERRCODE = '22023'; END IF;
  IF _home_time_terms IS NOT NULL AND char_length(_home_time_terms) > 2000 THEN
    RAISE EXCEPTION 'home_time_terms too long' USING ERRCODE = '22023'; END IF;
  IF _orientation_details IS NOT NULL AND char_length(_orientation_details) > 2000 THEN
    RAISE EXCEPTION 'orientation_details too long' USING ERRCODE = '22023'; END IF;
  IF _contingencies IS NOT NULL AND char_length(_contingencies) > 2000 THEN
    RAISE EXCEPTION 'contingencies too long' USING ERRCODE = '22023'; END IF;
  IF _recruiter_message IS NOT NULL AND char_length(_recruiter_message) > 2000 THEN
    RAISE EXCEPTION 'recruiter_message too long' USING ERRCODE = '22023'; END IF;

  IF _estimated_weekly_amount IS NOT NULL AND _estimated_weekly_amount < 0 THEN
    RAISE EXCEPTION 'amount cannot be negative' USING ERRCODE = '22023';
  END IF;

  _pay_description     := NULLIF(btrim(COALESCE(_pay_description,'')), '');
  _route_summary       := NULLIF(btrim(COALESCE(_route_summary,'')), '');
  _equipment_summary   := NULLIF(btrim(COALESCE(_equipment_summary,'')), '');
  _home_time_terms     := NULLIF(btrim(COALESCE(_home_time_terms,'')), '');
  _orientation_details := NULLIF(btrim(COALESCE(_orientation_details,'')), '');
  _contingencies       := NULLIF(btrim(COALESCE(_contingencies,'')), '');
  _recruiter_message   := NULLIF(btrim(COALESCE(_recruiter_message,'')), '');

  _lock_key := 'phase1h_m2_draft:' || _application_id::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(_lock_key, 0));

  SELECT * INTO _app FROM public.opportunity_applications
    WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application not found' USING ERRCODE = 'P0002'; END IF;

  -- AUTHORIZATION FIRST — before any eligibility/state disclosure.
  SELECT * INTO _rp FROM public.recruiter_profiles WHERE id = _app.recruiter_id;
  IF NOT FOUND OR _rp.user_id <> _actor THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.current_user_can_manage_recruiter_opportunities(_app.recruiter_id) THEN
    RAISE EXCEPTION 'recruiter not eligible' USING ERRCODE = '42501';
  END IF;

  IF _app.application_type <> 'apply' THEN
    RAISE EXCEPTION 'offers require a formal application' USING ERRCODE = '42501';
  END IF;

  -- Positive-list draft eligibility.
  IF _app.status NOT IN ('interviewing','offer_sent') THEN
    RAISE EXCEPTION 'application not eligible for draft' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.opportunity_offers
              WHERE application_id = _app.id AND status='accepted') THEN
    RAISE EXCEPTION 'accepted offer blocks new draft' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _existing FROM public.opportunity_offers
    WHERE application_id = _app.id AND status='draft'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    UPDATE public.opportunity_offers SET
      pay_description=_pay_description,
      estimated_weekly_amount=_estimated_weekly_amount,
      route_summary=_route_summary,
      equipment_summary=_equipment_summary,
      home_time_terms=_home_time_terms,
      proposed_start_date=_proposed_start_date,
      orientation_details=_orientation_details,
      contingencies=_contingencies,
      recruiter_message=_recruiter_message
    WHERE id=_existing.id;
    application_id := _app.id; offer_id := _existing.id; offer_status := 'draft';
    result_code := 'draft_updated'; RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.opportunity_offers(
    application_id, opportunity_id, driver_user_id, recruiter_id, status,
    pay_description, estimated_weekly_amount, route_summary, equipment_summary,
    home_time_terms, proposed_start_date, orientation_details, contingencies,
    recruiter_message, created_by
  ) VALUES (
    _app.id, _app.opportunity_id, _app.driver_user_id, _app.recruiter_id, 'draft',
    _pay_description, _estimated_weekly_amount, _route_summary, _equipment_summary,
    _home_time_terms, _proposed_start_date, _orientation_details, _contingencies,
    _recruiter_message, _actor
  ) RETURNING id INTO _new_id;

  PERFORM public._m2_insert_event_once(_app.id, 'recruiter', _actor,
    'offer_draft_created', _new_id, '{}'::jsonb);

  application_id := _app.id; offer_id := _new_id; offer_status := 'draft';
  result_code := 'draft_created'; RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_opportunity_offer_draft(
  uuid, text, numeric, text, text, text, date, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_opportunity_offer_draft(
  uuid, text, numeric, text, text, text, date, text, text, text
) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- RPC 3: send_opportunity_offer
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.send_opportunity_offer(uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.send_opportunity_offer(
  _offer_id uuid, _expires_at timestamptz
) RETURNS TABLE(
  application_id uuid, application_status text,
  offer_id uuid, offer_status text, result_code text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE
  _actor uuid := auth.uid();
  _offer public.opportunity_offers%ROWTYPE;
  _app   public.opportunity_applications%ROWTYPE;
  _rp    public.recruiter_profiles%ROWTYPE;
  _now   timestamptz := now();
  _prior public.opportunity_offers%ROWTYPE;
  _snapshot jsonb;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF _expires_at IS NULL THEN RAISE EXCEPTION 'expires_at required' USING ERRCODE = '22023'; END IF;

  -- Ownership-scoped lookup: foreign existing and nonexistent both yield the
  -- same public-safe not-authorized denial (no offer-not-found disclosure).
  SELECT o.* INTO _offer
    FROM public.opportunity_offers o
    JOIN public.recruiter_profiles r ON r.id = o.recruiter_id
   WHERE o.id = _offer_id AND r.user_id = _actor
   FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.current_user_can_manage_recruiter_opportunities(_offer.recruiter_id) THEN
    RAISE EXCEPTION 'recruiter not eligible' USING ERRCODE = '42501';
  END IF;

  IF _offer.status = 'sent' THEN
    application_id := _offer.application_id; offer_id := _offer.id; offer_status := 'sent';
    SELECT status INTO application_status FROM public.opportunity_applications WHERE id = _offer.application_id;
    result_code := 'already_sent'; RETURN NEXT; RETURN;
  END IF;

  IF _offer.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft offers can be sent' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _app FROM public.opportunity_applications
    WHERE id = _offer.application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application not found' USING ERRCODE = 'P0002'; END IF;

  IF _app.application_type <> 'apply' THEN
    RAISE EXCEPTION 'offers require a formal application' USING ERRCODE = '42501';
  END IF;

  -- Positive-list send eligibility.
  IF _app.status NOT IN ('interviewing','offer_sent') THEN
    RAISE EXCEPTION 'application state does not permit send' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.opportunity_offers
              WHERE application_id=_app.id AND status='accepted') THEN
    RAISE EXCEPTION 'accepted offer blocks send' USING ERRCODE = '42501';
  END IF;

  IF _offer.pay_description IS NULL OR btrim(_offer.pay_description) = '' THEN
    RAISE EXCEPTION 'pay_description required to send' USING ERRCODE = '22023';
  END IF;
  IF _offer.estimated_weekly_amount IS NOT NULL AND _offer.estimated_weekly_amount < 0 THEN
    RAISE EXCEPTION 'amount cannot be negative' USING ERRCODE = '22023';
  END IF;
  IF _offer.proposed_start_date IS NOT NULL AND _offer.proposed_start_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'start date must not be in the past' USING ERRCODE = '22023';
  END IF;
  IF _expires_at < _now + interval '24 hours' THEN
    RAISE EXCEPTION 'expiration must be at least 24 hours from now' USING ERRCODE = '22023';
  END IF;
  IF _expires_at > _now + interval '30 days' THEN
    RAISE EXCEPTION 'expiration must be within 30 days' USING ERRCODE = '22023';
  END IF;

  -- Reconcile prior sent offers on the same application.
  FOR _prior IN
    SELECT * FROM public.opportunity_offers
     WHERE application_id=_app.id AND status='sent' FOR UPDATE
  LOOP
    IF _prior.expires_at IS NOT NULL AND _prior.expires_at <= _now THEN
      PERFORM public._m2_expire_offer(_prior.id);
    ELSE
      UPDATE public.opportunity_offers
         SET status='superseded', superseded_at=_now, superseded_by=_offer.id
       WHERE id=_prior.id;
      PERFORM public._m2_insert_event_once(_app.id, 'recruiter', _actor,
        'offer_superseded', _prior.id, jsonb_build_object('superseded_by', _offer.id));
    END IF;
  END LOOP;

  _snapshot := jsonb_build_object(
    'offer_id', _offer.id,
    'application_id', _app.id,
    'opportunity_id', _app.opportunity_id,
    'recruiter_id', _app.recruiter_id,
    'driver_user_id', _app.driver_user_id,
    'pay_description', _offer.pay_description,
    'estimated_weekly_amount', _offer.estimated_weekly_amount,
    'route_summary', _offer.route_summary,
    'equipment_summary', _offer.equipment_summary,
    'home_time_terms', _offer.home_time_terms,
    'proposed_start_date', _offer.proposed_start_date,
    'orientation_details', _offer.orientation_details,
    'contingencies', _offer.contingencies,
    'recruiter_message', _offer.recruiter_message,
    'sent_at', _now,
    'expires_at', _expires_at
  );

  UPDATE public.opportunity_offers
     SET status='sent', sent_at=_now, expires_at=_expires_at,
         sent_snapshot=_snapshot,
         snapshot_version = GREATEST(snapshot_version, 1)
   WHERE id=_offer.id;

  IF _app.status <> 'offer_sent' THEN
    PERFORM public._m2_set_application_status(_app.id, 'offer_sent');
  END IF;

  PERFORM public._m2_insert_event_once(_app.id, 'recruiter', _actor,
    'offer_sent', _offer.id, jsonb_build_object('expires_at', _expires_at));

  PERFORM public._m2_notify_once(_app.driver_user_id, 'offer_sent',
    'New offer', 'You have received an offer.',
    _app.id, _offer.id,
    jsonb_build_object('opportunity_id', _app.opportunity_id));

  application_id := _app.id; application_status := 'offer_sent';
  offer_id := _offer.id; offer_status := 'sent';
  result_code := 'offer_sent'; RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.send_opportunity_offer(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_opportunity_offer(uuid, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- RPC 4: accept_opportunity_offer  (driver)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.accept_opportunity_offer(uuid);
CREATE OR REPLACE FUNCTION public.accept_opportunity_offer(_offer_id uuid)
RETURNS TABLE(
  application_id uuid, application_status text,
  offer_id uuid, offer_status text, result_code text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE
  _actor uuid := auth.uid();
  _offer public.opportunity_offers%ROWTYPE;
  _app   public.opportunity_applications%ROWTYPE;
  _rp_user uuid;
  _now timestamptz := now();
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;

  SELECT * INTO _offer FROM public.opportunity_offers WHERE id=_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not found' USING ERRCODE = 'P0002'; END IF;

  -- AUTHORIZATION FIRST.
  IF _offer.driver_user_id <> _actor THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF _offer.status = 'accepted' THEN
    application_id := _offer.application_id; offer_id := _offer.id; offer_status := 'accepted';
    SELECT status INTO application_status FROM public.opportunity_applications WHERE id=_offer.application_id;
    result_code := 'already_accepted'; RETURN NEXT; RETURN;
  END IF;

  IF _offer.status='sent' AND _offer.expires_at IS NOT NULL AND _offer.expires_at <= _now THEN
    PERFORM public._m2_expire_offer(_offer.id);
    application_id := _offer.application_id; offer_id := _offer.id; offer_status := 'expired';
    SELECT status INTO application_status FROM public.opportunity_applications WHERE id=_offer.application_id;
    result_code := 'offer_expired'; RETURN NEXT; RETURN;
  END IF;

  IF _offer.status <> 'sent' THEN
    RAISE EXCEPTION 'offer is not available to accept' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _app FROM public.opportunity_applications
    WHERE id=_offer.application_id FOR UPDATE;
  IF _app.application_type <> 'apply' THEN
    RAISE EXCEPTION 'offers require a formal application' USING ERRCODE = '42501';
  END IF;
  IF _app.status <> 'offer_sent' THEN
    RAISE EXCEPTION 'application state does not permit acceptance' USING ERRCODE = '42501';
  END IF;

  UPDATE public.opportunity_offers
     SET status='accepted', responded_at=_now, accepted_at=_now
   WHERE id=_offer.id;

  PERFORM public._m2_set_application_status(_app.id, 'onboarding');

  PERFORM public._m2_insert_event_once(_app.id, 'driver', _actor,
    'offer_accepted', _offer.id, '{}'::jsonb);

  SELECT rp.user_id INTO _rp_user FROM public.recruiter_profiles rp WHERE rp.id=_app.recruiter_id;
  PERFORM public._m2_notify_once(_rp_user, 'offer_accepted',
    'Offer accepted', 'The driver accepted your offer.',
    _app.id, _offer.id,
    jsonb_build_object('opportunity_id', _app.opportunity_id));

  application_id := _app.id; application_status := 'onboarding';
  offer_id := _offer.id; offer_status := 'accepted';
  result_code := 'offer_accepted'; RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_opportunity_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_opportunity_offer(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- RPC 5: decline_opportunity_offer  (driver)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.decline_opportunity_offer(uuid, text);
CREATE OR REPLACE FUNCTION public.decline_opportunity_offer(
  _offer_id uuid, _reason text DEFAULT NULL
) RETURNS TABLE(application_id uuid, offer_id uuid, offer_status text, result_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE
  _actor uuid := auth.uid();
  _offer public.opportunity_offers%ROWTYPE;
  _rp_user uuid;
  _now timestamptz := now();
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF _reason IS NOT NULL AND char_length(_reason) > 1000 THEN
    RAISE EXCEPTION 'reason too long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _offer FROM public.opportunity_offers WHERE id=_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not found' USING ERRCODE = 'P0002'; END IF;

  -- AUTHORIZATION FIRST.
  IF _offer.driver_user_id <> _actor THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF _offer.status = 'declined' THEN
    application_id := _offer.application_id; offer_id := _offer.id; offer_status := 'declined';
    result_code := 'already_declined'; RETURN NEXT; RETURN;
  END IF;
  IF _offer.status = 'accepted' THEN
    RAISE EXCEPTION 'accepted offer cannot be declined' USING ERRCODE = '42501';
  END IF;

  IF _offer.status='sent' AND _offer.expires_at IS NOT NULL AND _offer.expires_at <= _now THEN
    PERFORM public._m2_expire_offer(_offer.id);
    application_id := _offer.application_id; offer_id := _offer.id; offer_status := 'expired';
    result_code := 'offer_expired'; RETURN NEXT; RETURN;
  END IF;

  IF _offer.status <> 'sent' THEN
    RAISE EXCEPTION 'offer is not available to decline' USING ERRCODE = '42501';
  END IF;

  UPDATE public.opportunity_offers SET status='declined', responded_at=_now, declined_at=_now
   WHERE id=_offer.id;
  PERFORM public._m2_insert_event_once(_offer.application_id, 'driver', _actor,
    'offer_declined', _offer.id, jsonb_build_object('reason', _reason));
  SELECT rp.user_id INTO _rp_user FROM public.recruiter_profiles rp WHERE rp.id=_offer.recruiter_id;
  PERFORM public._m2_notify_once(_rp_user, 'offer_declined',
    'Offer declined', 'The driver declined your offer.',
    _offer.application_id, _offer.id, '{}'::jsonb);

  application_id := _offer.application_id; offer_id := _offer.id; offer_status := 'declined';
  result_code := 'offer_declined'; RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.decline_opportunity_offer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_opportunity_offer(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- RPC 6: cancel_opportunity_offer  (recruiter)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_opportunity_offer(uuid, text);
CREATE OR REPLACE FUNCTION public.cancel_opportunity_offer(
  _offer_id uuid, _reason text DEFAULT NULL
) RETURNS TABLE(application_id uuid, offer_id uuid, offer_status text, result_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE
  _actor uuid := auth.uid();
  _offer public.opportunity_offers%ROWTYPE;
  _rp public.recruiter_profiles%ROWTYPE;
  _now timestamptz := now();
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF _reason IS NOT NULL AND char_length(_reason) > 1000 THEN
    RAISE EXCEPTION 'reason too long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _offer FROM public.opportunity_offers WHERE id=_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not found' USING ERRCODE = 'P0002'; END IF;

  -- AUTHORIZATION FIRST.
  SELECT * INTO _rp FROM public.recruiter_profiles WHERE id=_offer.recruiter_id;
  IF NOT FOUND OR _rp.user_id <> _actor THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.current_user_can_manage_recruiter_opportunities(_offer.recruiter_id) THEN
    RAISE EXCEPTION 'recruiter not eligible' USING ERRCODE = '42501';
  END IF;

  IF _offer.status = 'canceled' THEN
    application_id := _offer.application_id; offer_id := _offer.id; offer_status := 'canceled';
    result_code := 'already_canceled'; RETURN NEXT; RETURN;
  END IF;
  IF _offer.status = 'accepted' THEN
    RAISE EXCEPTION 'accepted offer cannot be canceled' USING ERRCODE = '42501';
  END IF;

  IF _offer.status='sent' AND _offer.expires_at IS NOT NULL AND _offer.expires_at <= _now THEN
    PERFORM public._m2_expire_offer(_offer.id);
    application_id := _offer.application_id; offer_id := _offer.id; offer_status := 'expired';
    result_code := 'offer_expired'; RETURN NEXT; RETURN;
  END IF;

  IF _offer.status <> 'sent' THEN
    RAISE EXCEPTION 'offer is not available to cancel' USING ERRCODE = '42501';
  END IF;

  UPDATE public.opportunity_offers SET status='canceled', canceled_at=_now WHERE id=_offer.id;
  PERFORM public._m2_insert_event_once(_offer.application_id, 'recruiter', _actor,
    'offer_canceled', _offer.id, jsonb_build_object('reason', _reason));
  PERFORM public._m2_notify_once(_offer.driver_user_id, 'offer_canceled',
    'Offer canceled', 'The recruiter canceled the offer.',
    _offer.application_id, _offer.id, '{}'::jsonb);

  application_id := _offer.application_id; offer_id := _offer.id; offer_status := 'canceled';
  result_code := 'offer_canceled'; RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_opportunity_offer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_opportunity_offer(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- RPC 7: expire_opportunity_offers  (service_role only)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.expire_opportunity_offers(integer);
CREATE OR REPLACE FUNCTION public.expire_opportunity_offers(_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE
  _count integer := 0;
  _rec RECORD;
  _now timestamptz := now();
BEGIN
  IF _limit IS NULL OR _limit <= 0 THEN _limit := 500; END IF;

  FOR _rec IN
    SELECT id
      FROM public.opportunity_offers
     WHERE status='sent' AND expires_at IS NOT NULL AND expires_at <= _now
     ORDER BY expires_at
     LIMIT _limit
     FOR UPDATE SKIP LOCKED
  LOOP
    IF public._m2_expire_offer(_rec.id) THEN
      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN _count;
END;
$function$;
REVOKE ALL ON FUNCTION public.expire_opportunity_offers(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_opportunity_offers(integer) TO service_role;

-- ---------------------------------------------------------------------
-- RPC 8: withdraw_opportunity_application  (driver)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_opportunity_application(application_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE
  _actor uuid := auth.uid();
  _row public.opportunity_applications%ROWTYPE;
  _sent public.opportunity_offers%ROWTYPE;
  _rp_user uuid;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;

  SELECT * INTO _row FROM public.opportunity_applications
    WHERE id = withdraw_opportunity_application.application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002'; END IF;

  -- AUTHORIZATION FIRST.
  IF _row.driver_user_id <> _actor THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  IF _row.application_type <> 'apply' THEN
    RAISE EXCEPTION 'Only formal applications may be withdrawn' USING ERRCODE = '42501';
  END IF;

  IF _row.status = 'withdrawn' THEN RETURN; END IF;
  IF _row.status IN ('hired','rejected') THEN
    RAISE EXCEPTION 'terminal application cannot be withdrawn' USING ERRCODE = '42501';
  END IF;
  IF _row.status = 'onboarding' THEN
    RAISE EXCEPTION 'onboarding cannot be withdrawn' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.opportunity_offers
              WHERE opportunity_offers.application_id=_row.id AND status='accepted') THEN
    RAISE EXCEPTION 'accepted offer blocks withdrawal' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _sent FROM public.opportunity_offers
    WHERE opportunity_offers.application_id=_row.id AND status='sent' FOR UPDATE;
  IF FOUND THEN
    UPDATE public.opportunity_offers SET status='canceled', canceled_at=now() WHERE id=_sent.id;
    PERFORM public._m2_insert_event_once(_row.id, 'driver', _actor,
      'offer_canceled', _sent.id, jsonb_build_object('reason','withdrawn'));
    SELECT rp.user_id INTO _rp_user FROM public.recruiter_profiles rp WHERE rp.id=_row.recruiter_id;
    PERFORM public._m2_notify_once(_rp_user, 'offer_canceled',
      'Offer canceled', 'The driver withdrew their application.',
      _row.id, _sent.id, '{}'::jsonb);
  END IF;

  PERFORM public._m2_set_application_withdrawn(_row.id);

  PERFORM public._m2_insert_event_once(_row.id, 'driver', _actor,
    'application_withdrawn', NULL, '{}'::jsonb);

  IF _rp_user IS NULL THEN
    SELECT rp.user_id INTO _rp_user FROM public.recruiter_profiles rp WHERE rp.id=_row.recruiter_id;
  END IF;
  PERFORM public._m2_notify_once(_rp_user, 'application_withdrawn',
    'Application withdrawn', 'A driver withdrew their application.',
    _row.id, NULL,
    jsonb_build_object('opportunity_id', _row.opportunity_id));
END;
$function$;
REVOKE ALL ON FUNCTION public.withdraw_opportunity_application(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_opportunity_application(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- RPC 9: complete_hiring  (recruiter)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_hiring(uuid);
CREATE OR REPLACE FUNCTION public.complete_hiring(_application_id uuid)
RETURNS TABLE(
  application_id uuid, application_status text,
  offer_id uuid, offer_status text, result_code text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE
  _actor uuid := auth.uid();
  _app public.opportunity_applications%ROWTYPE;
  _rp  public.recruiter_profiles%ROWTYPE;
  _accepted public.opportunity_offers%ROWTYPE;
  _c   public.contracts%ROWTYPE;
  _v   public.contract_versions%ROWTYPE;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;

  -- Ownership-scoped lookup: foreign existing and nonexistent both yield the
  -- same public-safe not-authorized denial (no application-not-found disclosure).
  SELECT a.* INTO _app
    FROM public.opportunity_applications a
    JOIN public.recruiter_profiles r ON r.id = a.recruiter_id
   WHERE a.id = _application_id AND r.user_id = _actor
   FOR UPDATE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.current_user_can_manage_recruiter_opportunities(_app.recruiter_id) THEN
    RAISE EXCEPTION 'recruiter not eligible' USING ERRCODE = '42501';
  END IF;

  IF _app.application_type <> 'apply' THEN
    RAISE EXCEPTION 'hiring requires a formal application' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _accepted FROM public.opportunity_offers
    WHERE opportunity_offers.application_id=_app.id AND status='accepted'
    LIMIT 1;

  IF _app.status = 'hired' THEN
    application_id := _app.id; application_status := 'hired';
    offer_id := _accepted.id; offer_status := _accepted.status;
    result_code := 'already_hired'; RETURN NEXT; RETURN;
  END IF;

  IF _app.status <> 'onboarding' THEN
    RAISE EXCEPTION 'application must be in onboarding to complete hire' USING ERRCODE = '42501';
  END IF;

  IF _accepted.id IS NULL THEN
    RAISE EXCEPTION 'accepted offer required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _c FROM public.contracts WHERE contracts.application_id=_app.id
    ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract required' USING ERRCODE = '42501', HINT = 'contract_required';
  END IF;
  IF _c.current_version_id IS NULL OR _c.status::text NOT IN ('approved','signed') THEN
    RAISE EXCEPTION 'contract required' USING ERRCODE = '42501', HINT = 'contract_required';
  END IF;
  SELECT * INTO _v FROM public.contract_versions
    WHERE id=_c.current_version_id AND contract_id=_c.id;
  IF NOT FOUND OR _v.upload_status <> 'uploaded' THEN
    RAISE EXCEPTION 'contract required' USING ERRCODE = '42501', HINT = 'contract_required';
  END IF;

  PERFORM public._m2_set_application_status(_app.id, 'hired');

  PERFORM public._m2_insert_event_once(_app.id, 'recruiter', _actor,
    'hiring_completed', NULL, '{}'::jsonb);

  PERFORM public._m2_notify_once(_app.driver_user_id, 'hiring_completed',
    'You are hired', 'The recruiter completed your hiring.',
    _app.id, _accepted.id,
    jsonb_build_object('opportunity_id', _app.opportunity_id));

  application_id := _app.id; application_status := 'hired';
  offer_id := _accepted.id; offer_status := _accepted.status;
  result_code := 'hiring_completed'; RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_hiring(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_hiring(uuid) TO authenticated, service_role;
