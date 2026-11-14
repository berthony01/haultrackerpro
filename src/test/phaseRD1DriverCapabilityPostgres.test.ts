// @vitest-environment node
// RD-1 candidate on a disposable native PostgreSQL cluster. Baseline own-record
// policies are copied from the live catalog (2026-11-14); assistant policies
// use the live expressions with a table-backed assistant_has_permission stub.
// Set RD1_BASELINE=1 to run against the pre-change state (expected failures).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const RD1 = 'supabase/migration-candidates/20261114143000_phase_rd1_explicit_driver_capability.sql';
const BASELINE = process.env.RD1_BASELINE === '1';
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG') && k !== 'DATABASE_URL'));
const run = (bin: string, args: string[]) => process.getuid?.() === 0
  ? execFileSync('setpriv', ['--reuid=1000', '--regid=1000', '--clear-groups', bin, ...args], { env, stdio: 'pipe' })
  : execFileSync(bin, args, { env, stdio: 'pipe' });

let dir = '', pool: pg.Pool;
const u = { driver: randomUUID(), recruiter: randomUUID(), legacyRec: randomUUID(), assistant: randomUUID(), suspended: randomUUID(), revoked: randomUUID(), setup: randomUUID() };
const legacyLoad = randomUUID();
const TABLES = ['loads', 'expenses', 'fuel_logs', 'recurring_expense_templates'] as const;
const PERM: Record<string, string> = { loads: 'manage_loads', expenses: 'manage_expenses', fuel_logs: 'manage_fuel', recurring_expense_templates: '' };

async function as(actor: string | null, sql: string, args: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated');
    await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor ?? '']);
    const r = await c.query(sql, args); await c.query('COMMIT'); return r;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
const cap = async (id: string) => (await pool.query("SELECT status FROM public.user_capabilities WHERE user_id=$1 AND capability='driver'", [id])).rows[0]?.status ?? null;
const counts = async () => Object.fromEntries(await Promise.all([...TABLES, 'load_stops', 'user_capabilities'].map(async (t) => [t, (await pool.query(`SELECT count(*)::int n, md5(coalesce(string_agg(t::text, ',' ORDER BY t::text),'')) h FROM public.${t} t`)).rows[0]])));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rd1-pg-')); if (process.getuid?.() === 0) execFileSync('chown', ['1000:1000', dir]);
  console.log('RD-1 native', run('postgres', ['--version']).toString().trim(), BASELINE ? '(BASELINE)' : '(CANDIDATE)');
  run('initdb', ['-D', join(dir, 'data'), '-U', 'local_owner', '-A', 'trust', '--no-locale']);
  run('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'pg.log'), '-o', `-k ${dir} -h '' -p 55443`, '-w', 'start']);
  pool = new pg.Pool({ host: dir, port: 55443, user: 'local_owner', database: 'postgres', password: '', ssl: false, max: 6 });
  const mig = readFileSync('supabase/migrations/20260720110000_phase1j_additive_user_capabilities.sql', 'utf8');
  const trig = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public._provision_driver_capability_for_new_user'), mig.indexOf('-- 7. Public RPCs'));
  await pool.query(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TYPE public.user_capability_type AS ENUM ('driver','recruiter');
    CREATE TYPE public.user_capability_status AS ENUM ('setup','active','suspended','revoked');
    CREATE TABLE public.user_capabilities(user_id uuid NOT NULL,capability public.user_capability_type NOT NULL,status public.user_capability_status NOT NULL,activated_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,capability));
    GRANT SELECT ON public.user_capabilities TO authenticated; ALTER TABLE public.user_capabilities ENABLE ROW LEVEL SECURITY;
    CREATE POLICY user_capabilities_self_select ON public.user_capabilities FOR SELECT TO authenticated USING (user_id = auth.uid());
    CREATE TABLE public.assistant_grants(assistant uuid, driver uuid, perm text);
    CREATE FUNCTION public.assistant_has_permission(_a uuid,_d uuid,_p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.assistant_grants WHERE assistant=_a AND driver=_d AND perm=_p) $$;
    ${trig}
  `);
  for (const t of [...TABLES, 'load_stops']) {
    await pool.query(`CREATE TABLE public.${t}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, note text${t === 'load_stops' ? ', load_id uuid NOT NULL' : ''});
      GRANT SELECT,INSERT,UPDATE,DELETE ON public.${t} TO authenticated; ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
  }
  // Live baseline own-record policies (names/expressions from pg_policies, 2026-11-14).
  const own: Record<string, string> = { loads: 'loads', expenses: 'expenses', fuel_logs: 'fuel logs', recurring_expense_templates: 'templates' };
  for (const t of TABLES) {
    const n = own[t];
    await pool.query(`CREATE POLICY "Users can view own ${n}" ON public.${t} FOR SELECT USING (auth.uid() = user_id);
      CREATE POLICY "Users can insert own ${n}" ON public.${t} FOR INSERT WITH CHECK (auth.uid() = user_id);
      CREATE POLICY "Users can update own ${n}" ON public.${t} FOR UPDATE USING (auth.uid() = user_id);
      CREATE POLICY "Users can delete own ${n}" ON public.${t} FOR DELETE USING (auth.uid() = user_id);`);
    if (PERM[t]) await pool.query(`
      CREATE POLICY ${t}_assistant_select ON public.${t} FOR SELECT TO authenticated USING (public.assistant_has_permission(auth.uid(), user_id, '${PERM[t]}'));
      CREATE POLICY ${t}_assistant_insert ON public.${t} FOR INSERT TO authenticated WITH CHECK (public.assistant_has_permission(auth.uid(), user_id, '${PERM[t]}'));
      CREATE POLICY ${t}_assistant_update ON public.${t} FOR UPDATE TO authenticated USING (public.assistant_has_permission(auth.uid(), user_id, '${PERM[t]}')) WITH CHECK (public.assistant_has_permission(auth.uid(), user_id, '${PERM[t]}'));`);
  }
  await pool.query(`CREATE POLICY "Users can view own load stops" ON public.load_stops FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "Users can insert own load stops" ON public.load_stops FOR INSERT WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM loads WHERE loads.id = load_stops.load_id AND loads.user_id = auth.uid()));
    CREATE POLICY "Users can update own load stops" ON public.load_stops FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM loads WHERE loads.id = load_stops.load_id AND loads.user_id = auth.uid()));
    CREATE POLICY "Users can delete own load stops" ON public.load_stops FOR DELETE USING (auth.uid() = user_id);
    CREATE POLICY load_stops_assistant_insert ON public.load_stops FOR INSERT TO authenticated WITH CHECK (public.assistant_has_permission(auth.uid(), user_id, 'manage_loads') AND EXISTS (SELECT 1 FROM loads l WHERE l.id = load_stops.load_id AND l.user_id = load_stops.user_id));`);
  // Fixture: driver (active), legacy recruiter-intent owner WITH legacy active driver + 1 load,
  // recruiter-only, assistant (no driver) delegated to driver, suspended, revoked, setup.
  await pool.query(`INSERT INTO public.user_capabilities(user_id,capability,status) VALUES
    ($1,'driver','active'),($2,'driver','active'),($2,'recruiter','active'),($3,'recruiter','active'),
    ($4,'driver','suspended'),($5,'driver','revoked'),($6,'driver','setup')`, [u.driver, u.legacyRec, u.recruiter, u.suspended, u.revoked, u.setup]);
  await pool.query(`INSERT INTO public.loads(id,user_id,note) VALUES ($1,$2,'legacy')`, [legacyLoad, u.legacyRec]);
  await pool.query(`INSERT INTO public.load_stops(user_id,load_id) VALUES ($1,$2)`, [u.legacyRec, legacyLoad]);
  await pool.query(`INSERT INTO public.assistant_grants VALUES ($1,$2,'manage_loads'),($1,$2,'manage_expenses'),($1,$2,'manage_fuel')`, [u.assistant, u.driver]);
  const before = await counts();
  if (!BASELINE) await pool.query(readFileSync(RD1, 'utf8'));
  expect(await counts()).toEqual(before); // migration changes no rows
}, 60000);
afterAll(async () => { if (pool) await pool.end(); if (dir) { try { run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'immediate', '-w', 'stop']); } finally { rmSync(dir, { recursive: true, force: true }); } } });

describe('signup provisioning', () => {
  const signup = async (meta: object | null) => { const id = randomUUID(); await pool.query('INSERT INTO auth.users VALUES ($1,$2)', [id, meta]); return cap(id); };
  it('driver signup gets active driver', async () => expect(await signup({ signup_capability: 'driver', intended_role: 'driver' })).toBe('active'));
  it('recruiter signup gets no driver', async () => expect(await signup({ signup_capability: 'recruiter', intended_role: 'recruiter' })).toBeNull());
  it('assistant signup gets no driver even with intended_role=driver', async () => expect(await signup({ signup_capability: 'assistant', intended_role: 'driver' })).toBeNull());
  it('agency signup gets no driver even with intended_role=driver', async () => expect(await signup({ signup_capability: 'agency', intended_role: 'driver' })).toBeNull());
  it('OAuth signup without intent gets no driver', async () => expect(await signup({ full_name: 'G User' })).toBeNull());
  it('null metadata gets no driver', async () => expect(await signup(null)).toBeNull());
});

describe.skipIf(BASELINE)('activate_my_driver_workspace', () => {
  const act = (a: string | null) => as(a, 'SELECT public.activate_my_driver_workspace() AS r').then((r) => r.rows[0].r);
  it('refuses unauthenticated', async () => { await expect(act(null)).rejects.toThrow(/Not authenticated/); });
  it('anon has no EXECUTE', async () => {
    const c = await pool.connect(); try { await c.query('SET ROLE anon'); await expect(c.query('SELECT public.activate_my_driver_workspace()')).rejects.toThrow(/permission denied/); } finally { await c.query('RESET ROLE'); c.release(); }
  });
  it('recruiter self-activates; idempotent; other users untouched', async () => {
    const other = await counts();
    expect(await act(u.recruiter)).toBe('active');
    expect(await act(u.recruiter)).toBe('active');
    expect((await pool.query("SELECT count(*)::int n FROM public.user_capabilities WHERE user_id=$1", [u.recruiter])).rows[0].n).toBe(2);
    expect(await cap(u.recruiter)).toBe('active');
    expect((await counts()).loads).toEqual(other.loads);
    await pool.query("DELETE FROM public.user_capabilities WHERE user_id=$1 AND capability='driver'", [u.recruiter]);
  });
  it('takes no user-id argument (cannot target another user)', async () => {
    await expect(as(u.recruiter, 'SELECT public.activate_my_driver_workspace($1) AS r', [u.assistant])).rejects.toThrow(/does not exist/);
  });
  it('never reactivates suspended or revoked', async () => {
    expect(await act(u.suspended)).toBe('suspended'); expect(await cap(u.suspended)).toBe('suspended');
    expect(await act(u.revoked)).toBe('revoked'); expect(await cap(u.revoked)).toBe('revoked');
  });
  it('promotes setup to active', async () => expect(await act(u.setup)).toBe('active'));
});

describe.skipIf(BASELINE)('has_my_active_driver_capability (self-only helper)', () => {
  const me = (a: string | null) => as(a, 'SELECT public.has_my_active_driver_capability() AS r').then((r) => r.rows[0].r);
  it('no callable has_active_driver_capability(uuid) exists', async () => {
    expect((await pool.query("SELECT count(*)::int n FROM pg_proc WHERE proname='has_active_driver_capability'")).rows[0].n).toBe(0);
    await expect(as(u.recruiter, 'SELECT public.has_active_driver_capability($1)', [u.driver])).rejects.toThrow(/does not exist/);
  });
  it('takes no user-id argument', async () => {
    await expect(as(u.recruiter, 'SELECT public.has_my_active_driver_capability($1)', [u.driver])).rejects.toThrow(/does not exist/);
  });
  it('reflects only the current auth id', async () => {
    expect(await me(u.driver)).toBe(true);
    expect(await me(u.recruiter)).toBe(false);
    expect(await me(u.suspended)).toBe(false);
    expect(await me(u.revoked)).toBe(false);
    expect(await me(null)).toBe(false);
  });
  it('anon has no EXECUTE; SECURITY DEFINER with pg_catalog search_path', async () => {
    const c = await pool.connect(); try { await c.query('SET ROLE anon'); await expect(c.query('SELECT public.has_my_active_driver_capability()')).rejects.toThrow(/permission denied/); } finally { await c.query('RESET ROLE'); c.release(); }
    const r = (await pool.query("SELECT prosecdef, proconfig, pronargs FROM pg_proc WHERE proname='has_my_active_driver_capability'")).rows[0];
    expect(r).toEqual({ prosecdef: true, proconfig: ['search_path=pg_catalog'], pronargs: 0 });
  });
});

describe('own-record writes require active driver', () => {
  for (const t of TABLES) {
    it(`${t}: recruiter-only INSERT denied`, async () => {
      await expect(as(u.recruiter, `INSERT INTO public.${t}(user_id) VALUES ($1)`, [u.recruiter])).rejects.toThrow(/row-level security/);
    });
    it(`${t}: suspended/revoked driver INSERT denied`, async () => {
      await expect(as(u.suspended, `INSERT INTO public.${t}(user_id) VALUES ($1)`, [u.suspended])).rejects.toThrow(/row-level security/);
      await expect(as(u.revoked, `INSERT INTO public.${t}(user_id) VALUES ($1)`, [u.revoked])).rejects.toThrow(/row-level security/);
    });
    it(`${t}: active driver INSERT/UPDATE/DELETE own allowed; cross-user denied`, async () => {
      const id = (await as(u.driver, `INSERT INTO public.${t}(user_id,note) VALUES ($1,'x') RETURNING id`, [u.driver])).rows[0].id;
      expect((await as(u.driver, `UPDATE public.${t} SET note='y' WHERE id=$1`, [id])).rowCount).toBe(1);
      await expect(as(u.driver, `UPDATE public.${t} SET user_id=$2 WHERE id=$1`, [id, u.recruiter])).rejects.toThrow(/row-level security/);
      await expect(as(u.driver, `INSERT INTO public.${t}(user_id) VALUES ($1)`, [u.legacyRec])).rejects.toThrow(/row-level security/);
      expect((await as(u.recruiter, `UPDATE public.${t} SET note='z' WHERE id=$1`, [id])).rowCount).toBe(0);
      expect((await as(u.recruiter, `DELETE FROM public.${t} WHERE id=$1`, [id])).rowCount).toBe(0);
      expect((await as(u.driver, `DELETE FROM public.${t} WHERE id=$1`, [id])).rowCount).toBe(1);
    });
  }
  it('recruiter-only UPDATE/DELETE of own row (e.g. inserted by service path) denied', async () => {
    const id = (await pool.query(`INSERT INTO public.expenses(user_id,note) VALUES ($1,'svc') RETURNING id`, [u.recruiter])).rows[0].id;
    expect((await as(u.recruiter, `UPDATE public.expenses SET note='x' WHERE id=$1`, [id])).rowCount).toBe(0);
    expect((await as(u.recruiter, `DELETE FROM public.expenses WHERE id=$1`, [id])).rowCount).toBe(0);
    expect((await as(u.recruiter, `SELECT id FROM public.expenses WHERE id=$1`, [id])).rowCount).toBe(1); // reads preserved
    await pool.query('DELETE FROM public.expenses WHERE id=$1', [id]);
  });
  it('load_stops: recruiter-only denied, driver own allowed', async () => {
    const lid = (await as(u.driver, `INSERT INTO public.loads(user_id) VALUES ($1) RETURNING id`, [u.driver])).rows[0].id;
    expect((await as(u.driver, `INSERT INTO public.load_stops(user_id,load_id) VALUES ($1,$2) RETURNING id`, [u.driver, lid])).rowCount).toBe(1);
    const rlid = (await pool.query(`INSERT INTO public.loads(user_id) VALUES ($1) RETURNING id`, [u.recruiter])).rows[0].id;
    await expect(as(u.recruiter, `INSERT INTO public.load_stops(user_id,load_id) VALUES ($1,$2)`, [u.recruiter, rlid])).rejects.toThrow(/row-level security/);
  });
  it('delegated assistant (no own driver capability) keeps granted writes for the driver', async () => {
    for (const t of ['loads', 'expenses', 'fuel_logs']) {
      const r = await as(u.assistant, `INSERT INTO public.${t}(user_id,note) VALUES ($1,'asst') RETURNING id`, [u.driver]);
      expect(r.rowCount).toBe(1);
      expect((await as(u.assistant, `UPDATE public.${t} SET note='asst2' WHERE id=$1`, [r.rows[0].id])).rowCount).toBe(1);
    }
    await expect(as(u.assistant, `INSERT INTO public.loads(user_id) VALUES ($1)`, [u.assistant])).rejects.toThrow(/row-level security/);
  });
  it('legacy recruiter-intent owner with legacy active driver keeps read+write of historical load', async () => {
    expect((await as(u.legacyRec, `SELECT id FROM public.loads WHERE id=$1`, [legacyLoad])).rowCount).toBe(1);
    expect((await as(u.legacyRec, `SELECT id FROM public.load_stops WHERE load_id=$1`, [legacyLoad])).rowCount).toBe(1);
    expect((await as(u.legacyRec, `UPDATE public.loads SET note='legacy' WHERE id=$1`, [legacyLoad])).rowCount).toBe(1);
  });
  it('anonymous writes denied', async () => {
    await expect(as(null, `INSERT INTO public.loads(user_id) VALUES ($1)`, [u.driver])).rejects.toThrow(/row-level security/);
  });
});
