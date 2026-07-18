-- =====================================================================
-- Phase 1H-A1 — Driver Application, Recruiter Pipeline, Offer Foundation
-- REMEDIATION ONLY candidate. NOT applied to the live database in this run.
-- =====================================================================
-- Canonical product rule preserved for A1:
--   * Recruiters cannot move applications into onboarding directly.
--   * Driver offer acceptance is the future path into onboarding.
--   * Formal apply snapshots are server-authoritative; client PII is never
--     trusted for submission_snapshot or contact snapshot fields.
--   * request_info and apply are separate RPCs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. opportunity_applications — new immutable submission metadata
-- ---------------------------------------------------------------------
ALTER TABLE public.opportunity_applications
  ADD COLUMN IF NOT EXISTS submission_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_version    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idempotency_key     text,
  ADD COLUMN IF NOT EXISTS submitted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_at        timestamptz;

COMMENT ON COLUMN public.opportunity_applications.submission_snapshot IS
  'Phase 1H: immutable server-authoritative submission-time snapshot for formal apply submissions. Never populated from client-supplied PII.';
COMMENT ON COLUMN public.opportunity_applications.snapshot_version IS
  'Phase 1H: form/schema version for submission_snapshot. 0 = legacy/no formal snapshot; new apply rows must be >= 1.';
COMMENT ON COLUMN public.opportunity_applications.idempotency_key IS
  'Phase 1H: opaque client-supplied token for retry-safe RPC submission, scoped by driver/opportunity/type.';

-- ---------------------------------------------------------------------
-- 2. Status CHECK — preserve existing statuses and add only onboarding.
-- ---------------------------------------------------------------------
ALTER TABLE public.opportunity_applications
  DROP CONSTRAINT IF EXISTS opportunity_applications_status_chk;

ALTER TABLE public.opportunity_applications
  ADD CONSTRAINT opportunity_applications_status_chk
  CHECK (status = ANY (ARRAY[
    'new',
    'viewed',
    'contact_requested',
    'call_scheduled',
    'waiting_documents',
    'interviewing',
    'offer_sent',
    'onboarding',
    'hired',
    'rejected',
    'withdrawn'
  ]));

-- ---------------------------------------------------------------------
-- 3. Uniqueness reconciliation for apply/request_info coexistence.
-- ---------------------------------------------------------------------
ALTER TABLE public.opportunity_applications
  DROP CONSTRAINT IF EXISTS opportunity_applications_unique;

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_applications_active_apply_uidx
  ON public.opportunity_applications (opportunity_id, driver_user_id)
  WHERE application_type = 'apply'
    AND opportunity_applications.status NOT IN ('rejected', 'withdrawn');

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_applications_request_info_uidx
  ON public.opportunity_applications (opportunity_id, driver_user_id)
  WHERE application_type = 'request_info';

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_applications_idem_uidx
  ON public.opportunity_applications
    (driver_user_id, opportunity_id, application_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Offers table: RPC-only mutations, RLS reads, identity/expiry guards.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunity_offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES public.opportunity_applications(id) ON DELETE CASCADE,
  opportunity_id        uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  driver_user_id        uuid NOT NULL,
  recruiter_id          uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'draft',
  pay_description       text,
  estimated_weekly_amount numeric,
  route_summary         text,
  equipment_summary     text,
  home_time_terms       text,
  proposed_start_date   date,
  orientation_details   text,
  contingencies         text,
  recruiter_message     text,
  sent_snapshot         jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_version      integer NOT NULL DEFAULT 0,
  expires_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  sent_at               timestamptz,
  responded_at          timestamptz,
  accepted_at           timestamptz,
  declined_at           timestamptz,
  expired_at            timestamptz,
  canceled_at           timestamptz,
  superseded_at         timestamptz,
  superseded_by         uuid REFERENCES public.opportunity_offers(id) ON DELETE SET NULL,
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_offers_status_chk CHECK (status = ANY (ARRAY[
    'draft', 'sent', 'accepted', 'declined', 'expired', 'canceled', 'superseded'
  ])),
  CONSTRAINT opportunity_offers_sent_expiry_chk CHECK (
    status <> 'sent' OR expires_at IS NOT NULL
  )
);

GRANT SELECT ON public.opportunity_offers TO authenticated;
GRANT ALL ON public.opportunity_offers TO service_role;

ALTER TABLE public.opportunity_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruiter selects own offers"
  ON public.opportunity_offers FOR SELECT TO authenticated
  USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

CREATE POLICY "Driver selects own offers"
  ON public.opportunity_offers FOR SELECT TO authenticated
  USING (auth.uid() = driver_user_id);

CREATE POLICY "Admins view all offers"
  ON public.opportunity_offers FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_opportunity_offers_application
  ON public.opportunity_offers(application_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_offers_driver
  ON public.opportunity_offers(driver_user_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_offers_recruiter
  ON public.opportunity_offers(recruiter_id);

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_offers_one_sent_per_app_uidx
  ON public.opportunity_offers(application_id)
  WHERE status = 'sent';

CREATE OR REPLACE FUNCTION public.opportunity_offers_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.opportunity_applications%ROWTYPE;
BEGIN
  NEW.updated_at := now();

  SELECT * INTO v_app
    FROM public.opportunity_applications oa
   WHERE oa.id = NEW.application_id;

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

  IF NEW.status = 'sent' THEN
    IF NEW.sent_at IS NULL THEN
      NEW.sent_at := now();
    END IF;
    IF NEW.expires_at IS NULL OR NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'sent offers require a future expires_at' USING ERRCODE = '22023';
    END IF;
    IF NEW.snapshot_version < 1 OR NEW.sent_snapshot = '{}'::jsonb THEN
      RAISE EXCEPTION 'sent offers require snapshot_version >= 1 and sent_snapshot' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
       OR NEW.driver_user_id IS DISTINCT FROM OLD.driver_user_id
       OR NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id THEN
      RAISE EXCEPTION 'offer identity is immutable' USING ERRCODE = '42501';
    END IF;

    IF OLD.status IN ('sent','accepted','declined','expired','canceled','superseded') THEN
      IF NEW.pay_description            IS DISTINCT FROM OLD.pay_description
         OR NEW.estimated_weekly_amount IS DISTINCT FROM OLD.estimated_weekly_amount
         OR NEW.route_summary           IS DISTINCT FROM OLD.route_summary
         OR NEW.equipment_summary       IS DISTINCT FROM OLD.equipment_summary
         OR NEW.home_time_terms         IS DISTINCT FROM OLD.home_time_terms
         OR NEW.proposed_start_date     IS DISTINCT FROM OLD.proposed_start_date
         OR NEW.orientation_details     IS DISTINCT FROM OLD.orientation_details
         OR NEW.contingencies           IS DISTINCT FROM OLD.contingencies
         OR NEW.recruiter_message       IS DISTINCT FROM OLD.recruiter_message
         OR NEW.sent_snapshot           IS DISTINCT FROM OLD.sent_snapshot
         OR NEW.snapshot_version        IS DISTINCT FROM OLD.snapshot_version
         OR NEW.expires_at              IS DISTINCT FROM OLD.expires_at THEN
        RAISE EXCEPTION 'offer terms are immutable once sent' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opportunity_offers_guard ON public.opportunity_offers;
CREATE TRIGGER trg_opportunity_offers_guard
  BEFORE INSERT OR UPDATE ON public.opportunity_offers
  FOR EACH ROW EXECUTE FUNCTION public.opportunity_offers_guard();

-- ---------------------------------------------------------------------
-- 5. Restrictions table: no private-row/admin_note SELECT for users.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_user_restrictions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  scope          text NOT NULL,
  restriction    text NOT NULL,
  reason_code    text,
  admin_note     text,
  starts_at      timestamptz NOT NULL DEFAULT now(),
  ends_at        timestamptz,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_user_restrictions_scope_chk
    CHECK (scope IN ('driver_applications','recruiter_pipeline','all')),
  CONSTRAINT marketplace_user_restrictions_restriction_chk
    CHECK (restriction IN ('blocked','read_only','warned'))
);

GRANT SELECT ON public.marketplace_user_restrictions TO authenticated;
GRANT ALL ON public.marketplace_user_restrictions TO service_role;

ALTER TABLE public.marketplace_user_restrictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins see all restrictions"
  ON public.marketplace_user_restrictions FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_marketplace_user_restrictions_user
  ON public.marketplace_user_restrictions(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_user_restrictions_active
  ON public.marketplace_user_restrictions(user_id, scope)
  WHERE ends_at IS NULL;

CREATE OR REPLACE FUNCTION public.user_is_marketplace_blocked(_user_id uuid, _scope text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.marketplace_user_restrictions r
    WHERE r.user_id = _user_id
      AND r.restriction = 'blocked'
      AND (r.scope = _scope OR r.scope = 'all')
      AND r.starts_at <= now()
      AND (r.ends_at IS NULL OR r.ends_at > now())
  );
$$;

REVOKE ALL ON FUNCTION public.user_is_marketplace_blocked(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_marketplace_blocked(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_marketplace_restrictions()
RETURNS TABLE (
  id uuid,
  scope text,
  restriction text,
  reason_code text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.scope, r.restriction, r.reason_code, r.starts_at, r.ends_at, r.created_at
    FROM public.marketplace_user_restrictions r
   WHERE r.user_id = auth.uid()
     AND r.starts_at <= now()
     AND (r.ends_at IS NULL OR r.ends_at > now())
   ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_marketplace_restrictions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_marketplace_restrictions() TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Driver snapshot builder: server-authoritative profile + opportunity.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_application_submission_snapshot(
  _driver_user_id uuid,
  _opportunity_id uuid
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'snapshot_version', 1,
    'captured_at', now(),
    'driver_profile', jsonb_build_object(
      'full_name', dop.full_name,
      'city', dop.city,
      'state', dop.state,
      'cdl_class', dop.cdl_class,
      'years_experience', dop.years_experience,
      'endorsements', dop.endorsements,
      'trailer_experience', dop.trailer_experience,
      'preferred_driver_type', dop.preferred_driver_type,
      'preferred_route_type', dop.preferred_route_type,
      'preferred_home_time', dop.preferred_home_time,
      'preferred_states', dop.preferred_states,
      'min_weekly_gross', dop.min_weekly_gross,
      'min_weekly_net', dop.min_weekly_net,
      'min_effective_rpm', dop.min_effective_rpm,
      'available_start_date', dop.available_start_date,
      'willing_to_relocate', dop.willing_to_relocate,
      'visibility', dop.visibility,
      'contact_preference', dop.contact_preference,
      'profile_completed', dop.profile_completed
    ),
    'opportunity', jsonb_build_object(
      'id', o.id,
      'title', o.title,
      'company_name', o.company_name,
      'hiring_city', o.hiring_city,
      'hiring_state', o.hiring_state,
      'hiring_states', o.hiring_states,
      'driver_type', o.driver_type,
      'route_type', o.route_type,
      'trailer_type', o.trailer_type,
      'pay_model', o.pay_model,
      'cpm', o.cpm,
      'percentage_pay', o.percentage_pay,
      'flat_weekly_pay', o.flat_weekly_pay,
      'estimated_weekly_gross', o.estimated_weekly_gross,
      'estimated_weekly_miles', o.estimated_weekly_miles,
      'estimated_loaded_miles', o.estimated_loaded_miles,
      'estimated_deadhead_miles', o.estimated_deadhead_miles,
      'home_time', o.home_time
    )
  )
  FROM public.driver_opportunity_profiles dop
  JOIN public.opportunities o ON o.id = _opportunity_id
  WHERE dop.user_id = _driver_user_id
    AND dop.profile_completed = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.build_application_submission_snapshot(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_application_submission_snapshot(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Split RPCs: formal apply only, request_info only.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_opportunity_application(
  _opportunity_id     uuid,
  _idempotency_key    text,
  _message            text DEFAULT NULL
)
RETURNS TABLE (
  application_id     uuid,
  application_status text,
  result_code        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_recruiter_id  uuid;
  v_existing      public.opportunity_applications%ROWTYPE;
  v_new_id        uuid;
  v_snapshot      jsonb;
  v_profile_id    uuid;
  v_message       text := NULLIF(left(coalesce(_message, ''), 1000), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF public.user_is_marketplace_blocked(v_uid, 'driver_applications') THEN
    RAISE EXCEPTION 'driver is restricted from submitting applications' USING ERRCODE = '42501';
  END IF;

  SELECT o.recruiter_id INTO v_recruiter_id
    FROM public.opportunities o
   WHERE o.id = _opportunity_id;

  IF v_recruiter_id IS NULL THEN
    RAISE EXCEPTION 'opportunity not found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.driver_can_access_opportunity(_opportunity_id, v_recruiter_id) THEN
    RAISE EXCEPTION 'opportunity is not accepting applications' USING ERRCODE = '42501';
  END IF;

  SELECT dop.id INTO v_profile_id
    FROM public.driver_opportunity_profiles dop
   WHERE dop.user_id = v_uid
     AND dop.profile_completed = true
   LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'completed driver opportunity profile required' USING ERRCODE = '22023';
  END IF;

  v_snapshot := public.build_application_submission_snapshot(v_uid, _opportunity_id);
  IF v_snapshot IS NULL OR v_snapshot = '{}'::jsonb THEN
    RAISE EXCEPTION 'server application snapshot could not be built' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || '|' || _opportunity_id::text || '|apply', 0)
  );

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.opportunity_applications oa
     WHERE oa.driver_user_id = v_uid
       AND oa.opportunity_id = _opportunity_id
       AND oa.application_type = 'apply'
       AND oa.idempotency_key = _idempotency_key
     LIMIT 1;

    IF FOUND THEN
      RETURN QUERY SELECT v_existing.id, v_existing.status, 'idempotent_replay'::text;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_existing
    FROM public.opportunity_applications oa
   WHERE oa.driver_user_id = v_uid
     AND oa.opportunity_id = _opportunity_id
     AND oa.application_type = 'apply'
     AND oa.status NOT IN ('rejected','withdrawn')
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.status, 'duplicate_same_type'::text;
    RETURN;
  END IF;

  INSERT INTO public.opportunity_applications (
    opportunity_id, driver_user_id, recruiter_id,
    driver_profile_id, application_type, status,
    submission_snapshot, snapshot_version, idempotency_key,
    preferred_contact_method, driver_email_snapshot, driver_phone_snapshot,
    message, submitted_at
  ) VALUES (
    _opportunity_id, v_uid, v_recruiter_id,
    v_profile_id, 'apply', 'new',
    v_snapshot, 1, _idempotency_key,
    NULL, NULL, NULL,
    v_message, now()
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, 'new'::text, 'created'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_opportunity_application(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_opportunity_application(uuid, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.submit_opportunity_application(uuid, text, jsonb, integer, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.submit_request_info(
  _opportunity_id     uuid,
  _idempotency_key    text,
  _message            text DEFAULT NULL
)
RETURNS TABLE (
  application_id     uuid,
  application_status text,
  result_code        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_recruiter_id  uuid;
  v_existing      public.opportunity_applications%ROWTYPE;
  v_new_id        uuid;
  v_profile       public.driver_opportunity_profiles%ROWTYPE;
  v_message       text := NULLIF(left(coalesce(_message, ''), 1000), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF public.user_is_marketplace_blocked(v_uid, 'driver_applications') THEN
    RAISE EXCEPTION 'driver is restricted from submitting applications' USING ERRCODE = '42501';
  END IF;

  SELECT o.recruiter_id INTO v_recruiter_id
    FROM public.opportunities o
   WHERE o.id = _opportunity_id;

  IF v_recruiter_id IS NULL THEN
    RAISE EXCEPTION 'opportunity not found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.driver_can_access_opportunity(_opportunity_id, v_recruiter_id) THEN
    RAISE EXCEPTION 'opportunity is not accepting requests' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile
    FROM public.driver_opportunity_profiles dop
   WHERE dop.user_id = v_uid
   LIMIT 1;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || '|' || _opportunity_id::text || '|request_info', 0)
  );

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.opportunity_applications oa
     WHERE oa.driver_user_id = v_uid
       AND oa.opportunity_id = _opportunity_id
       AND oa.application_type = 'request_info'
       AND oa.idempotency_key = _idempotency_key
     LIMIT 1;

    IF FOUND THEN
      RETURN QUERY SELECT v_existing.id, v_existing.status, 'idempotent_replay'::text;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_existing
    FROM public.opportunity_applications oa
   WHERE oa.driver_user_id = v_uid
     AND oa.opportunity_id = _opportunity_id
     AND oa.application_type = 'request_info'
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.status, 'duplicate_same_type'::text;
    RETURN;
  END IF;

  INSERT INTO public.opportunity_applications (
    opportunity_id, driver_user_id, recruiter_id,
    driver_profile_id, application_type, status,
    submission_snapshot, snapshot_version, idempotency_key,
    preferred_contact_method, driver_email_snapshot, driver_phone_snapshot,
    message, submitted_at
  ) VALUES (
    _opportunity_id, v_uid, v_recruiter_id,
    v_profile.id, 'request_info', 'new',
    '{}'::jsonb, 0, _idempotency_key,
    COALESCE(v_profile.contact_preference, 'in_app'), NULL, NULL,
    v_message, now()
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, 'new'::text, 'created'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_request_info(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_request_info(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. Application guards: immutable snapshot + legal recruiter transitions.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.opportunity_applications_snapshot_freeze()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.submission_snapshot IS NOT NULL
       AND OLD.snapshot_version > 0
       AND NEW.submission_snapshot IS DISTINCT FROM OLD.submission_snapshot THEN
      RAISE EXCEPTION 'submission_snapshot is immutable' USING ERRCODE = '42501';
    END IF;
    IF OLD.snapshot_version > 0
       AND NEW.snapshot_version IS DISTINCT FROM OLD.snapshot_version THEN
      RAISE EXCEPTION 'snapshot_version is immutable once set' USING ERRCODE = '42501';
    END IF;
    IF OLD.submitted_at IS NOT NULL
       AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
      RAISE EXCEPTION 'submitted_at is immutable' USING ERRCODE = '42501';
    END IF;
    IF OLD.driver_user_id IS DISTINCT FROM NEW.driver_user_id
       OR OLD.opportunity_id IS DISTINCT FROM NEW.opportunity_id
       OR OLD.application_type IS DISTINCT FROM NEW.application_type
       OR OLD.recruiter_id IS DISTINCT FROM NEW.recruiter_id THEN
      RAISE EXCEPTION 'application identity is immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opportunity_applications_snapshot_freeze ON public.opportunity_applications;
DROP TRIGGER IF EXISTS aaa_opportunity_applications_snapshot_freeze_trigger ON public.opportunity_applications;
CREATE TRIGGER aaa_opportunity_applications_snapshot_freeze_trigger
  BEFORE UPDATE ON public.opportunity_applications
  FOR EACH ROW EXECUTE FUNCTION public.opportunity_applications_snapshot_freeze();

CREATE OR REPLACE FUNCTION public.opportunity_applications_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _allow_withdraw boolean;
  _allow_driver_accept_offer boolean;
  _allowed text[];
BEGIN
  _allow_withdraw := (current_setting('app.allow_driver_withdraw', true) = 'true');
  _allow_driver_accept_offer := (current_setting('app.allow_driver_accept_offer', true) = 'true');

  IF public.is_admin(auth.uid()) THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

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
     OR (
          NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at
          AND NOT (_allow_withdraw AND NEW.status = 'withdrawn')
        )
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Recruiters may only update application status.' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF _allow_withdraw AND NEW.status = 'withdrawn' THEN
      NEW.withdrawn_at := COALESCE(NEW.withdrawn_at, now());
      NEW.updated_at := now();
      RETURN NEW;
    END IF;

    IF _allow_driver_accept_offer AND OLD.status = 'offer_sent' AND NEW.status = 'onboarding' THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;

    IF OLD.status IN ('withdrawn','hired','rejected') THEN
      RAISE EXCEPTION 'Terminal application status cannot be changed.' USING ERRCODE = '42501';
    END IF;

    IF NEW.status IN ('withdrawn','onboarding','hired') THEN
      RAISE EXCEPTION 'Only server-authorized workflow can set %, not recruiter update.', NEW.status USING ERRCODE = '42501';
    END IF;

    _allowed := CASE OLD.status
      WHEN 'new'                THEN ARRAY['viewed','contact_requested','rejected']
      WHEN 'viewed'             THEN ARRAY['contact_requested','rejected']
      WHEN 'contact_requested'  THEN ARRAY['call_scheduled','rejected']
      WHEN 'contacted'          THEN ARRAY['call_scheduled','rejected']
      WHEN 'call_scheduled'     THEN ARRAY['waiting_documents','interviewing','rejected']
      WHEN 'waiting_documents'  THEN ARRAY['interviewing','rejected']
      WHEN 'interviewing'       THEN ARRAY['offer_sent','rejected']
      WHEN 'offer_sent'         THEN ARRAY['rejected']
      WHEN 'onboarding'         THEN ARRAY['rejected']
      ELSE ARRAY[]::text[]
    END;

    IF NOT (NEW.status = ANY (_allowed)) THEN
      RAISE EXCEPTION 'Illegal application status transition from % to %.', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_applications_update_guard_trigger
  ON public.opportunity_applications;

CREATE TRIGGER opportunity_applications_update_guard_trigger
  BEFORE UPDATE ON public.opportunity_applications
  FOR EACH ROW EXECUTE FUNCTION public.opportunity_applications_update_guard();

-- ---------------------------------------------------------------------
-- 9. RLS hardening: RPC-only application INSERT and canonical eligibility.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Driver inserts own application" ON public.opportunity_applications;

CREATE POLICY "Driver inserts own application"
  ON public.opportunity_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Recruiter updates application status" ON public.opportunity_applications;
CREATE POLICY "Recruiter updates application status"
  ON public.opportunity_applications
  FOR UPDATE
  TO authenticated
  USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id))
  WITH CHECK (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

REVOKE ALL ON FUNCTION public.opportunity_offers_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.opportunity_applications_snapshot_freeze() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.opportunity_applications_update_guard() FROM PUBLIC;