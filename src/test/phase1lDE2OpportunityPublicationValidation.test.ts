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

const read = (rel: string) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CANDIDATE_SQL = read(CANDIDATE_REL);
const PHASE_1K_SQL = read(PHASE_1K_MIG_REL);

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
  hiring_states text[],
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

const dbs: AnyPGlite[] = [];

async function makePGlite(): Promise<AnyPGlite> {
  const inst = new PGlite() as unknown as AnyPGlite;
  dbs.push(inst);
  return inst;
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
    hiring_states: null,
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
  db = await makePGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(PHASE_1K_SQL);
  await db.exec(PHASE_1K_TRIGGER_BINDING);
  await seedIdentities(db);

  // Capture Phase 1K state BEFORE candidate applies.
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

  // Apply candidate for the shared harness.
  await db.exec(CANDIDATE_SQL);
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
  it('reapplying the candidate leaves exactly one new trigger and unchanged function definitions', async () => {
    const defBefore = await db.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.opportunities_canonical_publication_guard()'::regprocedure) AS def`,
    );
    await db.exec(CANDIDATE_SQL);
    const defAfter = await db.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.opportunities_canonical_publication_guard()'::regprocedure) AS def`,
    );
    expect(defAfter.rows[0].def).toBe(defBefore.rows[0].def);
    const tr = await db.query<{ ct: string }>(
      `SELECT count(*)::text AS ct FROM pg_trigger
        WHERE tgname = 'trg_opportunities_canonical_publication_guard'`,
    );
    expect(tr.rows[0].ct).toBe('1');
    // And Phase 1K guard still byte-identical.
    const p1k = await db.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.opportunities_guard()'::regprocedure) AS def`,
    );
    expect(p1k.rows[0].def).toBe(phase1kDefBefore);
  });
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
    ['hiring area',       { hiring_city: '', hiring_state: '', hiring_states: null }, 'Provide a hiring city and state, or at least one hiring state.'],
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
      const d = parseDetail(a.err);
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
      expect(parseDetail(a.err).blocking_reasons)
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
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('CPM must be greater than zero.');
  });
  it('missing weekly miles blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ ...cpmBase, estimated_weekly_miles: null }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Total weekly miles must be greater than zero for CPM pay.');
  });
  it('explicit zero loaded miles blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ ...cpmBase, estimated_loaded_miles: 0 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Loaded miles cannot be zero when provided.');
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
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Specify whether deadhead miles are paid (yes or no).');
  });
});

describe('percentage / flat / salary boundaries', () => {
  it('missing percentage_pay blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'percentage', flat_weekly_pay: null,
      percentage_pay: null, percentage_basis_label: 'Line-haul', percentage_weekly_revenue_basis: 5000 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Percentage rate must be greater than zero.');
  });
  it('missing basis label blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'percentage', flat_weekly_pay: null,
      percentage_pay: 30, percentage_basis_label: '', percentage_weekly_revenue_basis: 5000 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Percentage basis label is required.');
  });
  it('missing basis amount blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'percentage', flat_weekly_pay: null,
      percentage_pay: 30, percentage_basis_label: 'x', percentage_weekly_revenue_basis: null }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Percentage weekly revenue basis must be greater than zero.');
  });
  it('zero flat weekly pay blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ flat_weekly_pay: 0 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Flat weekly pay must be greater than zero.');
  });
  it('missing salary amount blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'salary', flat_weekly_pay: null,
      salary_amount: null, salary_frequency: 'annual' }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Salary amount must be greater than zero.');
  });
  it('invalid salary frequency blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'salary', flat_weekly_pay: null,
      salary_amount: 100000, salary_frequency: 'quarterly' }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Salary pay period is required.');
  });
});

describe('mixed pay boundaries', () => {
  it('only one complete component blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'mixed', flat_weekly_pay: null,
      mixed_pay_components: JSON.stringify([{ label: 'Base', amount: 1000, frequency: 'weekly' }]) }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons)
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
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Mixed component 2 needs a label.');
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
      expect(String(a.err.code)).toBe('23514');
      expect(parseDetail(a.err).blocking_reasons).toContain('Mixed component 1 amount must be zero or greater.');
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
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Mixed component 1 frequency is required.');
  });
});

describe('"other" boundaries', () => {
  it('missing label blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'other', flat_weekly_pay: null,
      other_pay_method_label: '', other_weekly_gross: 1200 }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Pay method label is required for “Other”.');
  });
  it('missing weekly gross blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, publishableRow({ pay_model: 'other', flat_weekly_pay: null,
      other_pay_method_label: 'Piece-rate', other_weekly_gross: null }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Supported weekly gross must be greater than zero for “Other”.');
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
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons)
      .toContain('Insurance amount is required when a frequency is set.');
  });
  it('amount without frequency blocks (Maintenance)', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      maintenance_deductions: 100, maintenance_deduction_frequency: null,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons)
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
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons)
      .toContain('Lease payment frequency is required when an amount is set.');
  });
  it('escrow required with missing amount blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'required', escrow_amount: null, escrow_amount_frequency: 'weekly',
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Escrow amount is required when escrow is required.');
  });
  it('escrow required with missing frequency blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'required', escrow_amount: 100, escrow_amount_frequency: null,
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons).toContain('Escrow frequency is required when escrow is required.');
  });
  it('escrow not_required with positive stale amount blocks', async () => {
    await setUid(db, RECR_UID);
    const a = await tryInsert(db, base({
      escrow_required_state: 'not_required', escrow_amount: 50, escrow_amount_frequency: 'weekly',
    }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons)
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
    if (!a.ok) expect(parseDetail(a.err).blocking_reasons)
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
      expect(String(a.err.code)).toBe('23514');
      expect(String(a.err.message)).toContain('Opportunity does not meet publication requirements.');
      expect(String(a.err.hint)).toBe('Save as draft or correct the listed fields before publishing.');
      const d = parseDetail(a.err);
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
      expect(parseDetail(upd.err).blocking_reasons)
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
