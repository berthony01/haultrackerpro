// @vitest-environment node
// =====================================================================
// Phase 1L-DE2A — Server publication validation candidate (PGlite runtime).
//
// Loads the Phase 1L-DE2A candidate migration directly from disk and
// runs it against an isolated schema-faithful PGlite instance that
// mirrors the shape of `public.opportunities`, the `is_admin`,
// `recruiter_profile_can_manage_opportunities`,
// `current_user_can_manage_recruiter_opportunities` helpers, and the
// canonical Phase 1K guard function loaded verbatim from
// `supabase/migrations/20260721000000_phase1k_admin_recruiter_opportunity_publication.sql`.
//
// The suite proves:
//   * Candidate source + catalog integrity, function/trigger properties,
//     and idempotency.
//   * Byte-identical preservation of the existing Phase 1K guard and its
//     trigger binding.
//   * Correct pass-through for non-active lifecycle states.
//   * Correct validation for every publication blocker mandated by the
//     Phase 1L contract, including exact message strings.
//   * Correct structured 23514 error (message + hint + DETAIL code +
//     sorted unique blocking_reasons array).
//   * Correct atomicity on failed INSERT and UPDATE.
//   * Preserved Phase 1K admin exceptions.
//   * Legacy pre-candidate active row scenarios: can be moved to draft,
//     cannot receive an ordinary active→active edit until it becomes
//     canonical_version=1 + complete.
// =====================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// ---------------------------------------------------------------------
// Source paths (repo-relative, resolved once).
// ---------------------------------------------------------------------
const CANDIDATE_REL =
  '../../supabase/migration-candidates/20260721183000_phase1l_de2_opportunity_publication_validation.sql';
const PHASE_1K_MIG_REL =
  '../../supabase/migrations/20260721000000_phase1k_admin_recruiter_opportunity_publication.sql';
const PHASE_1L_DE1_MIG_REL =
  '../../supabase/migrations/20260721143000_phase1l_de1_opportunity_authoring_contract.sql';

const read = (rel: string) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CANDIDATE_SQL = read(CANDIDATE_REL);
const PHASE_1K_SQL = read(PHASE_1K_MIG_REL);
const PHASE_1L_DE1_SQL = read(PHASE_1L_DE1_MIG_REL);

// ---------------------------------------------------------------------
// PGlite helper shim (types).
// ---------------------------------------------------------------------
interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close?(): Promise<void>;
}

// ---------------------------------------------------------------------
// Fixture SQL — schema-faithful reproduction of every column the
// candidate reads plus the Phase 1K helpers and trigger binding.
// ---------------------------------------------------------------------
const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

CREATE TABLE public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = _user_id);
$$;

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_name text NOT NULL DEFAULT '',
  recruiter_email text,
  company_name text NOT NULL DEFAULT '',
  dot_number text,
  mc_number text,
  verification_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'active',
  posting_terms_accepted_at timestamptz,
  posting_terms_version text,
  legacy_terms_grandfathered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(_recruiter_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
      AND COALESCE(btrim(rp.recruiter_name), '') <> ''
      AND COALESCE(btrim(rp.company_name),   '') <> ''
      AND COALESCE(btrim(rp.recruiter_email),'') <> ''
      AND (COALESCE(btrim(rp.dot_number),'') <> '' OR COALESCE(btrim(rp.mc_number),'') <> '')
      AND (rp.posting_terms_accepted_at IS NOT NULL OR rp.legacy_terms_grandfathered_at IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(_recruiter_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
      AND COALESCE(btrim(rp.recruiter_name), '') <> ''
      AND COALESCE(btrim(rp.company_name),   '') <> ''
      AND COALESCE(btrim(rp.recruiter_email),'') <> ''
      AND (COALESCE(btrim(rp.dot_number),'') <> '' OR COALESCE(btrim(rp.mc_number),'') <> '')
      AND (rp.posting_terms_accepted_at IS NOT NULL OR rp.legacy_terms_grandfathered_at IS NOT NULL)
  );
$$;

CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  description text,
  home_time text,
  hiring_city text,
  hiring_state text,
  hiring_states text[] NOT NULL DEFAULT ARRAY[]::text[],
  driver_type text,
  route_type text,
  trailer_type text,
  employment_model text,
  team_configuration text,
  canonical_version smallint,
  pay_model text,
  cpm numeric,
  percentage_pay numeric,
  percentage_basis_label text,
  percentage_weekly_revenue_basis numeric,
  flat_weekly_pay numeric,
  salary_amount numeric,
  salary_frequency text,
  mixed_pay_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  other_pay_method_label text,
  other_weekly_gross numeric,
  estimated_weekly_gross numeric,
  estimated_weekly_miles numeric,
  estimated_loaded_miles numeric,
  estimated_deadhead_miles numeric,
  deadhead_paid boolean,
  sign_on_bonus numeric,
  detention_pay text,
  layover_pay text,
  forced_dispatch boolean,
  pets_allowed boolean,
  riders_allowed boolean,
  equipment_year text,
  fuel_paid_by text,
  insurance_deductions numeric,
  insurance_deduction_frequency text,
  maintenance_deductions numeric,
  maintenance_deduction_frequency text,
  other_deductions numeric,
  other_deduction_frequency text,
  lease_payment numeric,
  lease_payment_frequency text,
  escrow_required boolean NOT NULL DEFAULT false,
  escrow_required_state text,
  escrow_amount numeric,
  escrow_amount_frequency text,
  typical_lanes text,
  requirements text,
  actual_benefits text,
  benefits text,
  transparency_confirmed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  admin_review_status text NOT NULL DEFAULT 'pending',
  featured boolean NOT NULL DEFAULT false,
  view_count integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

// Phase 1K trigger binding SQL — bound once, before candidate applies.
const PHASE_1K_TRIGGER_BINDING = `
DROP TRIGGER IF EXISTS trg_opportunities_guard ON public.opportunities;
CREATE TRIGGER trg_opportunities_guard
  BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.opportunities_guard();
`;

// ---------------------------------------------------------------------
// Fixture identities.
// ---------------------------------------------------------------------
const ADMIN_UID   = '11111111-1111-4111-8111-111111111111';
const ADMIN_RP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECR_UID    = '22222222-2222-4222-8222-222222222222';
const RECR_RP_ID  = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_UID   = '33333333-3333-4333-8333-333333333333';
const OTHER_RP_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// ---------------------------------------------------------------------
// Test harness state.
// ---------------------------------------------------------------------
let db: AnyPGlite;
let phase1kDefBefore: string;
let phase1kTriggerBefore: string;

/** Baselines captured immediately after the FIRST candidate application. */
const baselineFnDefs: Record<string, string> = {};
const baselineTriggerDefs: Record<string, string> = {};
const baselineTriggerCounts: Record<string, number> = {};
const baselinePublicLacks: Record<string, boolean> = {};
const baselineAnonLacks: Record<string, boolean> = {};
const baselineAuthLacks: Record<string, boolean> = {};

const NEW_FN_REGS = [
  'public._opportunity_numeric_is_finite(numeric)',
  'public._opportunity_jsonb_number(jsonb)',
  'public.opportunity_publication_blockers(public.opportunities)',
  'public.opportunities_canonical_publication_guard()',
] as const;
const ALL_FN_REGS = [...NEW_FN_REGS, 'public.opportunities_guard()'] as const;
const TRG_NAMES = [
  'trg_opportunities_guard',
  'trg_opportunities_canonical_publication_guard',
] as const;

const dbs: AnyPGlite[] = [];

async function makePGlite(): Promise<AnyPGlite> {
  const inst = new PGlite() as unknown as AnyPGlite;
  dbs.push(inst);
  return inst;
}

/**
 * Catalog-level check that PUBLIC (grantee OID 0) has no EXECUTE grant
 * for the given function regprocedure.  Uses aclexplode over the
 * effective ACL (proacl COALESCED with acldefault('f', proowner)).
 */
async function publicLacksExecute(inst: AnyPGlite, fnReg: string): Promise<boolean> {
  const r = await inst.query<{ v: boolean }>(
    `SELECT NOT EXISTS(
       SELECT 1
         FROM pg_proc p,
              aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = $1::regprocedure
          AND a.grantee = 0
          AND a.privilege_type = 'EXECUTE'
     ) AS v`,
    [fnReg],
  );
  return r.rows[0].v;
}
async function roleLacksExecute(inst: AnyPGlite, role: string, fnReg: string): Promise<boolean> {
  const r = await inst.query<{ v: boolean }>(
    `SELECT NOT has_function_privilege($1, $2, 'EXECUTE') AS v`,
    [role, fnReg],
  );
  return r.rows[0].v;
}

async function setUid(inst: AnyPGlite, uid: string | null) {
  await inst.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
}

async function seedIdentities(inst: AnyPGlite) {
  await inst.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2),($3,$4),($5,$6)`, [
    ADMIN_UID, 'admin@t.test',
    RECR_UID,  'recr@t.test',
    OTHER_UID, 'other@t.test',
  ]);
  await inst.query(
    `INSERT INTO public.admin_users(user_id,email,role) VALUES ($1,$2,'admin')`,
    [ADMIN_UID, 'admin@t.test'],
  );
  // Admin-owned eligible recruiter profile.
  await inst.query(
    `INSERT INTO public.recruiter_profiles(
       id,user_id,recruiter_name,recruiter_email,company_name,dot_number,
       verification_status,status,posting_terms_accepted_at,posting_terms_version
     ) VALUES ($1,$2,'Admin Rec','admin@t.test','Admin Co','DOT1','approved','active',now(),'v1')`,
    [ADMIN_RP_ID, ADMIN_UID],
  );
  // Ordinary eligible recruiter.
  await inst.query(
    `INSERT INTO public.recruiter_profiles(
       id,user_id,recruiter_name,recruiter_email,company_name,dot_number,
       verification_status,status,posting_terms_accepted_at,posting_terms_version
     ) VALUES ($1,$2,'Ord Rec','recr@t.test','Ord Co','DOT2','approved','active',now(),'v1')`,
    [RECR_RP_ID, RECR_UID],
  );
  // Second ordinary recruiter (a different owner).
  await inst.query(
    `INSERT INTO public.recruiter_profiles(
       id,user_id,recruiter_name,recruiter_email,company_name,dot_number,
       verification_status,status,posting_terms_accepted_at,posting_terms_version
     ) VALUES ($1,$2,'Other Rec','other@t.test','Other Co','DOT3','approved','active',now(),'v1')`,
    [OTHER_RP_ID, OTHER_UID],
  );
}

/**
 * Build a fully-canonical, publishable opportunity payload with
 * user-supplied overrides.  Every mandatory publication field is set to
 * a valid value by default; overrides let each test isolate a single
 * blocker or scenario.
 */
type Row = Record<string, unknown>;
function publishableRow(overrides: Row = {}): Row {
  return {
    recruiter_id: RECR_RP_ID,
    title: 'Regional CDL-A OTR Driver',
    company_name: 'Ord Co',
    description: 'Long haul dry van.',
    home_time: 'Weekly',
    hiring_city: 'Dallas',
    hiring_state: 'TX',
    hiring_states: [] as string[],
    route_type: 'OTR',
    trailer_type: 'Dry Van',
    employment_model: 'company_driver',
    team_configuration: 'solo',
    canonical_version: 1,
    pay_model: 'flat_weekly',
    flat_weekly_pay: 1500,
    estimated_weekly_gross: null,
    estimated_weekly_miles: 2500,
    estimated_loaded_miles: 2200,
    estimated_deadhead_miles: 300,
    deadhead_paid: true,
    mixed_pay_components: '[]',
    escrow_required: false,
    transparency_confirmed: true,
    status: 'active',
    admin_review_status: 'pending',
    ...overrides,
  };
}

/**
 * INSERT an opportunity from an arbitrary column map.  Returns the
 * inserted row (all columns), or throws the PG error.
 */
async function insertOpportunity(inst: AnyPGlite, row: Row): Promise<Row> {
  const cols = Object.keys(row);
  const params = cols.map((_, i) => `$${i + 1}`);
  const values = cols.map((c) => row[c]);
  const sql =
    `INSERT INTO public.opportunities (${cols.join(',')}) VALUES (${params.join(',')}) RETURNING *`;
  const r = await inst.query<Row>(sql, values as unknown[]);
  return r.rows[0];
}

/** Seed a legacy pre-candidate active row by disabling the new trigger. */
async function seedLegacyBypassingCanonical(inst: AnyPGlite, row: Row): Promise<string> {
  await inst.exec(
    'ALTER TABLE public.opportunities DISABLE TRIGGER trg_opportunities_canonical_publication_guard',
  );
  try {
    const out = await insertOpportunity(inst, row);
    return String(out.id);
  } finally {
    await inst.exec(
      'ALTER TABLE public.opportunities ENABLE TRIGGER trg_opportunities_canonical_publication_guard',
    );
  }
}

/**
 * Await an INSERT/UPDATE and normalize the PG error shape.  When the
 * operation succeeds, returns { ok: true, row }; otherwise returns
 * { ok: false, err } where err is the raw pg Error instance so callers
 * may assert on `.code` / `.detail` / `.hint` / `.message`.
 */
interface AttemptOk { ok: true; row: Row; err?: undefined }
interface AttemptErr { ok: false; err: Error & Record<string, unknown>; row?: undefined }
type Attempt = AttemptOk | AttemptErr;
function mustErr(a: Attempt): Error & Record<string, unknown> {
  if (a.ok) throw new Error('expected failure but write succeeded');
  return a.err;
}
async function tryInsert(inst: AnyPGlite, row: Row): Promise<Attempt> {
  try {
    const r = await insertOpportunity(inst, row);
    return { ok: true, row: r };
  } catch (e) {
    return { ok: false, err: e as Error & Record<string, unknown> };
  }
}
async function tryExec(inst: AnyPGlite, sql: string, params: unknown[] = []): Promise<Attempt> {
  try {
    const r = await inst.query<Row>(sql, params);
    return { ok: true, row: r.rows[0] ?? {} };
  } catch (e) {
    return { ok: false, err: e as Error & Record<string, unknown> };
  }
}

// ---------------------------------------------------------------------
// beforeAll — build fixture, capture Phase 1K baseline, apply candidate.
// ---------------------------------------------------------------------
beforeAll(async () => {
  const inst = await makePGlite();
  db = inst;
  try {
    await db.exec(BOOTSTRAP);
    // Load DE1 canonical CHECK constraints from disk after the base
    // opportunities table exists so the fixture inherits the applied
    // storage contract without duplicating any constraint bodies here.
    await db.exec(PHASE_1L_DE1_SQL);
    await db.exec(PHASE_1K_SQL);
    await db.exec(PHASE_1K_TRIGGER_BINDING);
    await seedIdentities(db);

    // Capture Phase 1K state BEFORE candidate applies (proves candidate
    // does not touch the Phase 1K function or its trigger binding).
    const defR = await db.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.opportunities_guard()'::regprocedure) AS def`,
    );
    phase1kDefBefore = defR.rows[0].def;
    const trR = await db.query<{ sig: string }>(
      `SELECT t.tgname || '|' || pg_get_triggerdef(t.oid) AS sig
         FROM pg_trigger t
        WHERE t.tgname = 'trg_opportunities_guard'`,
    );
    phase1kTriggerBefore = trR.rows.map((r) => r.sig).join('\n');

    // Apply candidate exactly once for the shared harness.
    await db.exec(CANDIDATE_SQL);

    // Immediately capture immutable baselines for every new function
    // definition, both trigger definitions/counts, and the effective
    // EXECUTE ACL for PUBLIC (grantee OID 0), anon, and authenticated.
    for (const reg of NEW_FN_REGS) {
      const r = await db.query<{ def: string }>(
        `SELECT pg_get_functiondef($1::regprocedure) AS def`, [reg],
      );
      baselineFnDefs[reg] = r.rows[0].def;
      baselinePublicLacks[reg] = await publicLacksExecute(db, reg);
      baselineAnonLacks[reg] = await roleLacksExecute(db, 'anon', reg);
      baselineAuthLacks[reg] = await roleLacksExecute(db, 'authenticated', reg);
    }
    // Phase 1K definition is captured pre-candidate; also record it in the
    // shared map under the ALL_FN_REGS key for the consolidated idempotency
    // test to compare against.
    baselineFnDefs['public.opportunities_guard()'] = phase1kDefBefore;

    for (const tg of TRG_NAMES) {
      const t = await db.query<{ def: string; ct: string }>(
        `SELECT COALESCE(min(pg_get_triggerdef(oid)), '') AS def,
                count(*)::text AS ct
           FROM pg_trigger WHERE tgname = $1`,
        [tg],
      );
      baselineTriggerDefs[tg] = t.rows[0].def;
      baselineTriggerCounts[tg] = Number(t.rows[0].ct);
    }
  } catch (e) {
    try { await inst.close?.(); } catch { /* ignore */ }
    throw e;
  }
});

afterAll(async () => {
  for (const inst of dbs) {
    try {
      await inst.close?.();
    } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------

describe('candidate source & catalog integrity', () => {
  it('candidate file exists and is non-trivial', () => {
    expect(CANDIDATE_SQL.length).toBeGreaterThan(2000);
  });
  it('defines all four required functions', () => {
    expect(CANDIDATE_SQL).toContain('FUNCTION public._opportunity_numeric_is_finite(');
    expect(CANDIDATE_SQL).toContain('FUNCTION public._opportunity_jsonb_number(');
    expect(CANDIDATE_SQL).toContain('FUNCTION public.opportunity_publication_blockers(');
    expect(CANDIDATE_SQL).toContain('FUNCTION public.opportunities_canonical_publication_guard()');
  });
  it('binds the new trigger with the mandated name', () => {
    expect(CANDIDATE_SQL).toContain(
      'CREATE TRIGGER trg_opportunities_canonical_publication_guard',
    );
    expect(CANDIDATE_SQL).toContain('BEFORE INSERT OR UPDATE ON public.opportunities');
  });
  it('revokes EXECUTE on all four helpers from PUBLIC, anon, authenticated', () => {
    for (const fn of [
      'public._opportunity_numeric_is_finite(numeric)',
      'public._opportunity_jsonb_number(jsonb)',
      'public.opportunity_publication_blockers(public.opportunities)',
      'public.opportunities_canonical_publication_guard()',
    ]) {
      const re = new RegExp(
        `REVOKE EXECUTE ON FUNCTION ${fn.replace(/[.()]/g, (c) => `\\${c}`)}\\s+FROM PUBLIC, anon, authenticated`,
        'i',
      );
      expect(re.test(CANDIDATE_SQL)).toBe(true);
    }
  });
  it('does not replace or drop the Phase 1K guard function or trigger', () => {
    expect(CANDIDATE_SQL).not.toContain('CREATE OR REPLACE FUNCTION public.opportunities_guard');
    expect(CANDIDATE_SQL).not.toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_opportunities_guard\b(?!_canonical)/i);
    expect(CANDIDATE_SQL).not.toMatch(/DROP\s+FUNCTION[^;]*opportunities_guard\s*\(/i);
  });

  it('_opportunity_numeric_is_finite is SQL, IMMUTABLE, pinned search_path', async () => {
    const r = await db.query<{ lang: string; volatile: string; cfg: string[] | null }>(
      `SELECT l.lanname AS lang, p.provolatile AS volatile, p.proconfig AS cfg
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.proname = '_opportunity_numeric_is_finite'`,
    );
    expect(r.rows[0].lang).toBe('sql');
    expect(r.rows[0].volatile).toBe('i');
    expect((r.rows[0].cfg ?? []).some((c) => c.startsWith('search_path='))).toBe(true);
  });
  it('_opportunity_jsonb_number is PL/pgSQL, IMMUTABLE, pinned search_path', async () => {
    const r = await db.query<{ lang: string; volatile: string; cfg: string[] | null }>(
      `SELECT l.lanname AS lang, p.provolatile AS volatile, p.proconfig AS cfg
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.proname = '_opportunity_jsonb_number'`,
    );
    expect(r.rows[0].lang).toBe('plpgsql');
    expect(r.rows[0].volatile).toBe('i');
    expect((r.rows[0].cfg ?? []).some((c) => c.startsWith('search_path='))).toBe(true);
  });
  it('opportunity_publication_blockers is PL/pgSQL, STABLE, pinned search_path', async () => {
    const r = await db.query<{ lang: string; volatile: string; cfg: string[] | null }>(
      `SELECT l.lanname AS lang, p.provolatile AS volatile, p.proconfig AS cfg
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.proname = 'opportunity_publication_blockers'`,
    );
    expect(r.rows[0].lang).toBe('plpgsql');
    expect(r.rows[0].volatile).toBe('s');
    expect((r.rows[0].cfg ?? []).some((c) => c.startsWith('search_path='))).toBe(true);
  });
  it('opportunities_canonical_publication_guard is PL/pgSQL, SECURITY DEFINER, pinned search_path', async () => {
    const r = await db.query<{ lang: string; secdef: boolean; cfg: string[] | null }>(
      `SELECT l.lanname AS lang, p.prosecdef AS secdef, p.proconfig AS cfg
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.proname = 'opportunities_canonical_publication_guard'`,
    );
    expect(r.rows[0].lang).toBe('plpgsql');
    expect(r.rows[0].secdef).toBe(true);
    expect((r.rows[0].cfg ?? []).some((c) => c.startsWith('search_path='))).toBe(true);
  });
  it('trg_opportunities_canonical_publication_guard is a BEFORE INSERT OR UPDATE row trigger, singly bound', async () => {
    const r = await db.query<{ ct: string; def: string }>(
      `SELECT count(*)::text AS ct, min(pg_get_triggerdef(oid)) AS def
         FROM pg_trigger WHERE tgname = 'trg_opportunities_canonical_publication_guard'`,
    );
    expect(r.rows[0].ct).toBe('1');
    expect(r.rows[0].def).toContain('BEFORE INSERT OR UPDATE');
    expect(r.rows[0].def).toContain('FOR EACH ROW');
  });
});

describe('coexistence with Phase 1K guard and idempotency', () => {
  it('Phase 1K opportunities_guard function definition is byte-identical after candidate apply', async () => {
    const r = await db.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.opportunities_guard()'::regprocedure) AS def`,
    );
    expect(r.rows[0].def).toBe(phase1kDefBefore);
  });
  it('trg_opportunities_guard remains singly bound with unchanged definition', async () => {
    const r = await db.query<{ sig: string }>(
      `SELECT tgname || '|' || pg_get_triggerdef(oid) AS sig
         FROM pg_trigger WHERE tgname = 'trg_opportunities_guard'`,
    );
    expect(r.rows.map((x) => x.sig).join('\n')).toBe(phase1kTriggerBefore);
    expect(r.rows.length).toBe(1);
  });
  // NOTE: reapplication invariance and PUBLIC/anon/authenticated ACL
  // stability under reapplication are consolidated into the final
  // "definitive idempotency" test at the bottom of this file, which
  // compares every helper/trigger/ACL against the beforeAll baselines
  // captured immediately after the first candidate application.
});

// -------------------- helper: derive parsed detail ---------------------
function parseDetail(err: Error & Record<string, unknown>): { code: string; blocking_reasons: string[] } {
  const detail = String(err.detail ?? '');
  return JSON.parse(detail);
}

describe('non-active lifecycle rows pass validation unchanged', () => {
  it.each(['draft', 'paused', 'closed', 'removed'])(
    'status=%s accepts a fully invalid row',
    async (status) => {
      await setUid(db, RECR_UID);
      const attempt = await tryInsert(
        db,
        publishableRow({
          status,
          title: '',
          company_name: '',
          description: null,
          home_time: null,
          transparency_confirmed: false,
          canonical_version: null,
          pay_model: null,
          employment_model: null,
          team_configuration: null,
          route_type: null,
          trailer_type: null,
          hiring_city: null,
          hiring_state: null,
          flat_weekly_pay: null,
        }),
      );
      expect(attempt.ok).toBe(true);
    },
  );
});

describe('valid active insert per pay model — succeeds and Phase 1K stamps publication', () => {
  it('flat_weekly baseline is published to drivers', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow());
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.row.admin_review_status).toBe('approved');
      expect(a.row.published_at).not.toBeNull();
    }
  });
  it('cpm passes with valid rate, weekly miles, deadhead disclosure', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'cpm', flat_weekly_pay: null,
      cpm: 0.6, estimated_weekly_miles: 2500, estimated_loaded_miles: 2200, deadhead_paid: true,
    }));
    expect(a.ok).toBe(true);
  });
  it('percentage passes with rate + basis + label', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'percentage', flat_weekly_pay: null,
      percentage_pay: 30, percentage_weekly_revenue_basis: 5000, percentage_basis_label: 'Line-haul revenue',
    }));
    expect(a.ok).toBe(true);
  });
  it('salary passes with amount + frequency', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'salary', flat_weekly_pay: null,
      salary_amount: 90000, salary_frequency: 'annual',
    }));
    expect(a.ok).toBe(true);
  });
  it('mixed passes with two complete components', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([
        { label: 'Base', amount: 1000, frequency: 'weekly' },
        { label: 'Perf bonus', amount: 200, frequency: 'weekly' },
      ]),
    }));
    expect(a.ok).toBe(true);
  });
  it('other passes with label + weekly gross', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'other', flat_weekly_pay: null,
      other_pay_method_label: 'Piece-rate', other_weekly_gross: 1200,
    }));
    expect(a.ok).toBe(true);
  });
});

describe('universal blockers — exact messages', () => {
  const cases: Array<[string, Row, string]> = [
    ['canonical_version', { canonical_version: null }, 'Canonical opportunity version 1 is required before publication.'],
    ['title',             { title: '   ' },              'Opportunity title is required.'],
    ['company_name',      { company_name: '' },          'Company name is required.'],
    ['employment_model',  { employment_model: null },    'Select an employment arrangement.'],
    ['team_configuration',{ team_configuration: null },  'Select a driving configuration (Solo, Team, or Solo or Team).'],
    ['route_type',        { route_type: 'Freeway' },     'Select a route type.'],
    ['trailer_type',      { trailer_type: 'Van' },       'Select a trailer type.'],
    ['hiring area',       { hiring_city: '', hiring_state: '', hiring_states: [] }, 'Provide a hiring city and state, or at least one hiring state.'],
    ['description',       { description: '  ' },         'Description is required.'],
    ['home_time',         { home_time: '' },             'Home time is required.'],
    ['pay_model',         { pay_model: null, flat_weekly_pay: null }, 'Select a pay model.'],
    ['transparency',      { transparency_confirmed: false }, 'Confirm the opportunity is accurate before publishing.'],
  ];
  it.each(cases)('missing %s blocks with exact message', async (_lbl, overrides, expected) => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow(overrides));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      const d = parseDetail(mustErr(a));
      expect(d.blocking_reasons).toContain(expected);
    }
  });
});

describe('route/trailer/hiring alternatives', () => {
  it.each(['Local','Regional','OTR','Dedicated','Semi-Dedicated'])(
    'route_type %s is accepted', async (rt) => {
      await setUid(db, RECR_UID);
      const a = await tryInsert(db, publishableRow({ route_type: rt }));
      expect(a.ok).toBe(true);
    },
  );
  it.each(['Dry Van','Reefer','Flatbed','Tanker','Car Hauler','Intermodal','Other'])(
    'trailer_type %s is accepted', async (tt) => {
      await setUid(db, RECR_UID);
      const a = await tryInsert(db, publishableRow({ trailer_type: tt }));
      expect(a.ok).toBe(true);
    },
  );
  it('hiring_states-only (no city/state) is accepted', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      hiring_city: null, hiring_state: null, hiring_states: ['TX','OK'],
    }));
    expect(a.ok).toBe(true);
  });
  it('hiring_states with only blank entries still blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      hiring_city: null, hiring_state: null, hiring_states: ['   ', ''],
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(parseDetail(mustErr(a)).blocking_reasons)
        .toContain('Provide a hiring city and state, or at least one hiring state.');
    }
  });
});

describe('CPM boundaries', () => {
  const cpmBase = { pay_model: 'cpm', flat_weekly_pay: null, cpm: 0.55, estimated_weekly_miles: 2500, estimated_loaded_miles: 2200, deadhead_paid: true } as Row;
  it('missing cpm blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ ...cpmBase, cpm: null }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('CPM must be greater than zero.');
  });
  it('missing weekly miles blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ ...cpmBase, estimated_weekly_miles: null }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Total weekly miles must be greater than zero for CPM pay.');
  });
  it('explicit zero loaded miles blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ ...cpmBase, estimated_loaded_miles: 0 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Loaded miles cannot be zero when provided.');
  });
  it('null loaded miles is allowed', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ ...cpmBase, estimated_loaded_miles: null }));
    expect(a.ok).toBe(true);
  });
  it('unknown deadhead_paid blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ ...cpmBase, deadhead_paid: null }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Specify whether deadhead miles are paid (yes or no).');
  });
});

describe('percentage / flat / salary boundaries', () => {
  it('missing percentage_pay blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'percentage', flat_weekly_pay: null,
      percentage_pay: null, percentage_basis_label: 'Line-haul', percentage_weekly_revenue_basis: 5000 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Percentage rate must be greater than zero.');
  });
  it('missing basis label blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'percentage', flat_weekly_pay: null,
      percentage_pay: 30, percentage_basis_label: '', percentage_weekly_revenue_basis: 5000 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Percentage basis label is required.');
  });
  it('missing basis amount blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'percentage', flat_weekly_pay: null,
      percentage_pay: 30, percentage_basis_label: 'x', percentage_weekly_revenue_basis: null }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Percentage weekly revenue basis must be greater than zero.');
  });
  it('zero flat weekly pay blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ flat_weekly_pay: 0 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Flat weekly pay must be greater than zero.');
  });
  it('missing salary amount blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'salary', flat_weekly_pay: null,
      salary_amount: null, salary_frequency: 'annual' }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Salary amount must be greater than zero.');
  });
  it('invalid salary frequency blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'salary', flat_weekly_pay: null,
      salary_amount: 100000, salary_frequency: 'quarterly' }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Salary pay period is required.');
  });
});

describe('mixed pay boundaries', () => {
  it('only one complete component blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([{ label: 'Base', amount: 1000, frequency: 'weekly' }]) }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Mixed pay requires at least two complete components (label, amount, frequency).');
  });
  it('completely blank component is ignored', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([
        {}, // blank
        { label: 'Base', amount: 1000, frequency: 'weekly' },
        { label: 'Bonus', amount: 200, frequency: 'weekly' },
      ]) }));
    expect(a.ok).toBe(true);
  });
  it('nonblank component missing label blocks with 1-based index', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([
        { label: 'Base', amount: 1000, frequency: 'weekly' },
        { label: '', amount: 200, frequency: 'weekly' }, // idx 2 needs label
        { label: 'Perf', amount: 100, frequency: 'weekly' },
      ]) }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Mixed component 2 needs a label.');
  });
  it('malformed JSON string amount produces structured 23514, not cast error', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([
        { label: 'Base', amount: 'not-a-number', frequency: 'weekly' },
        { label: 'Bonus', amount: 200, frequency: 'weekly' },
      ]) }));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(String(mustErr(a).code)).toBe('23514');
      expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Mixed component 1 amount must be zero or greater.');
    }
  });
  it('component amount without frequency blocks by index', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([
        { label: 'A', amount: 500, frequency: null },
        { label: 'B', amount: 300, frequency: 'weekly' },
      ]) }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Mixed component 1 frequency is required.');
  });
});

describe('"other" boundaries', () => {
  it('missing label blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'other', flat_weekly_pay: null,
      other_pay_method_label: '', other_weekly_gross: 1200 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Pay method label is required for “Other”.');
  });
  it('missing weekly gross blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'other', flat_weekly_pay: null,
      other_pay_method_label: 'Piece-rate', other_weekly_gross: null }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Supported weekly gross must be greater than zero for “Other”.');
  });
});

describe('cost pairs and escrow (contractor_1099)', () => {
  const base = (o: Row = {}) => publishableRow({
    employment_model: 'contractor_1099',
    driver_type: '1099',
    ...o,
  });
  it('null/null cost pair is allowed (not disclosed)', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({}));
    expect(a.ok).toBe(true);
  });
  it('frequency without amount blocks (Insurance)', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      insurance_deductions: null, insurance_deduction_frequency: 'weekly',
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Insurance amount is required when a frequency is set.');
  });
  it('amount without frequency blocks (Maintenance)', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      maintenance_deductions: 100, maintenance_deduction_frequency: null,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Maintenance frequency is required when an amount is set.');
  });
  it('zero + valid frequency is allowed (Other recurring cost)', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      other_deductions: 0, other_deduction_frequency: 'weekly',
    }));
    expect(a.ok).toBe(true);
  });
  it('lease pair only applies to lease_purchase', async () => {
    await setUid(db, RECR_UID);
    // A stray lease pair on contractor_1099 must NOT block.
    const a = await tryInsert(db, base({ lease_payment: 500, lease_payment_frequency: null }));
    expect(a.ok).toBe(true);
  });
  it('lease pair enforced for lease_purchase', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      employment_model: 'lease_purchase', driver_type: 'lease_purchase',
      lease_payment: 500, lease_payment_frequency: null,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Lease payment frequency is required when an amount is set.');
  });
  it('escrow required with missing amount blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'required', escrow_amount: null, escrow_amount_frequency: 'weekly',
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Escrow amount is required when escrow is required.');
  });
  it('escrow required with missing frequency blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'required', escrow_amount: 100, escrow_amount_frequency: null,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons).toContain('Escrow frequency is required when escrow is required.');
  });
  it('escrow not_required with positive stale amount blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'not_required', escrow_amount: 50, escrow_amount_frequency: 'weekly',
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Escrow is marked not required but a positive escrow amount was provided. Clear the stale escrow amount before publishing.');
  });
  it('escrow not_disclosed is allowed', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({ escrow_required_state: 'not_disclosed' }));
    expect(a.ok).toBe(true);
  });
});

describe('gross conflict > 10% (and boundary + bonus invariance)', () => {
  it('recruiter gross differing by more than 10% from derived blocks', async () => {
    await setUid(db, RECR_UID);
    // derived flat_weekly_pay = 1000; recruiter = 1200 (+20%)
    const a = await tryInsert(db, publishableRow({
      flat_weekly_pay: 1000, estimated_weekly_gross: 1200,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Recruiter-provided weekly gross differs from derived gross by more than 10%. Resolve the conflict before publishing.');
  });
  it('recruiter gross differing by exactly 10% is allowed', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      flat_weekly_pay: 1000, estimated_weekly_gross: 1100,
    }));
    expect(a.ok).toBe(true);
  });
  it('sign-on bonus is excluded from derived gross (bonus invariance)', async () => {
    await setUid(db, RECR_UID);
    // derived is $1000 (flat weekly); bonus $50000 must NOT count.
    // Recruiter-provided at 1050 (5%) — still under 10%.
    const a = await tryInsert(db, publishableRow({
      flat_weekly_pay: 1000, estimated_weekly_gross: 1050, sign_on_bonus: 50000,
    }));
    expect(a.ok).toBe(true);
  });
});

describe('structured 23514 error shape', () => {
  it('SQLSTATE, message, hint, DETAIL code and sorted/unique blockers', async () => {
    await setUid(db, RECR_UID);
    // Two independent blockers, produced in reverse-alphabetical natural order.
    const a = await tryInsert(db, publishableRow({
      title: '', transparency_confirmed: false, home_time: '', description: '',
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(String(mustErr(a).code)).toBe('23514');
      expect(String(mustErr(a).message)).toContain('Opportunity does not meet publication requirements.');
      expect(String(mustErr(a).hint)).toBe('Save as draft or correct the listed fields before publishing.');
      const d = parseDetail(mustErr(a));
      expect(d.code).toBe('opportunity_publication_invalid');
      // Must be sorted asc, unique.
      const sorted = [...d.blocking_reasons].sort();
      expect(d.blocking_reasons).toEqual(sorted);
      expect(new Set(d.blocking_reasons).size).toBe(d.blocking_reasons.length);
      // Expected reasons all present.
      expect(d.blocking_reasons).toEqual(expect.arrayContaining([
        'Opportunity title is required.',
        'Description is required.',
        'Home time is required.',
        'Confirm the opportunity is accurate before publishing.',
      ]));
    }
  });
});

describe('atomicity on failed writes', () => {
  it('failed INSERT persists no row', async () => {
    await setUid(db, RECR_UID);
    const before = await db.query<{ ct: string }>(`SELECT count(*)::text AS ct FROM public.opportunities`);
    const a = await tryInsert(db, publishableRow({ title: '' }));
    expect(a.ok).toBe(false);
    const after = await db.query<{ ct: string }>(`SELECT count(*)::text AS ct FROM public.opportunities`);
    expect(after.rows[0].ct).toBe(before.rows[0].ct);
  });
  it('failed UPDATE leaves OLD row unchanged', async () => {
    await setUid(db, RECR_UID);
    const inserted = await insertOpportunity(db, publishableRow({ title: 'Original Title' }));
    const id = String(inserted.id);
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities SET title = '' WHERE id = $1 RETURNING *`,
      [id],
    );
    expect(upd.ok).toBe(false);
    const check = await db.query<{ title: string }>(
      `SELECT title FROM public.opportunities WHERE id = $1`, [id],
    );
    expect(check.rows[0].title).toBe('Original Title');
  });
});

describe('Phase 1K admin exceptions preserved', () => {
  it('admin acting on ANOTHER recruiter’s incomplete active row is not validated', async () => {
    await setUid(db, ADMIN_UID);
    const a = await tryInsert(db, publishableRow({
      recruiter_id: OTHER_RP_ID,
      title: '', // would normally block
    }));
    expect(a.ok).toBe(true);
  });
  it('admin explicit moderation UPDATE on own row bypasses canonical validation', async () => {
    // Seed a legacy-style row bypassing all triggers, then admin flips
    // admin_review_status explicitly.
    await setUid(db, ADMIN_UID);
    const legacyId = await seedLegacyBypassingCanonical(db, publishableRow({
      recruiter_id: ADMIN_RP_ID,
      title: '', canonical_version: null,           // deliberately invalid
      admin_review_status: 'pending', published_at: null, status: 'active',
    }));
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities SET admin_review_status = 'flagged' WHERE id = $1 RETURNING *`,
      [legacyId],
    );
    expect(upd.ok).toBe(true);
  });
  it('admin ordinary INSERT on own recruiter is validated (invalid row blocks)', async () => {
    await setUid(db, ADMIN_UID);
    const a = await tryInsert(db, publishableRow({
      recruiter_id: ADMIN_RP_ID, title: '',
    }));
    expect(a.ok).toBe(false);
  });
  it('admin valid INSERT on own recruiter is stamped as published', async () => {
    await setUid(db, ADMIN_UID);
    const a = await tryInsert(db, publishableRow({ recruiter_id: ADMIN_RP_ID }));
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.row.admin_review_status).toBe('approved');
      expect(a.row.published_at).not.toBeNull();
    }
  });
});

describe('legacy pre-candidate active rows', () => {
  it('ordinary active→active edit on a legacy incomplete row is blocked', async () => {
    await setUid(db, RECR_UID);
    const id = await seedLegacyBypassingCanonical(db, publishableRow({
      canonical_version: null, title: 'Legacy row',
      admin_review_status: 'approved', published_at: new Date().toISOString(),
    }));
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities SET description = 'edit while active' WHERE id = $1 RETURNING *`,
      [id],
    );
    expect(upd.ok).toBe(false);
    if (!upd.ok) {
      expect(parseDetail(mustErr(upd)).blocking_reasons)
        .toContain('Canonical opportunity version 1 is required before publication.');
    }
  });
  it('same legacy row can be moved to draft', async () => {
    await setUid(db, RECR_UID);
    const id = await seedLegacyBypassingCanonical(db, publishableRow({
      canonical_version: null, title: 'Legacy row 2',
      admin_review_status: 'approved', published_at: new Date().toISOString(),
    }));
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities SET status = 'draft' WHERE id = $1 RETURNING *`,
      [id],
    );
    expect(upd.ok).toBe(true);
  });
  it('legacy row can be reactivated once canonicalized and complete', async () => {
    await setUid(db, RECR_UID);
    const id = await seedLegacyBypassingCanonical(db, publishableRow({
      canonical_version: null, title: 'Legacy row 3', status: 'draft',
    }));
    // Fill it out then flip back to active.
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities
          SET status = 'active', canonical_version = 1
        WHERE id = $1 RETURNING *`,
      [id],
    );
    expect(upd.ok).toBe(true);
  });
});

// =====================================================================
// Extended coverage — helper truth tables, universal-numeric enforcement,
// per-pay-model derivation, exhaustive cost-pair matrix, mixed malformed
// element handling, company-driver bypass, catalog-privilege revocation,
// and full reapplication invariance.
// =====================================================================

describe('_opportunity_numeric_is_finite truth table', () => {
  const cases: Array<[string, string, boolean]> = [
    ['NULL',               'NULL::numeric',            false],
    ['zero',               '0::numeric',               true],
    ['positive small',     '0.0001::numeric',          true],
    ['positive large',     '1e6::numeric',             true],
    ['negative finite',    '(-1.25)::numeric',         true],
    ['NaN',                `'NaN'::numeric`,           false],
    ['+Infinity',          `'Infinity'::numeric`,      false],
    ['-Infinity',          `'-Infinity'::numeric`,     false],
  ];
  it.each(cases)('finite(%s) = %s', async (_lbl, expr, expected) => {
    const r = await db.query<{ v: boolean }>(
      `SELECT public._opportunity_numeric_is_finite(${expr}) AS v`,
    );
    expect(r.rows[0].v).toBe(expected);
  });
});

describe('_opportunity_jsonb_number extractor', () => {
  const cases: Array<[string, string, number | null]> = [
    ['SQL NULL',        'NULL::jsonb',           null],
    ['JSON null',       `'null'::jsonb`,         null],
    ['JSON string',     `'"7"'::jsonb`,          null],
    ['JSON boolean',    `'true'::jsonb`,         null],
    ['JSON object',     `'{"x":1}'::jsonb`,      null],
    ['JSON array',      `'[1,2]'::jsonb`,        null],
    ['JSON number 0',   `'0'::jsonb`,            0],
    ['JSON number pos', `'12.5'::jsonb`,         12.5],
    ['JSON number neg', `'-3'::jsonb`,           -3],
  ];
  it.each(cases)('extract(%s) = %s', async (_lbl, expr, expected) => {
    const r = await db.query<{ v: string | null }>(
      `SELECT public._opportunity_jsonb_number(${expr})::text AS v`,
    );
    if (expected === null) {
      expect(r.rows[0].v).toBeNull();
    } else {
      expect(Number(r.rows[0].v)).toBe(expected);
    }
  });
});

describe('universal numeric blocker — negative and non-finite', () => {
  it('negative cpm on an active row raises structured 23514', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'cpm', flat_weekly_pay: null,
      cpm: -0.1, estimated_weekly_miles: 2500, estimated_loaded_miles: 2200, deadhead_paid: true,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(String(mustErr(a).code)).toBe('23514');
      expect(parseDetail(mustErr(a)).blocking_reasons)
        .toContain('Fix invalid numeric values (must be zero or greater).');
    }
  });
  it('negative sign_on_bonus is blocked as invalid numeric', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ sign_on_bonus: -100 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Fix invalid numeric values (must be zero or greater).');
  });
  it('NaN cpm injected via UPDATE is intercepted as structured 23514', async () => {
    await setUid(db, RECR_UID);
    const seeded = await insertOpportunity(db, publishableRow({ status: 'draft' }));
    const id = String(seeded.id);
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities
          SET status = 'active', pay_model = 'cpm', flat_weekly_pay = NULL,
              cpm = 'NaN'::numeric, estimated_weekly_miles = 2500,
              estimated_loaded_miles = 2200, deadhead_paid = true
        WHERE id = $1 RETURNING *`,
      [id],
    );
    expect(upd.ok).toBe(false);
    if (!upd.ok) {
      expect(String(mustErr(upd).code)).toBe('23514');
      expect(parseDetail(mustErr(upd)).blocking_reasons)
        .toContain('Fix invalid numeric values (must be zero or greater).');
    }
  });
  it('Infinity cpm injected via UPDATE is intercepted as structured 23514', async () => {
    await setUid(db, RECR_UID);
    const seeded = await insertOpportunity(db, publishableRow({ status: 'draft' }));
    const id = String(seeded.id);
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities
          SET status = 'active', pay_model = 'cpm', flat_weekly_pay = NULL,
              cpm = 'Infinity'::numeric, estimated_weekly_miles = 2500,
              estimated_loaded_miles = 2200, deadhead_paid = true
        WHERE id = $1 RETURNING *`,
      [id],
    );
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(String(mustErr(upd).code)).toBe('23514');
  });
  it('-Infinity cpm injected via UPDATE is intercepted as structured 23514 with universal blocker', async () => {
    await setUid(db, RECR_UID);
    const seeded = await insertOpportunity(db, publishableRow({ status: 'draft' }));
    const id = String(seeded.id);
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities
          SET status = 'active', pay_model = 'cpm', flat_weekly_pay = NULL,
              cpm = '-Infinity'::numeric, estimated_weekly_miles = 2500,
              estimated_loaded_miles = 2200, deadhead_paid = true
        WHERE id = $1 RETURNING *`,
      [id],
    );
    expect(upd.ok).toBe(false);
    if (!upd.ok) {
      expect(String(mustErr(upd).code)).toBe('23514');
      const d = parseDetail(mustErr(upd));
      expect(d.code).toBe('opportunity_publication_invalid');
      expect(d.blocking_reasons)
        .toContain('Fix invalid numeric values (must be zero or greater).');
    }
  });
  it('invalid salary_frequency asserts structured 23514 before CHECK', async () => {
    await setUid(db, RECR_UID);
    const seeded = await insertOpportunity(db, publishableRow({ status: 'draft' }));
    const id = String(seeded.id);
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities
          SET status = 'active', pay_model = 'salary', flat_weekly_pay = NULL,
              salary_amount = 1000, salary_frequency = 'daily'
        WHERE id = $1 RETURNING *`,
      [id],
    );
    expect(upd.ok).toBe(false);
    if (!upd.ok) {
      expect(String(mustErr(upd).code)).toBe('23514');
      const d = parseDetail(mustErr(upd));
      expect(d.code).toBe('opportunity_publication_invalid');
      expect(d.blocking_reasons).toContain('Salary pay period is required.');
    }
  });
});


describe('candidate intercepts before underlying CHECK constraints', () => {
  it('canonical_version=2 returns structured publication error (not CHECK failure)', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ canonical_version: 2 }));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(String(mustErr(a).code)).toBe('23514');
      expect(String(mustErr(a).message))
        .toContain('Opportunity does not meet publication requirements.');
      expect(parseDetail(mustErr(a)).blocking_reasons)
        .toContain('Canonical opportunity version 1 is required before publication.');
    }
  });
  it('invalid employment_model returns structured publication error', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ employment_model: 'gig' }));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(String(mustErr(a).code)).toBe('23514');
      expect(parseDetail(mustErr(a)).blocking_reasons)
        .toContain('Select an employment arrangement.');
    }
  });
  it('invalid team_configuration returns structured publication error', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ team_configuration: 'triple' }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Select a driving configuration (Solo, Team, or Solo or Team).');
  });
  it('non-array mixed_pay_components on active row returns structured publication error', async () => {
    await setUid(db, RECR_UID);
    // Seed as draft with valid array, then flip to active while corrupting to object.
    const seeded = await insertOpportunity(db, publishableRow({
      status: 'draft', pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([
        { label: 'Base', amount: 1000, frequency: 'weekly' },
        { label: 'Bonus', amount: 200, frequency: 'weekly' },
      ]),
    }));
    const id = String(seeded.id);
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities
          SET status = 'active', mixed_pay_components = '{}'::jsonb
        WHERE id = $1 RETURNING *`,
      [id],
    );
    expect(upd.ok).toBe(false);
    if (!upd.ok) {
      expect(String(mustErr(upd).code)).toBe('23514');
      expect(parseDetail(mustErr(upd)).blocking_reasons)
        .toContain('Mixed pay requires at least two complete components (label, amount, frequency).');
    }
  });
});

/**
 * One honest, data-driven matrix over ALL FOUR cost pairs:
 *   Insurance / Maintenance / Other  → contractor_1099
 *   Lease                            → lease_purchase
 *
 * For each pair every scenario produces a real active-row write and
 * inspects the structured 23514 error (code, DETAIL.code, blocking
 * reasons array), rather than only `ok === false`.
 *
 * Scenarios per pair:
 *   1. null/null                   → allowed
 *   2. freq set + NULL amount      → "<label> amount is required when a frequency is set."
 *   3. positive amount + NULL freq → "<label> frequency is required when an amount is set."
 *   4. positive amount + 'daily'   → same frequency-required blocker (trigger fires before CHECK)
 *   5. negative amount             → universal numeric blocker + pair amount-invalid blocker
 *   6. NaN amount (via UPDATE)     → structured 23514 + universal numeric + amount-invalid blockers
 *   7. zero + valid freq           → allowed
 *   8. positive + valid freq       → allowed
 */
describe('cost-pair full matrix (all four cost pairs, 8 scenarios each)', () => {
  interface Pair {
    label: string;
    employment: string;
    driverType: string;
    amt: 'insurance_deductions' | 'maintenance_deductions' | 'other_deductions' | 'lease_payment';
    freq:
      | 'insurance_deduction_frequency'
      | 'maintenance_deduction_frequency'
      | 'other_deduction_frequency'
      | 'lease_payment_frequency';
    msgFreq: string;
    msgAmt: string;
    msgAmtInvalid: string;
  }
  const pairs: Pair[] = [
    {
      label: 'Insurance', employment: 'contractor_1099', driverType: '1099',
      amt: 'insurance_deductions', freq: 'insurance_deduction_frequency',
      msgFreq: 'Insurance frequency is required when an amount is set.',
      msgAmt:  'Insurance amount is required when a frequency is set.',
      msgAmtInvalid: 'Insurance amount must be zero or a positive number.',
    },
    {
      label: 'Maintenance', employment: 'contractor_1099', driverType: '1099',
      amt: 'maintenance_deductions', freq: 'maintenance_deduction_frequency',
      msgFreq: 'Maintenance frequency is required when an amount is set.',
      msgAmt:  'Maintenance amount is required when a frequency is set.',
      msgAmtInvalid: 'Maintenance amount must be zero or a positive number.',
    },
    {
      label: 'Other', employment: 'contractor_1099', driverType: '1099',
      amt: 'other_deductions', freq: 'other_deduction_frequency',
      msgFreq: 'Other recurring cost frequency is required when an amount is set.',
      msgAmt:  'Other recurring cost amount is required when a frequency is set.',
      msgAmtInvalid: 'Other recurring cost amount must be zero or a positive number.',
    },
    {
      label: 'Lease', employment: 'lease_purchase', driverType: 'lease_purchase',
      amt: 'lease_payment', freq: 'lease_payment_frequency',
      msgFreq: 'Lease payment frequency is required when an amount is set.',
      msgAmt:  'Lease payment amount is required when a frequency is set.',
      msgAmtInvalid: 'Lease payment amount must be zero or a positive number.',
    },
  ];

  const UNIVERSAL = 'Fix invalid numeric values (must be zero or greater).';

  for (const p of pairs) {
    const base = (o: Row = {}) => publishableRow({
      employment_model: p.employment,
      driver_type: p.driverType,
      ...o,
    });

    it(`${p.label} 1/null/null is allowed`, async () => {
      await setUid(db, RECR_UID);
      const a = await tryInsert(db, base({ [p.amt]: null, [p.freq]: null } as Row));
      expect(a.ok).toBe(true);
    });
    it(`${p.label} 2/freq+null-amount → amount-required blocker`, async () => {
      await setUid(db, RECR_UID);
      const a = await tryInsert(db, base({ [p.amt]: null, [p.freq]: 'monthly' } as Row));
      expect(a.ok).toBe(false);
      if (!a.ok) {
        expect(String(mustErr(a).code)).toBe('23514');
        const d = parseDetail(mustErr(a));
        expect(d.code).toBe('opportunity_publication_invalid');
        expect(d.blocking_reasons).toContain(p.msgAmt);
      }
    });
    it(`${p.label} 3/positive-amount+null-freq → frequency-required blocker`, async () => {
      await setUid(db, RECR_UID);
      const a = await tryInsert(db, base({ [p.amt]: 100, [p.freq]: null } as Row));
      expect(a.ok).toBe(false);
      if (!a.ok) {
        expect(String(mustErr(a).code)).toBe('23514');
        const d = parseDetail(mustErr(a));
        expect(d.code).toBe('opportunity_publication_invalid');
        expect(d.blocking_reasons).toContain(p.msgFreq);
      }
    });
    it(`${p.label} 4/positive-amount+'daily' → frequency-required (before CHECK)`, async () => {
      await setUid(db, RECR_UID);
      const a = await tryInsert(db, base({ [p.amt]: 100, [p.freq]: 'daily' } as Row));
      expect(a.ok).toBe(false);
      if (!a.ok) {
        expect(String(mustErr(a).code)).toBe('23514');
        const d = parseDetail(mustErr(a));
        expect(d.code).toBe('opportunity_publication_invalid');
        expect(d.blocking_reasons).toContain(p.msgFreq);
      }
    });
    it(`${p.label} 5/negative amount → universal + pair amount-invalid blockers`, async () => {
      await setUid(db, RECR_UID);
      const a = await tryInsert(db, base({ [p.amt]: -1, [p.freq]: 'weekly' } as Row));
      expect(a.ok).toBe(false);
      if (!a.ok) {
        expect(String(mustErr(a).code)).toBe('23514');
        const d = parseDetail(mustErr(a));
        expect(d.code).toBe('opportunity_publication_invalid');
        expect(d.blocking_reasons).toContain(UNIVERSAL);
        expect(d.blocking_reasons).toContain(p.msgAmtInvalid);
      }
    });
    it(`${p.label} 6/NaN amount via UPDATE → structured 23514 + universal + pair amount-invalid`, async () => {
      await setUid(db, RECR_UID);
      const seeded = await insertOpportunity(db, publishableRow({
        status: 'draft', employment_model: p.employment, driver_type: p.driverType,
      }));
      const id = String(seeded.id);
      const upd = await tryExec(
        db,
        `UPDATE public.opportunities
            SET status = 'active', ${p.amt} = 'NaN'::numeric, ${p.freq} = 'weekly'
          WHERE id = $1 RETURNING *`,
        [id],
      );
      expect(upd.ok).toBe(false);
      if (!upd.ok) {
        expect(String(mustErr(upd).code)).toBe('23514');
        const d = parseDetail(mustErr(upd));
        expect(d.code).toBe('opportunity_publication_invalid');
        expect(d.blocking_reasons).toContain(UNIVERSAL);
        expect(d.blocking_reasons).toContain(p.msgAmtInvalid);
      }
    });
    it(`${p.label} 7/zero + valid freq is allowed`, async () => {
      await setUid(db, RECR_UID);
      const a = await tryInsert(db, base({ [p.amt]: 0, [p.freq]: 'weekly' } as Row));
      expect(a.ok).toBe(true);
    });
    it(`${p.label} 8/positive + valid freq is allowed`, async () => {
      await setUid(db, RECR_UID);
      const a = await tryInsert(db, base({ [p.amt]: 150, [p.freq]: 'biweekly' } as Row));
      expect(a.ok).toBe(true);
    });
  }

  // Prove lease fields are IRRELEVANT for non-lease_purchase employment.
  it('Lease positive+null on contractor_1099 does not block (lease irrelevant)', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      employment_model: 'contractor_1099', driver_type: '1099',
      lease_payment: 500, lease_payment_frequency: null,
    }));
    expect(a.ok).toBe(true);
  });
  it('Lease positive+null on owner_operator does not block (lease irrelevant)', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      employment_model: 'owner_operator', driver_type: 'owner_operator',
      lease_payment: 500, lease_payment_frequency: null,
    }));
    expect(a.ok).toBe(true);
  });
});

/**
 * Full escrow matrix on a cost-bearing employment model.  Every failure
 * inspects the structured 23514 error and the DETAIL code/blocking
 * reasons — no cast leak into SQLSTATE 22P02 or CHECK errors.
 */
describe('escrow full matrix (contractor_1099)', () => {
  const base = (o: Row = {}) => publishableRow({
    employment_model: 'contractor_1099', driver_type: '1099', ...o,
  });
  const AMOUNT_REQUIRED = 'Escrow amount is required when escrow is required.';
  const FREQ_REQUIRED   = 'Escrow frequency is required when escrow is required.';
  const NOT_REQUIRED_CONFLICT =
    'Escrow is marked not required but a positive escrow amount was provided. Clear the stale escrow amount before publishing.';
  const UNIVERSAL = 'Fix invalid numeric values (must be zero or greater).';

  it('required + null amount + valid freq → amount-required blocker', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'required', escrow_amount: null, escrow_amount_frequency: 'weekly',
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(String(mustErr(a).code)).toBe('23514');
      expect(parseDetail(mustErr(a)).blocking_reasons).toContain(AMOUNT_REQUIRED);
    }
  });
  it('required + positive amount + null freq → frequency-required blocker', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'required', escrow_amount: 100, escrow_amount_frequency: null,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(String(mustErr(a).code)).toBe('23514');
      expect(parseDetail(mustErr(a)).blocking_reasons).toContain(FREQ_REQUIRED);
    }
  });
  it(`required + positive amount + 'daily' → frequency-required blocker (before CHECK)`, async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'required', escrow_amount: 100, escrow_amount_frequency: 'daily',
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(String(mustErr(a).code)).toBe('23514');
      const d = parseDetail(mustErr(a));
      expect(d.code).toBe('opportunity_publication_invalid');
      expect(d.blocking_reasons).toContain(FREQ_REQUIRED);
    }
  });
  it('required + negative amount → structured 23514 with universal + amount-required blockers', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'required', escrow_amount: -1, escrow_amount_frequency: 'weekly',
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(String(mustErr(a).code)).toBe('23514');
      const d = parseDetail(mustErr(a));
      expect(d.code).toBe('opportunity_publication_invalid');
      expect(d.blocking_reasons).toContain(UNIVERSAL);
      expect(d.blocking_reasons).toContain(AMOUNT_REQUIRED);
    }
  });
  it('required + NaN amount via UPDATE → structured 23514, no cast-error leak', async () => {
    await setUid(db, RECR_UID);
    const seeded = await insertOpportunity(db, publishableRow({
      status: 'draft', employment_model: 'contractor_1099', driver_type: '1099',
    }));
    const id = String(seeded.id);
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities
          SET status = 'active', escrow_required_state = 'required',
              escrow_amount = 'NaN'::numeric, escrow_amount_frequency = 'weekly'
        WHERE id = $1 RETURNING *`,
      [id],
    );
    expect(upd.ok).toBe(false);
    if (!upd.ok) {
      expect(String(mustErr(upd).code)).toBe('23514');
      const d = parseDetail(mustErr(upd));
      expect(d.code).toBe('opportunity_publication_invalid');
      expect(d.blocking_reasons).toContain(UNIVERSAL);
      expect(d.blocking_reasons).toContain(AMOUNT_REQUIRED);
    }
  });
  it('required + +Infinity amount via UPDATE → structured 23514, no cast-error leak', async () => {
    await setUid(db, RECR_UID);
    const seeded = await insertOpportunity(db, publishableRow({
      status: 'draft', employment_model: 'contractor_1099', driver_type: '1099',
    }));
    const id = String(seeded.id);
    const upd = await tryExec(
      db,
      `UPDATE public.opportunities
          SET status = 'active', escrow_required_state = 'required',
              escrow_amount = 'Infinity'::numeric, escrow_amount_frequency = 'weekly'
        WHERE id = $1 RETURNING *`,
      [id],
    );
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(String(mustErr(upd).code)).toBe('23514');
  });
  it('required + zero + valid freq is allowed', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'required', escrow_amount: 0, escrow_amount_frequency: 'weekly',
    }));
    expect(a.ok).toBe(true);
  });
  it('required + positive + valid freq is allowed', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'required', escrow_amount: 25, escrow_amount_frequency: 'biweekly',
    }));
    expect(a.ok).toBe(true);
  });
  it('not_required + positive amount → conflict blocker', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'not_required', escrow_amount: 50, escrow_amount_frequency: 'weekly',
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(String(mustErr(a).code)).toBe('23514');
      expect(parseDetail(mustErr(a)).blocking_reasons).toContain(NOT_REQUIRED_CONFLICT);
    }
  });
  it('not_required + zero is allowed', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'not_required', escrow_amount: 0, escrow_amount_frequency: 'weekly',
    }));
    expect(a.ok).toBe(true);
  });
  it('null escrow_required_state is allowed', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({ escrow_required_state: null }));
    expect(a.ok).toBe(true);
  });
  it('not_disclosed escrow_required_state is allowed', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({ escrow_required_state: 'not_disclosed' }));
    expect(a.ok).toBe(true);
  });
});


describe('company-driver rows: cost-pair rules are irrelevant', () => {
  it('stray positive insurance without frequency does not block on company_driver', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      employment_model: 'company_driver',
      insurance_deductions: 250, insurance_deduction_frequency: null,
    }));
    expect(a.ok).toBe(true);
  });
  it('stray positive lease without frequency does not block on company_driver', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      employment_model: 'company_driver',
      lease_payment: 400, lease_payment_frequency: null,
    }));
    expect(a.ok).toBe(true);
  });
  it('company_driver row with escrow_required is not evaluated for escrow blockers', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      employment_model: 'company_driver',
      escrow_required_state: 'required', escrow_amount: null, escrow_amount_frequency: null,
    }));
    expect(a.ok).toBe(true);
  });
});

describe('mixed pay — additional malformed and edge cases', () => {
  it('scalar element inserted between two valid components blocks with indexed label', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([
        { label: 'Base', amount: 1000, frequency: 'weekly' },
        'garbage',
        { label: 'Bonus', amount: 200, frequency: 'weekly' },
      ]),
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Mixed component 2 needs a label.');
  });
  it('JSON null element is treated as malformed and blocks with indexed label', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([
        { label: 'A', amount: 500, frequency: 'weekly' },
        { label: 'B', amount: 500, frequency: 'weekly' },
        null,
      ]),
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Mixed component 3 needs a label.');
  });
  it('component with zero amount and valid frequency is a valid complete component', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([
        { label: 'Base', amount: 1000, frequency: 'weekly' },
        { label: 'Reserve', amount: 0, frequency: 'weekly' },
      ]),
    }));
    expect(a.ok).toBe(true);
  });
  it('component with invalid frequency emits frequency-required blocker', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([
        { label: 'A', amount: 500, frequency: 'daily' },
        { label: 'B', amount: 500, frequency: 'weekly' },
      ]),
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Mixed component 1 frequency is required.');
  });
});

describe('gross conflict derivation per pay model (>10% blocks, ≤10% allowed)', () => {
  it('CPM: recruiter gross 30% above derived blocks', async () => {
    await setUid(db, RECR_UID);
    // derived = 0.6 * 2200 = 1320; recruiter 1800 (+36%)
    const a = await tryInsert(db, publishableRow({
      pay_model: 'cpm', flat_weekly_pay: null,
      cpm: 0.6, estimated_weekly_miles: 2500, estimated_loaded_miles: 2200, deadhead_paid: true,
      estimated_weekly_gross: 1800,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Recruiter-provided weekly gross differs from derived gross by more than 10%. Resolve the conflict before publishing.');
  });
  it('CPM: recruiter gross within 10% is allowed', async () => {
    await setUid(db, RECR_UID);
    // derived = 1320; recruiter 1400 (~+6%)
    const a = await tryInsert(db, publishableRow({
      pay_model: 'cpm', flat_weekly_pay: null,
      cpm: 0.6, estimated_weekly_miles: 2500, estimated_loaded_miles: 2200, deadhead_paid: true,
      estimated_weekly_gross: 1400,
    }));
    expect(a.ok).toBe(true);
  });
  it('percentage: recruiter gross conflict >10% blocks', async () => {
    await setUid(db, RECR_UID);
    // derived = 5000 * 0.30 = 1500; recruiter 1900 (+26.7%)
    const a = await tryInsert(db, publishableRow({
      pay_model: 'percentage', flat_weekly_pay: null,
      percentage_pay: 30, percentage_weekly_revenue_basis: 5000, percentage_basis_label: 'Line-haul',
      estimated_weekly_gross: 1900,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Recruiter-provided weekly gross differs from derived gross by more than 10%. Resolve the conflict before publishing.');
  });
  it('salary annual: normalized derived is annual/52; conflict >10% blocks', async () => {
    await setUid(db, RECR_UID);
    // derived weekly = 52000 / 52 = 1000; recruiter 1300 (+30%)
    const a = await tryInsert(db, publishableRow({
      pay_model: 'salary', flat_weekly_pay: null,
      salary_amount: 52000, salary_frequency: 'annual',
      estimated_weekly_gross: 1300,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Recruiter-provided weekly gross differs from derived gross by more than 10%. Resolve the conflict before publishing.');
  });
  it('salary weekly: derived = amount; matching recruiter gross allowed', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'salary', flat_weekly_pay: null,
      salary_amount: 1200, salary_frequency: 'weekly', estimated_weekly_gross: 1200,
    }));
    expect(a.ok).toBe(true);
  });
  it('mixed: derived sums normalized-to-weekly components; conflict >10% blocks', async () => {
    await setUid(db, RECR_UID);
    // components: 1000 weekly + 2000 monthly (~= 461.5/week) = 1461.5; recruiter 2500 (+71%)
    const a = await tryInsert(db, publishableRow({
      pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([
        { label: 'Base', amount: 1000, frequency: 'weekly' },
        { label: 'Retention', amount: 2000, frequency: 'monthly' },
      ]),
      estimated_weekly_gross: 2500,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Recruiter-provided weekly gross differs from derived gross by more than 10%. Resolve the conflict before publishing.');
  });
  it('other: derived = other_weekly_gross; matching recruiter allowed', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'other', flat_weekly_pay: null,
      other_pay_method_label: 'Piece-rate', other_weekly_gross: 1500, estimated_weekly_gross: 1500,
    }));
    expect(a.ok).toBe(true);
  });
  it('other: recruiter gross >10% from other_weekly_gross blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({
      pay_model: 'other', flat_weekly_pay: null,
      other_pay_method_label: 'Piece-rate', other_weekly_gross: 1000, estimated_weekly_gross: 1500,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(mustErr(a)).blocking_reasons)
      .toContain('Recruiter-provided weekly gross differs from derived gross by more than 10%. Resolve the conflict before publishing.');
  });
});

describe('catalog-level revocation — anon and authenticated cannot EXECUTE the four helpers', () => {
  const fns = [
    'public._opportunity_numeric_is_finite(numeric)',
    'public._opportunity_jsonb_number(jsonb)',
    'public.opportunity_publication_blockers(public.opportunities)',
    'public.opportunities_canonical_publication_guard()',
  ] as const;
  for (const fn of fns) {
    it(`anon lacks EXECUTE on ${fn}`, async () => {
      const r = await db.query<{ v: boolean }>(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS v`,
        [fn],
      );
      expect(r.rows[0].v).toBe(false);
    });
    it(`authenticated lacks EXECUTE on ${fn}`, async () => {
      const r = await db.query<{ v: boolean }>(
        `SELECT has_function_privilege('authenticated', $1, 'EXECUTE') AS v`,
        [fn],
      );
      expect(r.rows[0].v).toBe(false);
    });
  }
});

describe('full reapplication invariance — every helper and both triggers stay byte-identical', () => {
  it('reapplying the candidate a second time preserves every function definition and trigger binding', async () => {
    const fnRegs = [
      'public._opportunity_numeric_is_finite(numeric)',
      'public._opportunity_jsonb_number(jsonb)',
      'public.opportunity_publication_blockers(public.opportunities)',
      'public.opportunities_canonical_publication_guard()',
      'public.opportunities_guard()',
    ];
    const before: Record<string, string> = {};
    for (const reg of fnRegs) {
      const r = await db.query<{ def: string }>(
        `SELECT pg_get_functiondef($1::regprocedure) AS def`, [reg],
      );
      before[reg] = r.rows[0].def;
    }
    const trBefore = await db.query<{ tgname: string; def: string }>(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
        WHERE tgname IN ('trg_opportunities_guard','trg_opportunities_canonical_publication_guard')
        ORDER BY tgname`,
    );
    expect(trBefore.rows.length).toBe(2);

    // Reapply the candidate.
    await db.exec(CANDIDATE_SQL);

    for (const reg of fnRegs) {
      const r = await db.query<{ def: string }>(
        `SELECT pg_get_functiondef($1::regprocedure) AS def`, [reg],
      );
      expect(r.rows[0].def).toBe(before[reg]);
    }
    const trAfter = await db.query<{ tgname: string; def: string }>(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
        WHERE tgname IN ('trg_opportunities_guard','trg_opportunities_canonical_publication_guard')
        ORDER BY tgname`,
    );
    expect(trAfter.rows.length).toBe(2);
    for (let i = 0; i < trAfter.rows.length; i++) {
      expect(trAfter.rows[i].tgname).toBe(trBefore.rows[i].tgname);
      expect(trAfter.rows[i].def).toBe(trBefore.rows[i].def);
    }
    // Phase 1K baseline unchanged.
    const p1k = await db.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.opportunities_guard()'::regprocedure) AS def`,
    );
    expect(p1k.rows[0].def).toBe(phase1kDefBefore);
  });
});
