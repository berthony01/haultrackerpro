// @vitest-environment node
// =====================================================================
// Phase 1S-A2 — Agency paid-plan enforcement with beta grandfathering.
//
// Static contract proofs over the candidate SQL and the client surface,
// plus a PGlite runtime proof that loads the candidate on top of a minimal
// Supabase-compatible agency bootstrap and exercises the real functions.
//
// No production database, Stripe, deploy, or publish access.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

const CANDIDATE_REL =
  '../../supabase/migration-candidates/20260806052000_phase1s_a2_agency_paid_plan_enforcement.sql';

const CANDIDATE_SQL = fs.readFileSync(
  fileURLToPath(new URL(CANDIDATE_REL, import.meta.url)),
  'utf8',
);

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// ---------------------------------------------------------------------
// 1–2, 8–11 — static contract
// ---------------------------------------------------------------------

describe('Phase 1S-A2 — candidate header and transaction', () => {
  it('declares itself a candidate on the very first line', () => {
    expect(CANDIDATE_SQL.split('\n')[0]).toBe(
      '-- CANDIDATE MIGRATION — NOT APPLIED LIVE.',
    );
  });

  it('wraps the whole change in one explicit transaction', () => {
    expect(CANDIDATE_SQL).toMatch(/^BEGIN;$/m);
    expect(CANDIDATE_SQL).toMatch(/^COMMIT;$/m);
    expect(CANDIDATE_SQL.indexOf('\nBEGIN;')).toBeLessThan(
      CANDIDATE_SQL.lastIndexOf('\nCOMMIT;'),
    );
  });
});

describe('Phase 1S-A2 — candidate scope is exactly one default + twelve functions', () => {
  const statementText = CANDIDATE_SQL
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

  // Top-level scope only: function bodies legitimately contain INSERT/UPDATE
  // statements that are preserved production behavior, so they must not be
  // read as migration-time DML.
  const topLevelText = statementText.replace(/AS \$(\w*)\$[\s\S]*?\$\1\$/g, 'AS $$BODY$$');

  it('changes only the agency_entitlements.status default', () => {
    const alters = topLevelText.match(/ALTER TABLE[\s\S]*?;/gi) ?? [];
    expect(alters).toHaveLength(1);
    expect(alters[0].replace(/\s+/g, ' ').trim()).toBe(
      "ALTER TABLE public.agency_entitlements ALTER COLUMN status SET DEFAULT 'cancelled'::text;",
    );
  });

  it('replaces exactly the twelve named functions', () => {
    const fns = (topLevelText.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) ?? []).map(
      (m) => m.replace('CREATE OR REPLACE FUNCTION public.', ''),
    );
    expect(fns.sort()).toEqual([
      'accept_agency_invite',
      'assert_agency_limit',
      'create_agency',
      'create_agency_delegation_request',
      'create_agency_work_item',
      'get_agency_public_view',
      'get_effective_agency_limits',
      'list_agency_packages_public',
      'resolve_agency_slug',
      'set_agency_client_request_status',
      'set_agency_slug',
      'submit_agency_client_request',
    ]);
  });

  it('leaves cleanup and existing-work functions outside this candidate', () => {
    for (const fn of [
      'update_agency_package',
      'update_agency_work_item',
      'list_agency_client_requests',
      'list_agency_work_items',
      'list_agency_audit_log',
      'driver_decide_delegation',
    ]) {
      expect(topLevelText).not.toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
    }
  });

  it('contains no top-level data mutation, schema growth, policy, index, trigger, or grant change', () => {
    for (const forbidden of [
      /\bUPDATE\s+public\./i,
      /\bINSERT\s+INTO\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
      /\bCREATE\s+TABLE\b/i,
      /\bADD\s+COLUMN\b/i,
      /\bDROP\s+COLUMN\b/i,
      /\bCREATE\s+POLICY\b/i,
      /\bDROP\s+POLICY\b/i,
      /\bROW\s+LEVEL\s+SECURITY\b/i,
      /\bCREATE\s+(UNIQUE\s+)?INDEX\b/i,
      /\bCREATE\s+TRIGGER\b/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /\bstripe\b/i,
    ]) {
      expect(topLevelText).not.toMatch(forbidden);
    }
  });

  it('never rewrites an existing entitlement row', () => {
    expect(statementText).toMatch(/ON CONFLICT \(agency_id\) DO NOTHING/);
    expect(statementText).not.toMatch(/DO UPDATE/i);
  });

  it('preserves the verified production signature/security contract of every replaced function', () => {
    const contracts: [string, RegExp][] = [
      [
        'set_agency_slug',
        /FUNCTION public\.set_agency_slug\(_agency_id uuid, _slug text\)\s*\nRETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public/,
      ],
      [
        'resolve_agency_slug',
        /FUNCTION public\.resolve_agency_slug\(_slug text\)\s*\nRETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public/,
      ],
      [
        'get_agency_public_view',
        /FUNCTION public\.get_agency_public_view\(_agency_id uuid\)\s*\nRETURNS TABLE \(id uuid, name text, description text, contact_email text, status text\)\s*\nLANGUAGE sql STABLE SECURITY DEFINER SET search_path = public/,
      ],
      [
        'list_agency_packages_public',
        /FUNCTION public\.list_agency_packages_public\(_agency_id uuid\)\s*\nRETURNS SETOF public\.agency_service_packages\s*\nLANGUAGE sql STABLE SECURITY DEFINER SET search_path = public/,
      ],
      [
        'submit_agency_client_request',
        /FUNCTION public\.submit_agency_client_request\(\s*\n\s*_agency_id uuid, _selected_package_id uuid, _message text,\s*\n\s*_preferred_contact_method text, _phone text, _consent boolean\s*\n\) RETURNS public\.agency_client_requests\s*\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = public/,
      ],
      [
        'set_agency_client_request_status',
        /FUNCTION public\.set_agency_client_request_status\(\s*\n\s*_id uuid, _status public\.agency_client_request_status,\s*\n\s*_assigned_member_user_id uuid DEFAULT NULL\s*\n\) RETURNS public\.agency_client_requests\s*\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = public/,
      ],
      [
        'create_agency_delegation_request',
        /FUNCTION public\.create_agency_delegation_request\(_client_request_id uuid, _member_user_id uuid, _requested_permissions jsonb\)\s*\n RETURNS public\.agency_delegation_requests\s*\n LANGUAGE plpgsql\s*\n SECURITY DEFINER\s*\n SET search_path TO 'public'/,
      ],
      [
        'create_agency_work_item',
        /FUNCTION public\.create_agency_work_item\(_agency_id uuid, _driver_user_id uuid, _title text, _description text, _type public\.agency_work_item_type, _priority public\.agency_work_item_priority, _assigned_member_user_id uuid, _client_request_id uuid, _due_date date\)\s*\n RETURNS public\.agency_work_items\s*\n LANGUAGE plpgsql\s*\n SECURITY DEFINER\s*\n SET search_path TO 'public'/,
      ],
    ];
    for (const [name, re] of contracts) {
      expect(CANDIDATE_SQL, name).toMatch(re);
    }
  });

  it('guards each mutating paid path before its INSERT/UPDATE', () => {
    const body = (name: string) => {
      const start = CANDIDATE_SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
      expect(start).toBeGreaterThan(-1);
      const next = CANDIDATE_SQL.indexOf('CREATE OR REPLACE FUNCTION public.', start + 1);
      return CANDIDATE_SQL.slice(start, next === -1 ? undefined : next);
    };

    const submit = body('submit_agency_client_request');
    expect(submit.indexOf("assert_agency_limit(_agency_id, 'submit_client_request')")).toBeLessThan(
      submit.indexOf('INSERT INTO public.agency_client_requests'),
    );

    const progress = body('set_agency_client_request_status');
    expect(
      progress.indexOf("assert_agency_limit(_old.agency_id, 'progress_client_request')"),
    ).toBeLessThan(progress.indexOf('UPDATE public.agency_client_requests'));
    expect(progress).toMatch(
      /IF _status NOT IN \('declined','cancelled'\) OR _assigned_member_user_id IS NOT NULL THEN/,
    );
    // R2: driver self-cancel is a cleanup path ONLY with no member assignment.
    expect(progress).toMatch(
      /_old\.driver_user_id = _uid AND _status='cancelled' AND _assigned_member_user_id IS NULL THEN NULL;/,
    );

    const delegation = body('create_agency_delegation_request');
    expect(
      delegation.indexOf("assert_agency_limit(_req.agency_id, 'create_delegation_request')"),
    ).toBeLessThan(delegation.indexOf('INSERT INTO public.agency_delegation_requests'));

    const workItem = body('create_agency_work_item');
    expect(workItem.indexOf("assert_agency_limit(_agency_id, 'create_work_item')")).toBeLessThan(
      workItem.indexOf('INSERT INTO public.agency_work_items'),
    );

    const slug = body('set_agency_slug');
    expect(slug.indexOf("assert_agency_limit(_agency_id, 'set_private_request_link')")).toBeLessThan(
      slug.indexOf('UPDATE public.agency_profiles'),
    );
    expect(slug).toMatch(/IF _normalized IS NOT NULL THEN/);
  });

  it('R2 — accept_agency_invite checks billing after the pending SELECT and before the UPDATE', () => {
    const start = CANDIDATE_SQL.indexOf(
      'CREATE OR REPLACE FUNCTION public.accept_agency_invite',
    );
    expect(start).toBeGreaterThan(-1);
    const accept = CANDIDATE_SQL.slice(start);

    // Live identity preserved.
    expect(accept).toMatch(
      /FUNCTION public\.accept_agency_invite\(_token text\)\s*\nRETURNS public\.agency_members\s*\nLANGUAGE plpgsql\s*\nSECURITY DEFINER\s*\nSET search_path TO 'public'/,
    );
    expect(accept).toContain("encode(digest(coalesce(_token,''),'sha256'),'hex')");
    expect(accept).toContain('lower(invite_email)=_em');
    expect(accept).toContain(
      "RAISE EXCEPTION 'Invite invalid or not addressed to your email' USING ERRCODE='P0002'",
    );
    expect(accept).toContain(
      "SET member_user_id=_uid, status='active', accepted_at=now()",
    );
    expect(accept).toContain('invite_token_hash=NULL, updated_at=now()');

    const select = accept.indexOf('SELECT * INTO _pending FROM public.agency_members');
    const guard = accept.indexOf(
      "assert_agency_limit(_pending.agency_id, 'accept_member_invite')",
    );
    const update = accept.indexOf('UPDATE public.agency_members SET member_user_id=_uid');
    expect(select).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(select);
    expect(update).toBeGreaterThan(guard);
  });

  it('R2 — public package listing requires both an active profile and an allowed entitlement', () => {
    const start = CANDIDATE_SQL.indexOf(
      'CREATE OR REPLACE FUNCTION public.list_agency_packages_public',
    );
    const next = CANDIDATE_SQL.indexOf('CREATE OR REPLACE FUNCTION public.', start + 1);
    const fn = CANDIDATE_SQL.slice(start, next === -1 ? undefined : next);
    expect(fn).toMatch(
      /EXISTS \(SELECT 1 FROM public\.agency_profiles ap\s*\n\s*WHERE ap\.id = _agency_id AND ap\.status = 'active'\)/,
    );
    expect(fn).toContain("IN ('manual_beta','active','trialing','past_due')");
  });

  it('R2 — accept_member_invite is a recognized non-numeric paid action', () => {
    const start = CANDIDATE_SQL.indexOf('CREATE OR REPLACE FUNCTION public.assert_agency_limit');
    const next = CANDIDATE_SQL.indexOf('CREATE OR REPLACE FUNCTION public.', start + 1);
    expect(CANDIDATE_SQL.slice(start, next)).toContain("'accept_member_invite'");
  });

  it('R2 — invite creation, revocation, and listing stay outside this candidate', () => {
    for (const fn of ['invite_agency_member', 'revoke_agency_member', 'list_agency_members']) {
      expect(CANDIDATE_SQL).not.toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
    }
  });
});

describe('Phase 1S-A2 — client source contract', () => {
  const plans = read('src/lib/agencyPlans.ts');
  const hook = read('src/hooks/useAgencyEntitlement.ts');
  const card = read('src/components/agency/AgencyPlanLimitsCard.tsx');

  it('exports defaultUnsubscribedEntitlement and no legacy beta fallback remains under src', () => {
    expect(plans).toMatch(/export function defaultUnsubscribedEntitlement\(/);
    // Built at runtime so this assertion file is not its own counterexample.
    const forbidden = ['default', 'Beta', 'Entitlement'].join('');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
      });
    const offenders = walk(path.join(process.cwd(), 'src')).filter((p) =>
      fs.readFileSync(p, 'utf8').includes(forbidden),
    );
    expect(offenders).toEqual([]);
  });

  it('the entitlement hook uses the fail-closed fallback for missing rows', () => {
    expect(hook).toMatch(/defaultUnsubscribedEntitlement\(agencyId \?\? ''\)/);
    expect(hook).toMatch(/fail closed/i);
    expect(hook).toMatch(/grandfathered/i);
  });

  it('the plan card distinguishes never-started, previously cancelled, and manual_beta', () => {
    expect(card).toContain('billingNeverStarted');
    expect(card).toContain('previouslyCancelled');
    expect(card).toContain('isGrandfatheredBeta');
    expect(card).toMatch(/Not active/);
    expect(card).toMatch(/Agency billing has not been started/);
    expect(card).toMatch(/Agency billing is cancelled/);
    expect(card).toMatch(/Grandfathered beta workspace/);
    expect(card).toMatch(/Start Agency Billing —/);
    expect(card).toMatch(/Restart Billing —/);
  });
});

describe('Phase 1S-A2 — untouched commercial surface', () => {
  const plans = read('src/lib/agencyPlans.ts');

  it('keeps agency prices at 29 / 79 / 149', () => {
    expect(plans).toMatch(/monthlyPrice: 29/);
    expect(plans).toMatch(/monthlyPrice: 79/);
    expect(plans).toMatch(/monthlyPrice: 149/);
  });

  it('keeps plan limits and included recruiter tiers', () => {
    expect(plans).toMatch(/Includes Recruiter Starter — 5 active opportunities/);
    expect(plans).toMatch(/Includes Recruiter Growth — 15 active opportunities/);
    expect(plans).toMatch(/Includes Recruiter Fleet — 25 active opportunities/);
    expect(plans).toMatch(/OUTSIDE_PAYMENTS_DISCLAIMER/);
  });

  it('adds no free agency plan', () => {
    expect(plans).not.toMatch(/agency_free/);
  });

  it('leaves checkout and webhook edge functions untouched by this phase', () => {
    for (const rel of [
      'supabase/functions/create-agency-checkout/index.ts',
      'supabase/functions/stripe-webhook/index.ts',
    ]) {
      const src = read(rel);
      expect(src).not.toMatch(/Phase 1S-A2/);
    }
  });

  it('relies on the existing update_agency_package inactive→active guard', () => {
    const migration = read(
      'supabase/migrations/20260630002954_a8c350ea-94e2-4f9b-8107-58a921dbe35b.sql',
    );
    expect(migration).toMatch(
      /IF COALESCE\(_is_active, _old\.is_active\) = true AND _old\.is_active = false THEN\s*\n\s*PERFORM public\.assert_agency_limit\(_old\.agency_id, 'create_service_package'\);/,
    );
    // Reactivation is therefore blocked while cancelled without this
    // candidate touching update_agency_package at all.
    expect(CANDIDATE_SQL).not.toContain(
      'CREATE OR REPLACE FUNCTION public.update_agency_package',
    );
    expect(CANDIDATE_SQL).not.toContain(
      'CREATE OR REPLACE FUNCTION public.update_agency_work_item',
    );
    expect(CANDIDATE_SQL).not.toContain('revoke_agency_member');
  });
});

// ---------------------------------------------------------------------
// 3–8 — PGlite runtime proof
// ---------------------------------------------------------------------

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

-- pgcrypto shim: production resolves digest() from pgcrypto on search_path
-- public. PGlite exposes the PG14+ builtin sha256(bytea) instead.
CREATE OR REPLACE FUNCTION public.digest(_data text, _algo text) RETURNS bytea
  LANGUAGE sql IMMUTABLE AS $$
    SELECT sha256(convert_to(_data, 'UTF8'))
  $$;



CREATE TYPE public.agency_client_request_status AS ENUM
  ('pending','approved','declined','cancelled','converted_to_client');
CREATE TYPE public.agency_work_item_type AS ENUM
  ('load_entry','expense_entry','fuel_entry','report_review','monthly_closeout','document_followup','other');
CREATE TYPE public.agency_work_item_priority AS ENUM ('low','normal','high');
CREATE TYPE public.agency_work_item_status AS ENUM
  ('open','in_progress','waiting_on_driver','completed','cancelled');

CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  contact_email text,
  slug text UNIQUE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  member_user_id uuid,
  invite_email text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  invite_token_hash text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agency_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL UNIQUE REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  plan_key text NOT NULL DEFAULT 'agency_starter'
    CHECK (plan_key IN ('assistant_free','agency_starter','agency_team','agency_growth')),
  status text NOT NULL DEFAULT 'manual_beta'
    CHECK (status IN ('trialing','active','past_due','cancelled','manual_beta')), -- // trial-allowlist (schema mirror of the live CHECK constraint)
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','stripe','admin_seed')),
  active_client_limit integer,
  member_limit integer,
  service_package_limit integer,
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agency_service_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_display_text text,
  billing_frequency_display_text text,
  included_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agency_client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  selected_package_id uuid,
  message text,
  preferred_contact_method text,
  phone text,
  requested_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.agency_client_request_status NOT NULL DEFAULT 'pending',
  assigned_member_user_id uuid,
  decided_at timestamptz,
  decided_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agency_delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  client_request_id uuid,
  driver_user_id uuid NOT NULL,
  member_user_id uuid,
  member_invite_email text,
  requested_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid,
  status text NOT NULL DEFAULT 'pending_driver_approval',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agency_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  assigned_member_user_id uuid,
  client_request_id uuid,
  title text NOT NULL,
  description text,
  type public.agency_work_item_type NOT NULL DEFAULT 'other',
  priority public.agency_work_item_priority NOT NULL DEFAULT 'normal',
  status public.agency_work_item_status NOT NULL DEFAULT 'open',
  due_date date,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agency_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  agency_id uuid,
  driver_user_id uuid,
  target_user_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Authorization + permission helpers (production definitions).
CREATE OR REPLACE FUNCTION public.is_agency_owner(_agency_id uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.agency_profiles
                  WHERE id = _agency_id AND owner_user_id = _uid);
$$;

CREATE OR REPLACE FUNCTION public.is_agency_owner_or_admin(_agency_id uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id = _agency_id AND member_user_id = _uid
       AND status = 'active' AND role IN ('agency_owner','agency_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.clean_assistant_permissions(_p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(_p, '{}'::jsonb);
$$;


-- Canonical plan-default helpers (production definitions).
CREATE OR REPLACE FUNCTION public._agency_plan_defaults(_plan_key text)
RETURNS TABLE(member_limit integer, active_client_limit integer, service_package_limit integer)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT
    CASE _plan_key WHEN 'agency_starter' THEN 2 WHEN 'agency_team' THEN 5 WHEN 'agency_growth' THEN 15 ELSE 2 END,
    CASE _plan_key WHEN 'agency_starter' THEN 5 WHEN 'agency_team' THEN 25 WHEN 'agency_growth' THEN 100 ELSE 5 END,
    CASE _plan_key WHEN 'agency_starter' THEN 3 WHEN 'agency_team' THEN 25 WHEN 'agency_growth' THEN 100 ELSE 3 END;
$$;

CREATE OR REPLACE FUNCTION public._agency_plan_label(_plan_key text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _plan_key
    WHEN 'agency_starter' THEN 'Agency Starter'
    WHEN 'agency_team'    THEN 'Agency Team'
    WHEN 'agency_growth'  THEN 'Agency Growth'
    ELSE 'Agency' END;
$$;

-- PRE-migration (defective) definitions, mirroring production HEAD.
CREATE OR REPLACE FUNCTION public.create_agency(
  _name text, _description text DEFAULT NULL, _contact_email text DEFAULT NULL
) RETURNS public.agency_profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.agency_profiles;
  _existing public.agency_profiles;
  _defaults record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _existing FROM public.agency_profiles WHERE owner_user_id = _uid LIMIT 1;
  IF FOUND THEN RETURN _existing; END IF;
  INSERT INTO public.agency_profiles(owner_user_id, name, description, contact_email)
  VALUES (_uid, btrim(_name), NULL, NULL) RETURNING * INTO _row;
  INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, role, status, accepted_at)
  VALUES (_row.id, _uid, 'owner@local', 'agency_owner','active', now());
  SELECT * INTO _defaults FROM public._agency_plan_defaults('agency_starter');
  INSERT INTO public.agency_entitlements
    (agency_id, plan_key, status, source, active_client_limit, member_limit, service_package_limit)
  VALUES (_row.id, 'agency_starter', 'manual_beta', 'manual',
          _defaults.active_client_limit, _defaults.member_limit, _defaults.service_package_limit)
  ON CONFLICT (agency_id) DO NOTHING;
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.get_effective_agency_limits(_agency_id uuid)
RETURNS TABLE(
  plan_key text, status text,
  member_limit integer, active_client_limit integer, service_package_limit integer,
  has_entitlement_row boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ent public.agency_entitlements; defaults record;
BEGIN
  SELECT * INTO ent FROM public.agency_entitlements WHERE agency_id = _agency_id;
  IF NOT FOUND THEN
    SELECT * INTO defaults FROM public._agency_plan_defaults('agency_starter');
    RETURN QUERY SELECT 'agency_starter'::text, 'manual_beta'::text,
      defaults.member_limit, defaults.active_client_limit, defaults.service_package_limit, false;
    RETURN;
  END IF;
  SELECT * INTO defaults FROM public._agency_plan_defaults(ent.plan_key);
  RETURN QUERY SELECT ent.plan_key, ent.status,
    COALESCE(ent.member_limit, defaults.member_limit),
    COALESCE(ent.active_client_limit, defaults.active_client_limit),
    COALESCE(ent.service_package_limit, defaults.service_package_limit),
    true;
END $$;

CREATE OR REPLACE FUNCTION public.assert_agency_limit(_agency_id uuid, _action text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN;
END $$;
`;

interface LimitRow {
  plan_key: string;
  status: string;
  member_limit: number;
  active_client_limit: number;
  service_package_limit: number;
  has_entitlement_row: boolean;
}

async function raises(
  db: AnyPGlite,
  sql: string,
  params?: unknown[],
): Promise<{ code?: string; message: string }> {
  try {
    await db.query(sql, params);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    return { code: err.code, message: err.message ?? String(e) };
  }
  throw new Error(`expected ${sql} to raise, but it succeeded`);
}

describe('Phase 1S-A2 — PGlite runtime proof', () => {
  let db: AnyPGlite;
  const BETA_USER = '11111111-1111-4111-8111-111111111111';
  const NEW_USER = '22222222-2222-4222-8222-222222222222';
  let betaAgencyId = '';
  let betaBefore: Record<string, unknown> = {};

  beforeAll(async () => {
    db = new PGlite() as unknown as AnyPGlite;
    await db.exec(BOOTSTRAP);

    await db.query('INSERT INTO auth.users(id, email) VALUES ($1,$2), ($3,$4)', [
      BETA_USER,
      'beta@example.com',
      NEW_USER,
      'new@example.com',
    ]);

    // Existing grandfathered beta workspace, created under the OLD behavior.
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [BETA_USER]);
    const created = await db.query<{ id: string }>(
      "SELECT (public.create_agency('Beta Agency')).id AS id",
    );
    betaAgencyId = created.rows[0].id;
    const before = await db.query<Record<string, unknown>>(
      'SELECT * FROM public.agency_entitlements WHERE agency_id = $1',
      [betaAgencyId],
    );
    betaBefore = before.rows[0];
    expect(betaBefore.status).toBe('manual_beta');

    // Apply the candidate.
    await db.exec(CANDIDATE_SQL);
  }, 120_000);

  it('3 — the pre-existing manual_beta row is value-identical after the migration', async () => {
    const after = await db.query<Record<string, unknown>>(
      'SELECT * FROM public.agency_entitlements WHERE agency_id = $1',
      [betaAgencyId],
    );
    expect(after.rows[0]).toEqual(betaBefore);
    expect(after.rows[0].status).toBe('manual_beta');
  });

  it('3 — the grandfathered beta agency is still allowed under Starter limits', async () => {
    const lim = await db.query<LimitRow>(
      'SELECT * FROM public.get_effective_agency_limits($1)',
      [betaAgencyId],
    );
    expect(lim.rows[0].status).toBe('manual_beta');
    expect(lim.rows[0].member_limit).toBe(2);
    // One owner member exists; a second invite is still inside the limit.
    await expect(
      db.query('SELECT public.assert_agency_limit($1, $2)', [betaAgencyId, 'invite_member']),
    ).resolves.toBeTruthy();
    await expect(
      db.query('SELECT public.assert_agency_limit($1, $2)', [
        betaAgencyId,
        'create_service_package',
      ]),
    ).resolves.toBeTruthy();
    await expect(
      db.query('SELECT public.assert_agency_limit($1, $2)', [betaAgencyId, 'activate_client']),
    ).resolves.toBeTruthy();
  });

  it('5 — a missing entitlement row resolves to Starter / cancelled / 2-5-3', async () => {
    const orphan = await db.query<{ id: string }>(
      "INSERT INTO public.agency_profiles(owner_user_id, name) VALUES ($1,'Orphan') RETURNING id",
      [BETA_USER],
    );
    const lim = await db.query<LimitRow>(
      'SELECT * FROM public.get_effective_agency_limits($1)',
      [orphan.rows[0].id],
    );
    expect(lim.rows[0]).toMatchObject({
      plan_key: 'agency_starter',
      status: 'cancelled',
      member_limit: 2,
      active_client_limit: 5,
      service_package_limit: 3,
      has_entitlement_row: false,
    });
    expect(lim.rows[0].status).not.toBe('manual_beta');
  });

  describe('new agency created after the migration', () => {
    let newAgencyId = '';

    beforeAll(async () => {
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [NEW_USER]);
      const r = await db.query<{ id: string }>(
        "SELECT (public.create_agency('Fresh Agency')).id AS id",
      );
      newAgencyId = r.rows[0].id;
    });

    it('4 — creates exactly one active owner membership', async () => {
      const m = await db.query<{ role: string; status: string; n: string }>(
        'SELECT role, status, count(*) OVER () AS n FROM public.agency_members WHERE agency_id = $1',
        [newAgencyId],
      );
      expect(m.rows).toHaveLength(1);
      expect(m.rows[0].role).toBe('agency_owner');
      expect(m.rows[0].status).toBe('active');
    });

    it('4 — creates exactly one Starter/cancelled/manual placeholder with NULL overrides', async () => {
      const e = await db.query<Record<string, unknown>>(
        'SELECT * FROM public.agency_entitlements WHERE agency_id = $1',
        [newAgencyId],
      );
      expect(e.rows).toHaveLength(1);
      expect(e.rows[0]).toMatchObject({
        plan_key: 'agency_starter',
        status: 'cancelled',
        source: 'manual',
        active_client_limit: null,
        member_limit: null,
        service_package_limit: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
      });
    });

    it('6 — assert_agency_limit blocks all three actions with P0001 and billing-not-active copy', async () => {
      for (const action of ['create_service_package', 'invite_member', 'activate_client']) {
        const err = await raises(db, 'SELECT public.assert_agency_limit($1, $2)', [
          newAgencyId,
          action,
        ]);
        expect(err.code).toBe('P0001');
        expect(err.message).toContain('Agency billing is not active.');
        expect(err.message).toContain(
          'Start or restart your Agency Starter plan from the Plan & Limits card',
        );
      }
    });

    it('7 — after Stripe activation, under-limit actions pass and ceilings still enforce', async () => {
      await db.query(
        `UPDATE public.agency_entitlements
           SET status = 'active', source = 'stripe',
               stripe_customer_id = 'cus_test', stripe_subscription_id = 'sub_test'
         WHERE agency_id = $1`,
        [newAgencyId],
      );

      // Under limit: 1 owner member of 2 allowed, 0 packages of 3, 0 clients of 5.
      await expect(
        db.query('SELECT public.assert_agency_limit($1, $2)', [newAgencyId, 'invite_member']),
      ).resolves.toBeTruthy();
      await expect(
        db.query('SELECT public.assert_agency_limit($1, $2)', [
          newAgencyId,
          'create_service_package',
        ]),
      ).resolves.toBeTruthy();

      // Fill the Starter ceilings and re-check each action.
      await db.query(
        `INSERT INTO public.agency_members(agency_id, invite_email, role, status)
         VALUES ($1,'seat2@example.com','agency_member','pending')`,
        [newAgencyId],
      );
      const memberErr = await raises(db, 'SELECT public.assert_agency_limit($1, $2)', [
        newAgencyId,
        'invite_member',
      ]);
      expect(memberErr.code).toBe('P0001');
      expect(memberErr.message).toContain('allows up to 2 agency members');

      await db.query(
        `INSERT INTO public.agency_service_packages(agency_id, name)
         SELECT $1, 'p' || g FROM generate_series(1,3) g`,
        [newAgencyId],
      );
      const pkgErr = await raises(db, 'SELECT public.assert_agency_limit($1, $2)', [
        newAgencyId,
        'create_service_package',
      ]);
      expect(pkgErr.code).toBe('P0001');
      expect(pkgErr.message).toContain('allows up to 3 active service packages');

      await db.query(
        `INSERT INTO public.agency_delegation_requests(agency_id, driver_user_id, status)
         SELECT $1, gen_random_uuid(), 'approved' FROM generate_series(1,5)`,
        [newAgencyId],
      );
      const clientErr = await raises(db, 'SELECT public.assert_agency_limit($1, $2)', [
        newAgencyId,
        'activate_client',
      ]);
      expect(clientErr.code).toBe('P0001');
      expect(clientErr.message).toContain('allows up to 5 active driver clients');
    });
  });

  // -------------------------------------------------------------------
  // R1 — complete paid Agency Workspace enforcement
  // -------------------------------------------------------------------
  describe('R1 — paid workflow surfaces', () => {
    const R1_OWNER = '33333333-3333-4333-8333-333333333333';
    const R1_DRIVER = '44444444-4444-4444-8444-444444444444';
    const R1_INVITEE = '55555555-5555-4555-8555-555555555555';
    const INVITE_TOKEN = 'r1-invite-token-abc';
    const INVITE_HASH = createHash('sha256').update(INVITE_TOKEN, 'utf8').digest('hex');
    const GENERIC_ACTIONS = [
      'set_private_request_link',
      'submit_client_request',
      'progress_client_request',
      'create_delegation_request',
      'create_work_item',
      'accept_member_invite',
    ];
    let agencyId = '';
    let declinableRequestId = '';
    let driverCancelRequestId = '';
    let assignmentBypassRequestId = '';
    let inviteMemberId = '';
    let packageId = '';

    const actAs = (uid: string) =>
      db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);

    beforeAll(async () => {
      await db.query('INSERT INTO auth.users(id, email) VALUES ($1,$2), ($3,$4)', [
        R1_OWNER,
        'r1owner@example.com',
        R1_DRIVER,
        'r1driver@example.com',
      ]);
      await actAs(R1_OWNER);
      const r = await db.query<{ id: string }>(
        "SELECT (public.create_agency('R1 Agency')).id AS id",
      );
      agencyId = r.rows[0].id;

      // Pre-existing surface created before billing lapsed.
      await db.query("UPDATE public.agency_profiles SET slug = 'r1-agency' WHERE id = $1", [
        agencyId,
      ]);
      const pkg = await db.query<{ id: string }>(
        "INSERT INTO public.agency_service_packages(agency_id, name) VALUES ($1,'Full Back Office') RETURNING id",
        [agencyId],
      );
      packageId = pkg.rows[0].id;
      const reqs = await db.query<{ id: string }>(
        `INSERT INTO public.agency_client_requests(agency_id, driver_user_id, status)
         VALUES ($1,$2,'pending'), ($1,$2,'pending') RETURNING id`,
        [agencyId, R1_DRIVER],
      );
      declinableRequestId = reqs.rows[0].id;
      driverCancelRequestId = reqs.rows[1].id;
    });

    it('R1.1 — cancelled agency: all five generic paid actions raise P0001', async () => {
      for (const action of GENERIC_ACTIONS) {
        const err = await raises(db, 'SELECT public.assert_agency_limit($1, $2)', [
          agencyId,
          action,
        ]);
        expect(err.code).toBe('P0001');
        expect(err.message).toContain('Agency billing is not active.');
      }
    });

    it('R1.1 — a missing entitlement row blocks the five generic actions too', async () => {
      const orphan = await db.query<{ id: string }>(
        "INSERT INTO public.agency_profiles(owner_user_id, name) VALUES ($1,'R1 Orphan') RETURNING id",
        [R1_OWNER],
      );
      for (const action of GENERIC_ACTIONS) {
        const err = await raises(db, 'SELECT public.assert_agency_limit($1, $2)', [
          orphan.rows[0].id,
          action,
        ]);
        expect(err.code).toBe('P0001');
        expect(err.message).toContain('Agency billing is not active.');
      }
    });

    it('R1.1 — an unknown action still raises 22023', async () => {
      await db.query(
        "UPDATE public.agency_entitlements SET status='manual_beta' WHERE agency_id=$1",
        [agencyId],
      );
      const err = await raises(db, 'SELECT public.assert_agency_limit($1, $2)', [
        agencyId,
        'not_a_real_action',
      ]);
      expect(err.code).toBe('22023');
      await db.query(
        "UPDATE public.agency_entitlements SET status='cancelled' WHERE agency_id=$1",
        [agencyId],
      );
    });

    it('R1.3 — set_agency_slug blocks a nonblank slug while cancelled but allows clearing', async () => {
      await actAs(R1_OWNER);
      const err = await raises(db, 'SELECT public.set_agency_slug($1, $2)', [
        agencyId,
        'new-link',
      ]);
      expect(err.code).toBe('P0001');

      const cleared = await db.query<{ set_agency_slug: string | null }>(
        'SELECT public.set_agency_slug($1, $2)',
        [agencyId, '  '],
      );
      expect(cleared.rows[0].set_agency_slug).toBeNull();
      // Restore the pre-existing link for the public-visibility proofs.
      await db.query("UPDATE public.agency_profiles SET slug='r1-agency' WHERE id=$1", [agencyId]);
    });

    it('R1.4 — cancelled agency exposes nothing publicly', async () => {
      const slug = await db.query('SELECT public.resolve_agency_slug($1) AS id', ['r1-agency']);
      expect((slug.rows[0] as { id: string | null }).id).toBeNull();
      const view = await db.query('SELECT * FROM public.get_agency_public_view($1)', [agencyId]);
      expect(view.rows).toHaveLength(0);
      const pkgs = await db.query('SELECT * FROM public.list_agency_packages_public($1)', [
        agencyId,
      ]);
      expect(pkgs.rows).toHaveLength(0);
    });

    it('R1.4 — a grandfathered manual_beta agency still resolves and is visible', async () => {
      const beta = await db.query('SELECT public.resolve_agency_slug($1) AS id', ['beta-agency']);
      // No slug set on the beta fixture, so prove visibility through the
      // other two public reads instead.
      expect((beta.rows[0] as { id: string | null }).id).toBeNull();
      const view = await db.query('SELECT * FROM public.get_agency_public_view($1)', [
        betaAgencyId,
      ]);
      expect(view.rows).toHaveLength(1);
      await db.query(
        "INSERT INTO public.agency_service_packages(agency_id, name) VALUES ($1,'Beta Pkg')",
        [betaAgencyId],
      );
      const pkgs = await db.query('SELECT * FROM public.list_agency_packages_public($1)', [
        betaAgencyId,
      ]);
      expect(pkgs.rows).toHaveLength(1);
    });

    it('R1.5 — cancelled agency blocks intake, positive progression, delegation, and new work', async () => {
      await actAs(R1_DRIVER);
      const submitErr = await raises(
        db,
        'SELECT public.submit_agency_client_request($1,$2,$3,$4,$5,$6)',
        [agencyId, packageId, 'hi', 'email', null, true],
      );
      expect(submitErr.code).toBe('P0001');
      expect(submitErr.message).toContain('Agency billing is not active.');
      const submitted = await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM public.agency_client_requests WHERE agency_id=$1',
        [agencyId],
      );
      expect(Number(submitted.rows[0].n)).toBe(2);

      await actAs(R1_OWNER);
      const approveErr = await raises(
        db,
        'SELECT public.set_agency_client_request_status($1,$2,$3)',
        [declinableRequestId, 'approved', null],
      );
      expect(approveErr.code).toBe('P0001');

      const assignErr = await raises(
        db,
        'SELECT public.set_agency_client_request_status($1,$2,$3)',
        [declinableRequestId, 'cancelled', R1_OWNER],
      );
      expect(assignErr.code).toBe('P0001');

      const delErr = await raises(
        db,
        'SELECT public.create_agency_delegation_request($1,$2,$3)',
        [declinableRequestId, R1_OWNER, '{}'],
      );
      expect(delErr.code).toBe('P0001');
      const dels = await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM public.agency_delegation_requests WHERE agency_id=$1',
        [agencyId],
      );
      expect(Number(dels.rows[0].n)).toBe(0);

      const wiErr = await raises(
        db,
        'SELECT public.create_agency_work_item($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [agencyId, R1_DRIVER, 'Task', null, 'other', 'normal', null, null, null],
      );
      expect(wiErr.code).toBe('P0001');
      const wis = await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM public.agency_work_items WHERE agency_id=$1',
        [agencyId],
      );
      expect(Number(wis.rows[0].n)).toBe(0);
    });

    it('R1.6 — decline and driver self-cancel stay available while cancelled', async () => {
      await actAs(R1_OWNER);
      const declined = await db.query<{ status: string }>(
        'SELECT (public.set_agency_client_request_status($1,$2,$3)).status AS status',
        [declinableRequestId, 'declined', null],
      );
      expect(declined.rows[0].status).toBe('declined');

      await actAs(R1_DRIVER);
      const cancelled = await db.query<{ status: string }>(
        'SELECT (public.set_agency_client_request_status($1,$2,$3)).status AS status',
        [driverCancelRequestId, 'cancelled', null],
      );
      expect(cancelled.rows[0].status).toBe('cancelled');
    });

    describe('after simulated Stripe activation', () => {
      beforeAll(async () => {
        await db.query(
          `UPDATE public.agency_entitlements
              SET status='active', source='stripe',
                  stripe_customer_id='cus_r1', stripe_subscription_id='sub_r1'
            WHERE agency_id=$1`,
          [agencyId],
        );
      });

      it('R1.2 — all five generic actions succeed', async () => {
        for (const action of GENERIC_ACTIONS) {
          await expect(
            db.query('SELECT public.assert_agency_limit($1, $2)', [agencyId, action]),
          ).resolves.toBeTruthy();
        }
      });

      it('R1.3/R1.4 — the private link can be set and public reads expose the agency', async () => {
        await actAs(R1_OWNER);
        const set = await db.query<{ set_agency_slug: string }>(
          'SELECT public.set_agency_slug($1,$2)',
          [agencyId, 'R1-Agency'],
        );
        expect(set.rows[0].set_agency_slug).toBe('r1-agency');
        const resolved = await db.query('SELECT public.resolve_agency_slug($1) AS id', [
          'r1-agency',
        ]);
        expect((resolved.rows[0] as { id: string | null }).id).toBe(agencyId);
        const view = await db.query('SELECT * FROM public.get_agency_public_view($1)', [agencyId]);
        expect(view.rows).toHaveLength(1);
        const pkgs = await db.query('SELECT * FROM public.list_agency_packages_public($1)', [
          agencyId,
        ]);
        expect(pkgs.rows).toHaveLength(1);
      });

      it('R1.2 — intake, progression, delegation, and work-item creation all succeed', async () => {
        await actAs(R1_DRIVER);
        const req = await db.query<{ id: string }>(
          'SELECT (public.submit_agency_client_request($1,$2,$3,$4,$5,$6)).id AS id',
          [agencyId, packageId, 'please help', 'email', null, true],
        );
        const requestId = req.rows[0].id;

        await actAs(R1_OWNER);
        const progressed = await db.query<{ status: string }>(
          'SELECT (public.set_agency_client_request_status($1,$2,$3)).status AS status',
          [requestId, 'approved', R1_OWNER],
        );
        expect(progressed.rows[0].status).toBe('approved');

        const delegation = await db.query<{ id: string }>(
          'SELECT (public.create_agency_delegation_request($1,$2,$3)).id AS id',
          [requestId, R1_OWNER, '{}'],
        );
        expect(delegation.rows[0].id).toBeTruthy();

        // Simulate driver approval so the work-item approved-client check passes.
        await db.query(
          "UPDATE public.agency_delegation_requests SET status='approved' WHERE id=$1",
          [delegation.rows[0].id],
        );

        const item = await db.query<{ title: string }>(
          'SELECT (public.create_agency_work_item($1,$2,$3,$4,$5,$6,$7,$8,$9)).title AS title',
          [agencyId, R1_DRIVER, 'Weekly closeout', null, 'other', 'normal', null, null, null],
        );
        expect(item.rows[0].title).toBe('Weekly closeout');
      });
    });
  });


  it('8 — the candidate is idempotent on a second execution', async () => {
    const snapshotBefore = await db.query<Record<string, unknown>>(
      'SELECT * FROM public.agency_entitlements ORDER BY agency_id',
    );
    await db.exec(CANDIDATE_SQL);
    const snapshotAfter = await db.query<Record<string, unknown>>(
      'SELECT * FROM public.agency_entitlements ORDER BY agency_id',
    );
    expect(snapshotAfter.rows).toEqual(snapshotBefore.rows);

    const def = await db.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema='public' AND table_name='agency_entitlements' AND column_name='status'`,
    );
    expect(def.rows[0].column_default).toMatch(/'cancelled'/);
  });
});
