-- =====================================================================
-- Phase 1H-A1 — Driver Application, Recruiter Pipeline, Offer Foundation
-- =====================================================================
-- STATUS: candidate migration only. NOT applied to the live database in
-- this run. Reviewed and applied under a later Phase 1H-A4 gate.
--
-- Scope (A1 only):
--   1. Extend public.opportunity_applications with immutable
--      submission-snapshot, submission-time metadata, idempotency key,
--      submitted/withdrawn timestamps.
--   2. Reconcile status CHECK to add exactly one new non-terminal
--      status: 'onboarding' between 'offer_sent' and 'hired'. No other
--      status values are added, renamed, or removed.
--   3. Replace the (opportunity_id, driver_user_id) full-uniqueness
--      constraint with two partial unique indexes so a Driver may hold
--      one active 'apply' AND one active 'request_info' per opportunity
--      while duplicate same-type submissions are blocked.
--   4. Create public.opportunity_offers with RLS, grants, indexes,
--      partial-unique guard for a single actionable sent offer per
--      application, and an immutable-when-sent trigger.
--   5. Create public.marketplace_user_restrictions with RLS, grants,
--      and audit-safe timestamps.
--   6. Add public.submit_opportunity_application SECURITY DEFINER RPC:
--      driver-authored, idempotent by idempotency_key, blocks same-type
--      active duplicates while preserving history, refuses inserts when
--      the Driver is marketplace-restricted or opportunity is inactive.
--   7. Guard triggers preventing offer term mutation after 'sent', and
--      preventing driver->driver reassignment of applications/offers.
--
-- Prohibited scope untouched: recruiter billing, Stripe, checkout,
-- webhooks, pricing, driver pay tracking, agencies, assistants,
-- parking, dispatcher, account deletion, unrelated authentication.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. opportunity_applications — new columns
-- ---------------------------------------------------------------------
ALTER TABLE public.opportunity_applications
  ADD COLUMN IF NOT EXISTS submission_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_version    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idempotency_key     text,
  ADD COLUMN IF NOT EXISTS submitted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_at        timestamptz;

COMMENT ON COLUMN public.opportunity_applications.submission_snapshot IS
  'Phase 1H: immutable submission-time snapshot for formal (apply) submissions. JSONB, versioned via snapshot_version. Populated only by the submit_opportunity_application RPC.';
COMMENT ON COLUMN public.opportunity_applications.snapshot_version IS
  'Phase 1H: monotonically increasing form-schema version for submission_snapshot. 0 = legacy pre-1H row (no formal snapshot captured).';
COMMENT ON COLUMN public.opportunity_applications.idempotency_key IS
  'Phase 1H: opaque client-supplied token used by submit_opportunity_application to make retries safe. Scoped by (driver_user_id, opportunity_id, application_type).';

-- ---------------------------------------------------------------------
-- 2. Status CHECK — add 'onboarding' between 'offer_sent' and 'hired'.
--    All prior statuses preserved; historical rows never rewritten.
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
    'onboarding',       -- Phase 1H-A1: new non-terminal stage
    'hired',
    'rejected',
    'withdrawn'
  ]));

-- ---------------------------------------------------------------------
-- 3. Uniqueness reconciliation.
--    Drop the full (opportunity_id, driver_user_id) unique constraint
--    (which blocked apply+request_info coexistence) and replace with
--    two partial unique indexes keyed by application_type.
--    Historical rows are preserved: prior uniqueness ensured no
--    conflicting pair exists today, so partial indexes will build.
-- ---------------------------------------------------------------------
ALTER TABLE public.opportunity_applications
  DROP CONSTRAINT IF EXISTS opportunity_applications_unique;

-- Active formal application: one per (opportunity, driver). Terminal
-- statuses release the slot so a Driver could re-apply later if allowed
-- by a future phase; for Phase 1H-A1 this stays strict for active rows.
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_applications_active_apply_uidx
  ON public.opportunity_applications (opportunity_id, driver_user_id)
  WHERE application_type = 'apply'
    AND status NOT IN ('rejected', 'withdrawn');

-- Inquiries: exactly one 'request_info' row per (opportunity, driver).
-- Blocks accidental double-tap duplicates while preserving history via
-- the existing row + append-only application_events trail.
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_applications_request_info_uidx
  ON public.opportunity_applications (opportunity_id, driver_user_id)
  WHERE application_type = 'request_info';

-- Idempotency key uniqueness per driver/opportunity/type.
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_applications_idem_uidx
  ON public.opportunity_applications
    (driver_user_id, opportunity_id, application_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. opportunity_offers
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunity_offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES public.opportunity_applications(id) ON DELETE CASCADE,
  opportunity_id        uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  driver_user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_offers_status_chk CHECK (status = ANY (ARRAY[
    'draft', 'sent', 'accepted', 'declined', 'expired', 'canceled', 'superseded'
  ]))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_offers TO authenticated;
GRANT ALL ON public.opportunity_offers TO service_role;

ALTER TABLE public.opportunity_offers ENABLE ROW LEVEL SECURITY;

-- Owning recruiter (non-suspended) manages offers for their applications.
CREATE POLICY "Recruiter selects own offers"
  ON public.opportunity_offers FOR SELECT TO authenticated
  USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

CREATE POLICY "Recruiter inserts own offers"
  ON public.opportunity_offers FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_manage_recruiter_opportunities(recruiter_id)
    AND EXISTS (
      SELECT 1 FROM public.opportunity_applications oa
      WHERE oa.id = application_id
        AND oa.recruiter_id = opportunity_offers.recruiter_id
        AND oa.opportunity_id = opportunity_offers.opportunity_id
        AND oa.driver_user_id = opportunity_offers.driver_user_id
        AND oa.application_type = 'apply'
    )
  );

CREATE POLICY "Recruiter updates own draft offers"
  ON public.opportunity_offers FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id))
  WITH CHECK (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

-- Driver sees offers on their own applications.
CREATE POLICY "Driver selects own offers"
  ON public.opportunity_offers FOR SELECT TO authenticated
  USING (auth.uid() = driver_user_id);

-- Admin visibility.
CREATE POLICY "Admins view all offers"
  ON public.opportunity_offers FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_opportunity_offers_application
  ON public.opportunity_offers(application_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_offers_driver
  ON public.opportunity_offers(driver_user_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_offers_recruiter
  ON public.opportunity_offers(recruiter_id);

-- Only one actionable ('sent') offer per application at any time.
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_offers_one_sent_per_app_uidx
  ON public.opportunity_offers(application_id)
  WHERE status = 'sent';

-- Trigger: keep updated_at fresh and block mutating sent-offer terms.
CREATE OR REPLACE FUNCTION public.opportunity_offers_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  immutable_after_sent text[] := ARRAY[
    'application_id','opportunity_id','driver_user_id','recruiter_id',
    'pay_description','estimated_weekly_amount','route_summary',
    'equipment_summary','home_time_terms','proposed_start_date',
    'orientation_details','contingencies','recruiter_message',
    'sent_snapshot','snapshot_version','expires_at'
  ];
BEGIN
  NEW.updated_at := now();

  -- Identity is immutable across the row's lifetime.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.driver_user_id IS DISTINCT FROM OLD.driver_user_id
       OR NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id
       OR NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id THEN
      RAISE EXCEPTION 'offer identity is immutable';
    END IF;

    -- Once 'sent' (or any post-sent terminal), the terms cannot be
    -- edited in place. Status transitions and timestamp updates are
    -- allowed; term columns are frozen.
    IF OLD.status IN ('sent','accepted','declined','expired','canceled','superseded') THEN
      IF NEW.pay_description         IS DISTINCT FROM OLD.pay_description
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
        RAISE EXCEPTION 'offer terms are immutable once sent (columns: %)', array_to_string(immutable_after_sent, ',');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opportunity_offers_guard ON public.opportunity_offers;
CREATE TRIGGER trg_opportunity_offers_guard
  BEFORE UPDATE ON public.opportunity_offers
  FOR EACH ROW EXECUTE FUNCTION public.opportunity_offers_guard();

-- ---------------------------------------------------------------------
-- 5. marketplace_user_restrictions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_user_restrictions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope          text NOT NULL,   -- 'driver_applications' | 'recruiter_pipeline' | 'all'
  restriction    text NOT NULL,   -- 'blocked' | 'read_only' | 'warned'
  reason_code    text,
  admin_note     text,
  starts_at      timestamptz NOT NULL DEFAULT now(),
  ends_at        timestamptz,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_user_restrictions_scope_chk
    CHECK (scope IN ('driver_applications','recruiter_pipeline','all')),
  CONSTRAINT marketplace_user_restrictions_restriction_chk
    CHECK (restriction IN ('blocked','read_only','warned'))
);

GRANT SELECT ON public.marketplace_user_restrictions TO authenticated;
GRANT ALL ON public.marketplace_user_restrictions TO service_role;

ALTER TABLE public.marketplace_user_restrictions ENABLE ROW LEVEL SECURITY;

-- User can see their own active restrictions (transparency).
CREATE POLICY "User sees own restrictions"
  ON public.marketplace_user_restrictions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admin full read.
CREATE POLICY "Admins see all restrictions"
  ON public.marketplace_user_restrictions FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_marketplace_user_restrictions_user
  ON public.marketplace_user_restrictions(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_user_restrictions_active
  ON public.marketplace_user_restrictions(user_id, scope)
  WHERE ends_at IS NULL OR ends_at > now();

-- Server helper: is a user currently blocked from marketplace actions?
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

-- ---------------------------------------------------------------------
-- 6. submit_opportunity_application — idempotent formal-apply RPC
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_opportunity_application(
  _opportunity_id     uuid,
  _application_type   text,
  _snapshot           jsonb,
  _snapshot_version   integer,
  _idempotency_key    text,
  _preferred_contact_method text DEFAULT NULL,
  _driver_email       text DEFAULT NULL,
  _driver_phone       text DEFAULT NULL,
  _message            text DEFAULT NULL
)
RETURNS TABLE (
  application_id uuid,
  status         text,
  result_code    text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_recruiter_id uuid;
  v_opp_status   text;
  v_existing     public.opportunity_applications%ROWTYPE;
  v_new_id       uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF _application_type NOT IN ('apply','request_info') THEN
    RAISE EXCEPTION 'invalid application_type: %', _application_type USING ERRCODE = '22023';
  END IF;

  -- Marketplace restriction gate.
  IF public.user_is_marketplace_blocked(v_uid, 'driver_applications') THEN
    RAISE EXCEPTION 'driver is restricted from submitting applications' USING ERRCODE = '42501';
  END IF;

  -- Resolve opportunity + ownership + availability.
  SELECT o.recruiter_id, COALESCE(o.status, 'active')
    INTO v_recruiter_id, v_opp_status
    FROM public.opportunities o
   WHERE o.id = _opportunity_id;

  IF v_recruiter_id IS NULL THEN
    RAISE EXCEPTION 'opportunity not found' USING ERRCODE = '22023';
  END IF;

  IF v_opp_status IS DISTINCT FROM 'active' THEN
    -- Fall through only if the column doesn't exist / legacy row.
    IF v_opp_status NOT IN ('active','open') THEN
      RAISE EXCEPTION 'opportunity is not accepting applications (status=%)', v_opp_status USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Row lock scope for this driver/opportunity to serialize concurrent
  -- submissions from double-click / retry.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || '|' || _opportunity_id::text || '|' || _application_type, 0)
  );

  -- Idempotency: identical key already fulfilled -> return same row.
  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.opportunity_applications
     WHERE driver_user_id = v_uid
       AND opportunity_id = _opportunity_id
       AND application_type = _application_type
       AND idempotency_key = _idempotency_key
     LIMIT 1;

    IF FOUND THEN
      RETURN QUERY SELECT v_existing.id, v_existing.status, 'idempotent_replay'::text;
      RETURN;
    END IF;
  END IF;

  -- Same-type active duplicate guard.
  SELECT * INTO v_existing
    FROM public.opportunity_applications
   WHERE driver_user_id = v_uid
     AND opportunity_id = _opportunity_id
     AND application_type = _application_type
     AND (_application_type = 'request_info'
          OR status NOT IN ('rejected','withdrawn'))
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.status, 'duplicate_same_type'::text;
    RETURN;
  END IF;

  INSERT INTO public.opportunity_applications (
    opportunity_id, driver_user_id, recruiter_id,
    application_type, status,
    submission_snapshot, snapshot_version, idempotency_key,
    preferred_contact_method, driver_email_snapshot, driver_phone_snapshot,
    message, submitted_at
  )
  VALUES (
    _opportunity_id, v_uid, v_recruiter_id,
    _application_type, 'new',
    COALESCE(_snapshot, '{}'::jsonb),
    GREATEST(COALESCE(_snapshot_version, 0), 0),
    _idempotency_key,
    _preferred_contact_method, _driver_email, _driver_phone,
    _message, now()
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, 'new'::text, 'created'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_opportunity_application(
  uuid, text, jsonb, integer, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_opportunity_application(
  uuid, text, jsonb, integer, text, text, text, text, text
) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. Snapshot / submitted_at freeze guard on opportunity_applications.
--    Once a submission_snapshot / submitted_at is written, it cannot be
--    mutated by ordinary UPDATE paths. Recruiter status transitions and
--    other operational updates remain allowed.
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
      RAISE EXCEPTION 'submission_snapshot is immutable';
    END IF;
    IF OLD.snapshot_version > 0
       AND NEW.snapshot_version IS DISTINCT FROM OLD.snapshot_version THEN
      RAISE EXCEPTION 'snapshot_version is immutable once set';
    END IF;
    IF OLD.submitted_at IS NOT NULL
       AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
      RAISE EXCEPTION 'submitted_at is immutable';
    END IF;
    IF OLD.driver_user_id IS DISTINCT FROM NEW.driver_user_id
       OR OLD.opportunity_id IS DISTINCT FROM NEW.opportunity_id
       OR OLD.application_type IS DISTINCT FROM NEW.application_type THEN
      RAISE EXCEPTION 'application identity is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opportunity_applications_snapshot_freeze ON public.opportunity_applications;
CREATE TRIGGER trg_opportunity_applications_snapshot_freeze
  BEFORE UPDATE ON public.opportunity_applications
  FOR EACH ROW EXECUTE FUNCTION public.opportunity_applications_snapshot_freeze();
