-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase CF-1C-A — Structured qualification foundation (additive columns only).
--
-- Scope: ADD three nullable/defaulted structured criteria columns to
-- public.opportunities plus their CHECK constraints. No RLS, policy, grant,
-- function, trigger, index, enum, data write, or backfill is performed.
--
-- These columns represent DETERMINISTIC, RECRUITER-DECLARED criteria only.
-- public.opportunities.requirements free text remains untouched and remains
-- authoritative for any requirement not represented structurally. No existing
-- requirements text is parsed or backfilled: existing rows keep NULL / empty
-- structured criteria, which the evaluator treats as "no structured criteria".
--
-- Intentionally excluded from this phase: MVR, DUI, SAP, drug testing, age,
-- criminal history, medical, disability, and any protected-class attribute.
-- Hiring geography stays a fit/visibility signal and is NOT a hard criterion.

BEGIN;

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS min_years_experience numeric NULL,
  ADD COLUMN IF NOT EXISTS required_cdl_class text NULL,
  ADD COLUMN IF NOT EXISTS required_endorsements text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_min_years_experience_check
  CHECK (min_years_experience IS NULL OR min_years_experience >= 0);

ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_required_cdl_class_check
  CHECK (required_cdl_class IS NULL OR required_cdl_class IN ('A', 'B', 'C'));

ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_required_endorsements_check
  CHECK (
    array_position(required_endorsements, NULL) IS NULL
    AND required_endorsements <@ ARRAY['H', 'N', 'P', 'S', 'T', 'X']::text[]
  );

COMMIT;
