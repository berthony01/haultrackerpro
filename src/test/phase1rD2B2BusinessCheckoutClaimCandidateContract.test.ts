import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 1R-D2-B2-A — static contract proof for the atomic business checkout
 * claim CANDIDATE. Node file reads only: no database, no network.
 *
 * This phase deliberately does NOT create an active migration. The candidate
 * lives under supabase/migration-candidates/ and B2-B promotion is separate.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const CANDIDATE_REL = path.join(
  "supabase",
  "migration-candidates",
  "20260730070000_phase1r_d2_b2_business_checkout_claims.sql",
);

const B1_ACTIVE_REL = path.join(
  "supabase",
  "migrations",
  "20260730060000_phase1r_d2_b1_recruiter_checkout_intents.sql",
);

const B1_CANDIDATE_REL = path.join(
  "supabase",
  "migration-candidates",
  "20260717235300_phase1g_r1a1_recruiter_checkout_intents.sql",
);

const PROMOTED_ACTIVE_REL = path.join(
  "supabase",
  "migrations",
  "20260730070000_phase1r_d2_b2_business_checkout_claims.sql",
);

function readRepoFile(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

function extractExecutableBody(sql: string): string {
  const lines = sql.split("\n");
  const begin = lines.findIndex((line) => line === "BEGIN;");
  const end = lines.lastIndexOf("COMMIT;");
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  return lines.slice(begin, end + 1).join("\n");
}

const candidateSql = readRepoFile(CANDIDATE_REL);
const candidateHeader = candidateSql.slice(0, candidateSql.indexOf("\nBEGIN;"));
const candidateBody = extractExecutableBody(candidateSql);

describe("Phase 1R-D2-B2-A — candidate location and header", () => {
  it("exists at the exact migration-candidates path", () => {
    expect(existsSync(path.join(REPO_ROOT, CANDIDATE_REL))).toBe(true);
  });

  it("does not create an active B2 migration in this phase", () => {
    expect(existsSync(path.join(REPO_ROOT, PROMOTED_ACTIVE_REL))).toBe(false);
  });

  it("identifies Phase 1R-D2-B2-A as candidate only", () => {
    expect(candidateHeader).toContain("Phase 1R-D2-B2-A");
    expect(candidateHeader).toContain("CANDIDATE ONLY");
    expect(candidateHeader).toContain(
      "NOT part of the managed migrations directory",
    );
  });

  it("states it is not applied to production", () => {
    expect(candidateHeader).toContain("NOT been applied to production");
  });

  it("states promotion and edge integration are separate phases", () => {
    expect(candidateHeader).toContain("B2-B promotion");
    expect(candidateHeader).toContain("SEPARATE phase");
    expect(candidateHeader).toContain("Edge-function integration");
  });

  it("wraps the executable SQL in exactly one BEGIN;/COMMIT;", () => {
    expect(candidateBody.startsWith("BEGIN;\n")).toBe(true);
    expect(candidateBody.endsWith("\nCOMMIT;")).toBe(true);
    expect(candidateBody.split("\n").filter((l) => l === "BEGIN;")).toHaveLength(1);
    expect(candidateBody.split("\n").filter((l) => l === "COMMIT;")).toHaveLength(1);
  });
});

describe("Phase 1R-D2-B2-A — table contract", () => {
  it("declares exactly one strict table without IF NOT EXISTS", () => {
    const creates = candidateSql.match(/CREATE TABLE\s+public\.business_checkout_claims\s*\(/g) ?? [];
    expect(creates).toHaveLength(1);
    expect(candidateSql).not.toContain("CREATE TABLE IF NOT EXISTS");
    expect(
      (candidateSql.match(/CREATE TABLE\s+public\./g) ?? []).length,
    ).toBe(1);
  });

  it("declares the exact fourteen-column set", () => {
    const columns = [
      "user_id                     uuid PRIMARY KEY",
      "context                     text NOT NULL",
      "subject_id                  uuid NOT NULL",
      "plan_key                    text NOT NULL",
      "request_key                 text NOT NULL",
      "generation                  integer NOT NULL DEFAULT 1",
      "state                       text NOT NULL",
      "claim_token                 uuid NULL",
      "lease_expires_at            timestamptz NULL",
      "stripe_checkout_session_id  text NULL",
      "checkout_expires_at         timestamptz NULL",
      "last_error_code             text NULL",
      "created_at                  timestamptz NOT NULL DEFAULT now()",
      "updated_at                  timestamptz NOT NULL DEFAULT now()",
    ];
    for (const column of columns) {
      expect(candidateSql).toContain(column);
    }
    expect(columns).toHaveLength(14);
  });

  it("enforces the exact context and context/plan matrix", () => {
    expect(candidateSql).toContain("CHECK (context IN ('recruiter','agency'))");
    expect(candidateSql).toContain(
      "(context = 'recruiter' AND plan_key IN ('starter','growth','fleet'))",
    );
    expect(candidateSql).toContain(
      "(context = 'agency' AND plan_key IN ('agency_starter','agency_team','agency_growth'))",
    );
  });

  it("enforces generation, state, request key, and error code shapes", () => {
    expect(candidateSql).toContain("CHECK (generation > 0)");
    expect(candidateSql).toContain(
      "CHECK (state IN ('processing','ready','released','failed'))",
    );
    expect(candidateSql).toContain("btrim(request_key) <> ''");
    expect(candidateSql).toContain(
      "char_length(btrim(request_key)) BETWEEN 1 AND 200",
    );
    expect(candidateSql).toContain(
      "last_error_code ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'",
    );
    expect(candidateSql).not.toContain("'^[a-z0-9_]+$'");
    expect(candidateSql).toContain(
      "char_length(last_error_code) BETWEEN 1 AND 64",
    );
  });

  it("enforces processing, ready, and inactive coherence", () => {
    expect(candidateSql).toContain(
      "business_checkout_claims_processing_coherent_chk",
    );
    expect(candidateSql).toContain("business_checkout_claims_ready_coherent_chk");
    expect(candidateSql).toContain(
      "business_checkout_claims_inactive_coherent_chk",
    );
    expect(candidateSql).toContain("lease_expires_at = checkout_expires_at");
    expect(candidateSql).toContain("btrim(stripe_checkout_session_id) <> ''");
    expect(candidateSql).toContain(
      "CHECK (state NOT IN ('released','failed')\n      OR (claim_token IS NULL AND lease_expires_at IS NULL))",
    );
  });

  it("creates strict partial unique indexes on token and session id", () => {
    expect(candidateSql).toContain(
      "CREATE UNIQUE INDEX business_checkout_claims_claim_token_uniq",
    );
    expect(candidateSql).toContain(
      "CREATE UNIQUE INDEX business_checkout_claims_session_id_uniq",
    );
    expect(candidateSql).toContain("WHERE claim_token IS NOT NULL");
    expect(candidateSql).toContain("WHERE stripe_checkout_session_id IS NOT NULL");
    expect(candidateSql).not.toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
  });

  it("adds no foreign key from the polymorphic subject_id", () => {
    expect(candidateSql).not.toMatch(/subject_id[^\n]*REFERENCES/);
  });
});

describe("Phase 1R-D2-B2-A — security posture", () => {
  it("enables RLS and creates no policy", () => {
    expect(candidateSql).toContain(
      "ALTER TABLE public.business_checkout_claims ENABLE ROW LEVEL SECURITY",
    );
    expect(candidateSql).not.toContain("CREATE POLICY");
  });

  it("revokes table access from PUBLIC/anon/authenticated and grants service_role", () => {
    expect(candidateSql).toContain(
      "REVOKE ALL ON TABLE public.business_checkout_claims FROM PUBLIC",
    );
    expect(candidateSql).toContain(
      "REVOKE ALL ON TABLE public.business_checkout_claims FROM anon",
    );
    expect(candidateSql).toContain(
      "REVOKE ALL ON TABLE public.business_checkout_claims FROM authenticated",
    );
    expect(candidateSql).toContain(
      "GRANT  ALL ON TABLE public.business_checkout_claims TO service_role",
    );
  });

  it("revokes function execution and grants service_role plus optional test roles", () => {
    expect(candidateSql).toContain("REVOKE ALL ON FUNCTION ' || v_sig || ' FROM PUBLIC");
    expect(candidateSql).toContain("REVOKE ALL ON FUNCTION ' || v_sig || ' FROM anon");
    expect(candidateSql).toContain(
      "REVOKE ALL ON FUNCTION ' || v_sig || ' FROM authenticated",
    );
    expect(candidateSql).toContain(
      "GRANT EXECUTE ON FUNCTION ' || v_sig || ' TO service_role",
    );
    expect(candidateSql).toContain("ARRAY['pglite_test','postgres_test_runner']");
  });

  it("declares every function SECURITY DEFINER with a pinned search_path", () => {
    const definers = candidateSql.match(/^SECURITY DEFINER$/gm) ?? [];
    const searchPaths = candidateSql.match(/^SET search_path = public$/gm) ?? [];
    expect(definers).toHaveLength(3);
    expect(searchPaths).toHaveLength(3);
  });
});

describe("Phase 1R-D2-B2-A — exactly three RPCs", () => {
  it("defines exactly three functions and no fourth or overload", () => {
    const defs = candidateSql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g) ?? [];
    expect(defs).toHaveLength(3);
    const names = defs.map((d) => d.replace(/.*public\./, "").replace("(", ""));
    expect([...names].sort()).toEqual([
      "claim_business_checkout",
      "complete_business_checkout_claim",
      "release_business_checkout_claim",
    ]);
    expect(new Set(names).size).toBe(3);
  });

  it("uses the exact claim signature and eleven-column return contract", () => {
    expect(candidateSql).toContain(
      "CREATE OR REPLACE FUNCTION public.claim_business_checkout(\n" +
        "  _user_id     uuid,\n" +
        "  _context     text,\n" +
        "  _subject_id  uuid,\n" +
        "  _plan_key    text,\n" +
        "  _request_key text\n" +
        ")",
    );
    const returnBlock = candidateSql.slice(
      candidateSql.indexOf("RETURNS TABLE (\n  outcome"),
      candidateSql.indexOf("LANGUAGE plpgsql"),
    );
    const ordered = [
      "outcome                     text",
      "reason                      text",
      "claim_context               text",
      "claim_subject_id            uuid",
      "claim_plan_key              text",
      "generation                  integer",
      "claim_token                 uuid",
      "claim_state                 text",
      "lease_expires_at            timestamptz",
      "stripe_checkout_session_id  text",
      "checkout_expires_at         timestamptz",
    ];
    let cursor = -1;
    for (const column of ordered) {
      const at = returnBlock.indexOf(column);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(ordered).toHaveLength(11);
  });

  it("uses the exact complete and release signatures and returns", () => {
    expect(candidateSql).toContain(
      "CREATE OR REPLACE FUNCTION public.complete_business_checkout_claim(\n" +
        "  _user_id             uuid,\n" +
        "  _context             text,\n" +
        "  _claim_token         uuid,\n" +
        "  _session_id          text,\n" +
        "  _checkout_expires_at timestamptz\n" +
        ")",
    );
    expect(candidateSql).toContain(
      "CREATE OR REPLACE FUNCTION public.release_business_checkout_claim(\n" +
        "  _user_id     uuid,\n" +
        "  _context     text,\n" +
        "  _claim_token uuid,\n" +
        "  _error_code  text,\n" +
        "  _terminal    boolean\n" +
        ")",
    );
    expect(
      (candidateSql.match(/RETURNS TABLE \(outcome text, reason text\)/g) ?? []).length,
    ).toBe(2);
  });

  it("comments each function signature exactly once", () => {
    expect(candidateSql).toContain(
      "COMMENT ON FUNCTION public.claim_business_checkout(uuid,text,uuid,text,text)",
    );
    expect(candidateSql).toContain(
      "COMMENT ON FUNCTION public.complete_business_checkout_claim(uuid,text,uuid,text,timestamptz)",
    );
    expect(candidateSql).toContain(
      "COMMENT ON FUNCTION public.release_business_checkout_claim(uuid,text,uuid,text,boolean)",
    );
  });
});

describe("Phase 1R-D2-B2-A-R2 — Repair A: lock namespace and post-lock clock", () => {
  it("declares the 64-bit namespace constant in all three RPCs", () => {
    const declared =
      candidateSql.match(
        /v_lock_namespace constant bigint := 7218926914894380123;/g,
      ) ?? [];
    expect(declared).toHaveLength(3);
  });

  it("acquires every advisory lock through the declared constant", () => {
    const locks = candidateSql.match(/pg_advisory_xact_lock\(/g) ?? [];
    expect(locks).toHaveLength(3);
    const namespaced =
      candidateSql.match(
        /hashtextextended\(_user_id::text, v_lock_namespace\)/g,
      ) ?? [];
    expect(namespaced).toHaveLength(3);
    expect(candidateSql).not.toContain(
      "hashtextextended(_user_id::text, 7218926914894380123)",
    );
    expect(candidateSql).not.toContain("hashtext('bcc:'");
    expect(candidateSql).not.toContain("::bigint\n  );");
  });

  it("declares v_now with no initializer in all three RPCs", () => {
    const declared = candidateSql.match(/^  v_now\s+timestamptz;$/gm) ?? [];
    expect(declared).toHaveLength(3);
    expect(candidateSql).not.toMatch(/v_now\s+timestamptz\s*:=/);
    expect(candidateSql).not.toMatch(/v_now\s*(timestamptz)?\s*:=\s*now\(\)/);
  });

  it("re-reads clock_timestamp() immediately after every lock acquisition", () => {
    const segments = candidateSql.split("pg_advisory_xact_lock(").slice(1);
    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      const lockEnd = segment.indexOf(");");
      const after = segment.slice(lockEnd, lockEnd + 240);
      expect(after).toContain("v_now := clock_timestamp();");
    }
  });

  it("refreshes the clock a second time in claim before the durable row select", () => {
    const claimStart = candidateSql.indexOf(
      "CREATE OR REPLACE FUNCTION public.claim_business_checkout(",
    );
    const claimEnd = candidateSql.indexOf(
      "COMMENT ON FUNCTION public.claim_business_checkout(",
    );
    const claimBody = candidateSql.slice(claimStart, claimEnd);
    const refreshes = claimBody.match(/v_now := clock_timestamp\(\);/g) ?? [];
    expect(refreshes).toHaveLength(2);

    const lockAt = claimBody.indexOf("pg_advisory_xact_lock(");
    const first = claimBody.indexOf("v_now := clock_timestamp();", lockAt);
    const second = claimBody.indexOf("v_now := clock_timestamp();", first + 1);
    const selectAt = claimBody.indexOf(
      "SELECT * INTO v_row FROM public.business_checkout_claims",
    );
    expect(second).toBeGreaterThan(first);
    expect(selectAt).toBeGreaterThan(second);
  });

  it("revalidates checkout expiry after the lock and before the row select", () => {
    const start = candidateSql.indexOf(
      "CREATE OR REPLACE FUNCTION public.complete_business_checkout_claim(",
    );
    const end = candidateSql.indexOf(
      "COMMENT ON FUNCTION public.complete_business_checkout_claim(",
    );
    const body = candidateSql.slice(start, end);
    const lockAt = body.indexOf("pg_advisory_xact_lock(");
    const clockAt = body.indexOf("v_now := clock_timestamp();", lockAt);
    const revalidateAt = body.indexOf(
      "IF NOT (_checkout_expires_at IS NOT NULL AND _checkout_expires_at > v_now) THEN",
    );
    const selectAt = body.indexOf(
      "SELECT * INTO v_row FROM public.business_checkout_claims",
    );
    expect(revalidateAt).toBeGreaterThan(clockAt);
    expect(selectAt).toBeGreaterThan(revalidateAt);
    expect(body).toContain(
      "IF _checkout_expires_at IS NULL OR _checkout_expires_at <= clock_timestamp() THEN",
    );
  });

  it("uses the fixed 300-second processing lease", () => {
    expect(candidateSql).toContain("v_lease_seconds constant integer := 300");
    expect(candidateSql).toContain("make_interval(secs => v_lease_seconds)");
  });
});

describe("Phase 1R-D2-B2-A-R2 — Repair B: strict null and shape validation", () => {
  it("rejects a NULL plan key explicitly before three-valued logic applies", () => {
    expect(candidateSql).toContain("IF _plan_key IS NULL THEN");
    const planNullAt = candidateSql.indexOf("IF _plan_key IS NULL THEN");
    const planMatrixAt = candidateSql.indexOf(
      "(_context = 'recruiter' AND _plan_key IN ('starter','growth','fleet'))",
    );
    expect(planNullAt).toBeGreaterThan(0);
    expect(planNullAt).toBeLessThan(planMatrixAt);
  });

  it("rejects a NULL terminal flag with the exact terminal_flag_invalid reason", () => {
    expect(candidateSql).toContain("IF _terminal IS NULL THEN");
    expect(candidateSql).toContain("'terminal_flag_invalid'");
    expect(candidateSql).not.toContain("terminal_flag_missing");
    expect(candidateSql.indexOf("IF _terminal IS NULL THEN")).toBeLessThan(
      candidateSql.indexOf("v_next := CASE WHEN _terminal THEN"),
    );
  });

  it("enforces strict snake_case error codes in the release RPC", () => {
    expect(candidateSql).toContain(
      "OR _error_code !~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'",
    );
    const strict =
      candidateSql.match(/\^\[a-z\]\[a-z0-9\]\*\(_\[a-z0-9\]\+\)\*\$/g) ?? [];
    expect(strict).toHaveLength(2);
  });
});

describe("Phase 1R-D2-B2-A-R2 — Repair C: fail-closed setwise precedence", () => {
  it("removes every single-row LIMIT 1 shortcut and the v_has_owner gate", () => {
    expect(candidateSql).not.toContain("LIMIT 1");
    expect(candidateSql).not.toContain("IF FOUND THEN");
    expect(candidateSql).not.toContain("v_has_owner");
  });

  it("joins ownership and active agency_owner membership inside the aggregate", () => {
    expect(candidateSql).toContain(
      "INTO v_unknown, v_live, v_past_due_stripe, v_past_due_other",
    );
    const aggregateAt = candidateSql.indexOf(
      "INTO v_unknown, v_live, v_past_due_stripe, v_past_due_other",
    );
    const joinBlock = candidateSql.slice(aggregateAt, aggregateAt + 700);
    expect(joinBlock).toContain("FROM public.agency_entitlements ae");
    expect(joinBlock).toContain("JOIN public.agency_profiles ap ON ap.id = ae.agency_id");
    expect(joinBlock).toContain("AND am.member_user_id = _user_id");
    expect(joinBlock).toContain("AND am.role::text = 'agency_owner'");
    expect(joinBlock).toContain("AND am.status::text = 'active'");
    expect(joinBlock).toContain("WHERE ap.owner_user_id = _user_id");
  });

  it("orders agency precedence unknown > live > non-stripe past_due > stripe past_due", () => {
    const order = [
      "IF v_unknown > 0 THEN",
      "'opposing_entitlement_unknown'",
      "ELSIF v_live > 0 THEN",
      "'agency_entitlement_exists'",
      "ELSIF v_past_due_other > 0 THEN",
      "'opposing_entitlement_unknown'",
      "ELSIF v_past_due_stripe > 0 THEN",
      "'agency_billing_requires_management'",
    ];
    let cursor = -1;
    for (const token of order) {
      const at = candidateSql.indexOf(token, cursor + 1);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(candidateSql).toContain(
      "unknown > live > past_due(non-stripe, fail closed) > past_due(stripe)",
    );
  });

  it("evaluates all recruiter billing rows with deterministic precedence", () => {
    expect(candidateSql).toContain("INTO v_null_status, v_unknown, v_live");
    expect(candidateSql).toContain("IF v_null_status > 0 OR v_unknown > 0 THEN");
    expect(candidateSql).toContain(
      "ELSIF v_live > 0 THEN\n      outcome := 'blocked'; reason := 'recruiter_subscription_exists';",
    );
  });

  it("counts setwise with FILTER rather than reading one arbitrary row", () => {
    const filters = candidateSql.match(/count\(\*\) FILTER \(WHERE/g) ?? [];
    expect(filters).toHaveLength(7);
    expect(candidateSql).not.toContain("SELECT ae.plan_key, ae.status, ae.source");
    expect(candidateSql).not.toContain("SELECT rbp.plan, rbp.status");
  });
});

describe("Phase 1R-D2-B2-A-R2 — Repair D/E: proof fidelity and hygiene", () => {
  const pgTestSource = readRepoFile(PG_TEST_REL);
  const pgConfigSource = readRepoFile(PG_CONFIG_REL);

  it("mirrors the exact production uniqueness constraints in the bootstrap", () => {
    expect(pgTestSource).toContain(
      "CONSTRAINT agency_entitlements_agency_id_key UNIQUE (agency_id)",
    );
    expect(pgTestSource).toContain(
      "CONSTRAINT recruiter_billing_profiles_recruiter_uq UNIQUE (recruiter_id)",
    );
    expect(pgTestSource).toContain(
      "CONSTRAINT recruiter_profiles_user_unique UNIQUE (user_id)",
    );
    expect(pgTestSource).toContain(
      "-- production-fidelity: agency_entitlements.agency_id UNIQUE",
    );
    expect(pgTestSource).toContain(
      "-- production-fidelity: recruiter_billing_profiles.recruiter_id UNIQUE only",
    );
  });

  it("uses real two-agency fixtures for multi-entitlement precedence", () => {
    expect(pgTestSource).toContain("async function seedTwoAgencies(");
    expect(pgTestSource).toContain("ON CONFLICT (agency_id) DO UPDATE");
    expect(pgTestSource).toContain(
      "blocks a same-context claim for a DIFFERENT agency the same user owns",
    );
    expect(pgTestSource).toContain(
      "fails closed when stripe past_due mixes with $other past_due",
    );
  });

  it("contains no sleep, timer, or elapsed-time based proof", () => {
    for (const forbidden of [
      "setTimeout",
      "setInterval",
      "Date.now()",
      "startedAt",
      "lock-wait",
      "lockwait",
    ]) {
      expect(pgTestSource).not.toContain(forbidden);
    }
  });

  it("rejects focused, skipped, todo, and snapshot tokens in the proofs", () => {
    const forbiddenTokens = [
      [".on", "ly("],
      [".sk", "ip("],
      [".to", "do("],
      ["toMatchSn", "apshot("],
      ["toMatchInlineSn", "apshot("],
    ].map(([a, b]) => a + b);

    const selfSource = readRepoFile(
      path.join("src", "test", "phase1rD2B2BusinessCheckoutClaimCandidateContract.test.ts"),
    );

    for (const token of forbiddenTokens) {
      expect(selfSource).not.toContain(token);
      expect(pgTestSource).not.toContain(token);
      expect(pgConfigSource).not.toContain(token);
    }
    expect(forbiddenTokens).toHaveLength(5);
  });
});


describe("Phase 1R-D2-B2-A — coordination and D1 policy vocabulary", () => {

  it("reproduces the exact D1 agency vocabulary and block reasons", () => {
    expect(candidateSql).toContain(
      "'agency_starter','agency_team','agency_growth'",
    );
    expect(candidateSql).toContain("'stripe','manual','admin_seed'");
    expect(candidateSql).toContain(
      "'manual_beta','trialing','active','past_due','cancelled'", // trial-allowlist: Stripe status vocabulary literal
    );
    expect(candidateSql).toContain("'agency_entitlement_exists'");
    expect(candidateSql).toContain("'agency_billing_requires_management'");
    expect(candidateSql).toContain("'opposing_entitlement_unknown'");
  });

  it("reproduces the exact D1 recruiter vocabulary and block reasons", () => {
    expect(candidateSql).toContain("'canceled','incomplete_expired','inactive'");
    expect(candidateSql).toContain(
      "'active','trialing','past_due','unpaid','incomplete','paused'", // trial-allowlist: Stripe status vocabulary literal
    );
    expect(candidateSql).toContain("'starter','growth','fleet'");
    expect(candidateSql).toContain("'recruiter_subscription_exists'");
  });

  it("uses the exact claim outcome and claim-conflict reason vocabulary", () => {
    for (const token of [
      "'acquired'",
      "'reused'",
      "'blocked'",
      "'not_owner'",
      "'invalid_input'",
      "'opposing_claim_active'",
      "'same_context_claim_active'",
      "'already_completed'",
      "'session_conflict'",
      "'lease_invalid'",
      "'ready_claim_not_releasable'",
    ]) {
      expect(candidateSql).toContain(token);
    }
  });
});

describe("Phase 1R-D2-B2-A — destructive and coupling exclusions", () => {
  it("contains no trigger, policy, backfill, delete, or drop statements", () => {
    for (const forbidden of [
      "CREATE TRIGGER",
      "CREATE POLICY",
      "DELETE FROM",
      "DROP TABLE",
      "DROP FUNCTION",
      "TRUNCATE",
      "ALTER TABLE public.recruiter_billing_profiles",
      "ALTER TABLE public.agency_entitlements",
    ]) {
      expect(candidateSql).not.toContain(forbidden);
    }
  });

  it("never updates recruiter billing or agency entitlement rows", () => {
    expect(candidateSql).not.toMatch(/UPDATE\s+public\.recruiter_billing_profiles/);
    expect(candidateSql).not.toMatch(/UPDATE\s+public\.agency_entitlements/);
    expect(candidateSql).not.toMatch(/INSERT\s+INTO\s+public\.recruiter_billing_profiles/);
    expect(candidateSql).not.toMatch(/INSERT\s+INTO\s+public\.agency_entitlements/);
    const updates = candidateSql.match(/UPDATE\s+public\.(\w+)/g) ?? [];
    expect(new Set(updates)).toEqual(
      new Set(["UPDATE public.business_checkout_claims"]),
    );
  });

  it("stores only the single Checkout Session Stripe identifier", () => {
    expect(candidateSql).not.toContain("stripe_customer_id");
    expect(candidateSql).not.toContain("stripe_subscription_id");
    expect(candidateSql).not.toContain("webhook");
  });
});

describe("Phase 1R-D2-B2-A — prior artifacts unchanged", () => {
  const b1Active = readRepoFile(B1_ACTIVE_REL);
  const b1Candidate = readRepoFile(B1_CANDIDATE_REL);

  it("keeps the B1 active migration byte-identical to its historical candidate body", () => {
    expect(extractExecutableBody(b1Active)).toBe(
      extractExecutableBody(b1Candidate),
    );
  });

  it("keeps the B1 promotion header wording intact", () => {
    expect(b1Active).toContain(
      "Phase 1R-D2-B1 — Recruiter Checkout Intent Active-Migration Promotion",
    );
    expect(b1Candidate).toContain("-- CANDIDATE MIGRATION — NOT APPLIED LIVE.");
  });

  it("does not reference business checkout claims from the B1 artifacts", () => {
    expect(b1Active).not.toContain("business_checkout_claims");
    expect(b1Candidate).not.toContain("business_checkout_claims");
  });
});
