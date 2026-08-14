// @vitest-environment node
// =====================================================================
// Phase DA-1 — Driver <-> Driver Assistant final hardening.
//
// Behavioral PGlite proof of the REAL candidate migration
//   supabase/migration-candidates/20260814223000_phase_da1_driver_assistant_final_hardening.sql
// executed against a schema-faithful baseline:
//   1. assistant_has_permission denies a DIRECT assistant when the driver is
//      not active Pro.
//   2. It allows an active DIRECT assistant holding the exact permission when
//      the driver IS active Pro.
//   3. Agency-delegated authorization is NOT newly tied to Driver Pro.
//   4. get_my_managed_drivers hides non-Pro DIRECT relationships and returns
//      driver_is_pro.
//   5. Plan-loss cleanup revokes pending + active DIRECT rows only, clears
//      invite token hashes, audits with reason driver_pro_ended, and leaves
//      agency-delegated rows untouched.
//
// No production database, no cloud application, no deploy, no publish.
// =====================================================================
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const CANDIDATE_REL =
  '../../supabase/migration-candidates/20260814223000_phase_da1_driver_assistant_final_hardening.sql';

const CANDIDATE_SQL = fs.readFileSync(
  fileURLToPath(new URL(CANDIDATE_REL, import.meta.url)),
  'utf8',
);

const DRIVER_PRO = '11111111-1111-1111-1111-111111111111';
const DRIVER_FREE = '22222222-2222-2222-2222-222222222222';
const DRIVER_AGENCY = '33333333-3333-3333-3333-333333333333';
const ASSISTANT = '44444444-4444-4444-4444-444444444444';

const BASELINE = `
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE anon;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fn$;

CREATE TABLE public.admin_users (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = _user_id);
$fn$;

CREATE TABLE public.subscriptions (
  user_id uuid PRIMARY KEY,
  plan_key text NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  display_name text
);

CREATE TABLE public.driver_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL,
  assistant_user_id uuid,
  invite_email text NOT NULL,
  invite_token_hash text,
  status text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  agency_delegation_id uuid,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.assistant_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegate_id uuid,
  driver_user_id uuid,
  assistant_user_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY,
  company_name text,
  company_start_date date,
  week_start_day text,
  currency text,
  tax_estimator_enabled boolean,
  federal_tax_percent numeric,
  state_tax_percent numeric,
  include_se_tax boolean,
  se_tax_percent numeric,
  buffer_percent numeric,
  tax_base_type text,
  lifecycle_emails_opt_in boolean
);

-- Pre-DA-1 authorization: active relationship + permission only.
CREATE FUNCTION public.assistant_has_permission(_assistant uuid, _driver uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.driver_assistants da
    WHERE da.assistant_user_id = _assistant
      AND da.driver_user_id = _driver
      AND da.status = 'active'
      AND COALESCE((da.permissions ->> _perm)::boolean, false) = true
  );
$fn$;

CREATE FUNCTION public.get_my_managed_drivers() RETURNS SETOF jsonb
LANGUAGE sql STABLE AS $fn$ SELECT '{}'::jsonb WHERE false; $fn$;
`;

let db: PGlite;

async function actAs(uid: string | null) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
}

async function seed() {
  await db.exec(`
    DELETE FROM public.assistant_audit_log;
    DELETE FROM public.driver_assistants;
    DELETE FROM public.subscriptions;
    DELETE FROM public.admin_users;
    DELETE FROM public.profiles;
    DELETE FROM auth.users;
  `);
  await db.query(
    `INSERT INTO auth.users (id, email) VALUES ($1,'pro@x.test'),($2,'free@x.test'),($3,'agency@x.test'),($4,'assistant@x.test')`,
    [DRIVER_PRO, DRIVER_FREE, DRIVER_AGENCY, ASSISTANT],
  );
  await db.query(
    `INSERT INTO public.subscriptions (user_id, plan_key, status) VALUES
       ($1,'pro_monthly','active'),
       ($2,'free','free'),
       ($3,'free','free')`,
    [DRIVER_PRO, DRIVER_FREE, DRIVER_AGENCY],
  );
  const perms = JSON.stringify({ manage_loads: true, view_reports: true });
  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, invite_email, invite_token_hash, status, permissions, agency_delegation_id, accepted_at)
     VALUES
       ($1,$4,'assistant@x.test','hash-pro','active',$5::jsonb,NULL,now()),
       ($2,$4,'assistant@x.test','hash-free','active',$5::jsonb,NULL,now()),
       ($3,$4,'assistant@x.test','hash-agency','active',$5::jsonb,'99999999-9999-9999-9999-999999999999',now())`,
    [DRIVER_PRO, DRIVER_FREE, DRIVER_AGENCY, ASSISTANT, perms],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASELINE);
  await db.exec(CANDIDATE_SQL);
});

beforeEach(async () => {
  await seed();
  await actAs(ASSISTANT);
});

describe('DA-1 · assistant_has_permission fails closed on driver Pro loss', () => {
  it('denies a DIRECT assistant when the driver is not active Pro', async () => {
    const r = await db.query<{ ok: boolean }>(
      `SELECT public.assistant_has_permission($1,$2,'manage_loads') AS ok`,
      [ASSISTANT, DRIVER_FREE],
    );
    expect(r.rows[0].ok).toBe(false);
  });

  it('allows an active DIRECT assistant with the exact permission when driver is Pro', async () => {
    const allowed = await db.query<{ ok: boolean }>(
      `SELECT public.assistant_has_permission($1,$2,'manage_loads') AS ok`,
      [ASSISTANT, DRIVER_PRO],
    );
    expect(allowed.rows[0].ok).toBe(true);

    const notGranted = await db.query<{ ok: boolean }>(
      `SELECT public.assistant_has_permission($1,$2,'manage_expenses') AS ok`,
      [ASSISTANT, DRIVER_PRO],
    );
    expect(notGranted.rows[0].ok).toBe(false);
  });

  it('does not newly tie AGENCY-delegated authorization to Driver Pro', async () => {
    const r = await db.query<{ ok: boolean }>(
      `SELECT public.assistant_has_permission($1,$2,'manage_loads') AS ok`,
      [ASSISTANT, DRIVER_AGENCY],
    );
    expect(r.rows[0].ok).toBe(true);
  });

  it('treats an admin driver as holding canonical Pro', async () => {
    await db.query(`INSERT INTO public.admin_users (user_id) VALUES ($1)`, [DRIVER_FREE]);
    const r = await db.query<{ ok: boolean }>(
      `SELECT public.assistant_has_permission($1,$2,'manage_loads') AS ok`,
      [ASSISTANT, DRIVER_FREE],
    );
    expect(r.rows[0].ok).toBe(true);
  });
});

describe('DA-1 · get_my_managed_drivers', () => {
  it('hides non-Pro DIRECT relationships and exposes driver_is_pro', async () => {
    const r = await db.query<{ row: any }>(`SELECT public.get_my_managed_drivers() AS row`);
    const rows = r.rows.map((x) => x.row);
    const ids = rows.map((x) => x.driver_user_id);

    expect(ids).toContain(DRIVER_PRO);
    expect(ids).toContain(DRIVER_AGENCY);
    expect(ids).not.toContain(DRIVER_FREE);

    const pro = rows.find((x) => x.driver_user_id === DRIVER_PRO);
    expect(pro.driver_is_pro).toBe(true);
    const agency = rows.find((x) => x.driver_user_id === DRIVER_AGENCY);
    expect(agency.driver_is_pro).toBe(false);
  });
});

describe('DA-1 · plan-loss cleanup', () => {
  it('revokes pending + active DIRECT rows only, clears tokens and audits the reason', async () => {
    await db.query(
      `INSERT INTO public.driver_assistants
         (driver_user_id, assistant_user_id, invite_email, invite_token_hash, status, permissions)
       VALUES ($1, NULL, 'pending@x.test', 'hash-pending', 'pending', '{}'::jsonb)`,
      [DRIVER_PRO],
    );
    await db.query(
      `INSERT INTO public.driver_assistants
         (driver_user_id, assistant_user_id, invite_email, invite_token_hash, status, permissions, revoked_at)
       VALUES ($1, NULL, 'old@x.test', NULL, 'revoked', '{}'::jsonb, now())`,
      [DRIVER_PRO],
    );
    // Agency-delegated row belonging to the SAME driver must survive.
    await db.query(
      `INSERT INTO public.driver_assistants
         (driver_user_id, assistant_user_id, invite_email, invite_token_hash, status, permissions, agency_delegation_id)
       VALUES ($1, $2, 'agency@x.test', 'hash-keep', 'active', '{}'::jsonb, '88888888-8888-8888-8888-888888888888')`,
      [DRIVER_PRO, ASSISTANT],
    );

    const res = await db.query<{ n: number }>(
      `SELECT public.revoke_direct_assistants_on_driver_pro_end($1) AS n`,
      [DRIVER_PRO],
    );
    expect(Number(res.rows[0].n)).toBe(2); // active direct + pending direct

    const direct = await db.query<{ status: string; invite_token_hash: string | null; revoked_at: string | null }>(
      `SELECT status, invite_token_hash, revoked_at FROM public.driver_assistants
        WHERE driver_user_id = $1 AND agency_delegation_id IS NULL`,
      [DRIVER_PRO],
    );
    expect(direct.rows.every((r) => r.status === 'revoked')).toBe(true);
    expect(direct.rows.every((r) => r.invite_token_hash === null)).toBe(true);
    expect(direct.rows.every((r) => r.revoked_at !== null)).toBe(true);
    // History preserved — nothing deleted.
    expect(direct.rows.length).toBe(3);

    const agency = await db.query<{ status: string; invite_token_hash: string | null }>(
      `SELECT status, invite_token_hash FROM public.driver_assistants
        WHERE driver_user_id = $1 AND agency_delegation_id IS NOT NULL`,
      [DRIVER_PRO],
    );
    expect(agency.rows[0].status).toBe('active');
    expect(agency.rows[0].invite_token_hash).toBe('hash-keep');

    const audit = await db.query<{ metadata: any; action: string }>(
      `SELECT action, metadata FROM public.assistant_audit_log WHERE driver_user_id = $1`,
      [DRIVER_PRO],
    );
    expect(audit.rows.length).toBe(2);
    expect(audit.rows.every((r) => r.metadata.reason === 'driver_pro_ended')).toBe(true);
  });

  it('does not touch another driver rows', async () => {
    await db.query(`SELECT public.revoke_direct_assistants_on_driver_pro_end($1)`, [DRIVER_FREE]);
    const other = await db.query<{ status: string }>(
      `SELECT status FROM public.driver_assistants WHERE driver_user_id = $1 AND agency_delegation_id IS NULL`,
      [DRIVER_PRO],
    );
    expect(other.rows[0].status).toBe('active');
  });
});

describe('DA-1 · narrow report settings RPC', () => {
  beforeEach(async () => {
    await db.query(
      `INSERT INTO public.user_settings
         (user_id, company_name, week_start_day, currency, tax_estimator_enabled, lifecycle_emails_opt_in)
       VALUES ($1,'Pro Driver LLC','monday','USD',true,true)
       ON CONFLICT (user_id) DO NOTHING`,
      [DRIVER_PRO],
    );
  });

  it('returns only report-relevant fields to an authorized assistant', async () => {
    const r = await db.query<any>(`SELECT * FROM public.get_driver_report_settings($1)`, [DRIVER_PRO]);
    expect(r.rows[0].company_name).toBe('Pro Driver LLC');
    const columns = Object.keys(r.rows[0]).sort();
    expect(columns).toEqual(
      [
        'buffer_percent',
        'company_name',
        'company_start_date',
        'currency',
        'federal_tax_percent',
        'include_se_tax',
        'se_tax_percent',
        'state_tax_percent',
        'tax_base_type',
        'tax_estimator_enabled',
        'week_start_day',
      ].sort(),
    );
    expect(columns).not.toContain('lifecycle_emails_opt_in');
    expect(columns).not.toContain('user_id');
  });

  it('denies an assistant with no authorized relationship', async () => {
    await actAs(ASSISTANT);
    await expect(
      db.query(`SELECT * FROM public.get_driver_report_settings($1)`, [DRIVER_FREE]),
    ).rejects.toThrow(/not authorized/);
  });

  it('allows the driver to read their own report settings', async () => {
    await actAs(DRIVER_PRO);
    const r = await db.query<any>(`SELECT * FROM public.get_driver_report_settings($1)`, [DRIVER_PRO]);
    expect(r.rows[0].company_name).toBe('Pro Driver LLC');
  });
});
