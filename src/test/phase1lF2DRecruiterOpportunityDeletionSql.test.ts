// @vitest-environment node
// =====================================================================
// Phase 1L-F2D — Safe recruiter opportunity delete RPC (PGlite runtime).
//
// Loads the candidate migration directly from disk and exercises the
// RPC against a schema-faithful PGlite instance that reproduces the
// canonical helper, roles, RLS-protected opportunities table with the
// existing admin DELETE policy sentinel, the five blocker tables, and
// saved_opportunities.
// =====================================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const CANDIDATE_REL =
  '../../supabase/migrations/20260722170358_93a70bd3-5a69-464e-85a2-6c4fbc1b7861.sql';
const CANDIDATE_SQL = fs.readFileSync(
  fileURLToPath(new URL(CANDIDATE_REL, import.meta.url)),
  'utf8',
);

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close?(): Promise<void>;
}

const RECR_UID = '22222222-2222-4222-8222-222222222222';
const RECR_RP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_UID = '33333333-3333-4333-8333-333333333333';
const OTHER_RP_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ADMIN_UID = '11111111-1111-4111-8111-111111111111';

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
  email text NOT NULL
);

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id = _user_id) $$;

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_name text NOT NULL DEFAULT '',
  recruiter_email text,
  company_name text NOT NULL DEFAULT '',
  dot_number text,
  mc_number text,
  verification_status text NOT NULL DEFAULT 'approved',
  status text NOT NULL DEFAULT 'active',
  posting_terms_accepted_at timestamptz DEFAULT now(),
  legacy_terms_grandfathered_at timestamptz
);

CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(_recruiter_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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
  status text NOT NULL DEFAULT 'draft',
  admin_review_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_delete_opportunities ON public.opportunities
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TABLE public.opportunity_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL
);
CREATE TABLE public.driver_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  recruiter_id uuid NOT NULL
);
CREATE TABLE public.opportunity_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT
);
CREATE TABLE public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT
);
CREATE TABLE public.opportunity_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT
);
CREATE TABLE public.saved_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
);
`;

async function setUid(inst: AnyPGlite, uid: string | null) {
  await inst.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
}

async function seedIdentities(inst: AnyPGlite) {
  await inst.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2),($3,$4),($5,$6)`, [
    ADMIN_UID, 'a@t', RECR_UID, 'r@t', OTHER_UID, 'o@t',
  ]);
  await inst.query(`INSERT INTO public.admin_users(user_id,email) VALUES ($1,'a@t')`, [ADMIN_UID]);
  await inst.query(
    `INSERT INTO public.recruiter_profiles(id,user_id,recruiter_name,recruiter_email,company_name,dot_number)
     VALUES ($1,$2,'Recr','r@t','Ord Co','D2'),($3,$4,'Other','o@t','Other Co','D3')`,
    [RECR_RP_ID, RECR_UID, OTHER_RP_ID, OTHER_UID],
  );
}

async function insertOpp(inst: AnyPGlite, recruiterId: string, status: string): Promise<string> {
  const r = await inst.query<{ id: string }>(
    `INSERT INTO public.opportunities(recruiter_id,title,company_name,status)
       VALUES ($1,'T','Co',$2) RETURNING id`,
    [recruiterId, status],
  );
  return r.rows[0].id;
}

async function callRpc(
  inst: AnyPGlite,
  uid: string | null,
  id: string | null,
): Promise<{ result_code: string; blockers?: string[] }> {
  await setUid(inst, uid);
  const r = await inst.query<{ result: { result_code: string; blockers?: string[] } }>(
    `SELECT public.delete_recruiter_opportunity($1::uuid) AS result`,
    [id],
  );
  return r.rows[0].result;
}

async function oppExists(inst: AnyPGlite, id: string): Promise<boolean> {
  const r = await inst.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.opportunities WHERE id = $1`,
    [id],
  );
  return r.rows[0].n !== '0';
}
async function savedCount(inst: AnyPGlite, id: string): Promise<number> {
  const r = await inst.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.saved_opportunities WHERE opportunity_id = $1`,
    [id],
  );
  return Number(r.rows[0].n);
}

let db: AnyPGlite;
const dbs: AnyPGlite[] = [];

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;
  dbs.push(db);
  await db.exec(BOOTSTRAP);
  await seedIdentities(db);
  await db.exec(CANDIDATE_SQL);
});

afterAll(async () => {
  for (const inst of dbs) {
    try { await inst.close?.(); } catch { /* ignore */ }
  }
});

describe('Phase 1L-F2D — function shape & privileges', () => {
  it('function exists with uuid argument', async () => {
    const r = await db.query<{ args: string }>(
      `SELECT pg_get_function_identity_arguments('public.delete_recruiter_opportunity(uuid)'::regprocedure) AS args`,
    );
    expect(r.rows[0].args).toBe('p_opportunity_id uuid');
  });
  it('returns jsonb', async () => {
    const r = await db.query<{ rt: string }>(
      `SELECT pg_catalog.format_type(p.prorettype, NULL) AS rt
         FROM pg_proc p WHERE p.oid = 'public.delete_recruiter_opportunity(uuid)'::regprocedure`,
    );
    expect(r.rows[0].rt).toBe('jsonb');
  });
  it('is SECURITY DEFINER, plpgsql, with pinned search_path', async () => {
    const r = await db.query<{ lang: string; secdef: boolean; cfg: string[] | null }>(
      `SELECT l.lanname AS lang, p.prosecdef AS secdef, p.proconfig AS cfg
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = 'public.delete_recruiter_opportunity(uuid)'::regprocedure`,
    );
    expect(r.rows[0].lang).toBe('plpgsql');
    expect(r.rows[0].secdef).toBe(true);
    expect((r.rows[0].cfg ?? []).some((c) => c === 'search_path=public')).toBe(true);
  });
  it('authenticated has EXECUTE', async () => {
    const r = await db.query<{ v: boolean }>(
      `SELECT has_function_privilege('authenticated','public.delete_recruiter_opportunity(uuid)','EXECUTE') AS v`,
    );
    expect(r.rows[0].v).toBe(true);
  });
  it('anon lacks EXECUTE', async () => {
    const r = await db.query<{ v: boolean }>(
      `SELECT has_function_privilege('anon','public.delete_recruiter_opportunity(uuid)','EXECUTE') AS v`,
    );
    expect(r.rows[0].v).toBe(false);
  });
  it('PUBLIC (grantee OID 0) lacks EXECUTE', async () => {
    const r = await db.query<{ v: boolean }>(
      `SELECT NOT EXISTS(
         SELECT 1 FROM pg_proc p,
              aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE p.oid = 'public.delete_recruiter_opportunity(uuid)'::regprocedure
           AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
       ) AS v`,
    );
    expect(r.rows[0].v).toBe(true);
  });
  it('function body references auth.uid(), FOR UPDATE, canonical helper', async () => {
    const r = await db.query<{ src: string }>(
      `SELECT prosrc AS src FROM pg_proc
        WHERE oid = 'public.delete_recruiter_opportunity(uuid)'::regprocedure`,
    );
    const src = r.rows[0].src;
    expect(src).toContain('auth.uid()');
    expect(src).toContain('FOR UPDATE');
    expect(src).toContain('current_user_can_manage_recruiter_opportunities');
  });
  it('no new DELETE policy was created on public.opportunities beyond the admin sentinel', async () => {
    const r = await db.query<{ polname: string }>(
      `SELECT p.polname
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname = 'opportunities' AND p.polcmd = 'd'
        ORDER BY p.polname`,
    );
    expect(r.rows.map((x) => x.polname)).toEqual(['admin_delete_opportunities']);
  });
});

describe('Phase 1L-F2D — authorization non-enumeration', () => {
  it('null caller returns not_found', async () => {
    const id = await insertOpp(db, RECR_RP_ID, 'draft');
    const res = await callRpc(db, null, id);
    expect(res).toEqual({ result_code: 'not_found' });
    expect(await oppExists(db, id)).toBe(true);
  });
  it('null opportunity id returns not_found', async () => {
    const res = await callRpc(db, RECR_UID, null);
    expect(res).toEqual({ result_code: 'not_found' });
  });
  it('unknown UUID returns not_found', async () => {
    const res = await callRpc(db, RECR_UID, '99999999-9999-4999-8999-999999999999');
    expect(res).toEqual({ result_code: 'not_found' });
  });
  it('wrong recruiter returns not_found and row remains', async () => {
    const id = await insertOpp(db, RECR_RP_ID, 'draft');
    const res = await callRpc(db, OTHER_UID, id);
    expect(res).toEqual({ result_code: 'not_found' });
    expect(await oppExists(db, id)).toBe(true);
  });
});

describe('Phase 1L-F2D — status gating', () => {
  it('active owner returns status_blocked and row remains', async () => {
    const id = await insertOpp(db, RECR_RP_ID, 'active');
    const res = await callRpc(db, RECR_UID, id);
    expect(res).toEqual({ result_code: 'status_blocked' });
    expect(await oppExists(db, id)).toBe(true);
  });
  it('paused owner returns status_blocked and row remains', async () => {
    const id = await insertOpp(db, RECR_RP_ID, 'paused');
    const res = await callRpc(db, RECR_UID, id);
    expect(res).toEqual({ result_code: 'status_blocked' });
    expect(await oppExists(db, id)).toBe(true);
  });
});

describe('Phase 1L-F2D — successful deletion', () => {
  it('draft owner deletes opportunity and clears saved bookmarks', async () => {
    const id = await insertOpp(db, RECR_RP_ID, 'draft');
    await db.query(
      `INSERT INTO public.saved_opportunities(opportunity_id,user_id) VALUES ($1,$2),($1,$3)`,
      [id, RECR_UID, OTHER_UID],
    );
    expect(await savedCount(db, id)).toBe(2);
    const res = await callRpc(db, RECR_UID, id);
    expect(res).toEqual({ result_code: 'deleted' });
    expect(await oppExists(db, id)).toBe(false);
    expect(await savedCount(db, id)).toBe(0);
  });
  it('closed owner deletes opportunity', async () => {
    const id = await insertOpp(db, RECR_RP_ID, 'closed');
    const res = await callRpc(db, RECR_UID, id);
    expect(res).toEqual({ result_code: 'deleted' });
    expect(await oppExists(db, id)).toBe(false);
  });
  it('successful deletion does not affect unrelated opportunities or bookmarks', async () => {
    const kept = await insertOpp(db, RECR_RP_ID, 'draft');
    const gone = await insertOpp(db, RECR_RP_ID, 'draft');
    await db.query(
      `INSERT INTO public.saved_opportunities(opportunity_id,user_id) VALUES ($1,$2),($3,$2)`,
      [kept, RECR_UID, gone],
    );
    const res = await callRpc(db, RECR_UID, gone);
    expect(res).toEqual({ result_code: 'deleted' });
    expect(await oppExists(db, kept)).toBe(true);
    expect(await savedCount(db, kept)).toBe(1);
    expect(await oppExists(db, gone)).toBe(false);
  });
});

describe('Phase 1L-F2D — blocker preservation', () => {
  async function seedBlocker(table: string, id: string) {
    if (table === 'driver_referrals') {
      await db.query(
        `INSERT INTO public.driver_referrals(opportunity_id, recruiter_id) VALUES ($1,$2)`,
        [id, RECR_RP_ID],
      );
    } else if (table === 'opportunity_applications') {
      await db.query(
        `INSERT INTO public.opportunity_applications(opportunity_id, driver_id) VALUES ($1,$2)`,
        [id, OTHER_UID],
      );
    } else {
      await db.query(`INSERT INTO public.${table}(opportunity_id) VALUES ($1)`, [id]);
    }
  }

  const cases: Array<[string, string, string]> = [
    ['opportunity_applications', 'applications', 'application'],
    ['driver_referrals', 'referrals', 'referral'],
    ['opportunity_offers', 'offers', 'offer'],
    ['contracts', 'contracts', 'contract'],
    ['opportunity_reports', 'reports', 'report'],
  ];
  it.each(cases)('%s blocker preserves opportunity and %s row', async (table, blockerName) => {
    const id = await insertOpp(db, RECR_RP_ID, 'draft');
    await seedBlocker(table, id);
    const res = await callRpc(db, RECR_UID, id);
    expect(res.result_code).toBe('related_records');
    expect(res.blockers).toEqual([blockerName]);
    expect(await oppExists(db, id)).toBe(true);
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.${table} WHERE opportunity_id = $1`,
      [id],
    );
    expect(r.rows[0].n).toBe('1');
  });

  it('multi-blocker returns only present blockers in the exact required order', async () => {
    const id = await insertOpp(db, RECR_RP_ID, 'draft');
    // Insert offers + applications + contracts (skipping referrals & reports).
    await db.query(`INSERT INTO public.opportunity_offers(opportunity_id) VALUES ($1)`, [id]);
    await db.query(
      `INSERT INTO public.opportunity_applications(opportunity_id, driver_id) VALUES ($1,$2)`,
      [id, OTHER_UID],
    );
    await db.query(`INSERT INTO public.contracts(opportunity_id) VALUES ($1)`, [id]);
    const res = await callRpc(db, RECR_UID, id);
    expect(res.result_code).toBe('related_records');
    // Contractual order: applications, referrals, offers, contracts, reports.
    expect(res.blockers).toEqual(['applications', 'offers', 'contracts']);
    expect(await oppExists(db, id)).toBe(true);
  });

  it('blocked deletion preserves saved bookmarks', async () => {
    const id = await insertOpp(db, RECR_RP_ID, 'draft');
    await db.query(
      `INSERT INTO public.saved_opportunities(opportunity_id,user_id) VALUES ($1,$2)`,
      [id, OTHER_UID],
    );
    await db.query(`INSERT INTO public.opportunity_reports(opportunity_id) VALUES ($1)`, [id]);
    const res = await callRpc(db, RECR_UID, id);
    expect(res.result_code).toBe('related_records');
    expect(await savedCount(db, id)).toBe(1);
    expect(await oppExists(db, id)).toBe(true);
  });
});

describe('Phase 1L-F2D — migration scope', () => {
  it('migration adds no trigger on public.opportunities beyond pre-existing', async () => {
    const r = await db.query<{ tgname: string }>(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname='opportunities' AND NOT t.tgisinternal`,
    );
    expect(r.rows.length).toBe(0);
  });
  it('migration adds no index/view/type', () => {
    expect(CANDIDATE_SQL).not.toMatch(/CREATE\s+INDEX/i);
    expect(CANDIDATE_SQL).not.toMatch(/CREATE\s+VIEW/i);
    expect(CANDIDATE_SQL).not.toMatch(/CREATE\s+TYPE/i);
    expect(CANDIDATE_SQL).not.toMatch(/CREATE\s+TABLE/i);
    expect(CANDIDATE_SQL).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(CANDIDATE_SQL).not.toMatch(/CREATE\s+POLICY/i);
  });
  it('existing admin_delete_opportunities policy definition is intact', async () => {
    const r = await db.query<{ polname: string; qual: string }>(
      `SELECT p.polname, pg_get_expr(p.polqual, p.polrelid) AS qual
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname='opportunities' AND p.polname='admin_delete_opportunities'`,
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].qual).toContain('is_admin');
  });
});
