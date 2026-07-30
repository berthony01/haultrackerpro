import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Phase 1R-D2-B1 — Recruiter checkout intent active-migration promotion contract.
// Static, file-read-only proof. No database, no network.

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const CANDIDATE_PATH = path.join(
  "supabase",
  "migration-candidates",
  "20260717235300_phase1g_r1a1_recruiter_checkout_intents.sql",
);

const ACTIVE_PATH = path.join(
  "supabase",
  "migrations",
  "20260730060000_phase1r_d2_b1_recruiter_checkout_intents.sql",
);

const readRepoFile = (relative: string): string =>
  readFileSync(path.join(REPO_ROOT, relative), "utf8");

/**
 * Extracts the executable body: from the first exact `BEGIN;` line through the
 * final exact `COMMIT;` line, inclusive.
 */
const extractExecutableBody = (sql: string): string => {
  const lines = sql.split("\n");
  const begin = lines.findIndex((line) => line === "BEGIN;");
  const commit = lines.reduce(
    (acc, line, index) => (line === "COMMIT;" ? index : acc),
    -1,
  );
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(commit).toBeGreaterThan(begin);
  return lines.slice(begin, commit + 1).join("\n");
};

const candidateSql = readRepoFile(CANDIDATE_PATH);
const activeSql = readRepoFile(ACTIVE_PATH);
const candidateBody = extractExecutableBody(candidateSql);
const activeBody = extractExecutableBody(activeSql);
const activeHeader = activeSql.slice(0, activeSql.indexOf("\nBEGIN;"));

describe("Phase 1R-D2-B1 — promotion file placement", () => {
  it("keeps the historical candidate at its exact migration-candidates path", () => {
    expect(existsSync(path.join(REPO_ROOT, CANDIDATE_PATH))).toBe(true);
  });

  it("creates the active migration at its exact supabase/migrations path", () => {
    expect(existsSync(path.join(REPO_ROOT, ACTIVE_PATH))).toBe(true);
  });
});

describe("Phase 1R-D2-B1 — byte-for-byte executable body equality", () => {
  it("produces exact string equality between candidate and active bodies", () => {
    expect(activeBody).toBe(candidateBody);
  });

  it("uses a non-trivial body that starts with BEGIN; and ends with COMMIT;", () => {
    expect(activeBody.startsWith("BEGIN;\n")).toBe(true);
    expect(activeBody.endsWith("\nCOMMIT;")).toBe(true);
    expect(activeBody.length).toBeGreaterThan(5_000);
  });
});

describe("Phase 1R-D2-B1 — active header", () => {
  it("identifies Phase 1R-D2-B1", () => {
    expect(activeHeader).toContain("Phase 1R-D2-B1");
  });

  it("states that production application is a separate phase", () => {
    expect(activeHeader).toMatch(/DOES NOT apply it to production/);
    expect(activeHeader).toMatch(/separate controlled phase/);
  });

  it("references the promoted candidate path", () => {
    expect(activeHeader).toContain(
      "supabase/migration-candidates/20260717235300_phase1g_r1a1_recruiter_checkout_intents.sql",
    );
  });
});

describe("Phase 1R-D2-B1 — schema object contract", () => {
  it("declares exactly one recruiter_checkout_intents table", () => {
    const matches =
      activeBody.match(/CREATE TABLE public\.recruiter_checkout_intents/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("uses strict CREATE TABLE without IF NOT EXISTS", () => {
    expect(activeBody).not.toMatch(/CREATE TABLE IF NOT EXISTS/i);
  });

  it("declares the three named partial unique indexes exactly once each", () => {
    for (const indexName of [
      "recruiter_billing_profiles_user_id_uniq",
      "recruiter_billing_profiles_stripe_customer_id_uniq",
      "recruiter_billing_profiles_stripe_subscription_id_uniq",
    ]) {
      const matches =
        activeBody.match(
          new RegExp(`CREATE UNIQUE INDEX ${indexName}\\b`, "g"),
        ) ?? [];
      expect(matches, indexName).toHaveLength(1);
    }
  });

  it("keeps the unique indexes strict (no IF NOT EXISTS)", () => {
    expect(activeBody).not.toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/i);
  });

  it("declares exactly four state-machine function definitions", () => {
    const matches =
      activeBody.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) ?? [];
    expect(matches).toHaveLength(4);
  });

  it("declares the four exact RPC names and signatures", () => {
    expect(activeBody).toContain(
      "CREATE OR REPLACE FUNCTION public.claim_recruiter_checkout_intent(\n  _recruiter_id uuid,\n  _user_id      uuid,\n  _plan         text\n)",
    );
    expect(activeBody).toContain(
      "CREATE OR REPLACE FUNCTION public.bind_recruiter_checkout_customer(\n  _intent_id   uuid,\n  _claim_token uuid,\n  _customer_id text\n)",
    );
    expect(activeBody).toContain(
      "CREATE OR REPLACE FUNCTION public.complete_recruiter_checkout_intent(\n  _intent_id           uuid,\n  _claim_token         uuid,\n  _customer_id         text,\n  _session_id          text,\n  _checkout_url        text,\n  _checkout_expires_at timestamptz\n)",
    );
    expect(activeBody).toContain(
      "CREATE OR REPLACE FUNCTION public.fail_recruiter_checkout_intent(\n  _intent_id   uuid,\n  _claim_token uuid,\n  _error_code  text,\n  _terminal    boolean\n)",
    );
  });

  it("keeps every RPC SECURITY DEFINER with a pinned search_path", () => {
    // Count only statement-level clauses (a table comment also mentions the phrase).
    expect((activeBody.match(/^SECURITY DEFINER$/gm) ?? []).length).toBe(4);
    expect((activeBody.match(/^SET search_path = public$/gm) ?? []).length).toBe(4);
  });

  it("preserves advisory transaction locking and the fixed 300-second lease", () => {
    expect(activeBody).toMatch(/pg_advisory_xact_lock/);
    expect(activeBody).toMatch(/300/);
  });

  it("preserves structured SQLSTATE 23505 collision handling", () => {
    expect(activeBody).toMatch(/23505|unique_violation/);
  });
});

describe("Phase 1R-D2-B1 — RLS and privilege posture", () => {
  it("enables row level security on the intents table", () => {
    expect(activeBody).toContain(
      "ALTER TABLE public.recruiter_checkout_intents ENABLE ROW LEVEL SECURITY;",
    );
  });

  it("creates no policy", () => {
    expect(activeBody).not.toMatch(/CREATE POLICY/i);
  });

  it("revokes table privileges from PUBLIC, anon and authenticated", () => {
    expect(activeBody).toContain(
      "REVOKE ALL ON TABLE public.recruiter_checkout_intents FROM PUBLIC;",
    );
    expect(activeBody).toContain(
      "REVOKE ALL ON TABLE public.recruiter_checkout_intents FROM anon;",
    );
    expect(activeBody).toContain(
      "REVOKE ALL ON TABLE public.recruiter_checkout_intents FROM authenticated;",
    );
  });

  it("grants table privileges to service_role", () => {
    expect(activeBody).toMatch(
      /GRANT\s+ALL ON TABLE public\.recruiter_checkout_intents TO service_role;/,
    );
  });

  it("revokes function execution from PUBLIC, anon and authenticated", () => {
    expect(activeBody).toContain("'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM PUBLIC'");
    expect(activeBody).toContain("'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM anon'");
    expect(activeBody).toContain(
      "'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM authenticated'",
    );
  });

  it("grants function execution to service_role", () => {
    expect(activeBody).toContain(
      "'GRANT EXECUTE ON FUNCTION ' || v_sig || ' TO service_role'",
    );
  });
});

describe("Phase 1R-D2-B1 — destructive-statement exclusion", () => {
  it("contains no destructive or backfill statements", () => {
    expect(activeBody).not.toMatch(/DROP TABLE/i);
    expect(activeBody).not.toMatch(/DROP FUNCTION/i);
    expect(activeBody).not.toMatch(/DELETE FROM public\.recruiter_billing_profiles/i);
    expect(activeBody).not.toMatch(/UPDATE public\.recruiter_billing_profiles/i);
  });

  it("adds no trigger and no fifth RPC", () => {
    expect(activeBody).not.toMatch(/CREATE TRIGGER/i);
    expect(
      (activeBody.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) ?? []).length,
    ).toBe(4);
  });
});

describe("Phase 1R-D2-B1 — candidate immutability", () => {
  it("keeps the historical candidate header wording intact", () => {
    expect(candidateSql).toContain(
      "-- Phase 1G-R1A1-R1 — Recruiter Checkout DB Candidate (CORRECTED)",
    );
    expect(candidateSql).toContain("-- CANDIDATE MIGRATION — NOT APPLIED LIVE.");
  });

  it("does not rewrite the candidate into promotion wording", () => {
    expect(candidateSql).not.toContain("Phase 1R-D2-B1");
  });
});
