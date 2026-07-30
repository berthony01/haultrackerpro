import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 1R-D2-B2-B — atomic business checkout claim active-migration promotion
 * contract. Static, file-read-only proof. No database, no network.
 *
 * This test owns the byte-for-byte equality proof between the accepted B2-A
 * candidate and the promoted active migration. Creating the active migration
 * FILE does not apply any SQL to production or to any connected database.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const CANDIDATE_REL = path.join(
  "supabase",
  "migration-candidates",
  "20260730070000_phase1r_d2_b2_business_checkout_claims.sql",
);

const ACTIVE_REL = path.join(
  "supabase",
  "migrations",
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

const SELF_REL = path.join(
  "src",
  "test",
  "phase1rD2B2BusinessCheckoutClaimMigrationPromotion.test.ts",
);

const ACTIVE_BASENAME = "20260730070000_phase1r_d2_b2_business_checkout_claims.sql";
const B1_ACTIVE_BASENAME =
  "20260730060000_phase1r_d2_b1_recruiter_checkout_intents.sql";

function readRepoFile(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/**
 * Executable body: from the first exact `BEGIN;` line through the last exact
 * `COMMIT;` line, inclusive.
 */
function extractExecutableBody(sql: string): string {
  const lines = sql.split("\n");
  const begin = lines.findIndex((line) => line === "BEGIN;");
  const end = lines.lastIndexOf("COMMIT;");
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  return lines.slice(begin, end + 1).join("\n");
}

const candidateSql = readRepoFile(CANDIDATE_REL);
const activeSql = readRepoFile(ACTIVE_REL);

const candidateHeader = candidateSql.slice(0, candidateSql.indexOf("\nBEGIN;"));
const activeHeader = activeSql.slice(0, activeSql.indexOf("\nBEGIN;"));

const candidateBody = extractExecutableBody(candidateSql);
const activeBody = extractExecutableBody(activeSql);

const RPC_SIGNATURES = [
  "claim_business_checkout(uuid,text,uuid,text,text)",
  "complete_business_checkout_claim(uuid,text,uuid,text,timestamptz)",
  "release_business_checkout_claim(uuid,text,uuid,text,boolean)",
] as const;

describe("Phase 1R-D2-B2-B — promotion file placement", () => {
  it("keeps the accepted candidate at its exact migration-candidates path", () => {
    expect(existsSync(path.join(REPO_ROOT, CANDIDATE_REL))).toBe(true);
  });

  it("creates the active migration at its exact managed-migrations path", () => {
    expect(existsSync(path.join(REPO_ROOT, ACTIVE_REL))).toBe(true);
  });
});

describe("Phase 1R-D2-B2-B — byte-for-byte executable body equality", () => {
  it("produces exact string equality between candidate and active bodies", () => {
    expect(activeBody).toBe(candidateBody);
  });

  it("produces exact byte equality between candidate and active bodies", () => {
    expect(Buffer.from(activeBody, "utf8").equals(Buffer.from(candidateBody, "utf8"))).toBe(
      true,
    );
  });

  it("starts with BEGIN; and ends with COMMIT; in both files", () => {
    for (const body of [candidateBody, activeBody]) {
      expect(body.startsWith("BEGIN;\n")).toBe(true);
      expect(body.endsWith("\nCOMMIT;")).toBe(true);
    }
  });

  it("contains exactly one BEGIN; and one COMMIT; in both files", () => {
    for (const sql of [candidateSql, activeSql]) {
      const lines = sql.split("\n");
      expect(lines.filter((line) => line === "BEGIN;")).toHaveLength(1);
      expect(lines.filter((line) => line === "COMMIT;")).toHaveLength(1);
    }
  });

  it("keeps both bodies non-trivial", () => {
    expect(candidateBody.length).toBeGreaterThan(10_000);
    expect(activeBody.length).toBeGreaterThan(10_000);
  });

  it("uses normalized LF line endings in the active migration", () => {
    expect(activeSql).not.toContain("\r");
  });
});

describe("Phase 1R-D2-B2-B — active promotion header", () => {
  it("identifies the exact phase and title", () => {
    expect(activeHeader).toContain("Phase 1R-D2-B2-B");
    expect(activeHeader).toContain(
      "Atomic Business Checkout Claim Active-Migration Promotion",
    );
  });

  it("references the exact promoted candidate path", () => {
    expect(activeHeader).toContain(
      "supabase/migration-candidates/20260730070000_phase1r_d2_b2_business_checkout_claims.sql",
    );
  });

  it("states the commit creates the FILE only", () => {
    expect(activeHeader).toContain("creates the managed migration FILE only");
  });

  it("states SQL is not applied to production or a connected database", () => {
    expect(activeHeader).toContain("DOES NOT apply SQL");
    expect(activeHeader).toContain("to production or any connected database");
  });

  it("states production application and edge integration are separate", () => {
    expect(activeHeader).toContain("separate controlled phase");
    expect(activeHeader).toContain("Edge-function integration is also separate");
  });

  it("appears entirely before the executable body", () => {
    expect(activeHeader).not.toContain("CREATE TABLE");
    expect(activeSql.indexOf("\nBEGIN;")).toBeGreaterThan(0);
  });
});

describe("Phase 1R-D2-B2-B — candidate header immutability", () => {
  it("keeps the candidate header candidate-only", () => {
    expect(candidateHeader).toContain("Phase 1R-D2-B2-A");
    expect(candidateHeader).toContain("CANDIDATE ONLY");
    expect(candidateHeader).toContain(
      "NOT part of the managed migrations directory",
    );
  });

  it("still states that B2-B promotion is a separate phase", () => {
    expect(candidateHeader).toContain("B2-B promotion");
    expect(candidateHeader).toContain("SEPARATE phase");
  });

  it("is not rewritten into promotion wording", () => {
    expect(candidateHeader).not.toContain(
      "Active-Migration Promotion",
    );
    expect(candidateHeader).not.toContain("Promoted from");
  });
});

describe("Phase 1R-D2-B2-B — table contract preserved", () => {
  it("declares exactly one business_checkout_claims table", () => {
    const matches =
      activeBody.match(/CREATE TABLE public\.business_checkout_claims/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("declares no other CREATE TABLE", () => {
    expect((activeBody.match(/CREATE TABLE/g) ?? [])).toHaveLength(1);
  });

  it("uses strict DDL without IF NOT EXISTS", () => {
    expect(activeBody).not.toMatch(/IF NOT EXISTS/i);
  });

  it("preserves the exact fourteen-column vocabulary", () => {
    for (const column of [
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
    ]) {
      expect(activeBody, column).toContain(column);
    }
  });

  it("preserves the exact named CHECK constraints", () => {
    for (const name of [
      "business_checkout_claims_context_chk",
      "business_checkout_claims_context_plan_chk",
      "business_checkout_claims_generation_chk",
      "business_checkout_claims_state_chk",
      "business_checkout_claims_request_key_chk",
      "business_checkout_claims_error_code_chk",
      "business_checkout_claims_processing_coherent_chk",
      "business_checkout_claims_ready_coherent_chk",
      "business_checkout_claims_inactive_coherent_chk",
    ]) {
      expect(
        (activeBody.match(new RegExp(`CONSTRAINT ${name}\\b`, "g")) ?? []).length,
        name,
      ).toBe(1);
    }
  });

  it("preserves the exact state and context vocabularies", () => {
    expect(activeBody).toContain("CHECK (context IN ('recruiter','agency'))");
    expect(activeBody).toContain(
      "CHECK (state IN ('processing','ready','released','failed'))",
    );
  });

  it("declares exactly the two partial unique indexes", () => {
    const indexes = activeBody.match(/CREATE UNIQUE INDEX \w+/g) ?? [];
    expect(indexes).toHaveLength(2);
    expect(activeBody).toContain(
      "CREATE UNIQUE INDEX business_checkout_claims_claim_token_uniq\n  ON public.business_checkout_claims (claim_token)\n  WHERE claim_token IS NOT NULL;",
    );
    expect(activeBody).toContain(
      "CREATE UNIQUE INDEX business_checkout_claims_session_id_uniq\n  ON public.business_checkout_claims (stripe_checkout_session_id)\n  WHERE stripe_checkout_session_id IS NOT NULL;",
    );
  });

  it("declares no foreign key on the subject", () => {
    expect(activeBody).not.toMatch(/REFERENCES/i);
    expect(activeBody).not.toMatch(/FOREIGN KEY/i);
  });
});

describe("Phase 1R-D2-B2-B — exactly three RPCs", () => {
  it("declares exactly three function definitions", () => {
    const matches =
      activeBody.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) ?? [];
    expect(matches).toHaveLength(3);
  });

  it("declares the exact three RPC signatures", () => {
    expect(activeBody).toContain(
      "CREATE OR REPLACE FUNCTION public.claim_business_checkout(\n  _user_id     uuid,\n  _context     text,\n  _subject_id  uuid,\n  _plan_key    text,\n  _request_key text\n)",
    );
    expect(activeBody).toContain(
      "CREATE OR REPLACE FUNCTION public.complete_business_checkout_claim(\n  _user_id             uuid,\n  _context             text,\n  _claim_token         uuid,\n  _session_id          text,\n  _checkout_expires_at timestamptz\n)",
    );
    expect(activeBody).toContain(
      "CREATE OR REPLACE FUNCTION public.release_business_checkout_claim(\n  _user_id     uuid,\n  _context     text,\n  _claim_token uuid,\n  _error_code  text,\n  _terminal    boolean\n)",
    );
  });

  it("preserves the exact claim return contract", () => {
    expect(activeBody).toContain(
      "RETURNS TABLE (\n  outcome                     text,\n  reason                      text,\n  claim_context               text,\n  claim_subject_id            uuid,\n  claim_plan_key              text,\n  generation                  integer,\n  claim_token                 uuid,\n  claim_state                 text,\n  lease_expires_at            timestamptz,\n  stripe_checkout_session_id  text,\n  checkout_expires_at         timestamptz\n)",
    );
  });

  it("preserves the exact two outcome/reason return contracts", () => {
    expect(
      (activeBody.match(/^RETURNS TABLE \(outcome text, reason text\)$/gm) ?? [])
        .length,
    ).toBe(2);
  });

  it("keeps all three RPCs SECURITY DEFINER with a pinned search_path", () => {
    expect((activeBody.match(/^SECURITY DEFINER$/gm) ?? []).length).toBe(3);
    expect((activeBody.match(/^SET search_path = public$/gm) ?? []).length).toBe(3);
    expect((activeBody.match(/^LANGUAGE plpgsql$/gm) ?? []).length).toBe(3);
  });
});

describe("Phase 1R-D2-B2-B — lock, clock and lease contract", () => {
  it("declares the exact 64-bit namespace constant in all three RPCs", () => {
    expect(
      (
        activeBody.match(
          /^ {2}v_lock_namespace constant bigint := 7218926914894380123;$/gm,
        ) ?? []
      ).length,
    ).toBe(3);
  });

  it("acquires the advisory lock through the declared constant three times", () => {
    expect(
      (
        activeBody.match(
          /PERFORM pg_advisory_xact_lock\(\n {4}hashtextextended\(_user_id::text, v_lock_namespace\)\n {2}\);/g,
        ) ?? []
      ).length,
    ).toBe(3);
  });

  it("never hashes with a literal namespace", () => {
    expect(activeBody).not.toMatch(/hashtextextended\(_user_id::text,\s*7218926914894380123\)/);
  });

  it("declares v_now without an initializer in all three RPCs", () => {
    expect((activeBody.match(/^ {2}v_now\s+timestamptz;$/gm) ?? []).length).toBe(3);
    expect(activeBody).not.toMatch(/v_now\s+timestamptz\s*:=/);
  });

  it("re-reads wall-clock time after every lock acquisition", () => {
    expect((activeBody.match(/v_now := clock_timestamp\(\);/g) ?? []).length).toBe(4);
  });

  it("preserves the fixed 300-second lease", () => {
    expect(activeBody).toContain("v_lease_seconds constant integer := 300;");
    expect(
      (activeBody.match(/v_now \+ make_interval\(secs => v_lease_seconds\)/g) ?? [])
        .length,
    ).toBe(2);
  });

  it("keeps a ready claim blocking through the exact checkout expiry", () => {
    expect(activeBody).toContain("lease_expires_at = checkout_expires_at");
    expect(activeBody).toContain("lease_expires_at           = _checkout_expires_at");
  });
});

describe("Phase 1R-D2-B2-B — structured outcome vocabulary", () => {
  it("preserves the exact retry, release and session-collision markers", () => {
    for (const marker of [
      "'invalid_input'",
      "'missing_identifier'",
      "'unsupported_context'",
      "'plan_not_supported'",
      "'request_key_invalid'",
      "'missing_claim_token'",
      "'session_id_invalid'",
      "'checkout_expiry_invalid'",
      "'terminal_flag_invalid'",
      "'error_code_malformed'",
      "'not_owner'",
      "'recruiter_ownership_mismatch'",
      "'agency_ownership_mismatch'",
      "'agency_owner_membership_missing'",
      "'reused'",
      "'acquired'",
      "'not_found'",
      "'claim_missing'",
      "'context_mismatch'",
      "'claim_context_differs'",
      "'lease_invalid'",
      "'no_active_lease'",
      "'already_completed'",
      "'session_mismatch'",
      "'ready_session_differs'",
      "'session_conflict'",
      "'checkout_session_already_claimed'",
      "'release_forbidden'",
      "'ready_claim_not_releasable'",
    ]) {
      expect(activeBody, marker).toContain(marker);
    }
  });

  it("preserves the exact Phase 1R-D1 block-reason vocabulary", () => {
    for (const reason of [
      "'opposing_entitlement_unknown'",
      "'agency_entitlement_exists'",
      "'agency_billing_requires_management'",
      "'recruiter_subscription_exists'",
      "'opposing_claim_active'",
      "'same_context_claim_active'",
    ]) {
      expect(activeBody, reason).toContain(reason);
    }
  });

  it("preserves the exact D1 agency and recruiter status vocabularies", () => {
    expect(activeBody).toContain(
      "('manual_beta','trialing','active','past_due','cancelled')",
    );
    expect(activeBody).toContain(
      "('active','trialing','past_due','unpaid','incomplete','paused')",
    );
    expect(activeBody).toContain("('canceled','incomplete_expired','inactive')");
    expect(activeBody).toContain(
      "('agency_starter','agency_team','agency_growth')",
    );
    expect(activeBody).toContain("('stripe','manual','admin_seed')");
  });

  it("preserves the unique_violation collision handler", () => {
    expect(activeBody).toContain("EXCEPTION WHEN unique_violation THEN");
  });

  it("removes every terminal_flag_missing occurrence", () => {
    expect(activeBody).not.toContain("terminal_flag_missing");
  });
});

describe("Phase 1R-D2-B2-B — RLS and privilege posture", () => {
  it("enables row level security with no policy", () => {
    expect(activeBody).toContain(
      "ALTER TABLE public.business_checkout_claims ENABLE ROW LEVEL SECURITY;",
    );
    expect(activeBody).not.toMatch(/CREATE POLICY/i);
  });

  it("revokes table privileges from PUBLIC, anon and authenticated", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(activeBody, role).toContain(
        `REVOKE ALL ON TABLE public.business_checkout_claims FROM ${role};`,
      );
    }
  });

  it("grants table privileges to service_role", () => {
    expect(activeBody).toMatch(
      /GRANT\s+ALL ON TABLE public\.business_checkout_claims TO service_role;/,
    );
  });

  it("revokes function execution from PUBLIC, anon and authenticated", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(activeBody, role).toContain(
        `EXECUTE 'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM ${role}';`,
      );
    }
  });

  it("grants function execution to service_role", () => {
    expect(activeBody).toContain(
      "EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_sig || ' TO service_role';",
    );
  });

  it("enumerates exactly the three RPC signatures in the privilege loop", () => {
    for (const signature of RPC_SIGNATURES) {
      expect(activeBody, signature).toContain(`'${signature}'`);
    }
  });
});

describe("Phase 1R-D2-B2-B — forbidden statement exclusion", () => {
  it("adds no trigger and no backfill", () => {
    expect(activeBody).not.toMatch(/CREATE TRIGGER/i);
    expect(activeBody).not.toMatch(/INSERT INTO public\.recruiter_billing_profiles/i);
    expect(activeBody).not.toMatch(/INSERT INTO public\.agency_entitlements/i);
  });

  it("contains no destructive statement", () => {
    expect(activeBody).not.toMatch(/\bDROP\b/i);
    expect(activeBody).not.toMatch(/\bDELETE\b/i);
  });

  it("never mutates recruiter billing or agency entitlements", () => {
    expect(activeBody).not.toMatch(/UPDATE public\.recruiter_billing_profiles/i);
    expect(activeBody).not.toMatch(/UPDATE public\.agency_entitlements/i);
  });

  it("declares no Stripe customer or subscription field", () => {
    expect(activeBody).not.toMatch(/stripe_customer_id/i);
    expect(activeBody).not.toMatch(/stripe_subscription_id/i);
  });

  it("declares no fourth RPC", () => {
    expect(
      (activeBody.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length,
    ).toBe(3);
  });

  it("carries no connected-database or apply marker", () => {
    expect(activeSql).not.toMatch(/supabase db push/i);
    expect(activeSql).not.toMatch(/migration up/i);
    expect(activeSql).not.toMatch(/APPLIED TO PRODUCTION/i);
  });
});

describe("Phase 1R-D2-B2-B — migration ordering", () => {
  const migrationDir = path.join(REPO_ROOT, "supabase", "migrations");
  const names = readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  it("contains both B1 and B2 active migrations", () => {
    expect(names).toContain(B1_ACTIVE_BASENAME);
    expect(names).toContain(ACTIVE_BASENAME);
  });

  it("sorts the B2 migration strictly after the B1 migration", () => {
    expect(names.indexOf(ACTIVE_BASENAME)).toBeGreaterThan(
      names.indexOf(B1_ACTIVE_BASENAME),
    );
    expect(ACTIVE_BASENAME > B1_ACTIVE_BASENAME).toBe(true);
  });

  it("sorts before every migration with a strictly greater timestamp", () => {
    const ownStamp = ACTIVE_BASENAME.slice(0, 14);
    for (const name of names) {
      const stamp = name.slice(0, 14);
      if (stamp > ownStamp) {
        expect(names.indexOf(name), name).toBeGreaterThan(
          names.indexOf(ACTIVE_BASENAME),
        );
      }
    }
  });

  it("creates exactly one active business checkout claim migration", () => {
    const matching = names.filter((name) =>
      name.includes("business_checkout_claims"),
    );
    expect(matching).toEqual([ACTIVE_BASENAME]);
  });
});

describe("Phase 1R-D2-B2-B — prior B1 artifacts untouched", () => {
  const b1Active = readRepoFile(B1_ACTIVE_REL);
  const b1Candidate = readRepoFile(B1_CANDIDATE_REL);

  it("keeps the B1 active and historical candidate bodies identical", () => {
    expect(extractExecutableBody(b1Active)).toBe(
      extractExecutableBody(b1Candidate),
    );
  });

  it("keeps business checkout claims out of both B1 artifacts", () => {
    expect(b1Active).not.toContain("business_checkout_claims");
    expect(b1Candidate).not.toContain("business_checkout_claims");
  });
});

describe("Phase 1R-D2-B2-B — source hygiene", () => {
  it("uses no focused, skipped, todo, or snapshot assertions", () => {
    const source = readRepoFile(SELF_REL);
    const forbidden = [
      `${"."}only(`,
      `${"."}skip(`,
      `${"."}todo(`,
      `${"toMatch"}Snapshot(`,
      `${"toMatchInline"}Snapshot(`,
    ];
    for (const token of forbidden) {
      expect(source.includes(token), token).toBe(false);
    }
  });
});
