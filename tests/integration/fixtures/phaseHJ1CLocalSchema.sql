-- HJ-1C disposable local fixture only. Never apply to a hosted database.
-- Canonical source table fragments; no production rows or lifecycle triggers.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

CREATE TYPE public.user_capability_type AS ENUM ('driver', 'recruiter');

CREATE TYPE public.user_capability_status AS ENUM ('setup', 'active', 'suspended', 'revoked');

CREATE TYPE public.assistant_status AS ENUM ('pending', 'active', 'revoked', 'expired');

CREATE TYPE public.recruiter_member_role AS ENUM ('recruiter_owner', 'recruiter_admin', 'recruiter_staff');

CREATE TYPE public.recruiter_member_status AS ENUM ('pending', 'active', 'revoked');

CREATE TYPE public.agency_status AS ENUM ('active', 'disabled');

CREATE TYPE public.agency_member_role AS ENUM ('agency_owner', 'agency_admin', 'agency_member');

CREATE TYPE public.agency_member_status AS ENUM ('pending', 'active', 'revoked');

CREATE TYPE public.agency_delegation_status AS ENUM ('pending_driver_approval', 'approved', 'declined', 'revoked', 'expired');

-- Source: 20260225000407_e32358b0-923e-4e45-adcd-1e0a2977790f.sql

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Source: 20260228060534_e148b76a-288a-4273-a42b-f9d95f9bfb0e.sql

CREATE TABLE public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.admin_users TO service_role;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Source: 20260308173206_2185a954-3f42-4fe7-8569-23290981fc8c.sql

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  plan_key text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'free',
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Source: 20260513003741_07f20f7a-242b-44d6-bd4b-4d91849cc847.sql

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_name text NOT NULL,
  recruiter_email text,
  recruiter_phone text,
  company_name text NOT NULL,
  company_website text,
  dot_number text,
  mc_number text,
  company_phone text,
  company_address text,
  company_city text,
  company_state text,
  hiring_states text[] NOT NULL DEFAULT '{}',
  equipment_types text[] NOT NULL DEFAULT '{}',
  driver_types_hired text[] NOT NULL DEFAULT '{}',
  verification_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'active',
  admin_notes text,
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruiter_profiles_user_unique UNIQUE (user_id),
  CONSTRAINT recruiter_profiles_verification_status_chk
    CHECK (verification_status IN ('pending','approved','rejected','suspended')),
  CONSTRAINT recruiter_profiles_status_chk
    CHECK (status IN ('active','inactive','suspended'))
);

GRANT ALL ON public.recruiter_profiles TO service_role;
ALTER TABLE public.recruiter_profiles ENABLE ROW LEVEL SECURITY;

-- Source: 20260513003741_07f20f7a-242b-44d6-bd4b-4d91849cc847.sql

CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  company_name text NOT NULL,
  hiring_city text,
  hiring_state text,
  hiring_states text[] NOT NULL DEFAULT '{}',
  driver_type text,
  route_type text,
  trailer_type text,
  pay_model text,
  cpm numeric,
  percentage_pay numeric,
  flat_weekly_pay numeric,
  estimated_weekly_gross numeric,
  estimated_weekly_miles numeric,
  estimated_loaded_miles numeric,
  estimated_deadhead_miles numeric,
  deadhead_paid boolean,
  detention_pay text,
  layover_pay text,
  sign_on_bonus numeric,
  fuel_paid_by text,
  insurance_deductions numeric,
  escrow_required boolean NOT NULL DEFAULT false,
  escrow_amount numeric,
  lease_payment numeric,
  maintenance_deductions numeric,
  other_deductions numeric,
  home_time text,
  forced_dispatch boolean,
  pets_allowed boolean,
  riders_allowed boolean,
  equipment_year text,
  benefits text,
  description text,
  transparency_confirmed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  admin_review_status text NOT NULL DEFAULT 'pending',
  featured boolean NOT NULL DEFAULT false,
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT opportunities_status_chk
    CHECK (status IN ('draft','active','paused','closed','removed')),
  CONSTRAINT opportunities_admin_review_status_chk
    CHECK (admin_review_status IN ('pending','approved','rejected','flagged')),
  CONSTRAINT opportunities_pay_model_chk
    CHECK (pay_model IS NULL OR pay_model IN ('cpm','percentage','flat_weekly','salary','mixed','other'))
);

GRANT ALL ON public.opportunities TO service_role;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

-- Source: 20260513003741_07f20f7a-242b-44d6-bd4b-4d91849cc847.sql

CREATE TABLE public.driver_opportunity_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  email text,
  city text,
  state text,
  cdl_class text,
  years_experience numeric,
  endorsements text[] NOT NULL DEFAULT '{}',
  trailer_experience text[] NOT NULL DEFAULT '{}',
  preferred_driver_type text,
  preferred_route_type text,
  preferred_home_time text,
  preferred_states text[] NOT NULL DEFAULT '{}',
  min_weekly_gross numeric,
  min_weekly_net numeric,
  min_effective_rpm numeric,
  available_start_date date,
  willing_to_relocate boolean NOT NULL DEFAULT false,
  contact_preference text NOT NULL DEFAULT 'in_app',
  visibility text NOT NULL DEFAULT 'private',
  allow_verified_recruiter_contact boolean NOT NULL DEFAULT false,
  profile_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_opportunity_profiles_user_unique UNIQUE (user_id),
  CONSTRAINT driver_opportunity_profiles_visibility_chk
    CHECK (visibility IN ('private','apply_only','verified_recruiters')),
  CONSTRAINT driver_opportunity_profiles_contact_pref_chk
    CHECK (contact_preference IN ('in_app','phone','email'))
);

GRANT ALL ON public.driver_opportunity_profiles TO service_role;
ALTER TABLE public.driver_opportunity_profiles ENABLE ROW LEVEL SECURITY;

-- Source: 20260628105109_9110e462-2adb-45e5-a391-02b29d32363f.sql

CREATE TABLE IF NOT EXISTS public.agency_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  contact_email   TEXT,
  status          public.agency_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.agency_profiles TO service_role;
ALTER TABLE public.agency_profiles ENABLE ROW LEVEL SECURITY;

-- Source: 20260628105109_9110e462-2adb-45e5-a391-02b29d32363f.sql

CREATE TABLE IF NOT EXISTS public.agency_members (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id          UUID NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  member_user_id     UUID,
  invite_email       TEXT NOT NULL,
  invite_token_hash  TEXT,
  role               public.agency_member_role NOT NULL DEFAULT 'agency_member',
  status             public.agency_member_status NOT NULL DEFAULT 'pending',
  invited_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at        TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.agency_members TO service_role;
ALTER TABLE public.agency_members ENABLE ROW LEVEL SECURITY;

-- Source: 20260630001239_aacd1acb-dd6f-4fc5-9645-7f430b807820.sql

create table if not exists public.agency_entitlements (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null unique references public.agency_profiles(id) on delete cascade,
  plan_key text not null default 'agency_starter'
    check (plan_key in ('assistant_free','agency_starter','agency_team','agency_growth')),
  status text not null default 'manual_beta'
    check (status in ('trialing','active','past_due','cancelled','manual_beta')),
  source text not null default 'manual'
    check (source in ('manual','stripe','admin_seed')),
  active_client_limit integer,
  member_limit integer,
  service_package_limit integer,
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT ALL ON public.agency_entitlements TO service_role;
ALTER TABLE public.agency_entitlements ENABLE ROW LEVEL SECURITY;

-- Source: 20260628033947_fd83ec69-321a-48ec-90f3-712584062414.sql

CREATE TABLE public.driver_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL,
  assistant_user_id uuid,
  invite_email text NOT NULL,
  invite_token_hash text,
  status public.assistant_status NOT NULL DEFAULT 'pending',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.driver_assistants TO service_role;
ALTER TABLE public.driver_assistants ENABLE ROW LEVEL SECURITY;

-- Source: 20260815020500_phase_rc1a_recruiter_workspace_membership_foundation.sql

CREATE TABLE IF NOT EXISTS public.recruiter_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id        uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  member_user_id      uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_email        citext NOT NULL,
  invite_token_hash   text NULL,
  invite_expires_at   timestamptz NULL,
  role                public.recruiter_member_role NOT NULL DEFAULT 'recruiter_staff',
  status              public.recruiter_member_status NOT NULL DEFAULT 'pending',
  invited_by_user_id  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at          timestamptz NOT NULL DEFAULT now(),
  accepted_at         timestamptz NULL,
  revoked_at          timestamptz NULL,
  revoked_by_user_id  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.recruiter_members TO service_role;
ALTER TABLE public.recruiter_members ENABLE ROW LEVEL SECURITY;

-- Source: 20260821003749_bfa5a325-8fcb-4a8b-b4e5-e6109e459fcb.sql

CREATE TABLE IF NOT EXISTS public.owner_qa_sessions (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  domain     text        NOT NULL,
  persona    text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT owner_qa_sessions_domain_check
    CHECK (domain IN ('driver', 'recruiter', 'agency')),
  CONSTRAINT owner_qa_sessions_persona_check
    CHECK (
      (domain = 'driver'    AND persona IN ('free', 'pro_monthly', 'pro_yearly'))
      OR (domain = 'recruiter' AND persona IN ('free_verified', 'starter', 'growth', 'fleet'))
      OR (domain = 'agency'  AND persona IN ('assistant_free', 'agency_starter', 'agency_team', 'agency_growth'))
    ),
  CONSTRAINT owner_qa_sessions_expiry_check
    CHECK (expires_at > created_at)
);

GRANT ALL ON public.owner_qa_sessions TO service_role;
ALTER TABLE public.owner_qa_sessions ENABLE ROW LEVEL SECURITY;

-- Source: 20260821062449_7c014ba4-370b-4eb8-afe0-f71de5785e43.sql

CREATE TABLE IF NOT EXISTS public.qa_fixture_roots (
  root_kind text NOT NULL,
  root_id uuid NOT NULL,
  qa_owner_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  note text,
  registered_by_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT qa_fixture_roots_pkey PRIMARY KEY (root_kind, root_id),
  CONSTRAINT qa_fixture_roots_root_kind_allowlist
    CHECK (root_kind IN ('user', 'recruiter_profile', 'agency_profile')),
  CONSTRAINT qa_fixture_roots_active_revoked_consistent
    CHECK (
      (active AND revoked_at IS NULL)
      OR (NOT active AND revoked_at IS NOT NULL)
    ),
  CONSTRAINT qa_fixture_roots_note_length
    CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT qa_fixture_roots_user_root_not_qa_owner
    CHECK (root_kind <> 'user' OR root_id <> qa_owner_user_id)
);

GRANT ALL ON public.qa_fixture_roots TO service_role;
ALTER TABLE public.qa_fixture_roots ENABLE ROW LEVEL SECURITY;

-- Source: 20260719183725_ee7ffc53-dcdc-4666-bcba-1aeac0f5d0cf.sql

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
    CHECK (scope IN ('applications','messaging','all')),
  CONSTRAINT marketplace_user_restrictions_restriction_chk
    CHECK (restriction IN ('blocked','read_only','warned'))
);

GRANT ALL ON public.marketplace_user_restrictions TO service_role;
ALTER TABLE public.marketplace_user_restrictions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles
  ADD COLUMN intended_role text NOT NULL DEFAULT 'driver' CHECK (intended_role IN ('driver','recruiter')),
  ADD COLUMN subscription_status text NOT NULL DEFAULT 'free',
  ADD COLUMN subscription_plan text,
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN stripe_subscription_id text,
  ADD COLUMN subscription_expires_at timestamptz,
  ADD COLUMN driver_handle text,
  ADD COLUMN handle_emoji text,
  ADD COLUMN handle_public boolean NOT NULL DEFAULT false,
  ADD COLUMN last_seen_release_id text;
ALTER TABLE public.recruiter_profiles
  ADD COLUMN posting_terms_accepted_at timestamptz,
  ADD COLUMN posting_terms_version text,
  ADD COLUMN legacy_terms_grandfathered_at timestamptz,
  ADD COLUMN company_type text CHECK (company_type IN ('carrier','third_party_recruiter','staffing_agency','independent_recruiter')),
  ADD COLUMN dispatch_week_start_day text NOT NULL DEFAULT 'sunday' CHECK (dispatch_week_start_day IN ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')),
  ADD COLUMN pay_period_cadence text NOT NULL DEFAULT 'weekly' CHECK (pay_period_cadence IN ('weekly','biweekly')),
  ADD COLUMN pay_period_anchor_date date,
  ADD CONSTRAINT recruiter_profiles_pay_period_anchor_shape_check
    CHECK (pay_period_cadence <> 'biweekly' OR pay_period_anchor_date IS NOT NULL);
CREATE TABLE public.user_capabilities (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability public.user_capability_type NOT NULL,
  status public.user_capability_status NOT NULL,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, capability)
);
GRANT SELECT ON public.user_capabilities TO authenticated;
GRANT ALL ON public.user_capabilities TO service_role;
ALTER TABLE public.user_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_capabilities_self_select ON public.user_capabilities
  FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.profiles, public.admin_users TO authenticated;
CREATE POLICY profiles_self_read ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.agency_profiles
  ADD COLUMN slug public.citext,
  ADD CONSTRAINT agency_profiles_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.agency_members ADD COLUMN invite_expires_at timestamptz,
  ADD COLUMN permissions jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.recruiter_members ADD COLUMN permissions jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(permissions) = 'object');


-- Source: 20260628114250_fe0250b1-6527-477c-be9a-ac5e21467e0a.sql

CREATE TABLE IF NOT EXISTS public.agency_client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  selected_package_id uuid REFERENCES public.agency_service_packages(id) ON DELETE SET NULL,
  status public.agency_client_request_status NOT NULL DEFAULT 'pending',
  message text,
  preferred_contact_method text CHECK (preferred_contact_method IN ('email','phone','text','any') OR preferred_contact_method IS NULL),
  phone text,
  requested_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_member_user_id uuid,
  decided_at timestamptz,
  decided_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.agency_client_requests TO service_role;
ALTER TABLE public.agency_client_requests ENABLE ROW LEVEL SECURITY;

-- Source: 20260628114250_fe0250b1-6527-477c-be9a-ac5e21467e0a.sql

CREATE TABLE IF NOT EXISTS public.agency_delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  client_request_id uuid REFERENCES public.agency_client_requests(id) ON DELETE SET NULL,
  driver_user_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  member_invite_email text NOT NULL,
  requested_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.agency_delegation_status NOT NULL DEFAULT 'pending_driver_approval',
  created_by_user_id uuid NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.agency_delegation_requests TO service_role;
ALTER TABLE public.agency_delegation_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.driver_assistants ADD COLUMN agency_delegation_id uuid REFERENCES public.agency_delegation_requests(id) ON DELETE SET NULL;

-- Phase 1L-DE1M: Canonical opportunity authoring additive storage foundation.
--
-- Additive columns and CHECK constraints for the canonical recruiter opportunity
-- authoring contract. Applied under controlled production migration approval.
-- No backfill, trigger, RLS, policy, grant, function, or existing-column changes.



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
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_canonical_version_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_canonical_version_chk
      CHECK (canonical_version IS NULL OR canonical_version = 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_employment_model_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_employment_model_chk
      CHECK (
        employment_model IS NULL
        OR employment_model IN ('company_driver','contractor_1099','owner_operator','lease_purchase')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_team_configuration_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_team_configuration_chk
      CHECK (
        team_configuration IS NULL
        OR team_configuration IN ('solo','team','solo_or_team')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_salary_frequency_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_salary_frequency_chk
      CHECK (salary_frequency IS NULL OR salary_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_insurance_deduction_frequency_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_insurance_deduction_frequency_chk
      CHECK (insurance_deduction_frequency IS NULL OR insurance_deduction_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_escrow_required_state_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_escrow_required_state_chk
      CHECK (escrow_required_state IS NULL OR escrow_required_state IN ('required','not_required','not_disclosed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_escrow_amount_frequency_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_escrow_amount_frequency_chk
      CHECK (escrow_amount_frequency IS NULL OR escrow_amount_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_lease_payment_frequency_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_lease_payment_frequency_chk
      CHECK (lease_payment_frequency IS NULL OR lease_payment_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_maintenance_deduction_frequency_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_maintenance_deduction_frequency_chk
      CHECK (maintenance_deduction_frequency IS NULL OR maintenance_deduction_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_other_deduction_frequency_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_other_deduction_frequency_chk
      CHECK (other_deduction_frequency IS NULL OR other_deduction_frequency IN ('weekly','biweekly','monthly','annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_mixed_pay_components_array_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_mixed_pay_components_array_chk
      CHECK (jsonb_typeof(mixed_pay_components) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_percentage_weekly_revenue_basis_nonneg_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_percentage_weekly_revenue_basis_nonneg_chk
      CHECK (percentage_weekly_revenue_basis IS NULL OR percentage_weekly_revenue_basis >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_salary_amount_nonneg_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_salary_amount_nonneg_chk
      CHECK (salary_amount IS NULL OR salary_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_other_weekly_gross_nonneg_chk'
      AND conrelid = 'public.opportunities'::regclass
  ) THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_other_weekly_gross_nonneg_chk
      CHECK (other_weekly_gross IS NULL OR other_weekly_gross >= 0);
  END IF;
END $$;




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




-- Preservation sentinels, NOT replicas of the full unrelated application schema.
CREATE TABLE public.hj1c_preservation_sentinels (
  domain text PRIMARY KEY,
  payload jsonb NOT NULL
);
GRANT ALL ON public.hj1c_preservation_sentinels TO service_role;
ALTER TABLE public.hj1c_preservation_sentinels ENABLE ROW LEVEL SECURITY;
INSERT INTO public.hj1c_preservation_sentinels VALUES
  ('applications','{"unchanged":true}'), ('conversations','{"unchanged":true}'),
  ('billing','{"unchanged":true}'), ('telegram','{"unchanged":true}');

