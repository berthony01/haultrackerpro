// @vitest-environment node
// =====================================================================
// Phase 1J-D2B-2 — Recruiter contract-workflow RLS (PGlite catalog contract)
//
// Applies the D2B-1 helper candidate, then the D2B-2 ALTER POLICY
// candidate, on top of a minimal Supabase-compatible bootstrap plus the
// four canonical target recruiter policies and four canonical non-target
// sentinel policies. Proves candidate source guards, D2B-1 dependency
// contract, and pg_catalog preservation/tightening. Runtime allow/deny
// enforcement under distinct roles is reserved for the real PostgreSQL
// gate in Step 3.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

const D2B1_REL =
  '../../supabase/migration-candidates/20260720203000_phase1j_d2b1_recruiter_paid_entitlement_resolver.sql';
const D2B2_REL =
  '../../supabase/migration-candidates/20260720214500_phase1j_d2b2_recruiter_contract_workflow_rls.sql';

const read = (rel: string) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const D2B1_SRC = read(D2B1_REL);
const D2B2_SRC = read(D2B2_REL);

const TARGET_POLICY_NAMES = [
  'Recruiter inserts contracts on own applications',
  'Recruiter updates own contracts',
  'Recruiter inserts versions on own contracts',
  'Recruiter inserts own review',
] as const;

const SENTINEL_POLICY_NAMES = [
  'Driver updates review status on own contracts',
  'Admins update all contracts',
  'Parties view contract versions',
  'Driver inserts own review',
] as const;

const ALL_POLICY_NAMES = [...TARGET_POLICY_NAMES, ...SENTINEL_POLICY_NAMES];

const RLS_TABLES = ['contracts', 'contract_versions', 'contract_reviews'] as const;

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE
);

CREATE TABLE public.recruiter_billing_profiles (
  recruiter_id uuid NOT NULL,
  user_id uuid NOT NULL,
  plan text NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.opportunity_applications (
  id uuid PRIMARY KEY,
  recruiter_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  driver_user_id uuid NOT NULL
);

CREATE TABLE public.contracts (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  recruiter_id uuid NOT NULL,
  recruiter_user_id uuid NOT NULL,
  driver_user_id uuid NOT NULL
);

CREATE TABLE public.contract_versions (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL,
  uploaded_by uuid NOT NULL
);

CREATE TABLE public.contract_reviews (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL,
  reviewer_role text NOT NULL
);

CREATE OR REPLACE FUNCTION public.is_recruiter_owner(_user_id uuid, _recruiter_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recruiter_profiles r
    WHERE r.id = _recruiter_id AND r.user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT false; $$;

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_reviews ENABLE ROW LEVEL SECURITY;

-- Target policies (canonical pre-D2B-2 definitions)
CREATE POLICY "Recruiter inserts contracts on own applications"
  ON public.contracts FOR INSERT TO authenticated
  WITH CHECK (
    public.is_recruiter_owner(auth.uid(), recruiter_id)
    AND auth.uid() = recruiter_user_id
    AND EXISTS (
      SELECT 1 FROM public.opportunity_applications oa
      WHERE oa.id = application_id
        AND oa.recruiter_id = contracts.recruiter_id
        AND oa.opportunity_id = contracts.opportunity_id
        AND oa.driver_user_id = contracts.driver_user_id
    )
  );

CREATE POLICY "Recruiter updates own contracts"
  ON public.contracts FOR UPDATE TO authenticated
  USING (public.is_recruiter_owner(auth.uid(), recruiter_id))
  WITH CHECK (public.is_recruiter_owner(auth.uid(), recruiter_id));

CREATE POLICY "Recruiter inserts versions on own contracts"
  ON public.contract_versions FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_versions.contract_id
        AND public.is_recruiter_owner(auth.uid(), c.recruiter_id)
    )
  );

CREATE POLICY "Recruiter inserts own review"
  ON public.contract_reviews FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_user_id = auth.uid()
    AND reviewer_role = 'recruiter'
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_reviews.contract_id
        AND public.is_recruiter_owner(auth.uid(), c.recruiter_id)
    )
  );

-- Sentinel policies (canonical, unchanged by D2B-2)
CREATE POLICY "Driver updates review status on own contracts"
  ON public.contracts FOR UPDATE TO authenticated
  USING (auth.uid() = driver_user_id)
  WITH CHECK (auth.uid() = driver_user_id);

CREATE POLICY "Admins update all contracts"
  ON public.contracts FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Parties view contract versions"
  ON public.contract_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_versions.contract_id
        AND (
          c.driver_user_id = auth.uid()
          OR public.is_recruiter_owner(auth.uid(), c.recruiter_id)
          OR public.is_admin(auth.uid())
        )
    )
  );

CREATE POLICY "Driver inserts own review"
  ON public.contract_reviews FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_user_id = auth.uid()
    AND reviewer_role = 'driver'
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_reviews.contract_id
        AND c.driver_user_id = auth.uid()
    )
  );
`;

/** Normalize catalog expression text for stable substring checks. */
function norm(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/\s+/g, '');
}

interface PolicyRow {
  schemaname: string;
  tablename: string;
  policyname: string;
  permissive: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

interface CatalogSnapshot {
  publicTableCount: number;
  publicFunctionCount: number;
  userTriggerCount: number;
  policyCount: number;
  policies: Record<string, PolicyRow>;
}

async function snapshot(db: AnyPGlite): Promise<CatalogSnapshot> {
  const tables = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'",
  );
  const fns = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'",
  );
  const trigs = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal",
  );
  const polCount = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'",
  );
  const rows = await db.query<PolicyRow>(
    "SELECT schemaname, tablename, policyname, permissive, roles::text[] AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public'",
  );
  const policies: Record<string, PolicyRow> = {};
  for (const r of rows.rows) policies[r.policyname] = r;
  return {
    publicTableCount: tables.rows[0].n,
    publicFunctionCount: fns.rows[0].n,
    userTriggerCount: trigs.rows[0].n,
    policyCount: polCount.rows[0].n,
    policies,
  };
}

let db: AnyPGlite;
let beforeSnap: CatalogSnapshot;
let afterSnap: CatalogSnapshot;

beforeAll(async () => {
  db = (new PGlite() as unknown) as AnyPGlite;
  await db.exec(BOOTSTRAP);
  await db.exec(D2B1_SRC);
  beforeSnap = await snapshot(db);
  await db.exec(D2B2_SRC);
  afterSnap = await snapshot(db);
}, 60_000);

describe('Phase 1J-D2B-2 — candidate source guards', () => {
  it('contains exactly four ALTER POLICY statements', () => {
    const matches = D2B2_SRC.match(/\bALTER\s+POLICY\b/gi) ?? [];
    expect(matches.length).toBe(4);
  });

  it('names each of the four target policies exactly once and no fifth', () => {
    for (const name of TARGET_POLICY_NAMES) {
      const re = new RegExp(`ALTER\\s+POLICY\\s+"${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}"`, 'gi');
      expect((D2B2_SRC.match(re) ?? []).length).toBe(1);
    }
    // Count all quoted policy names appearing after ALTER POLICY
    const altered = [...D2B2_SRC.matchAll(/ALTER\s+POLICY\s+"([^"]+)"/gi)].map((m) => m[1]);
    expect(altered.length).toBe(4);
    expect(new Set(altered)).toEqual(new Set(TARGET_POLICY_NAMES));
  });

  it('maps exactly two target policies to contracts, one to contract_versions, one to contract_reviews', () => {
    const stmts = [...D2B2_SRC.matchAll(/ALTER\s+POLICY\s+"([^"]+)"\s+ON\s+(public\.[a-z_]+)/gi)];
    expect(stmts.length).toBe(4);
    const byTable: Record<string, string[]> = {};
    for (const [, name, tbl] of stmts) {
      (byTable[tbl] ||= []).push(name);
    }
    expect(byTable['public.contracts']?.sort()).toEqual(
      ['Recruiter inserts contracts on own applications', 'Recruiter updates own contracts'].sort(),
    );
    expect(byTable['public.contract_versions']).toEqual(['Recruiter inserts versions on own contracts']);
    expect(byTable['public.contract_reviews']).toEqual(['Recruiter inserts own review']);
  });

  it("uses public.current_user_has_recruiter_minimum_paid_plan('growth') exactly five times", () => {
    const re = /public\.current_user_has_recruiter_minimum_paid_plan\('growth'\)/g;
    expect((D2B2_SRC.match(re) ?? []).length).toBe(5);
  });

  it("does not call the minimum-plan helper with any argument other than 'growth'", () => {
    const calls = [
      ...D2B2_SRC.matchAll(
        /current_user_has_recruiter_minimum_paid_plan\(\s*([^)]*?)\s*\)/gi,
      ),
    ].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(0);
    for (const arg of calls) {
      expect(arg).toBe("'growth'");
    }
  });

  it('contains no CREATE POLICY or DROP POLICY', () => {
    expect(/\bCREATE\s+POLICY\b/i.test(D2B2_SRC)).toBe(false);
    expect(/\bDROP\s+POLICY\b/i.test(D2B2_SRC)).toBe(false);
  });

  it('contains no non-ALTER-POLICY DDL', () => {
    const forbidden = [
      /\bCREATE\s+TABLE\b/i,
      /\bALTER\s+TABLE\b/i,
      /\bDROP\s+TABLE\b/i,
      /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i,
      /\bDROP\s+FUNCTION\b/i,
      /\bCREATE\s+TRIGGER\b/i,
      /\bDROP\s+TRIGGER\b/i,
      /\bCREATE\s+VIEW\b/i,
      /\bCREATE\s+INDEX\b/i,
      /\bCREATE\s+TYPE\b/i,
      /\bCREATE\s+SCHEMA\b/i,
      /\bALTER\s+SCHEMA\b/i,
    ];
    for (const re of forbidden) expect(re.test(D2B2_SRC)).toBe(false);
  });

  it('contains no DML statements', () => {
    const forbidden = [
      /\bINSERT\s+INTO\b/i,
      /^\s*UPDATE\s+\w/im,
      /\bDELETE\s+FROM\b/i,
      /\bMERGE\b/i,
      /\bTRUNCATE\b/i,
      /\bCOPY\b/i,
    ];
    for (const re of forbidden) expect(re.test(D2B2_SRC)).toBe(false);
  });

  it('contains no GRANT, REVOKE, role, transaction, or backfill statements', () => {
    const forbidden = [
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /\bCREATE\s+ROLE\b/i,
      /\bALTER\s+ROLE\b/i,
      /\bDROP\s+ROLE\b/i,
      /\bBEGIN\s*;/i,
      /\bCOMMIT\s*;/i,
      /\bROLLBACK\s*;/i,
      /\bSAVEPOINT\b/i,
    ];
    for (const re of forbidden) expect(re.test(D2B2_SRC)).toBe(false);
  });

  it('does not alter any non-target policy name (driver/admin/select/signature/clause/audit)', () => {
    const altered = [...D2B2_SRC.matchAll(/ALTER\s+POLICY\s+"([^"]+)"/gi)].map((m) => m[1]);
    for (const nonTarget of SENTINEL_POLICY_NAMES) {
      expect(altered).not.toContain(nonTarget);
    }
    // extra defensive assertions against additional canonical non-target names
    for (const nonTarget of [
      'Admins delete contracts',
      'Admins update versions',
      'Admins delete versions',
      'Parties view clauses',
      'Admins manage clauses',
      'Parties view reviews',
      'Admins manage reviews',
    ]) {
      expect(altered).not.toContain(nonTarget);
    }
  });
});

describe('Phase 1J-D2B-2 — D2B-1 dependency contract', () => {
  it('D2B-1 defines exactly one current_user_has_recruiter_minimum_paid_plan(_minimum_plan text) with STABLE / SECURITY DEFINER / search_path=public', () => {
    const re =
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.current_user_has_recruiter_minimum_paid_plan\s*\(\s*_minimum_plan\s+text\s*\)([\s\S]*?)\$\$;/gi;
    const matches = [...D2B1_SRC.matchAll(re)];
    expect(matches.length).toBe(1);
    const body = matches[0][1];
    expect(/\bSTABLE\b/i.test(body)).toBe(true);
    expect(/\bSECURITY\s+DEFINER\b/i.test(body)).toBe(true);
    expect(/SET\s+search_path\s*=\s*public/i.test(body)).toBe(true);
  });

  it('D2B-1 revokes the caller-bound helper from PUBLIC and anon and grants EXECUTE to authenticated and service_role', () => {
    expect(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.current_user_has_recruiter_minimum_paid_plan\(text\)\s+FROM\s+PUBLIC,\s*anon\s*;/i.test(
        D2B1_SRC,
      ),
    ).toBe(true);
    expect(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.current_user_has_recruiter_minimum_paid_plan\(text\)\s+TO\s+authenticated,\s*service_role\s*;/i.test(
        D2B1_SRC,
      ),
    ).toBe(true);
  });

  it('PGlite applies D2B-1 then D2B-2 in that exact order', async () => {
    // Snapshots exist iff both applied cleanly in beforeAll.
    expect(beforeSnap.policyCount).toBe(8);
    expect(afterSnap.policyCount).toBe(8);
    const fn = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname='current_user_has_recruiter_minimum_paid_plan'",
    );
    expect(fn.rows[0].n).toBe(1);
  });
});

describe('Phase 1J-D2B-2 — policy catalog preservation and tightening', () => {
  it('policy count remains exactly eight before and after D2B-2', () => {
    expect(beforeSnap.policyCount).toBe(8);
    expect(afterSnap.policyCount).toBe(8);
    for (const name of ALL_POLICY_NAMES) {
      expect(beforeSnap.policies[name]).toBeDefined();
      expect(afterSnap.policies[name]).toBeDefined();
    }
  });

  it('all four target policies retain their original commands and role array of only "authenticated"', () => {
    const cmdByName: Record<string, string> = {
      'Recruiter inserts contracts on own applications': 'INSERT',
      'Recruiter updates own contracts': 'UPDATE',
      'Recruiter inserts versions on own contracts': 'INSERT',
      'Recruiter inserts own review': 'INSERT',
    };
    for (const name of TARGET_POLICY_NAMES) {
      const before = beforeSnap.policies[name];
      const after = afterSnap.policies[name];
      expect(after.cmd).toBe(cmdByName[name]);
      expect(after.cmd).toBe(before.cmd);
      expect(after.roles).toEqual(['authenticated']);
      expect(before.roles).toEqual(['authenticated']);
    }
  });

  it('Recruiter contract INSERT policy preserves ownership + identity + all four application linkage predicates and adds exactly one Growth call in WITH CHECK', () => {
    const p = afterSnap.policies['Recruiter inserts contracts on own applications'];
    const wc = norm(p.with_check);
    expect(wc).toContain(norm('is_recruiter_owner(auth.uid(),recruiter_id)'));
    expect(wc).toContain(norm('auth.uid()=recruiter_user_id'));
    expect(wc).toContain(norm('oa.id=contracts.application_id'));
    expect(wc).toContain(norm('oa.recruiter_id=contracts.recruiter_id'));
    expect(wc).toContain(norm('oa.opportunity_id=contracts.opportunity_id'));
    expect(wc).toContain(norm('oa.driver_user_id=contracts.driver_user_id'));
    const growth = wc.match(
      /current_user_has_recruiter_minimum_paid_plan\('growth'(::text)?\)/g,
    );
    expect(growth?.length).toBe(1);
    expect(p.qual).toBeNull();
  });

  it('Recruiter contract UPDATE policy preserves ownership and adds exactly one Growth call in USING and exactly one in WITH CHECK', () => {
    const p = afterSnap.policies['Recruiter updates own contracts'];
    const q = norm(p.qual);
    const wc = norm(p.with_check);
    expect(q).toContain(norm('is_recruiter_owner(auth.uid(),recruiter_id)'));
    expect(wc).toContain(norm('is_recruiter_owner(auth.uid(),recruiter_id)'));
    const growthQ = q.match(/current_user_has_recruiter_minimum_paid_plan\('growth'(::text)?\)/g);
    const growthW = wc.match(/current_user_has_recruiter_minimum_paid_plan\('growth'(::text)?\)/g);
    expect(growthQ?.length).toBe(1);
    expect(growthW?.length).toBe(1);
  });

  it('Contract-version INSERT policy preserves uploaded_by identity + ownership EXISTS and adds exactly one Growth call in WITH CHECK', () => {
    const p = afterSnap.policies['Recruiter inserts versions on own contracts'];
    const wc = norm(p.with_check);
    expect(wc).toContain(norm('uploaded_by=auth.uid()'));
    expect(wc).toContain(norm('c.id=contract_versions.contract_id'));
    expect(wc).toContain(norm('is_recruiter_owner(auth.uid(),c.recruiter_id)'));
    const growth = wc.match(/current_user_has_recruiter_minimum_paid_plan\('growth'(::text)?\)/g);
    expect(growth?.length).toBe(1);
    expect(p.qual).toBeNull();
  });

  it('Recruiter-review INSERT policy preserves reviewer identity + exact recruiter role + ownership EXISTS and adds exactly one Growth call in WITH CHECK', () => {
    const p = afterSnap.policies['Recruiter inserts own review'];
    const wc = norm(p.with_check);
    expect(wc).toContain(norm('reviewer_user_id=auth.uid()'));
    expect(wc).toContain(norm("reviewer_role='recruiter'"));
    expect(wc).toContain(norm('c.id=contract_reviews.contract_id'));
    expect(wc).toContain(norm('is_recruiter_owner(auth.uid(),c.recruiter_id)'));
    const growth = wc.match(/current_user_has_recruiter_minimum_paid_plan\('growth'\)/g);
    expect(growth?.length).toBe(1);
    expect(p.qual).toBeNull();
  });

  it('all four non-target sentinel policy rows are deep-equal before and after D2B-2', () => {
    for (const name of SENTINEL_POLICY_NAMES) {
      expect(afterSnap.policies[name]).toEqual(beforeSnap.policies[name]);
    }
  });

  it('RLS remains enabled on exactly the three fixture contract tables', async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity = true ORDER BY c.relname",
    );
    expect(rows.rows.map((r) => r.relname).sort()).toEqual([...RLS_TABLES].sort());
  });

  it('relative to post-D2B-1, D2B-2 changes zero table/function/user-trigger/policy counts', () => {
    expect(afterSnap.publicTableCount).toBe(beforeSnap.publicTableCount);
    expect(afterSnap.publicFunctionCount).toBe(beforeSnap.publicFunctionCount);
    expect(afterSnap.userTriggerCount).toBe(beforeSnap.userTriggerCount);
    expect(afterSnap.policyCount).toBe(beforeSnap.policyCount);
  });
});
