// @vitest-environment node
// =====================================================================
// Phase 1J-A — Additive user capability foundation (PGlite runtime)
//
// Loads the Phase 1J-A candidate migration on top of a minimal
// Supabase-compatible bootstrap + canonical recruiter completeness helper.
// Proves the additive rule matrix required by the phase brief.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

import {
  beginRecruiterSetupRpc,
  deriveUserCapabilitiesView,
  isValidActivatedAt,
  parseUserCapabilityRow,
  parseUserCapabilityRows,
  parseUserCapabilityStatus,
  isUserCapabilityStatus,
  isUserCapabilityType,
  USER_CAPABILITY_STATUSES,
  USER_CAPABILITY_TYPES,
  type UserCapabilityRow,
} from '@/lib/userCapabilities';
import {
  getRecruiterPlanCapabilities,
  resolveRecruiterCapabilityTier,
} from '@/lib/recruiterCapabilities';

const CANONICAL_REL =
  '../../supabase/migrations/20260717185620_7efcb752-08f0-46b5-aaad-593e410aa818.sql';

/**
 * Read the canonical Phase 1F migration and slice out the exact block
 * defining `public.recruiter_profile_can_manage_opportunities(uuid)` up to
 * and including the service_role GRANT. Never returns a handwritten copy.
 */
function extractRecruiterCanManageBlock(): string {
  const src = read(CANONICAL_REL);
  const startMarker = 'CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(';
  const endMarker =
    'GRANT EXECUTE ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid) TO service_role;';
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('canonical: start marker not found');
  const endIdx = src.indexOf(endMarker, start);
  if (endIdx < 0) throw new Error('canonical: end marker not found');
  return src.slice(start, endIdx + endMarker.length);
}

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

const CANDIDATE_REL =
  '../../supabase/migration-candidates/20260720110000_phase1j_additive_user_capabilities.sql';

const read = (rel: string) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

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

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  intended_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_name text, recruiter_email text,
  company_name text,
  dot_number text, mc_number text,
  verification_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'active',
  posting_terms_accepted_at timestamptz,
  posting_terms_version text,
  legacy_terms_grandfathered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Canonical Phase 1F rule is loaded verbatim from
-- supabase/migrations/20260717185620_*.sql after this bootstrap runs.

CREATE TABLE public.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'inactive'
);
CREATE TABLE public.recruiter_billing_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text, subscription_status text
);
`;

const uid = (n: number) => `${n.toString().padStart(8, '0')}-0000-0000-0000-000000000000`;

async function setUid(db: AnyPGlite, user: string | null) {
  await db.query(
    `SELECT set_config('request.jwt.claim.sub', $1, false)`,
    [user ?? ''],
  );
}

async function makeUser(db: AnyPGlite, id: string, hasProfile = true, intent: string | null = null) {
  await db.query(`INSERT INTO auth.users(id, email) VALUES ($1, $2)`, [id, `${id}@t.test`]);
  if (hasProfile) {
    await db.query(
      `INSERT INTO public.profiles(user_id, intended_role) VALUES ($1, $2)`,
      [id, intent],
    );
  }
}

async function completeRecruiter(
  db: AnyPGlite,
  userId: string,
  overrides: Partial<{
    verification_status: string;
    status: string;
    posting_terms_accepted_at: string | null;
    recruiter_email: string;
  }> = {},
) {
  await db.query(
    `INSERT INTO public.recruiter_profiles(
       user_id, recruiter_name, recruiter_email, company_name, dot_number,
       verification_status, status, posting_terms_accepted_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      userId,
      'Rec Name',
      overrides.recruiter_email ?? 'r@example.com',
      'Company',
      '12345',
      overrides.verification_status ?? 'pending',
      overrides.status ?? 'active',
      overrides.posting_terms_accepted_at === undefined
        ? new Date().toISOString()
        : overrides.posting_terms_accepted_at,
    ],
  );
}

async function capsFor(db: AnyPGlite, userId: string) {
  const r = await db.query<{ capability: string; status: string; activated_at: string | null }>(
    `SELECT capability::text, status::text, activated_at
       FROM public.user_capabilities WHERE user_id = $1 ORDER BY capability`,
    [userId],
  );
  return r.rows;
}

let db: AnyPGlite;
let CANONICAL_BLOCK: string;

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;
  await db.exec(BOOTSTRAP);
  CANONICAL_BLOCK = extractRecruiterCanManageBlock();
  await db.exec(CANONICAL_BLOCK);
  await db.exec(read(CANDIDATE_REL));
});

describe('Phase 1J-A — canonical recruiter completeness helper source', () => {
  it('canonical migration file exists and is nonempty', () => {
    const src = read(CANONICAL_REL);
    expect(src.length).toBeGreaterThan(200);
  });

  it('extracted block contains the exact function signature and service_role GRANT', () => {
    expect(CANONICAL_BLOCK).toContain(
      'CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(',
    );
    expect(CANONICAL_BLOCK).toContain(
      'GRANT EXECUTE ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid) TO service_role;',
    );
    expect(CANONICAL_BLOCK).toContain('REVOKE ALL ON FUNCTION');
    expect(CANONICAL_BLOCK).toContain('SECURITY DEFINER');
    expect(CANONICAL_BLOCK.length).toBeGreaterThan(200);
  });

  it('bootstrap does not contain a second handwritten definition', () => {
    const occurrences = (BOOTSTRAP.match(
      /CREATE OR REPLACE FUNCTION public\.recruiter_profile_can_manage_opportunities/g,
    ) || []).length;
    expect(occurrences).toBe(0);
  });
});

describe('Phase 1J-A — pure capability helper', () => {
  it('driver-only rows → canEnterDriverWorkspace, no recruiter capability', () => {
    const v = deriveUserCapabilitiesView([
      { capability: 'driver', status: 'active', activated_at: '2026-01-01' },
    ]);
    expect(v.hasDriverCapability).toBe(true);
    expect(v.hasRecruiterCapability).toBe(false);
    expect(v.canEnterDriverWorkspace).toBe(true);
    expect(v.canOperateRecruiterWorkspace).toBe(false);
    expect(v.canEnterRecruiterSetup).toBe(false);
    expect(v.isRecruiterSuspended).toBe(false);
  });

  it('recruiter setup/active/suspended all count as hasRecruiterCapability', () => {
    for (const status of ['setup', 'active', 'suspended'] as const) {
      const v = deriveUserCapabilitiesView([
        { capability: 'driver', status: 'active', activated_at: null },
        { capability: 'recruiter', status, activated_at: null },
      ]);
      expect(v.hasRecruiterCapability).toBe(true);
      expect(v.canEnterRecruiterSetup).toBe(true);
      expect(v.canOperateRecruiterWorkspace).toBe(status === 'active');
      expect(v.isRecruiterSuspended).toBe(status === 'suspended');
    }
  });

  it('capability rows never grant plan-tier premium features', () => {
    // Even if a caller had recruiter-active, plan gating stays with billing.
    const caps = deriveUserCapabilitiesView([
      { capability: 'recruiter', status: 'active', activated_at: null },
    ]);
    expect(caps.canOperateRecruiterWorkspace).toBe(true);
    // Plan resolver operates only on plan + billing status.
    expect(resolveRecruiterCapabilityTier(null, null)).toBe('free_verified');
    const planCaps = getRecruiterPlanCapabilities({ plan: null, status: 'inactive' });
    expect(planCaps.tier).toBe('free_verified');
    expect(planCaps.canUseFeaturedListings).toBe(false);
    expect(planCaps.canUsePriorityPlacement).toBe(false);
  });

  it('null/empty rows return safe defaults', () => {
    const v = deriveUserCapabilitiesView(null);
    expect(v.hasDriverCapability).toBe(false);
    expect(v.hasRecruiterCapability).toBe(false);
    expect(v.canEnterDriverWorkspace).toBe(false);
  });
});

describe('Phase 1J-A — runtime capability matrix', () => {
  it('ordinary driver: new auth.users row → driver/active only', async () => {
    const id = uid(1);
    await makeUser(db, id);
    const rows = await capsFor(db, id);
    expect(rows).toEqual([
      expect.objectContaining({ capability: 'driver', status: 'active' }),
    ]);
    expect(rows[0].activated_at).not.toBeNull();
  });

  it('recruiter-intent without profile → driver active + recruiter setup', async () => {
    const id = uid(2);
    await makeUser(db, id, true, 'recruiter');
    const rows = await capsFor(db, id);
    expect(rows.map((r) => `${r.capability}:${r.status}`).sort()).toEqual([
      'driver:active',
      'recruiter:setup',
    ]);
  });

  it('incomplete recruiter profile → driver active + recruiter setup', async () => {
    const id = uid(3);
    await makeUser(db, id, true, 'recruiter');
    await db.query(
      `INSERT INTO public.recruiter_profiles(user_id, recruiter_name, company_name)
       VALUES ($1, 'Partial', 'C')`,
      [id],
    );
    const rows = await capsFor(db, id);
    expect(rows.find((r) => r.capability === 'recruiter')?.status).toBe('setup');
    expect(rows.find((r) => r.capability === 'driver')?.status).toBe('active');
  });

  it('complete recruiter — pending verification → recruiter active', async () => {
    const id = uid(4);
    await makeUser(db, id, true, 'recruiter');
    await completeRecruiter(db, id, { verification_status: 'pending' });
    const rec = (await capsFor(db, id)).find((r) => r.capability === 'recruiter');
    expect(rec?.status).toBe('active');
    expect(rec?.activated_at).not.toBeNull();
  });

  it('complete recruiter — rejected verification → recruiter active', async () => {
    const id = uid(5);
    await makeUser(db, id, true, 'recruiter');
    await completeRecruiter(db, id, { verification_status: 'rejected' });
    expect(
      (await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status,
    ).toBe('active');
  });

  it('complete recruiter — approved verification → recruiter active', async () => {
    const id = uid(6);
    await makeUser(db, id, true, 'recruiter');
    await completeRecruiter(db, id, { verification_status: 'approved' });
    expect(
      (await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status,
    ).toBe('active');
  });

  it('suspended recruiter → driver active + recruiter suspended', async () => {
    const id = uid(7);
    await makeUser(db, id, true, 'recruiter');
    await completeRecruiter(db, id, { status: 'suspended' });
    const rows = await capsFor(db, id);
    expect(rows.find((r) => r.capability === 'driver')?.status).toBe('active');
    expect(rows.find((r) => r.capability === 'recruiter')?.status).toBe('suspended');
  });

  it('deleting recruiter profile leaves driver active, recruiter setup (intent still set)', async () => {
    const id = uid(8);
    await makeUser(db, id, true, 'recruiter');
    await completeRecruiter(db, id);
    expect(
      (await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status,
    ).toBe('active');
    await db.query(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [id]);
    const rows = await capsFor(db, id);
    expect(rows.find((r) => r.capability === 'driver')?.status).toBe('active');
    expect(rows.find((r) => r.capability === 'recruiter')?.status).toBe('setup');
  });

  it('begin_recruiter_setup creates recruiter setup idempotently for ordinary driver', async () => {
    const id = uid(9);
    await makeUser(db, id);
    await setUid(db, id);
    const r1 = await db.query<{ begin_recruiter_setup: string }>(
      `SELECT public.begin_recruiter_setup()`,
    );
    expect(r1.rows[0].begin_recruiter_setup).toBe('setup');
    const r2 = await db.query<{ begin_recruiter_setup: string }>(
      `SELECT public.begin_recruiter_setup()`,
    );
    expect(r2.rows[0].begin_recruiter_setup).toBe('setup');
    const rows = await capsFor(db, id);
    expect(rows.filter((r) => r.capability === 'recruiter').length).toBe(1);
  });

  it('begin_recruiter_setup cannot unsuspend a suspended recruiter', async () => {
    const id = uid(10);
    await makeUser(db, id, true, 'recruiter');
    await completeRecruiter(db, id, { status: 'suspended' });
    await setUid(db, id);
    const r = await db.query<{ begin_recruiter_setup: string }>(
      `SELECT public.begin_recruiter_setup()`,
    );
    expect(r.rows[0].begin_recruiter_setup).toBe('suspended');
    await setUid(db, null);
  });

  it('recruiter activation never writes billing rows', async () => {
    const id = uid(11);
    await makeUser(db, id, true, 'recruiter');
    await completeRecruiter(db, id, { verification_status: 'approved' });
    const subs = await db.query(`SELECT * FROM public.subscriptions WHERE user_id = $1`, [id]);
    const bill = await db.query(
      `SELECT * FROM public.recruiter_billing_profiles WHERE user_id = $1`,
      [id],
    );
    expect(subs.rows.length).toBe(0);
    expect(bill.rows.length).toBe(0);
  });

  it('get_my_user_capabilities returns only the caller rows', async () => {
    const id = uid(12);
    await makeUser(db, id, true, 'recruiter');
    await setUid(db, id);
    const r = await db.query<UserCapabilityRow>(
      `SELECT capability::text as capability, status::text as status, activated_at
         FROM public.get_my_user_capabilities()`,
    );
    expect(r.rows.every((row) => row.capability === 'driver' || row.capability === 'recruiter'))
      .toBe(true);
    expect(r.rows.length).toBeGreaterThan(0);
    await setUid(db, null);
  });
});

describe('Phase 1J-A — capability lifecycle durability', () => {
  it('begin_recruiter_setup row survives an unrelated profile update', async () => {
    const id = uid(20);
    await makeUser(db, id);
    await setUid(db, id);
    await db.query(`SELECT public.begin_recruiter_setup()`);
    await setUid(db, null);
    await db.query(
      `UPDATE public.profiles SET display_name = 'renamed' WHERE user_id = $1`,
      [id],
    );
    const rec = (await capsFor(db, id)).find((r) => r.capability === 'recruiter');
    expect(rec?.status).toBe('setup');
  });

  it('clearing intended_role to null does not remove recruiter setup', async () => {
    const id = uid(21);
    await makeUser(db, id, true, 'recruiter');
    expect((await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status).toBe('setup');
    await db.query(`UPDATE public.profiles SET intended_role = NULL WHERE user_id = $1`, [id]);
    expect((await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status).toBe('setup');
  });

  it("clearing intended_role to 'driver' does not remove or demote recruiter setup", async () => {
    const id = uid(22);
    await makeUser(db, id, true, 'recruiter');
    await db.query(`UPDATE public.profiles SET intended_role = 'driver' WHERE user_id = $1`, [id]);
    const rec = (await capsFor(db, id)).find((r) => r.capability === 'recruiter');
    expect(rec?.status).toBe('setup');
  });

  it('clearing intended_role never demotes an active recruiter', async () => {
    const id = uid(23);
    await makeUser(db, id, true, 'recruiter');
    await completeRecruiter(db, id, { verification_status: 'approved' });
    await db.query(`UPDATE public.profiles SET intended_role = NULL WHERE user_id = $1`, [id]);
    expect((await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status).toBe('active');
  });

  it('deleting recruiter profile: suspended stays suspended', async () => {
    const id = uid(24);
    await makeUser(db, id, true, 'recruiter');
    await completeRecruiter(db, id, { status: 'suspended' });
    await db.query(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [id]);
    expect((await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status).toBe('suspended');
  });

  it('deleting recruiter profile: revoked stays revoked', async () => {
    const id = uid(25);
    await makeUser(db, id, true, 'recruiter');
    await completeRecruiter(db, id);
    // Force revoked via service-level path (simulating admin action).
    await db.query(
      `UPDATE public.user_capabilities SET status = 'revoked' WHERE user_id = $1 AND capability = 'recruiter'`,
      [id],
    );
    await db.query(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [id]);
    expect((await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status).toBe('revoked');
  });

  it('deleting recruiter profile when no row exists yet seeds setup', async () => {
    const id = uid(26);
    await makeUser(db, id); // no intent
    // Seed a recruiter row via profile completion, then remove all trace,
    // then re-insert+delete to prove the seed-on-delete branch.
    await db.query(
      `INSERT INTO public.recruiter_profiles(user_id, recruiter_name, company_name)
       VALUES ($1, 'X', 'C')`,
      [id],
    );
    await db.query(
      `DELETE FROM public.user_capabilities WHERE user_id = $1 AND capability = 'recruiter'`,
      [id],
    );
    await db.query(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [id]);
    expect((await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status).toBe('setup');
  });

  it('revoked is not reversed by begin_recruiter_setup, intent, or profile completion', async () => {
    const id = uid(27);
    await makeUser(db, id);
    await setUid(db, id);
    await db.query(`SELECT public.begin_recruiter_setup()`);
    await setUid(db, null);
    await db.query(
      `UPDATE public.user_capabilities SET status='revoked' WHERE user_id=$1 AND capability='recruiter'`,
      [id],
    );
    // begin_recruiter_setup
    await setUid(db, id);
    const r = await db.query<{ begin_recruiter_setup: string }>(
      `SELECT public.begin_recruiter_setup()`,
    );
    expect(r.rows[0].begin_recruiter_setup).toBe('revoked');
    await setUid(db, null);
    // intent flip
    await db.query(`UPDATE public.profiles SET intended_role='recruiter' WHERE user_id=$1`, [id]);
    expect((await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status).toBe('revoked');
    // recruiter profile insert + completion
    await completeRecruiter(db, id, { verification_status: 'approved' });
    expect((await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status).toBe('revoked');
    // recruiter profile delete
    await db.query(`DELETE FROM public.recruiter_profiles WHERE user_id=$1`, [id]);
    expect((await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status).toBe('revoked');
  });

  it('driver capability is never mutated by any recruiter-side lifecycle event', async () => {
    const id = uid(28);
    await makeUser(db, id, true, 'recruiter');
    await completeRecruiter(db, id, { verification_status: 'approved' });
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended' WHERE user_id=$1`, [id]);
    await db.query(`UPDATE public.recruiter_profiles SET status='active' WHERE user_id=$1`, [id]);
    await db.query(`DELETE FROM public.recruiter_profiles WHERE user_id=$1`, [id]);
    await db.query(`UPDATE public.profiles SET intended_role=NULL WHERE user_id=$1`, [id]);
    const drv = (await capsFor(db, id)).find((r) => r.capability === 'driver');
    expect(drv?.status).toBe('active');
    expect(drv?.activated_at).not.toBeNull();
  });
});

describe('Phase 1J-A — no-intent recruiter lifecycle', () => {
  it('ordinary driver (intended_role null) → begin_setup → complete profile → active → delete profile → setup remains', async () => {
    const id = uid(40);
    await makeUser(db, id, true, null); // no recruiter intent
    await setUid(db, id);
    const s1 = await db.query<{ begin_recruiter_setup: string }>(
      `SELECT public.begin_recruiter_setup()`,
    );
    expect(s1.rows[0].begin_recruiter_setup).toBe('setup');
    await setUid(db, null);

    await completeRecruiter(db, id, { verification_status: 'approved' });
    expect((await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status).toBe(
      'active',
    );

    await db.query(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [id]);
    const rows = await capsFor(db, id);
    expect(rows.find((r) => r.capability === 'recruiter')?.status).toBe('setup');
    expect(rows.find((r) => r.capability === 'driver')?.status).toBe('active');

    // intended_role never touched at any point.
    const p = await db.query<{ intended_role: string | null }>(
      `SELECT intended_role FROM public.profiles WHERE user_id = $1`,
      [id],
    );
    expect(p.rows[0].intended_role).toBeNull();
  });

  it('active recruiter with intended_role null → delete profile → setup remains, driver active', async () => {
    const id = uid(41);
    await makeUser(db, id, true, null);
    await completeRecruiter(db, id, { verification_status: 'approved' });
    expect((await capsFor(db, id)).find((r) => r.capability === 'recruiter')?.status).toBe(
      'active',
    );
    await db.query(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [id]);
    const rows = await capsFor(db, id);
    expect(rows.find((r) => r.capability === 'recruiter')?.status).toBe('setup');
    expect(rows.find((r) => r.capability === 'driver')?.status).toBe('active');
  });

  it("active recruiter with intended_role 'driver' → delete profile → setup remains, driver active", async () => {
    const id = uid(42);
    await makeUser(db, id, true, 'driver');
    await completeRecruiter(db, id, { verification_status: 'approved' });
    await db.query(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [id]);
    const rows = await capsFor(db, id);
    expect(rows.find((r) => r.capability === 'recruiter')?.status).toBe('setup');
    expect(rows.find((r) => r.capability === 'driver')?.status).toBe('active');
  });
});

describe('Phase 1J-A — client RPC payload parsers', () => {
  it('exposes the exact enum vocabulary', () => {
    expect(USER_CAPABILITY_TYPES).toEqual(['driver', 'recruiter']);
    expect(USER_CAPABILITY_STATUSES).toEqual(['setup', 'active', 'suspended', 'revoked']);
  });

  it('type/status predicates reject unknowns', () => {
    expect(isUserCapabilityType('driver')).toBe(true);
    expect(isUserCapabilityType('recruiter')).toBe(true);
    expect(isUserCapabilityType('admin')).toBe(false);
    expect(isUserCapabilityType(null)).toBe(false);
    expect(isUserCapabilityType(1)).toBe(false);

    for (const s of USER_CAPABILITY_STATUSES) expect(isUserCapabilityStatus(s)).toBe(true);
    expect(isUserCapabilityStatus('premium')).toBe(false);
    expect(isUserCapabilityStatus('')).toBe(false);
    expect(isUserCapabilityStatus(undefined)).toBe(false);
  });

  it('parseUserCapabilityStatus accepts every valid status and rejects garbage', () => {
    for (const s of USER_CAPABILITY_STATUSES) expect(parseUserCapabilityStatus(s)).toBe(s);
    expect(() => parseUserCapabilityStatus('bogus')).toThrow();
    expect(() => parseUserCapabilityStatus(null)).toThrow();
    expect(() => parseUserCapabilityStatus({ status: 'active' })).toThrow();
  });

  it('parseUserCapabilityRow accepts valid rows and rejects malformed shapes', () => {
    expect(
      parseUserCapabilityRow({ capability: 'driver', status: 'active', activated_at: null }),
    ).toEqual({ capability: 'driver', status: 'active', activated_at: null });
    expect(
      parseUserCapabilityRow({
        capability: 'recruiter',
        status: 'setup',
        activated_at: '2026-07-20T00:00:00Z',
      })?.activated_at,
    ).toBe('2026-07-20T00:00:00Z');

    // Malformed / unknown / non-object:
    expect(parseUserCapabilityRow(null)).toBeNull();
    expect(parseUserCapabilityRow('driver')).toBeNull();
    expect(parseUserCapabilityRow([])).toBeNull();
    expect(parseUserCapabilityRow({})).toBeNull();
    expect(
      parseUserCapabilityRow({ capability: 'admin', status: 'active', activated_at: null }),
    ).toBeNull();
    expect(
      parseUserCapabilityRow({ capability: 'driver', status: 'premium', activated_at: null }),
    ).toBeNull();
    expect(
      parseUserCapabilityRow({ capability: 'driver', status: 'active', activated_at: 'not-a-date' }),
    ).toBeNull();
    expect(
      parseUserCapabilityRow({ capability: 'driver', status: 'active', activated_at: 12345 }),
    ).toBeNull();
  });

  it('parseUserCapabilityRows returns [] for non-array payloads', () => {
    expect(parseUserCapabilityRows(null)).toEqual([]);
    expect(parseUserCapabilityRows(undefined)).toEqual([]);
    expect(parseUserCapabilityRows({} as unknown)).toEqual([]);
    expect(parseUserCapabilityRows('driver' as unknown)).toEqual([]);
  });

  it('parseUserCapabilityRows drops invalid entries and dedupes deterministically (first-wins)', () => {
    const rows = parseUserCapabilityRows([
      { capability: 'driver', status: 'active', activated_at: null },
      { capability: 'driver', status: 'revoked', activated_at: null }, // dropped
      { capability: 'admin', status: 'active', activated_at: null }, // dropped
      null,
      { capability: 'recruiter', status: 'setup', activated_at: null },
      { capability: 'recruiter', status: 'active', activated_at: null }, // dropped
    ]);
    expect(rows).toEqual([
      { capability: 'driver', status: 'active', activated_at: null },
      { capability: 'recruiter', status: 'setup', activated_at: null },
    ]);
  });

  it('deriveUserCapabilitiesView re-validates and never trusts unknown vocabulary', () => {
    const v = deriveUserCapabilitiesView([
      { capability: 'driver', status: 'active', activated_at: null },
      // Attackers cannot escalate by injecting a fake status.
      { capability: 'recruiter', status: 'premium' as unknown as 'active', activated_at: null },
    ]);
    expect(v.hasRecruiterCapability).toBe(false);
    expect(v.canOperateRecruiterWorkspace).toBe(false);
    expect(v.canEnterDriverWorkspace).toBe(true);
  });

  it('revoked recruiter is not operable, not setup-enterable, not "has capability"', () => {
    const v = deriveUserCapabilitiesView([
      { capability: 'driver', status: 'active', activated_at: null },
      { capability: 'recruiter', status: 'revoked', activated_at: null },
    ]);
    expect(v.hasRecruiterCapability).toBe(false);
    expect(v.canEnterRecruiterSetup).toBe(false);
    expect(v.canOperateRecruiterWorkspace).toBe(false);
    expect(v.recruiterCapabilityStatus).toBe('revoked');
  });
});
