-- Phase 1L-DE1: Canonical opportunity authoring additive storage foundation.
--
-- Additive, nullable columns on public.opportunities to preserve the
-- reconstructed recruiter authoring form without abusing legacy columns.
--
-- This candidate is NOT executed by DE1. Server-side trigger enforcement
-- lands in DE2. This file only defines the additive column shape and
-- vocabulary CHECK constraints that DE2 and later phases can rely on.
--
-- Non-goals for DE1:
--   * No changes to existing columns, defaults, RLS, grants, policies,
--     triggers, functions, or rows.
--   * No data backfill; Phase 1L-G will make legacy-data decisions.
--   * No new triggers.

BEGIN;

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS canonical_version smallint,
  ADD COLUMN IF NOT EXISTS employment_model text,
  ADD COLUMN IF NOT EXISTS team_configuration text,
  ADD COLUMN IF NOT EXISTS percentage_basis_label text,
  ADD COLUMN IF NOT EXISTS percentage_weekly_revenue_basis numeric,
  ADD COLUMN IF NOT EXISTS salary_amount numeric,
  ADD COLUMN IF NOT EXISTS salary_frequency text,
  ADD COLUMN IF NOT EXISTS mixed_pay_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS other_pay_method_label text,
  ADD COLUMN IF NOT EXISTS other_weekly_gross numeric,
  ADD COLUMN IF NOT EXISTS insurance_deduction_frequency text,
  ADD COLUMN IF NOT EXISTS escrow_required_state text,
  ADD COLUMN IF NOT EXISTS escrow_amount_frequency text,
  ADD COLUMN IF NOT EXISTS lease_payment_frequency text,
  ADD COLUMN IF NOT EXISTS maintenance_deduction_frequency text,
  ADD COLUMN IF NOT EXISTS other_deduction_frequency text,
  ADD COLUMN IF NOT EXISTS typical_lanes text,
  ADD COLUMN IF NOT EXISTS requirements text,
  ADD COLUMN IF NOT EXISTS actual_benefits text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_canonical_version_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_canonical_version_chk
      CHECK (canonical_version IS NULL OR canonical_version = 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_employment_model_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_employment_model_chk
      CHECK (
        employment_model IS NULL
        OR employment_model IN ('company_driver','contractor_1099','owner_operator','lease_purchase')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_team_configuration_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_team_configuration_chk
      CHECK (
        team_configuration IS NULL
        OR team_configuration IN ('solo','team','solo_or_team')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_salary_frequency_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_salary_frequency_chk
      CHECK (salary_frequency IS NULL OR salary_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_insurance_deduction_frequency_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_insurance_deduction_frequency_chk
      CHECK (insurance_deduction_frequency IS NULL OR insurance_deduction_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_escrow_required_state_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_escrow_required_state_chk
      CHECK (escrow_required_state IS NULL OR escrow_required_state IN ('required','not_required','not_disclosed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_escrow_amount_frequency_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_escrow_amount_frequency_chk
      CHECK (escrow_amount_frequency IS NULL OR escrow_amount_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_lease_payment_frequency_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_lease_payment_frequency_chk
      CHECK (lease_payment_frequency IS NULL OR lease_payment_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_maintenance_deduction_frequency_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_maintenance_deduction_frequency_chk
      CHECK (maintenance_deduction_frequency IS NULL OR maintenance_deduction_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_other_deduction_frequency_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_other_deduction_frequency_chk
      CHECK (other_deduction_frequency IS NULL OR other_deduction_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_mixed_pay_components_array_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_mixed_pay_components_array_chk
      CHECK (jsonb_typeof(mixed_pay_components) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_percentage_weekly_revenue_basis_nonneg_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_percentage_weekly_revenue_basis_nonneg_chk
      CHECK (percentage_weekly_revenue_basis IS NULL OR percentage_weekly_revenue_basis >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_salary_amount_nonneg_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_salary_amount_nonneg_chk
      CHECK (salary_amount IS NULL OR salary_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_other_weekly_gross_nonneg_chk'
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_other_weekly_gross_nonneg_chk
      CHECK (other_weekly_gross IS NULL OR other_weekly_gross >= 0);
  END IF;
END $$;

COMMIT;
