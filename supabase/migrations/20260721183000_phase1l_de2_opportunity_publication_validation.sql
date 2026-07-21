-- Phase 1L-DE2A — Server-side publication validation for canonical opportunities.
--
-- Adds a BEFORE INSERT OR UPDATE row trigger that runs alongside — and
-- alphabetically before — the existing Phase 1K
-- `trg_opportunities_guard`/`public.opportunities_guard()` binding on
-- `public.opportunities`. This candidate:
--
--   * NEVER edits, replaces, or drops `public.opportunities_guard()` or
--     `trg_opportunities_guard`.
--   * NEVER mutates NEW.
--   * Only validates rows whose resulting `status` is `active`.
--   * Preserves the Phase 1K administrative exceptions verbatim:
--       - admin acting on ANOTHER recruiter's row -> no validation
--       - UPDATE by admin owner with explicit change to any of
--         admin_review_status/featured/view_count/published_at -> no validation
--       - all other writes -> validated
--   * On blocking reasons, raises SQLSTATE 23514 with the exact user-facing
--     message, hint, and DETAIL JSON shape mandated by the Phase 1L contract.
--
-- Idempotent: reapplying the file leaves exactly one row trigger with the
-- new name and byte-identical function bodies.
--
-- Migration-time legacy snapshot: on the first successful application of
-- this migration, a private snapshot table captures exactly the opportunity
-- IDs that are active and non-canonical at that instant. Only those captured
-- row identities may remain editable while still active and legacy.
-- Reapplication never expands the snapshot, ID transfer never inherits the
-- exemption, and INSERTs are never grandfathered.
--
-- Direct EXECUTE on all four new functions is revoked from PUBLIC, anon,
-- and authenticated so only the trigger dispatcher (SECURITY DEFINER) may
-- invoke the SECURITY DEFINER guard, and only internal SQL may consult
-- the helper functions.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Migration-time immutable legacy snapshot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunity_publication_legacy_snapshot (
  snapshot_key text PRIMARY KEY
    CHECK (snapshot_key = 'phase1l_de2_initial_active_legacy'),
  opportunity_ids uuid[] NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

ALTER TABLE public.opportunity_publication_legacy_snapshot ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.opportunity_publication_legacy_snapshot
  FROM PUBLIC, anon, authenticated;

INSERT INTO public.opportunity_publication_legacy_snapshot (
  snapshot_key,
  opportunity_ids
)
SELECT
  'phase1l_de2_initial_active_legacy',
  COALESCE(array_agg(o.id ORDER BY o.id), ARRAY[]::uuid[])
FROM public.opportunities o
WHERE o.status = 'active'
  AND o.canonical_version IS DISTINCT FROM 1
ON CONFLICT (snapshot_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. Finite-numeric helper.  Rejects NULL and non-finite `numeric` values
--    (NaN / +Inf / -Inf).  IMMUTABLE + SQL so it can be freely folded into
--    STABLE and pure PL/pgSQL callers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._opportunity_numeric_is_finite(v numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT v IS NOT NULL
     AND NOT (v = 'NaN'::numeric)
     AND NOT (v = 'Infinity'::numeric)
     AND NOT (v = '-Infinity'::numeric);
$$;

-- ---------------------------------------------------------------------------
-- 2. JSONB → numeric extraction that never leaks a cast error.  Returns
--    NULL for JSON `null`, missing keys, non-number types, unparseable
--    literals, and non-finite numbers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._opportunity_jsonb_number(j jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n numeric;
BEGIN
  IF j IS NULL OR jsonb_typeof(j) <> 'number' THEN
    RETURN NULL;
  END IF;
  BEGIN
    n := (j #>> '{}')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF NOT public._opportunity_numeric_is_finite(n) THEN
    RETURN NULL;
  END IF;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Pure row-validator.  Consumes a full `public.opportunities` row and
--    returns the alphabetically-sorted, deduplicated set of blocking
--    reasons that prevent publication.  Empty array -> row is publishable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.opportunity_publication_blockers(o public.opportunities)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  _b               text[] := ARRAY[]::text[];
  _has_city_state  boolean;
  _has_state_list  boolean;
  _mixed           jsonb;
  _elem            jsonb;
  _idx             int;
  _label           text;
  _label_present   boolean;
  _amt_json        jsonb;
  _amt_present     boolean;
  _amt             numeric;
  _amt_ok          boolean;
  _freq            text;
  _freq_valid      boolean;
  _complete_count  int;
  _cost_bearing    boolean;
  _lease_relevant  boolean;
  _derived_gross   numeric;
  _diff_ratio      numeric;
BEGIN
  ------------------------------------------------------------------
  -- Universal foundation
  ------------------------------------------------------------------
  IF o.canonical_version IS DISTINCT FROM 1 THEN
    _b := array_append(_b, 'Canonical opportunity version 1 is required before publication.');
  END IF;
  IF COALESCE(btrim(o.title), '') = '' THEN
    _b := array_append(_b, 'Opportunity title is required.');
  END IF;
  IF COALESCE(btrim(o.company_name), '') = '' THEN
    _b := array_append(_b, 'Company name is required.');
  END IF;

  IF o.employment_model IS NULL
     OR o.employment_model NOT IN ('company_driver','contractor_1099','owner_operator','lease_purchase') THEN
    _b := array_append(_b, 'Select an employment arrangement.');
  END IF;

  IF o.team_configuration IS NULL
     OR o.team_configuration NOT IN ('solo','team','solo_or_team') THEN
    _b := array_append(_b, 'Select a driving configuration (Solo, Team, or Solo or Team).');
  END IF;

  IF o.route_type IS NULL
     OR o.route_type NOT IN ('Local','Regional','OTR','Dedicated','Semi-Dedicated') THEN
    _b := array_append(_b, 'Select a route type.');
  END IF;

  IF o.trailer_type IS NULL
     OR o.trailer_type NOT IN ('Dry Van','Reefer','Flatbed','Tanker','Car Hauler','Intermodal','Other') THEN
    _b := array_append(_b, 'Select a trailer type.');
  END IF;

  _has_city_state := COALESCE(btrim(o.hiring_city), '') <> '' AND COALESCE(btrim(o.hiring_state), '') <> '';
  _has_state_list := o.hiring_states IS NOT NULL
                     AND EXISTS (
                       SELECT 1 FROM unnest(o.hiring_states) s WHERE COALESCE(btrim(s), '') <> ''
                     );
  IF NOT _has_city_state AND NOT _has_state_list THEN
    _b := array_append(_b, 'Provide a hiring city and state, or at least one hiring state.');
  END IF;

  IF COALESCE(btrim(o.description), '') = '' THEN
    _b := array_append(_b, 'Description is required.');
  END IF;
  IF COALESCE(btrim(o.home_time), '') = '' THEN
    _b := array_append(_b, 'Home time is required.');
  END IF;

  IF o.pay_model IS NULL
     OR o.pay_model NOT IN ('cpm','percentage','flat_weekly','salary','mixed','other') THEN
    _b := array_append(_b, 'Select a pay model.');
  END IF;

  IF o.transparency_confirmed IS NOT TRUE THEN
    _b := array_append(_b, 'Confirm the opportunity is accurate before publishing.');
  END IF;

  ------------------------------------------------------------------
  -- Universal numeric validity — every non-null stored numeric
  -- opportunity field must be finite AND nonnegative.  A single
  -- diagnostic is emitted regardless of how many fields fail.
  ------------------------------------------------------------------
  IF (o.cpm                             IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.cpm)                             OR o.cpm                             < 0))
  OR (o.percentage_pay                  IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.percentage_pay)                  OR o.percentage_pay                  < 0))
  OR (o.percentage_weekly_revenue_basis IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.percentage_weekly_revenue_basis) OR o.percentage_weekly_revenue_basis < 0))
  OR (o.flat_weekly_pay                 IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.flat_weekly_pay)                 OR o.flat_weekly_pay                 < 0))
  OR (o.salary_amount                   IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.salary_amount)                   OR o.salary_amount                   < 0))
  OR (o.other_weekly_gross              IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.other_weekly_gross)              OR o.other_weekly_gross              < 0))
  OR (o.estimated_weekly_gross          IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.estimated_weekly_gross)          OR o.estimated_weekly_gross          < 0))
  OR (o.estimated_weekly_miles          IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.estimated_weekly_miles)          OR o.estimated_weekly_miles          < 0))
  OR (o.estimated_loaded_miles          IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.estimated_loaded_miles)          OR o.estimated_loaded_miles          < 0))
  OR (o.estimated_deadhead_miles        IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.estimated_deadhead_miles)        OR o.estimated_deadhead_miles        < 0))
  OR (o.sign_on_bonus                   IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.sign_on_bonus)                   OR o.sign_on_bonus                   < 0))
  OR (o.insurance_deductions            IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.insurance_deductions)            OR o.insurance_deductions            < 0))
  OR (o.maintenance_deductions          IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.maintenance_deductions)          OR o.maintenance_deductions          < 0))
  OR (o.other_deductions                IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.other_deductions)                OR o.other_deductions                < 0))
  OR (o.lease_payment                   IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.lease_payment)                   OR o.lease_payment                   < 0))
  OR (o.escrow_amount                   IS NOT NULL AND (NOT public._opportunity_numeric_is_finite(o.escrow_amount)                   OR o.escrow_amount                   < 0))
  THEN
    _b := array_append(_b, 'Fix invalid numeric values (must be zero or greater).');
  END IF;

  ------------------------------------------------------------------
  -- Pay-model specific rules (exact client messages).
  ------------------------------------------------------------------
  IF o.pay_model = 'cpm' THEN
    IF o.cpm IS NULL
       OR NOT public._opportunity_numeric_is_finite(o.cpm)
       OR o.cpm <= 0 THEN
      _b := array_append(_b, 'CPM must be greater than zero.');
    END IF;
    IF o.estimated_weekly_miles IS NULL
       OR NOT public._opportunity_numeric_is_finite(o.estimated_weekly_miles)
       OR o.estimated_weekly_miles <= 0 THEN
      _b := array_append(_b, 'Total weekly miles must be greater than zero for CPM pay.');
    END IF;
    IF o.estimated_loaded_miles IS NOT NULL
       AND public._opportunity_numeric_is_finite(o.estimated_loaded_miles)
       AND o.estimated_loaded_miles = 0 THEN
      _b := array_append(_b, 'Loaded miles cannot be zero when provided.');
    END IF;
    IF o.deadhead_paid IS NULL THEN
      _b := array_append(_b, 'Specify whether deadhead miles are paid (yes or no).');
    END IF;

  ELSIF o.pay_model = 'percentage' THEN
    IF o.percentage_pay IS NULL
       OR NOT public._opportunity_numeric_is_finite(o.percentage_pay)
       OR o.percentage_pay <= 0 THEN
      _b := array_append(_b, 'Percentage rate must be greater than zero.');
    END IF;
    IF COALESCE(btrim(o.percentage_basis_label), '') = '' THEN
      _b := array_append(_b, 'Percentage basis label is required.');
    END IF;
    IF o.percentage_weekly_revenue_basis IS NULL
       OR NOT public._opportunity_numeric_is_finite(o.percentage_weekly_revenue_basis)
       OR o.percentage_weekly_revenue_basis <= 0 THEN
      _b := array_append(_b, 'Percentage weekly revenue basis must be greater than zero.');
    END IF;

  ELSIF o.pay_model = 'flat_weekly' THEN
    IF o.flat_weekly_pay IS NULL
       OR NOT public._opportunity_numeric_is_finite(o.flat_weekly_pay)
       OR o.flat_weekly_pay <= 0 THEN
      _b := array_append(_b, 'Flat weekly pay must be greater than zero.');
    END IF;

  ELSIF o.pay_model = 'salary' THEN
    IF o.salary_amount IS NULL
       OR NOT public._opportunity_numeric_is_finite(o.salary_amount)
       OR o.salary_amount <= 0 THEN
      _b := array_append(_b, 'Salary amount must be greater than zero.');
    END IF;
    IF o.salary_frequency IS NULL
       OR o.salary_frequency NOT IN ('weekly','biweekly','monthly','annual') THEN
      _b := array_append(_b, 'Salary pay period is required.');
    END IF;

  ELSIF o.pay_model = 'mixed' THEN
    _mixed := o.mixed_pay_components;
    _complete_count := 0;
    IF _mixed IS NULL OR jsonb_typeof(_mixed) <> 'array' THEN
      _b := array_append(_b, 'Mixed pay requires at least two complete components (label, amount, frequency).');
    ELSE
      _idx := 0;
      FOR _elem IN SELECT value FROM jsonb_array_elements(_mixed)
      LOOP
        _idx := _idx + 1;

        -- Malformed non-object element (scalar, array, JSON null): cannot
        -- be a valid mixed component. Emit the label blocker and skip.
        IF jsonb_typeof(_elem) IS DISTINCT FROM 'object' THEN
          _b := array_append(_b, format('Mixed component %s needs a label.', _idx));
          CONTINUE;
        END IF;

        _label := CASE WHEN jsonb_typeof(_elem->'label') = 'string' THEN _elem->>'label' ELSE NULL END;
        _label_present := COALESCE(btrim(_label), '') <> '';

        _amt_json := _elem->'amount';
        _amt_present := _amt_json IS NOT NULL AND jsonb_typeof(_amt_json) <> 'null';
        _amt := public._opportunity_jsonb_number(_amt_json);
        _amt_ok := _amt IS NOT NULL AND _amt >= 0;

        _freq := CASE WHEN jsonb_typeof(_elem->'frequency') = 'string' THEN _elem->>'frequency' ELSE NULL END;
        _freq_valid := _freq IS NOT NULL AND _freq IN ('weekly','biweekly','monthly','annual');

        -- Completely blank component: no label, no amount, no frequency -> ignore.
        IF NOT _label_present AND NOT _amt_present AND _freq IS NULL THEN
          CONTINUE;
        END IF;

        IF NOT _label_present THEN
          _b := array_append(_b, format('Mixed component %s needs a label.', _idx));
        END IF;
        IF _amt_present AND NOT _amt_ok THEN
          _b := array_append(_b, format('Mixed component %s amount must be zero or greater.', _idx));
        END IF;
        IF _amt_present AND NOT _freq_valid THEN
          _b := array_append(_b, format('Mixed component %s frequency is required.', _idx));
        END IF;

        IF _label_present AND _amt_ok AND _freq_valid THEN
          _complete_count := _complete_count + 1;
        END IF;
      END LOOP;
      IF _complete_count < 2 THEN
        _b := array_append(_b, 'Mixed pay requires at least two complete components (label, amount, frequency).');
      END IF;
    END IF;

  ELSIF o.pay_model = 'other' THEN
    IF COALESCE(btrim(o.other_pay_method_label), '') = '' THEN
      _b := array_append(_b, 'Pay method label is required for “Other”.');
    END IF;
    IF o.other_weekly_gross IS NULL
       OR NOT public._opportunity_numeric_is_finite(o.other_weekly_gross)
       OR o.other_weekly_gross <= 0 THEN
      _b := array_append(_b, 'Supported weekly gross must be greater than zero for “Other”.');
    END IF;
  END IF;

  ------------------------------------------------------------------
  -- Cost-bearing pair rules (mirror client validateCostPair).
  --   * NULL amount + NULL freq   -> not disclosed (no blocker)
  --   * NULL amount + freq set    -> "<label> amount is required when a frequency is set."
  --   * amount < 0 or non-finite  -> "<label> amount must be zero or a positive number."
  --   * amount set + NULL freq    -> "<label> frequency is required when an amount is set."
  --   * amount == 0 + valid freq  -> allowed
  ------------------------------------------------------------------
  _cost_bearing := o.employment_model IN ('contractor_1099','owner_operator','lease_purchase');
  _lease_relevant := o.employment_model = 'lease_purchase';

  IF _cost_bearing THEN
    -- Insurance
    IF NOT (o.insurance_deductions IS NULL AND o.insurance_deduction_frequency IS NULL) THEN
      IF o.insurance_deductions IS NULL THEN
        _b := array_append(_b, 'Insurance amount is required when a frequency is set.');
      ELSIF NOT public._opportunity_numeric_is_finite(o.insurance_deductions)
            OR o.insurance_deductions < 0 THEN
        _b := array_append(_b, 'Insurance amount must be zero or a positive number.');
      ELSIF o.insurance_deduction_frequency IS NULL
         OR o.insurance_deduction_frequency NOT IN ('weekly','biweekly','monthly','annual') THEN
        _b := array_append(_b, 'Insurance frequency is required when an amount is set.');
      END IF;
    END IF;
    -- Maintenance
    IF NOT (o.maintenance_deductions IS NULL AND o.maintenance_deduction_frequency IS NULL) THEN
      IF o.maintenance_deductions IS NULL THEN
        _b := array_append(_b, 'Maintenance amount is required when a frequency is set.');
      ELSIF NOT public._opportunity_numeric_is_finite(o.maintenance_deductions)
            OR o.maintenance_deductions < 0 THEN
        _b := array_append(_b, 'Maintenance amount must be zero or a positive number.');
      ELSIF o.maintenance_deduction_frequency IS NULL
         OR o.maintenance_deduction_frequency NOT IN ('weekly','biweekly','monthly','annual') THEN
        _b := array_append(_b, 'Maintenance frequency is required when an amount is set.');
      END IF;
    END IF;
    -- Other recurring cost
    IF NOT (o.other_deductions IS NULL AND o.other_deduction_frequency IS NULL) THEN
      IF o.other_deductions IS NULL THEN
        _b := array_append(_b, 'Other recurring cost amount is required when a frequency is set.');
      ELSIF NOT public._opportunity_numeric_is_finite(o.other_deductions)
            OR o.other_deductions < 0 THEN
        _b := array_append(_b, 'Other recurring cost amount must be zero or a positive number.');
      ELSIF o.other_deduction_frequency IS NULL
         OR o.other_deduction_frequency NOT IN ('weekly','biweekly','monthly','annual') THEN
        _b := array_append(_b, 'Other recurring cost frequency is required when an amount is set.');
      END IF;
    END IF;
    -- Lease payment (only for lease_purchase)
    IF _lease_relevant AND NOT (o.lease_payment IS NULL AND o.lease_payment_frequency IS NULL) THEN
      IF o.lease_payment IS NULL THEN
        _b := array_append(_b, 'Lease payment amount is required when a frequency is set.');
      ELSIF NOT public._opportunity_numeric_is_finite(o.lease_payment)
            OR o.lease_payment < 0 THEN
        _b := array_append(_b, 'Lease payment amount must be zero or a positive number.');
      ELSIF o.lease_payment_frequency IS NULL
         OR o.lease_payment_frequency NOT IN ('weekly','biweekly','monthly','annual') THEN
        _b := array_append(_b, 'Lease payment frequency is required when an amount is set.');
      END IF;
    END IF;

    ------------------------------------------------------------------
    -- Escrow rules.
    ------------------------------------------------------------------
    IF o.escrow_required_state = 'required' THEN
      IF o.escrow_amount IS NULL
         OR NOT public._opportunity_numeric_is_finite(o.escrow_amount)
         OR o.escrow_amount < 0 THEN
        _b := array_append(_b, 'Escrow amount is required when escrow is required.');
      END IF;
      IF o.escrow_amount_frequency IS NULL
         OR o.escrow_amount_frequency NOT IN ('weekly','biweekly','monthly','annual') THEN
        _b := array_append(_b, 'Escrow frequency is required when escrow is required.');
      END IF;
    ELSIF o.escrow_required_state = 'not_required' THEN
      IF o.escrow_amount IS NOT NULL
         AND public._opportunity_numeric_is_finite(o.escrow_amount)
         AND o.escrow_amount > 0 THEN
        _b := array_append(_b, 'Escrow is marked not required but a positive escrow amount was provided. Clear the stale escrow amount before publishing.');
      END IF;
    END IF;
    -- NULL / 'not_disclosed' -> allowed (no blocker).
  END IF;

  ------------------------------------------------------------------
  -- Recruiter-provided vs derived weekly gross conflict (> 10%).
  -- Sign-on bonus is excluded from the derivation.
  ------------------------------------------------------------------
  _derived_gross := NULL;

  IF o.pay_model = 'cpm'
     AND o.cpm IS NOT NULL AND public._opportunity_numeric_is_finite(o.cpm) AND o.cpm > 0
     AND o.estimated_loaded_miles IS NOT NULL
     AND public._opportunity_numeric_is_finite(o.estimated_loaded_miles)
     AND o.estimated_loaded_miles > 0
  THEN
    _derived_gross := o.cpm * o.estimated_loaded_miles;

  ELSIF o.pay_model = 'percentage'
     AND o.percentage_pay IS NOT NULL
     AND public._opportunity_numeric_is_finite(o.percentage_pay)
     AND o.percentage_pay > 0
     AND o.percentage_weekly_revenue_basis IS NOT NULL
     AND public._opportunity_numeric_is_finite(o.percentage_weekly_revenue_basis)
     AND o.percentage_weekly_revenue_basis > 0
     AND COALESCE(btrim(o.percentage_basis_label), '') <> ''
  THEN
    _derived_gross := o.percentage_weekly_revenue_basis * (o.percentage_pay / 100);

  ELSIF o.pay_model = 'flat_weekly'
     AND o.flat_weekly_pay IS NOT NULL
     AND public._opportunity_numeric_is_finite(o.flat_weekly_pay)
     AND o.flat_weekly_pay > 0
  THEN
    _derived_gross := o.flat_weekly_pay;

  ELSIF o.pay_model = 'salary'
     AND o.salary_amount IS NOT NULL
     AND public._opportunity_numeric_is_finite(o.salary_amount)
     AND o.salary_amount > 0
     AND o.salary_frequency IN ('weekly','biweekly','monthly','annual')
  THEN
    _derived_gross := CASE o.salary_frequency
      WHEN 'weekly'   THEN o.salary_amount
      WHEN 'biweekly' THEN o.salary_amount / 2
      WHEN 'monthly'  THEN (o.salary_amount * 12) / 52
      WHEN 'annual'   THEN o.salary_amount / 52
    END;

  ELSIF o.pay_model = 'mixed' AND jsonb_typeof(o.mixed_pay_components) = 'array' THEN
    DECLARE
      _wk_sum  numeric;
      _wk_cnt  int;
    BEGIN
      SELECT COALESCE(SUM(wk), 0), COUNT(*)
        INTO _wk_sum, _wk_cnt
      FROM (
        SELECT CASE (e.value->>'frequency')
                 WHEN 'weekly'   THEN public._opportunity_jsonb_number(e.value->'amount')
                 WHEN 'biweekly' THEN public._opportunity_jsonb_number(e.value->'amount') / 2
                 WHEN 'monthly'  THEN (public._opportunity_jsonb_number(e.value->'amount') * 12) / 52
                 WHEN 'annual'   THEN public._opportunity_jsonb_number(e.value->'amount') / 52
               END AS wk
        FROM jsonb_array_elements(o.mixed_pay_components) e
        WHERE COALESCE(btrim(e.value->>'label'), '') <> ''
          AND (e.value->>'frequency') IN ('weekly','biweekly','monthly','annual')
          AND public._opportunity_jsonb_number(e.value->'amount') IS NOT NULL
          AND public._opportunity_jsonb_number(e.value->'amount') >= 0
      ) s;
      IF _wk_cnt >= 2 THEN
        _derived_gross := _wk_sum;
      END IF;
    END;

  ELSIF o.pay_model = 'other'
     AND o.other_weekly_gross IS NOT NULL
     AND public._opportunity_numeric_is_finite(o.other_weekly_gross)
     AND o.other_weekly_gross > 0
  THEN
    _derived_gross := o.other_weekly_gross;
  END IF;

  IF _derived_gross IS NOT NULL
     AND _derived_gross > 0
     AND o.estimated_weekly_gross IS NOT NULL
     AND public._opportunity_numeric_is_finite(o.estimated_weekly_gross)
     AND o.estimated_weekly_gross > 0
  THEN
    _diff_ratio := abs(o.estimated_weekly_gross - _derived_gross) / _derived_gross;
    IF _diff_ratio > 0.10 THEN
      _b := array_append(_b, 'Recruiter-provided weekly gross differs from derived gross by more than 10%. Resolve the conflict before publishing.');
    END IF;
  END IF;

  ------------------------------------------------------------------
  -- Return unique, alphabetically sorted set.
  ------------------------------------------------------------------
  SELECT COALESCE(ARRAY(SELECT DISTINCT unnest(_b) ORDER BY 1), ARRAY[]::text[])
    INTO _b;
  RETURN _b;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. New BEFORE INSERT OR UPDATE trigger dispatcher.  Coexists with — never
--    replaces — the Phase 1K `trg_opportunities_guard`/`opportunities_guard`.
--    Alphabetical trigger name ordering guarantees this canonical
--    validator fires FIRST for any given INSERT/UPDATE, so a blocking
--    condition aborts the write before Phase 1K stamping runs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.opportunities_canonical_publication_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin                     boolean := public.is_admin(auth.uid());
  _owns_recruiter_profile       boolean := EXISTS (
    SELECT 1
      FROM public.recruiter_profiles rp
     WHERE rp.id = NEW.recruiter_id
       AND rp.user_id = auth.uid()
  );
  _is_explicit_admin_moderation boolean := false;
  _blockers                     text[];
  _detail                       text;
BEGIN
  -- Only validate rows whose resulting status is 'active'.
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  -- Grandfather only the exact row identities captured when this migration
  -- was first applied. The exemption cannot transfer to a different row ID,
  -- cannot be added by migration reapplication, and ends when the row becomes
  -- canonical or leaves the active state.
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id
     AND OLD.status = 'active'
     AND OLD.canonical_version IS DISTINCT FROM 1
     AND NEW.canonical_version IS DISTINCT FROM 1
     AND EXISTS (
       SELECT 1
       FROM public.opportunity_publication_legacy_snapshot s
       WHERE s.snapshot_key = 'phase1l_de2_initial_active_legacy'
         AND OLD.id = ANY(s.opportunity_ids)
     ) THEN
    RETURN NEW;
  END IF;

  -- Preserve Phase 1K administrative exceptions verbatim.
  IF _is_admin AND NOT _owns_recruiter_profile THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND _is_admin AND _owns_recruiter_profile THEN
    _is_explicit_admin_moderation :=
         (NEW.admin_review_status IS DISTINCT FROM OLD.admin_review_status)
      OR (NEW.featured             IS DISTINCT FROM OLD.featured)
      OR (NEW.view_count           IS DISTINCT FROM OLD.view_count)
      OR (NEW.published_at         IS DISTINCT FROM OLD.published_at);
    IF _is_explicit_admin_moderation THEN
      RETURN NEW;
    END IF;
  END IF;

  _blockers := public.opportunity_publication_blockers(NEW);

  IF _blockers IS NULL OR array_length(_blockers, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  _detail := jsonb_build_object(
    'code', 'opportunity_publication_invalid',
    'blocking_reasons', to_jsonb(_blockers)
  )::text;

  RAISE EXCEPTION 'Opportunity does not meet publication requirements.'
    USING ERRCODE = '23514',
          HINT    = 'Save as draft or correct the listed fields before publishing.',
          DETAIL  = _detail;
END;
$$;

-- Idempotent trigger binding.  DROP-then-CREATE keeps the trigger set to
-- exactly one row after any number of reapplications.
DROP TRIGGER IF EXISTS trg_opportunities_canonical_publication_guard ON public.opportunities;
CREATE TRIGGER trg_opportunities_canonical_publication_guard
  BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.opportunities_canonical_publication_guard();

-- ---------------------------------------------------------------------------
-- Direct EXECUTE lockdown.  These helpers are internal to the trigger
-- pipeline; only the SECURITY DEFINER dispatcher needs to invoke them.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._opportunity_numeric_is_finite(numeric)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._opportunity_jsonb_number(jsonb)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.opportunity_publication_blockers(public.opportunities) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.opportunities_canonical_publication_guard()            FROM PUBLIC, anon, authenticated;

COMMIT;
