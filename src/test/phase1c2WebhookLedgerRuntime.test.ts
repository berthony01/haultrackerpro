// @vitest-environment node
// Phase 1C-2 — Real Postgres runtime harness for the webhook ledger.
//
// Applies the EXACT production migration (SQL file on disk) into an
// in-process PGlite instance and drives the three RPCs — no simplified
// re-implementation. Proves the atomic claim + token stale-guard +
// lease-reclaim state machine holds at the real Postgres layer, not just
// in the mocked orchestrator.
//
// PGlite is installed in a sandbox path outside the repo so
// package.json / lockfiles remain untouched. If PGlite cannot be loaded
// this test FAILS (Phase 1C-2 acceptance criteria disallow skipping the
// critical runtime harness).

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

const PGLITE_ABS_PATH = "/tmp/pglite-sandbox/node_modules/@electric-sql/pglite";
const MIGRATION_GLOB_PREFIX = "20260713"; // Phase 1C-2 migration date prefix

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

async function loadPGlite(): Promise<null | { PGlite: new () => AnyPGlite }> {
  try {
    const req = createRequire(import.meta.url);
    const resolved = req.resolve(path.join(PGLITE_ABS_PATH, "dist/index.js"));
    const mod = await import(/* @vite-ignore */ resolved);
    return mod as { PGlite: new () => AnyPGlite };
  } catch {
    return null;
  }
}

function findMigration(): string {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(MIGRATION_GLOB_PREFIX) && f.endsWith(".sql"));
  for (const f of files.sort().reverse()) {
    const body = fs.readFileSync(path.join(dir, f), "utf8");
    if (body.includes("claim_stripe_webhook_event")) return body;
  }
  throw new Error("Phase 1C-2 migration not found on disk");
}

async function primeBaseline(db: AnyPGlite) {
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE TABLE public.stripe_webhook_events (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      stripe_event_id text NOT NULL UNIQUE,
      event_type text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON public.stripe_webhook_events TO service_role;
  `);
  await db.exec(`INSERT INTO public.stripe_webhook_events (stripe_event_id, event_type) VALUES ('evt_historical_1', 'customer.subscription.updated');`);
}

let pglite: { PGlite: new () => AnyPGlite } | null = null;
let db: AnyPGlite;

beforeAll(async () => {
  pglite = await loadPGlite();
  if (!pglite) return;
  db = new pglite.PGlite();
  await primeBaseline(db);
  await db.exec(findMigration());
});

describe("Phase 1C-2 — Postgres runtime harness (PGlite)", () => {
  it("PGlite loaded (harness MUST NOT be skipped per Phase 1C-2 acceptance)", () => {
    expect(pglite, `PGlite must be available at ${PGLITE_ABS_PATH}`).not.toBeNull();
  });

  it("historical row is preserved as processed with legacy_processed", async () => {
    if (!pglite) return;
    const r = await db.query<{ processing_status: string; result_code: string; processed_at: string }>(
      `SELECT processing_status, result_code, processed_at FROM public.stripe_webhook_events WHERE stripe_event_id = 'evt_historical_1'`,
    );
    expect(r.rows[0].processing_status).toBe("processed");
    expect(r.rows[0].result_code).toBe("legacy_processed");
    expect(r.rows[0].processed_at).toBeTruthy();
  });

  it("first claim inserts a processing row with a token", async () => {
    if (!pglite) return;
    const r = await db.query<{ result: string; claim_token: string | null; attempt: number }>(
      `SELECT * FROM public.claim_stripe_webhook_event('evt_1', 'customer.subscription.updated', 300)`,
    );
    expect(r.rows[0].result).toBe("claimed");
    expect(r.rows[0].claim_token).toBeTruthy();
    expect(r.rows[0].attempt).toBe(1);
    const row = await db.query<{ processing_status: string; claim_token: string | null }>(
      `SELECT processing_status, claim_token FROM public.stripe_webhook_events WHERE stripe_event_id = 'evt_1'`,
    );
    expect(row.rows[0].processing_status).toBe("processing");
    expect(row.rows[0].claim_token).toBe(r.rows[0].claim_token);
  });

  it("second claim while first is unexpired returns in_progress", async () => {
    if (!pglite) return;
    const r = await db.query<{ result: string; claim_token: string | null }>(
      `SELECT * FROM public.claim_stripe_webhook_event('evt_1', 'customer.subscription.updated', 300)`,
    );
    expect(r.rows[0].result).toBe("in_progress");
    expect(r.rows[0].claim_token).toBeNull();
  });

  it("completion succeeds only with the active claim token", async () => {
    if (!pglite) return;
    const active = (await db.query<{ claim_token: string }>(
      `SELECT claim_token FROM public.stripe_webhook_events WHERE stripe_event_id = 'evt_1'`,
    )).rows[0].claim_token;
    // Wrong token → false, no state change.
    const wrong = await db.query<{ complete_stripe_webhook_event: boolean }>(
      `SELECT public.complete_stripe_webhook_event('evt_1', '00000000-0000-0000-0000-000000000000', 'applied')`,
    );
    expect(wrong.rows[0].complete_stripe_webhook_event).toBe(false);
    // Right token → true.
    const ok = await db.query<{ complete_stripe_webhook_event: boolean }>(
      `SELECT public.complete_stripe_webhook_event('evt_1', $1, 'applied')`, [active],
    );
    expect(ok.rows[0].complete_stripe_webhook_event).toBe(true);
    const row = await db.query<{ processing_status: string; result_code: string; claim_token: string | null }>(
      `SELECT processing_status, result_code, claim_token FROM public.stripe_webhook_events WHERE stripe_event_id = 'evt_1'`,
    );
    expect(row.rows[0].processing_status).toBe("processed");
    expect(row.rows[0].result_code).toBe("applied");
    expect(row.rows[0].claim_token).toBeNull();
  });

  it("re-claim of a processed event returns already_processed", async () => {
    if (!pglite) return;
    const r = await db.query<{ result: string }>(
      `SELECT * FROM public.claim_stripe_webhook_event('evt_1', 'customer.subscription.updated', 300)`,
    );
    expect(r.rows[0].result).toBe("already_processed");
  });

  it("failed status can be reclaimed; attempt count increments; new token", async () => {
    if (!pglite) return;
    // Claim evt_2, then mark it failed, then reclaim.
    const c1 = (await db.query<{ result: string; claim_token: string }>(
      `SELECT * FROM public.claim_stripe_webhook_event('evt_2', 'customer.subscription.updated', 300)`,
    )).rows[0];
    expect(c1.result).toBe("claimed");
    const failed = await db.query<{ fail_stripe_webhook_event: boolean }>(
      `SELECT public.fail_stripe_webhook_event('evt_2', $1, 'transient_processing_error')`, [c1.claim_token],
    );
    expect(failed.rows[0].fail_stripe_webhook_event).toBe(true);
    const c2 = (await db.query<{ result: string; claim_token: string; attempt: number }>(
      `SELECT * FROM public.claim_stripe_webhook_event('evt_2', 'customer.subscription.updated', 300)`,
    )).rows[0];
    expect(c2.result).toBe("claimed");
    expect(c2.attempt).toBe(2);
    expect(c2.claim_token).not.toBe(c1.claim_token);
  });

  it("event-type conflict is rejected without mutating the existing row", async () => {
    if (!pglite) return;
    const before = (await db.query<{ event_type: string; processing_status: string }>(
      `SELECT event_type, processing_status FROM public.stripe_webhook_events WHERE stripe_event_id = 'evt_1'`,
    )).rows[0];
    const r = await db.query<{ result: string }>(
      `SELECT * FROM public.claim_stripe_webhook_event('evt_1', 'customer.subscription.deleted', 300)`,
    );
    expect(r.rows[0].result).toBe("event_type_conflict");
    const after = (await db.query<{ event_type: string; processing_status: string }>(
      `SELECT event_type, processing_status FROM public.stripe_webhook_events WHERE stripe_event_id = 'evt_1'`,
    )).rows[0];
    expect(after).toEqual(before);
  });

  it("expired processing lease can be reclaimed", async () => {
    if (!pglite) return;
    const claim = (await db.query<{ claim_token: string }>(
      `SELECT * FROM public.claim_stripe_webhook_event('evt_expired', 'customer.subscription.updated', 30)`,
    )).rows[0];
    // Manually age the lease.
    await db.exec(`UPDATE public.stripe_webhook_events SET lease_expires_at = now() - interval '1 minute' WHERE stripe_event_id = 'evt_expired'`);
    const reclaim = (await db.query<{ result: string; claim_token: string; attempt: number }>(
      `SELECT * FROM public.claim_stripe_webhook_event('evt_expired', 'customer.subscription.updated', 300)`,
    )).rows[0];
    expect(reclaim.result).toBe("claimed");
    expect(reclaim.attempt).toBe(2);
    expect(reclaim.claim_token).not.toBe(claim.claim_token);
  });

  it("stale worker cannot complete or fail after reclaim (token mismatch)", async () => {
    if (!pglite) return;
    const staleToken = (await db.query<{ claim_token: string }>(
      `SELECT claim_token FROM public.stripe_webhook_events WHERE stripe_event_id = 'evt_expired'`,
    )).rows[0].claim_token; // this is the NEW token now
    // Simulate an OLD token that no longer matches.
    const bogusToken = "00000000-0000-0000-0000-0000deadbeef";
    const stale = await db.query<{ complete_stripe_webhook_event: boolean }>(
      `SELECT public.complete_stripe_webhook_event('evt_expired', $1, 'applied')`, [bogusToken],
    );
    expect(stale.rows[0].complete_stripe_webhook_event).toBe(false);
    const staleFail = await db.query<{ fail_stripe_webhook_event: boolean }>(
      `SELECT public.fail_stripe_webhook_event('evt_expired', $1, 'stale')`, [bogusToken],
    );
    expect(staleFail.rows[0].fail_stripe_webhook_event).toBe(false);
    // Real token still works for the active claim.
    const ok = await db.query<{ complete_stripe_webhook_event: boolean }>(
      `SELECT public.complete_stripe_webhook_event('evt_expired', $1, 'applied')`, [staleToken],
    );
    expect(ok.rows[0].complete_stripe_webhook_event).toBe(true);
  });

  it("existing unique event-id protection remains effective", async () => {
    if (!pglite) return;
    let threw = false;
    try {
      await db.exec(`INSERT INTO public.stripe_webhook_events (stripe_event_id, event_type, processing_status, attempt_count, processing_started_at, lease_expires_at, claim_token, updated_at) VALUES ('evt_1', 'x', 'processing', 1, now(), now() + interval '5 min', gen_random_uuid(), now())`);
    } catch (e) {
      threw = true;
      expect(String(e)).toMatch(/duplicate|unique/i);
    }
    expect(threw).toBe(true);
  });

  it("anon and authenticated cannot execute the claim/complete/fail RPCs; service_role can", async () => {
    if (!pglite) return;
    const rows = (await db.query<{ proname: string; rolname: string; has: boolean }>(
      `SELECT p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS has
       FROM pg_proc p CROSS JOIN pg_roles r
       WHERE p.proname IN ('claim_stripe_webhook_event','complete_stripe_webhook_event','fail_stripe_webhook_event')
         AND r.rolname IN ('anon','authenticated','service_role')
       ORDER BY 1,2`,
    )).rows;
    for (const row of rows) {
      if (row.rolname === "service_role") {
        expect(row.has, `service_role should be able to execute ${row.proname}`).toBe(true);
      } else {
        expect(row.has, `${row.rolname} MUST NOT execute ${row.proname}`).toBe(false);
      }
    }
    // Also assert RLS remains enabled on the ledger.
    const rls = (await db.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'stripe_webhook_events'`,
    )).rows[0];
    expect(rls.relrowsecurity).toBe(true);
  });
});
