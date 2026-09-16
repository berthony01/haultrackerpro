import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase CF-1A — candidate → production migration promotion contract.
 *
 * Static, file-read-only. No database, no network. CF-1A was applied live
 * manually; this suite proves the repository recording is an exact copy of the
 * accepted candidates and preserves dependency order.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CANDIDATE_DIR = "supabase/migration-candidates";
const MIGRATION_DIR = "supabase/migrations";

const ENUM_FILE = "20260916050000_phase_cf1a_conversation_permission_vocabulary.sql";
const SCHEMA_FILE = "20260916050500_phase_cf1a_conversation_foundation.sql";
const BASENAMES = [ENUM_FILE, SCHEMA_FILE] as const;

const candidatePath = (base: string) => path.join(REPO_ROOT, CANDIDATE_DIR, base);
const migrationPath = (base: string) => path.join(REPO_ROOT, MIGRATION_DIR, base);

/** Executable lines only: `--` comments and blank lines stripped. */
const executableLines = (sql: string): string[] =>
  sql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));

const countExecutableStatements = (sql: string, needle: string): number =>
  executableLines(sql).filter((line) => line.toUpperCase() === needle).length;

describe("CF-1A promotion / file placement", () => {
  it("1a. both candidate files still exist at their accepted paths", () => {
    for (const base of BASENAMES) {
      expect(existsSync(candidatePath(base)), `${CANDIDATE_DIR}/${base}`).toBe(true);
    }
  });

  it("1b. both production migration files exist", () => {
    for (const base of BASENAMES) {
      expect(existsSync(migrationPath(base)), `${MIGRATION_DIR}/${base}`).toBe(true);
    }
  });

  it("1c. filenames preserve dependency order (vocabulary before foundation)", () => {
    expect(ENUM_FILE < SCHEMA_FILE).toBe(true);
    expect([...BASENAMES].sort()).toEqual([ENUM_FILE, SCHEMA_FILE]);
    expect(Number(ENUM_FILE.slice(0, 14))).toBeLessThan(Number(SCHEMA_FILE.slice(0, 14)));
  });
});

describe("CF-1A promotion / byte parity", () => {
  for (const base of BASENAMES) {
    it(`2. ${base} is string- and byte-identical candidate vs production`, () => {
      const candidateText = readFileSync(candidatePath(base), "utf8");
      const productionText = readFileSync(migrationPath(base), "utf8");
      expect(productionText).toBe(candidateText);

      const candidateBytes = readFileSync(candidatePath(base));
      const productionBytes = readFileSync(migrationPath(base));
      expect(productionBytes.equals(candidateBytes)).toBe(true);
      expect(productionBytes.length).toBeGreaterThan(0);
    });
  }
});

describe("CF-1A promotion / transaction shape", () => {
  const enumSql = readFileSync(migrationPath(ENUM_FILE), "utf8");
  const schemaSql = readFileSync(migrationPath(SCHEMA_FILE), "utf8");

  it("3a. enum migration is intentionally transaction-free", () => {
    expect(countExecutableStatements(enumSql, "BEGIN;")).toBe(0);
    expect(countExecutableStatements(enumSql, "COMMIT;")).toBe(0);
    expect(enumSql).toContain(
      "ALTER TYPE public.recruiter_workspace_permission\n  ADD VALUE IF NOT EXISTS 'conversations_view';",
    );
    expect(enumSql).toContain(
      "ALTER TYPE public.recruiter_workspace_permission\n  ADD VALUE IF NOT EXISTS 'conversations_reply';",
    );
    expect(enumSql).not.toMatch(/CREATE TABLE/i);
  });

  it("3b. schema migration has exactly one executable BEGIN and one COMMIT", () => {
    expect(countExecutableStatements(schemaSql, "BEGIN;")).toBe(1);
    expect(countExecutableStatements(schemaSql, "COMMIT;")).toBe(1);
    const lines = executableLines(schemaSql);
    expect(lines[0]).toBe("BEGIN;");
    expect(lines[lines.length - 1]).toBe("COMMIT;");
  });
});

describe("CF-1A promotion / hardening present in the production copy", () => {
  const schemaSql = readFileSync(migrationPath(SCHEMA_FILE), "utf8");
  const TABLES = [
    "conversation_threads",
    "conversation_participants",
    "conversation_messages",
    "conversation_events",
  ] as const;

  it("4a. retains the admin view-only guard (no blanket admin bypass)", () => {
    expect(schemaSql).toMatch(
      /IF _action = 'view' AND public\.is_admin\(_uid\) THEN\s+RETURN true;\s+END IF;/,
    );
    expect(schemaSql).not.toMatch(/IF public\.is_admin\(_uid\) THEN\s+RETURN true;/);
    expect((schemaSql.match(/public\.is_admin\(/g) ?? []).length).toBe(1);
  });

  it("4b. retains the four explicit table privilege revokes", () => {
    for (const table of TABLES) {
      expect(schemaSql).toContain(
        `REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated;`,
      );
      expect(schemaSql).toContain(`GRANT SELECT ON public.${table} TO authenticated;`);
      expect(schemaSql).toContain(`GRANT ALL ON public.${table} TO service_role;`);
      expect(schemaSql).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`,
      );
    }
    expect(
      (
        schemaSql.match(
          /REVOKE ALL ON public\.conversation_\w+ FROM PUBLIC, anon, authenticated;/g,
        ) ?? []
      ).length,
    ).toBe(TABLES.length);
  });
});
