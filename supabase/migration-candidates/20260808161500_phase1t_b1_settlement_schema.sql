-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase 1T-B1 — Settlement physical data model (fail-closed schema only).
--
-- Scope: exactly five new public tables, their constraints, and practical
-- lookup indexes. Row-level security is ENABLED on every new table and
-- ZERO policies are created, so if this candidate is ever applied before
-- Phase 1T-B2 the authenticated client surface stays fail-closed (no read,
-- no write) rather than silently open.
--
-- Deliberately NOT in this candidate:
--   * no RLS policies, no authorization helper functions, no triggers;
--   * no DML, no backfill;
--   * no payroll-processing or tax-form structures.
--
-- Privacy boundary: this is settlement viewing/reconciliation storage, not
-- payroll processing. No email, SSN, EIN, bank/routing, direct-deposit,
-- W-4/I-9, tax-filing credential, Stripe identifier, payroll-tax, or other
-- payment-credential column exists in any table below.
--
-- Identity contract (matches Phase 1T-A):
--   recruiter/carrier business identity = public.recruiter_profiles.id
--   agency business identity            = public.agency_profiles.id
--   driver / actor identity             = auth.users.id
-- An auth user id is never used as a business identity and email is never
-- an ownership key.
--
-- This candidate intentionally does NOT use IF NOT EXISTS: a re-apply must
-- fail loudly rather than mask partial schema drift.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) carrier_driver_relationships
--    Explicit carrier (recruiter business) <-> driver (auth user) link.
-- ---------------------------------------------------------------------------
CREATE TABLE public.carrier_driver_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'invited',
  created_by_user_id uuid NOT NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz NULL,
  ended_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carrier_driver_relationships_status_check
    CHECK (status IN ('invited', 'active', 'inactive', 'ended')),
  CONSTRAINT carrier_driver_relationships_unique_pair
    UNIQUE (recruiter_id, driver_user_id)
);

CREATE INDEX idx_carrier_driver_relationships_recruiter_status
  ON public.carrier_driver_relationships (recruiter_id, status);
CREATE INDEX idx_carrier_driver_relationships_driver_status
  ON public.carrier_driver_relationships (driver_user_id, status);

ALTER TABLE public.carrier_driver_relationships ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2) driver_settlements
--    One settlement statement. Provenance (source) is never collapsed:
--    carrier_issued, agency_prepared, and driver_imported stay distinct.
-- ---------------------------------------------------------------------------
CREATE TABLE public.driver_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  -- Historical provenance snapshots, intentionally NOT foreign keys: these three
  -- UUIDs preserve the canonical business identity value of the issuer/preparer
  -- even after the live recruiter profile, carrier relationship, or agency
  -- profile is deleted. A settlement statement is a historical financial record
  -- and must remain readable and attributable to its driver. Phase 1T-B2 must
  -- validate that these ids reference live, authorized objects on CREATE/MANAGE;
  -- already-stored historical rows do not depend on those objects continuing to
  -- exist, and business/account deletion must never be blocked or silently
  -- rewrite provenance to NULL.
  carrier_recruiter_profile_id uuid NULL,
  carrier_driver_relationship_id uuid NULL,
  agency_id uuid NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  pay_date date NULL,
  statement_reference text NULL,
  payer_name_snapshot text NULL,
  source_display_name_snapshot text NULL,
  reported_gross_amount numeric(14,2) NULL,
  reported_net_amount numeric(14,2) NULL,
  notes text NULL,
  calculation_version text NOT NULL DEFAULT '1',
  version_number integer NOT NULL DEFAULT 1,
  -- CASCADE (not RESTRICT) so an entire revision chain — every version belongs to
  -- the same driver — can be removed together when that driver explicitly deletes
  -- their HaulTracker account. This is referential/account-deletion safety only;
  -- Phase 1T-B2 must still prohibit normal client deletion of finalized history.
  supersedes_settlement_id uuid NULL REFERENCES public.driver_settlements(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL,
  finalized_by_user_id uuid NULL,
  finalized_at timestamptz NULL,
  voided_by_user_id uuid NULL,
  voided_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_settlements_source_check
    CHECK (source IN ('carrier_issued', 'agency_prepared', 'driver_imported')),
  CONSTRAINT driver_settlements_status_check
    CHECK (status IN ('draft', 'finalized', 'voided', 'superseded')),
  CONSTRAINT driver_settlements_period_order_check
    CHECK (period_end >= period_start),
  CONSTRAINT driver_settlements_version_number_check
    CHECK (version_number >= 1),
  CONSTRAINT driver_settlements_reported_gross_check
    CHECK (
      reported_gross_amount IS NULL
      OR (
        reported_gross_amount::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND reported_gross_amount >= 0
      )
    ),
  CONSTRAINT driver_settlements_reported_net_finite_check
    CHECK (
      reported_net_amount IS NULL
      OR reported_net_amount::text NOT IN ('NaN', 'Infinity', '-Infinity')
    ),
  CONSTRAINT driver_settlements_no_self_supersede_check
    CHECK (supersedes_settlement_id IS NULL OR supersedes_settlement_id <> id),
  CONSTRAINT driver_settlements_revision_shape_check
    CHECK (
      (version_number = 1 AND supersedes_settlement_id IS NULL)
      OR (version_number > 1 AND supersedes_settlement_id IS NOT NULL)
    ),
  CONSTRAINT driver_settlements_source_identity_check
    CHECK (
      (source = 'carrier_issued'
        AND carrier_recruiter_profile_id IS NOT NULL
        AND carrier_driver_relationship_id IS NOT NULL
        AND agency_id IS NULL
        AND source_display_name_snapshot IS NOT NULL
        AND length(btrim(source_display_name_snapshot, E' \t\r\n')) > 0)
      OR (source = 'agency_prepared'
        AND agency_id IS NOT NULL
        AND carrier_recruiter_profile_id IS NULL
        AND carrier_driver_relationship_id IS NULL
        AND source_display_name_snapshot IS NOT NULL
        AND length(btrim(source_display_name_snapshot, E' \t\r\n')) > 0)
      OR (source = 'driver_imported'
        AND carrier_recruiter_profile_id IS NULL
        AND carrier_driver_relationship_id IS NULL
        AND agency_id IS NULL)
    )
);

-- A CHECK constraint cannot read another table. Phase 1T-B2 must enforce, in
-- authorization/validation logic, that carrier_driver_relationship_id points at
-- a relationship whose recruiter_id equals carrier_recruiter_profile_id AND
-- whose driver_user_id equals this row's driver_user_id.

CREATE INDEX idx_driver_settlements_driver_pay_date
  ON public.driver_settlements (driver_user_id, pay_date DESC);
CREATE INDEX idx_driver_settlements_carrier_status
  ON public.driver_settlements (carrier_recruiter_profile_id, status);
CREATE INDEX idx_driver_settlements_agency_status
  ON public.driver_settlements (agency_id, status);
CREATE INDEX idx_driver_settlements_driver_period
  ON public.driver_settlements (driver_user_id, period_start DESC, period_end DESC);

ALTER TABLE public.driver_settlements ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3) driver_settlement_items
--    Line items. Amounts are always non-negative; item_type determines
--    add/subtract semantics. No linked load id here — company-vs-driver load
--    matching lives only in driver_settlement_matches so the two source
--    records stay distinct.
-- ---------------------------------------------------------------------------
CREATE TABLE public.driver_settlement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.driver_settlements(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  category text NULL,
  description text NULL,
  amount numeric(14,2) NOT NULL,
  pay_method text NULL,
  quantity numeric(14,4) NULL,
  rate numeric(14,6) NULL,
  unit_label text NULL,
  expected_amount_snapshot numeric(14,2) NULL,
  load_reference_snapshot text NULL,
  pickup_date_snapshot date NULL,
  delivery_date_snapshot date NULL,
  origin_snapshot text NULL,
  destination_snapshot text NULL,
  loaded_miles_snapshot numeric(12,2) NULL,
  deadhead_miles_snapshot numeric(12,2) NULL,
  payable_miles_snapshot numeric(12,2) NULL,
  eligible_revenue_snapshot numeric(14,2) NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_settlement_items_item_type_check
    CHECK (item_type IN ('load_pay', 'earning', 'reimbursement', 'deduction', 'withholding')),
  CONSTRAINT driver_settlement_items_amount_check
    CHECK (
      amount::text NOT IN ('NaN', 'Infinity', '-Infinity')
      AND amount >= 0
    ),
  CONSTRAINT driver_settlement_items_pay_method_check
    CHECK (pay_method IS NULL OR pay_method IN ('per_mile', 'percentage', 'flat_rate', 'manual')),
  CONSTRAINT driver_settlement_items_quantity_check
    CHECK (
      quantity IS NULL
      OR (
        quantity::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND quantity >= 0
      )
    ),
  CONSTRAINT driver_settlement_items_rate_check
    CHECK (
      rate IS NULL
      OR (
        rate::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND rate >= 0
      )
    ),
  CONSTRAINT driver_settlement_items_expected_amount_check
    CHECK (
      expected_amount_snapshot IS NULL
      OR (
        expected_amount_snapshot::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND expected_amount_snapshot >= 0
      )
    ),
  CONSTRAINT driver_settlement_items_loaded_miles_check
    CHECK (
      loaded_miles_snapshot IS NULL
      OR (
        loaded_miles_snapshot::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND loaded_miles_snapshot >= 0
      )
    ),
  CONSTRAINT driver_settlement_items_deadhead_miles_check
    CHECK (
      deadhead_miles_snapshot IS NULL
      OR (
        deadhead_miles_snapshot::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND deadhead_miles_snapshot >= 0
      )
    ),
  CONSTRAINT driver_settlement_items_payable_miles_check
    CHECK (
      payable_miles_snapshot IS NULL
      OR (
        payable_miles_snapshot::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND payable_miles_snapshot >= 0
      )
    ),
  CONSTRAINT driver_settlement_items_eligible_revenue_check
    CHECK (
      eligible_revenue_snapshot IS NULL
      OR (
        eligible_revenue_snapshot::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND eligible_revenue_snapshot >= 0
      )
    ),
  CONSTRAINT driver_settlement_items_sort_order_check
    CHECK (sort_order >= 0)
);

CREATE INDEX idx_driver_settlement_items_settlement_sort
  ON public.driver_settlement_items (settlement_id, sort_order, id);

ALTER TABLE public.driver_settlement_items ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4) driver_settlement_matches
--    Reconciliation link between a company statement line and the driver's own
--    load record. The two records remain independent; this table only records
--    the proposed/accepted correspondence.
-- ---------------------------------------------------------------------------
CREATE TABLE public.driver_settlement_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_item_id uuid NOT NULL REFERENCES public.driver_settlement_items(id) ON DELETE CASCADE,
  driver_load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  match_state text NOT NULL,
  confidence numeric(5,4) NULL,
  matched_by_user_id uuid NULL,
  matched_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_settlement_matches_state_check
    CHECK (match_state IN ('exact', 'likely', 'possible', 'confirmed', 'rejected')),
  CONSTRAINT driver_settlement_matches_confidence_check
    CHECK (
      confidence IS NULL
      OR (
        confidence::text NOT IN ('NaN', 'Infinity', '-Infinity')
        AND confidence >= 0
        AND confidence <= 1
      )
    ),
  CONSTRAINT driver_settlement_matches_unique_pair
    UNIQUE (settlement_item_id, driver_load_id)
);

-- Phase 1T-B2 must enforce that driver_load_id belongs to the same
-- driver_user_id as the parent settlement; no CHECK can span those tables.

CREATE UNIQUE INDEX uq_driver_settlement_matches_accepted
  ON public.driver_settlement_matches (settlement_item_id)
  WHERE match_state IN ('exact', 'confirmed');

CREATE INDEX idx_driver_settlement_matches_item_state
  ON public.driver_settlement_matches (settlement_item_id, match_state);
CREATE INDEX idx_driver_settlement_matches_load
  ON public.driver_settlement_matches (driver_load_id);

ALTER TABLE public.driver_settlement_matches ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5) driver_settlement_events
--    Append-only audit trail of settlement lifecycle actions.
-- ---------------------------------------------------------------------------
CREATE TABLE public.driver_settlement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.driver_settlements(id) ON DELETE CASCADE,
  actor_user_id uuid NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_settlement_events_type_check
    CHECK (event_type IN ('created', 'updated', 'finalized', 'superseded', 'voided', 'match_confirmed', 'exported'))
);

CREATE INDEX idx_driver_settlement_events_settlement_created
  ON public.driver_settlement_events (settlement_id, created_at DESC);

ALTER TABLE public.driver_settlement_events ENABLE ROW LEVEL SECURITY;

COMMIT;
