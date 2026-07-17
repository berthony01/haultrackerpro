// @vitest-environment node
// Phase 1F-A — Real Postgres runtime harness for the recruiter posting guard.
//
// Applies the actual production migration (SQL file on disk) into an
// in-process PGlite instance and drives the two triggers — no simplified
// re-implementation. Proves the server-authoritative rule holds:
//   * Standard opportunities from any complete, non-suspended recruiter
//     go live (`admin_review_status = 'approved'`, `published_at` set),
//     regardless of verification_status = pending or rejected.
//   * Suspended or incomplete recruiters cannot publish (billing_guard raises 42501).
//   * Recruiter A cannot insert opportunities under recruiter B.
//   * Client-set featured=true is stripped on INSERT for non-admin actors.

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { PGlite } from "@electric-sql/pglite";

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

function findPhase1FMigration(): string {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().reverse();
  for (const f of files) {
    const body = fs.readFileSync(path.join(dir, f), "utf8");
    if (body.includes("recruiter_can_post")) return body;
  }
  throw new Error("Phase 1F-A migration (recruiter_can_post) not found on disk");
}

const RECRUITER_A_USER = "11111111-1111-1111-1111-111111111111";
const RECRUITER_B_USER = "22222222-2222-2222-2222-222222222222";

let db: AnyPGlite;
let recruiterAId: string;
let recruiterBId: string;
let incompleteRecruiterId: string;
let suspendedRecruiterId: string;

async function setUid(uid: string | null, isAdmin = false) {
  await db.exec(
    `SELECT set_config('test.uid', ${uid ? `'${uid}'` : "''"}, false),
            set_config('test.is_admin', '${isAdmin ? "true" : "false"}', false);`,
  );
}

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;

  // Baseline: minimal shim of the pieces the trigger reads. auth.uid()
  // and is_admin() are backed by session GUCs so tests can flip identity.
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA IF NOT EXISTS auth;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('test.uid', true), '')::uuid
    $$;

    CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT COALESCE(current_setting('test.is_admin', true), 'false') = 'true'
    $$;

    CREATE TABLE public.recruiter_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      recruiter_name text NOT NULL DEFAULT '',
      company_name text NOT NULL DEFAULT '',
      recruiter_email text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'active',
      verification_status text NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE public.opportunities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id),
      title text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      admin_review_status text NOT NULL DEFAULT 'pending',
      featured boolean NOT NULL DEFAULT false,
      view_count integer NOT NULL DEFAULT 0,
      published_at timestamptz
    );
  `);

  // Apply the real Phase 1F-A migration.
  await db.exec(findPhase1FMigration());

  // Attach the triggers the way prior production migrations attached them.
  await db.exec(`
    CREATE TRIGGER opportunities_guard_trigger
      BEFORE INSERT OR UPDATE ON public.opportunities
      FOR EACH ROW EXECUTE FUNCTION public.opportunities_guard();
    CREATE TRIGGER opportunities_billing_guard_trigger
      BEFORE INSERT OR UPDATE ON public.opportunities
      FOR EACH ROW EXECUTE FUNCTION public.opportunities_billing_guard();
  `);

  // Seed recruiters via admin (bypasses trigger).
  await setUid(null, true);
  const a = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles (user_id, recruiter_name, company_name, recruiter_email, status, verification_status)
     VALUES ($1, 'Alice', 'Acme Freight', 'a@a.example', 'active', 'pending') RETURNING id`,
    [RECRUITER_A_USER],
  );
  recruiterAId = a.rows[0].id;

  const b = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles (user_id, recruiter_name, company_name, recruiter_email, status, verification_status)
     VALUES ($1, 'Bob', 'Bco', 'b@b.example', 'active', 'approved') RETURNING id`,
    [RECRUITER_B_USER],
  );
  recruiterBId = b.rows[0].id;

  const incomplete = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles (user_id, recruiter_name, company_name, recruiter_email, status, verification_status)
     VALUES ($1, 'Cara', '', 'c@c.example', 'active', 'pending') RETURNING id`,
    ["33333333-3333-3333-3333-333333333333"],
  );
  incompleteRecruiterId = incomplete.rows[0].id;

  const suspended = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles (user_id, recruiter_name, company_name, recruiter_email, status, verification_status)
     VALUES ($1, 'Dan', 'Dco', 'd@d.example', 'suspended', 'approved') RETURNING id`,
    ["44444444-4444-4444-4444-444444444444"],
  );
  suspendedRecruiterId = suspended.rows[0].id;
});

describe("recruiter_can_post — SQL rule", () => {
  it("returns true for a complete, non-suspended recruiter regardless of verification", async () => {
    const r = await db.query<{ b: boolean }>(
      `SELECT public.recruiter_can_post($1) AS b`,
      [RECRUITER_A_USER],
    );
    expect(r.rows[0].b).toBe(true);
  });

  it("returns false for a suspended recruiter", async () => {
    const r = await db.query<{ b: boolean }>(
      `SELECT public.recruiter_can_post($1) AS b`,
      ["44444444-4444-4444-4444-444444444444"],
    );
    expect(r.rows[0].b).toBe(false);
  });

  it("returns false for an incomplete profile", async () => {
    const r = await db.query<{ b: boolean }>(
      `SELECT public.recruiter_can_post($1) AS b`,
      ["33333333-3333-3333-3333-333333333333"],
    );
    expect(r.rows[0].b).toBe(false);
  });

  it("returns false when no profile exists", async () => {
    const r = await db.query<{ b: boolean }>(
      `SELECT public.recruiter_can_post($1) AS b`,
      ["99999999-9999-9999-9999-999999999999"],
    );
    expect(r.rows[0].b).toBe(false);
  });
});

describe("opportunities_guard + opportunities_billing_guard — Phase 1F-A", () => {
  it("pending recruiter INSERT status=active → succeeds, admin_review_status=approved, published_at set", async () => {
    await setUid(RECRUITER_A_USER);
    const r = await db.query<{ admin_review_status: string; published_at: string | null }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status)
       VALUES ($1, 'OTR Van', 'active')
       RETURNING admin_review_status, published_at`,
      [recruiterAId],
    );
    expect(r.rows[0].admin_review_status).toBe("approved");
    expect(r.rows[0].published_at).not.toBeNull();
  });

  it("approved recruiter INSERT status=active → succeeds, approved + published", async () => {
    await setUid(RECRUITER_B_USER);
    const r = await db.query<{ admin_review_status: string; published_at: string | null }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status)
       VALUES ($1, 'Regional Reefer', 'active')
       RETURNING admin_review_status, published_at`,
      [recruiterBId],
    );
    expect(r.rows[0].admin_review_status).toBe("approved");
    expect(r.rows[0].published_at).not.toBeNull();
  });

  it("suspended recruiter INSERT status=active → billing_guard raises 42501", async () => {
    await setUid("44444444-4444-4444-4444-444444444444");
    await expect(
      db.query(
        `INSERT INTO public.opportunities (recruiter_id, title, status)
         VALUES ($1, 'Should fail', 'active')`,
        [suspendedRecruiterId],
      ),
    ).rejects.toThrow(/Complete your recruiter profile to publish/i);
  });

  it("incomplete profile INSERT status=active → billing_guard raises", async () => {
    await setUid("33333333-3333-3333-3333-333333333333");
    await expect(
      db.query(
        `INSERT INTO public.opportunities (recruiter_id, title, status)
         VALUES ($1, 'Should fail incomplete', 'active')`,
        [incompleteRecruiterId],
      ),
    ).rejects.toThrow(/Complete your recruiter profile/i);
  });

  it("recruiter A cannot INSERT an opportunity under recruiter B (ownership check)", async () => {
    await setUid(RECRUITER_A_USER);
    await expect(
      db.query(
        `INSERT INTO public.opportunities (recruiter_id, title, status)
         VALUES ($1, 'Cross-recruiter insert', 'active')`,
        [recruiterBId],
      ),
    ).rejects.toThrow(/Complete your recruiter profile/i);
  });

  it("client-set featured=true on INSERT is overwritten to false for non-admin", async () => {
    await setUid(RECRUITER_A_USER);
    const r = await db.query<{ featured: boolean }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, featured)
       VALUES ($1, 'Sneaky featured', 'draft', true)
       RETURNING featured`,
      [recruiterAId],
    );
    expect(r.rows[0].featured).toBe(false);
  });

  it("draft INSERT for an incomplete recruiter still records as pending (no billing_guard trigger, no publish)", async () => {
    await setUid("33333333-3333-3333-3333-333333333333");
    const r = await db.query<{ admin_review_status: string; published_at: string | null }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status)
       VALUES ($1, 'Draft only', 'draft')
       RETURNING admin_review_status, published_at`,
      [incompleteRecruiterId],
    );
    expect(r.rows[0].admin_review_status).toBe("pending");
    expect(r.rows[0].published_at).toBeNull();
  });

  it("suspended recruiter reactivating a paused opportunity → billing_guard raises", async () => {
    // Seed a paused opp for the suspended recruiter via admin.
    await setUid(null, true);
    const seed = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status)
       VALUES ($1, 'Paused', 'paused', 'approved') RETURNING id`,
      [suspendedRecruiterId],
    );
    const oppId = seed.rows[0].id;

    await setUid("44444444-4444-4444-4444-444444444444");
    await expect(
      db.query(`UPDATE public.opportunities SET status='active' WHERE id=$1`, [oppId]),
    ).rejects.toThrow(/Complete your recruiter profile/i);
  });

  it("UPDATE on an opportunity previously rejected sets admin_review_status back to pending", async () => {
    await setUid(null, true);
    const seed = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status)
       VALUES ($1, 'To resubmit', 'draft', 'rejected') RETURNING id`,
      [recruiterAId],
    );
    const oppId = seed.rows[0].id;

    await setUid(RECRUITER_A_USER);
    const r = await db.query<{ admin_review_status: string; published_at: string | null }>(
      `UPDATE public.opportunities SET title='Edited resubmit' WHERE id=$1
       RETURNING admin_review_status, published_at`,
      [oppId],
    );
    expect(r.rows[0].admin_review_status).toBe("pending");
    expect(r.rows[0].published_at).toBeNull();
  });
});
