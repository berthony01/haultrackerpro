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

describe('Phase 1S-A2 — candidate scope is exactly one default + three functions', () => {
  const statementText = CANDIDATE_SQL
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

  it('changes only the agency_entitlements.status default', () => {
    const alters = statementText.match(/ALTER TABLE[\s\S]*?;/gi) ?? [];
    expect(alters).toHaveLength(1);
    expect(alters[0].replace(/\s+/g, ' ').trim()).toBe(
      "ALTER TABLE public.agency_entitlements ALTER COLUMN status SET DEFAULT 'cancelled'::text;",
    );
  });

  it('replaces exactly the three named functions', () => {
    const fns = (statementText.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) ?? []).map(
      (m) => m.replace('CREATE OR REPLACE FUNCTION public.', ''),
    );
    expect(fns.sort()).toEqual([
      'assert_agency_limit',
      'create_agency',
      'get_effective_agency_limits',
    ]);
  });

  it('contains no data mutation, schema growth, policy, index, trigger, or grant change', () => {
    for (const forbidden of [
      /\bUPDATE\s+public\./i,
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
      expect(statementText).not.toMatch(forbidden);
    }
  });

  it('never rewrites an existing entitlement row', () => {
    expect(statementText).toMatch(/ON CONFLICT \(agency_id\) DO NOTHING/);
    expect(statementText).not.toMatch(/DO UPDATE/i);
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

CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  contact_email text,
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
  revoked_at timestamptz
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
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.agency_delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  status text NOT NULL
);

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
