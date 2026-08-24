import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase TG-2F-A — secure dispatch-chat bind token foundation.
 *
 * Source-contract test over the TG-2F-A candidate migration. The candidate is
 * NOT applied live; these assertions therefore verify the authored SQL
 * contract, not runtime behaviour. Real-PostgreSQL behaviour is covered by
 * `tests/postgres/phaseTG2FDispatchChatBindTokenFoundation.test.ts`.
 */

const CANDIDATE_PATH = resolve(
  process.cwd(),
  "supabase/migration-candidates/20260824053000_phase_tg2f_dispatch_chat_bind_token_foundation.sql",
);

const sql = readFileSync(CANDIDATE_PATH, "utf8");

/** Executable SQL only: `--` commentary is documentation, not behaviour. */
const executableSql = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const TABLE = "public.telegram_dispatch_bind_tokens";
const ISSUE_FN = "public.issue_telegram_dispatch_bind_token";
const CONSUME_FN = "public.consume_telegram_dispatch_bind_token";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Full `CREATE FUNCTION ... $$;` block for one candidate function. */
function functionBlock(qualifiedName: string): string {
  const start = sql.indexOf(`CREATE FUNCTION ${qualifiedName}(`);
  expect(start, `missing CREATE FUNCTION for ${qualifiedName}`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  expect(end, `unterminated function body for ${qualifiedName}`).toBeGreaterThan(start);
  return sql.slice(start, end + 4);
}

/** Just the plpgsql body (from `AS $$` to the closing `$$`). */
function functionBody(qualifiedName: string): string {
  const block = functionBlock(qualifiedName);
  const bodyStart = block.indexOf("AS $$");
  expect(bodyStart, `missing AS $$ for ${qualifiedName}`).toBeGreaterThan(-1);
  return block.slice(bodyStart);
}

/** Executable-only view of a function body. */
function executableBody(qualifiedName: string): string {
  return functionBody(qualifiedName)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

// ---------------------------------------------------------------------------
// 1. Candidate-only, additive surface
// ---------------------------------------------------------------------------
describe("TG-2F-A candidate — additive surface only", () => {
  it("is marked candidate / not applied live", () => {
    expect(sql).toMatch(/CANDIDATE ONLY\s*—\s*NOT APPLIED LIVE/);
  });

  it("is wrapped in a single explicit transaction", () => {
    expect(countOccurrences(executableSql, "BEGIN;")).toBe(1);
    expect(countOccurrences(executableSql, "COMMIT;")).toBe(1);
    expect(executableSql.indexOf("BEGIN;")).toBeLessThan(executableSql.indexOf("COMMIT;"));
    expect(executableSql).not.toContain("ROLLBACK;");
  });

  it("creates exactly one table, and it is the bind-token table", () => {
    expect(countOccurrences(executableSql, "CREATE TABLE")).toBe(1);
    expect(executableSql).toContain(`CREATE TABLE ${TABLE} (`);
  });

  it("creates exactly two functions, both plain CREATE FUNCTION", () => {
    expect(countOccurrences(executableSql, "CREATE FUNCTION")).toBe(2);
    expect(executableSql).toContain(`CREATE FUNCTION ${ISSUE_FN}(`);
    expect(executableSql).toContain(`CREATE FUNCTION ${CONSUME_FN}(`);
    expect(executableSql).not.toMatch(/CREATE\s+OR\s+REPLACE/i);
  });

  it("never drops anything and never alters an existing object", () => {
    expect(executableSql).not.toMatch(/\bDROP\b/i);
    // The only ALTER permitted is enabling RLS on the brand-new table.
    const alters = executableSql.match(/ALTER\s+\w+[^\n;]*/gi) ?? [];
    expect(alters).toEqual([`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`]);
  });

  it("adds no trigger, type, view, schema, extension or publication", () => {
    for (const forbidden of [
      "CREATE TRIGGER",
      "CREATE TYPE",
      "ALTER TYPE",
      "CREATE VIEW",
      "CREATE MATERIALIZED VIEW",
      "CREATE SCHEMA",
      "CREATE EXTENSION",
      "CREATE PUBLICATION",
      "CREATE POLICY",
    ]) {
      expect(executableSql, `unexpected ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("modifies no existing TG-1/TG-2B/TG-2C/TG-2D/TG-2E object", () => {
    for (const existing of [
      "telegram_user_links",
      "telegram_link_tokens",
      "telegram_poll_state",
      "telegram_update_receipts",
      "issue_telegram_link_token",
      "consume_telegram_link_token",
      "revoke_my_telegram_link",
      "telegram_revoke_dispatch_chat",
      "telegram_process_start_update",
      "telegram_claim_poll_lease",
    ]) {
      expect(executableSql, `must not touch ${existing}`).not.toContain(existing);
    }
    // The one permitted reference is a CALL of the TG-2C bridge, never a
    // redefinition of it.
    expect(executableSql).not.toContain("CREATE FUNCTION public.telegram_bind_dispatch_chat");
    expect(executableSql).not.toContain("GRANT EXECUTE ON FUNCTION public.telegram_bind_dispatch_chat");
  });

  it("never issues DELETE — terminal token history is retained", () => {
    expect(executableSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(executableSql).not.toMatch(/\bTRUNCATE\b/i);
  });
});

// ---------------------------------------------------------------------------
// 2. No raw token, no Telegram identity/content, no metadata blob
// ---------------------------------------------------------------------------
describe("TG-2F-A candidate — token table stores hashes only", () => {
  const tableStart = executableSql.indexOf(`CREATE TABLE ${TABLE} (`);
  const tableDdl = executableSql.slice(
    tableStart,
    executableSql.indexOf("\n);", tableStart) + 3,
  );

  it("has no raw-token column", () => {
    expect(tableDdl).not.toMatch(/\braw_token\b/);
    expect(tableDdl).not.toMatch(/\btoken\s+text\b/);
    expect(tableDdl).toContain("token_hash text NOT NULL UNIQUE");
  });

  it("stores no Telegram identifier or message/display content", () => {
    for (const forbidden of [
      "telegram_user_id",
      "telegram_chat_id",
      "chat_type",
      "username",
      "chat_title",
      "first_name",
      "last_name",
      "message",
      "update_id",
    ]) {
      expect(tableDdl, `unexpected column ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("stores no JSON metadata of any kind", () => {
    expect(tableDdl).not.toMatch(/\bjsonb?\b/i);
    expect(tableDdl).not.toMatch(/\bmetadata\b/i);
    expect(tableDdl).not.toMatch(/\bpayload\b/i);
  });

  it("declares exactly the authorized column set", () => {
    for (const column of [
      "id uuid PRIMARY KEY DEFAULT gen_random_uuid()",
      "recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE",
      "issued_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE",
      "token_hash text NOT NULL UNIQUE",
      "created_at timestamptz NOT NULL DEFAULT now()",
      "expires_at timestamptz NOT NULL",
      "consumed_at timestamptz NULL",
      "invalidated_at timestamptz NULL",
    ]) {
      expect(tableDdl, `missing column ${column}`).toContain(column);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Hash / TTL / terminal-state constraints and outstanding-token index
// ---------------------------------------------------------------------------
describe("TG-2F-A candidate — lifecycle constraints", () => {
  it("pins token_hash to exactly 64 lowercase hex characters", () => {
    expect(executableSql).toContain("CHECK (token_hash ~ '^[0-9a-f]{64}$')");
  });

  it("requires expiry strictly after creation", () => {
    expect(executableSql).toContain("CHECK (expires_at > created_at)");
  });

  it("requires terminal timestamps not to predate creation", () => {
    expect(executableSql).toContain("CHECK (consumed_at IS NULL OR consumed_at >= created_at)");
    expect(executableSql).toContain(
      "CHECK (invalidated_at IS NULL OR invalidated_at >= created_at)",
    );
  });

  it("makes consumed and invalidated mutually exclusive", () => {
    expect(executableSql).toContain(
      "CHECK (NOT (consumed_at IS NOT NULL AND invalidated_at IS NOT NULL))",
    );
  });

  it("enforces one outstanding token per (recruiter_id, issued_by_user_id)", () => {
    expect(executableSql).toContain(
      `CREATE UNIQUE INDEX telegram_dispatch_bind_tokens_outstanding_pair_unique\n  ON ${TABLE} (recruiter_id, issued_by_user_id)\n  WHERE consumed_at IS NULL AND invalidated_at IS NULL;`,
    );
  });

  it("keeps now() out of every index predicate", () => {
    for (const indexBlock of executableSql.match(/CREATE (UNIQUE )?INDEX[\s\S]*?;/g) ?? []) {
      expect(indexBlock, "index predicate must be immutable").not.toContain("now()");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. RLS + direct privileges
// ---------------------------------------------------------------------------
describe("TG-2F-A candidate — table is unreachable from any client", () => {
  it("enables row level security", () => {
    expect(executableSql).toContain(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
  });

  it("declares zero client policies", () => {
    expect(executableSql).not.toContain("CREATE POLICY");
  });

  it("revokes all direct privileges from PUBLIC, anon and authenticated", () => {
    expect(executableSql).toContain(`REVOKE ALL ON TABLE ${TABLE} FROM PUBLIC;`);
    expect(executableSql).toContain(`REVOKE ALL ON TABLE ${TABLE} FROM anon;`);
    expect(executableSql).toContain(`REVOKE ALL ON TABLE ${TABLE} FROM authenticated;`);
  });

  it("grants direct table access to service_role only", () => {
    const tableGrants = (executableSql.match(/GRANT[^\n;]*ON TABLE[^\n;]*/g) ?? []);
    expect(tableGrants).toEqual([`GRANT ALL ON TABLE ${TABLE} TO service_role`]);
  });
});

// ---------------------------------------------------------------------------
// 5-6. Issue RPC contract
// ---------------------------------------------------------------------------
describe("TG-2F-A candidate — issue RPC", () => {
  const block = functionBlock(ISSUE_FN);
  const body = executableBody(ISSUE_FN);

  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(block).toContain("SECURITY DEFINER");
    expect(block).toContain("SET search_path TO 'pg_catalog', 'public', 'auth', 'extensions'");
  });

  it("takes only the recruiter workspace and returns text", () => {
    expect(block).toContain(`CREATE FUNCTION ${ISSUE_FN}(\n  _recruiter_id uuid\n)\nRETURNS text`);
  });

  it("derives the caller from auth.uid() and fails closed when unauthenticated", () => {
    expect(body).toContain("auth.uid()");
    expect(body).toContain("RAISE EXCEPTION 'telegram_not_authenticated'");
  });

  it("rejects a null recruiter workspace", () => {
    expect(body).toContain("IF _recruiter_id IS NULL THEN");
    expect(body).toContain("RAISE EXCEPTION 'telegram_dispatch_bind_invalid_input'");
  });

  it("requires an active recruiter profile under existing truth", () => {
    expect(body).toContain("FROM public.recruiter_profiles rp");
    expect(body).toContain("AND rp.status = 'active'");
    expect(body).toContain("RAISE EXCEPTION 'telegram_workspace_not_available'");
  });

  it("uses the exact existing dynamic loads_dispatch authority, with no role-label shortcut", () => {
    expect(body).toContain(
      "IF NOT public.current_user_has_recruiter_permission(_recruiter_id, 'loads_dispatch') THEN",
    );
    expect(body).toContain("RAISE EXCEPTION 'telegram_dispatch_not_authorized'");
    for (const shortcut of [
      "recruiter_owner",
      "recruiter_admin",
      "recruiter_staff",
      "recruiter_members",
      "is_admin",
      "has_role",
    ]) {
      expect(body, `must not shortcut via ${shortcut}`).not.toContain(shortcut);
    }
  });

  it("leaks no workspace or user detail in its failure messages", () => {
    for (const raised of body.match(/RAISE EXCEPTION '[^']*'/g) ?? []) {
      expect(raised).toMatch(/^RAISE EXCEPTION '[a-z0-9_]+'$/);
    }
    expect(body).not.toMatch(/RAISE EXCEPTION [^;]*%/);
  });

  it("invalidates any outstanding exact-pair token before inserting", () => {
    const invalidateAt = body.indexOf("SET invalidated_at = now()");
    const insertAt = body.indexOf(`INSERT INTO ${TABLE}`);
    expect(invalidateAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(invalidateAt);
    expect(body).toContain("WHERE t.recruiter_id = _recruiter_id");
    expect(body).toContain("AND t.issued_by_user_id = _uid");
    expect(body).toContain("AND t.consumed_at IS NULL");
    expect(body).toContain("AND t.invalidated_at IS NULL");
  });

  it("generates 32 random bytes and persists only the sha256 hash", () => {
    expect(body).toContain("_raw_token := encode(extensions.gen_random_bytes(32), 'hex')");
    expect(body).toContain("_token_hash := encode(extensions.digest(_raw_token, 'sha256'), 'hex')");
    expect(body).toContain("recruiter_id, issued_by_user_id, token_hash, expires_at");
    expect(body).not.toMatch(/INSERT[\s\S]*_raw_token/);
  });

  it("uses a 15 minute TTL and returns the raw token exactly once", () => {
    expect(body).toContain("now() + interval '15 minutes'");
    expect(countOccurrences(body, "RETURN _raw_token;")).toBe(1);
  });

  it("is executable by authenticated and service_role only", () => {
    expect(executableSql).toContain(`REVOKE ALL ON FUNCTION ${ISSUE_FN}(uuid) FROM PUBLIC;`);
    expect(executableSql).toContain(`REVOKE ALL ON FUNCTION ${ISSUE_FN}(uuid) FROM anon;`);
    expect(executableSql).toContain(`GRANT EXECUTE ON FUNCTION ${ISSUE_FN}(uuid) TO authenticated;`);
    expect(executableSql).toContain(`GRANT EXECUTE ON FUNCTION ${ISSUE_FN}(uuid) TO service_role;`);
  });
});

// ---------------------------------------------------------------------------
// 7-8-9-12. Consume RPC contract
// ---------------------------------------------------------------------------
describe("TG-2F-A candidate — consume RPC", () => {
  const SIG = "(bigint, bigint, text, text)";
  const block = functionBlock(CONSUME_FN);
  const body = executableBody(CONSUME_FN);

  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(block).toContain("SECURITY DEFINER");
    expect(block).toContain("SET search_path TO 'pg_catalog', 'public', 'auth', 'extensions'");
  });

  it("is service_role only", () => {
    expect(executableSql).toContain(`REVOKE ALL ON FUNCTION ${CONSUME_FN}${SIG} FROM PUBLIC;`);
    expect(executableSql).toContain(`REVOKE ALL ON FUNCTION ${CONSUME_FN}${SIG} FROM anon;`);
    expect(executableSql).toContain(`REVOKE ALL ON FUNCTION ${CONSUME_FN}${SIG} FROM authenticated;`);
    expect(executableSql).toContain(`GRANT EXECUTE ON FUNCTION ${CONSUME_FN}${SIG} TO service_role;`);
    expect(executableSql).not.toContain(`GRANT EXECUTE ON FUNCTION ${CONSUME_FN}${SIG} TO authenticated;`);
    expect(executableSql).not.toContain(`GRANT EXECUTE ON FUNCTION ${CONSUME_FN}${SIG} TO anon;`);
  });

  it("never accepts a recruiter workspace from the caller", () => {
    const signature = block.slice(0, block.indexOf(")\nRETURNS"));
    expect(signature).not.toContain("_recruiter_id");
    expect(signature).toContain("_telegram_user_id bigint");
    expect(signature).toContain("_telegram_chat_id bigint");
    expect(signature).toContain("_chat_type text");
    expect(signature).toContain("_raw_token text");
  });

  it("returns the existing binding row type", () => {
    expect(block).toContain("RETURNS public.telegram_chat_bindings");
  });

  it("validates telegram ids and restricts chat type to group/supergroup", () => {
    expect(body).toContain("OR _telegram_user_id <= 0");
    expect(body).toContain("OR _telegram_chat_id = 0");
    expect(body).toContain("OR _chat_type NOT IN ('group', 'supergroup') THEN");
  });

  it("requires a 64 lowercase hex secret shape", () => {
    expect(body).toContain("_raw_token !~ '^[0-9a-f]{64}$'");
  });

  it("collapses every token failure to one fixed generic error", () => {
    expect(countOccurrences(body, "RAISE EXCEPTION 'telegram_dispatch_bind_token_invalid'")).toBe(2);
    for (const distinguishing of [
      "token_expired",
      "token_consumed",
      "token_invalidated",
      "token_not_found",
      "token_unknown",
    ]) {
      expect(body, `must not distinguish ${distinguishing}`).not.toContain(distinguishing);
    }
  });

  it("hashes the presented secret and locks the matching live row", () => {
    expect(body).toContain("_token_hash := encode(extensions.digest(_raw_token, 'sha256'), 'hex')");
    expect(body).toContain("WHERE t.token_hash = _token_hash");
    expect(body).toContain("AND t.consumed_at IS NULL");
    expect(body).toContain("AND t.invalidated_at IS NULL");
    expect(body).toContain("AND t.expires_at > now()");
    expect(body).toContain("FOR UPDATE");
  });

  it("derives the recruiter workspace only from the locked token row", () => {
    expect(body).toContain("_token.recruiter_id");
    expect(countOccurrences(body, "_token.recruiter_id")).toBe(1);
  });

  it("delegates to the existing TG-2C bind RPC exactly once", () => {
    expect(countOccurrences(body, "public.telegram_bind_dispatch_chat(")).toBe(1);
    expect(body).toContain("_binding := public.telegram_bind_dispatch_chat(");
  });

  it("does not duplicate loads_dispatch permission logic", () => {
    expect(body).not.toContain("current_user_has_recruiter_permission");
    expect(body).not.toContain("loads_dispatch");
    expect(body).not.toContain("set_config");
    expect(body).not.toContain("request.jwt.claim.sub");
  });

  it("marks the token consumed only AFTER a successful bind", () => {
    const bindAt = body.indexOf("public.telegram_bind_dispatch_chat(");
    const consumeAt = body.indexOf("SET consumed_at = now()");
    expect(consumeAt).toBeGreaterThan(bindAt);
    expect(body).toContain("WHERE t.id = _token.id");
  });

  it("does not swallow or translate TG-2C errors", () => {
    expect(body).not.toContain("EXCEPTION\n  WHEN");
    expect(body).not.toMatch(/WHEN\s+OTHERS/i);
  });

  it("never returns or logs the raw secret", () => {
    expect(body).not.toContain("RETURN _raw_token");
    expect(body).not.toMatch(/RAISE\s+(NOTICE|LOG|WARNING|DEBUG|INFO)/i);
    expect(body).toContain("RETURN _binding;");
  });
});

// ---------------------------------------------------------------------------
// 9. Binding table is written only by the existing TG-2C bridge
// ---------------------------------------------------------------------------
describe("TG-2F-A candidate — no direct binding writes", () => {
  it("never writes telegram_chat_bindings directly", () => {
    expect(executableSql).not.toMatch(/INSERT\s+INTO\s+public\.telegram_chat_bindings/i);
    expect(executableSql).not.toMatch(/UPDATE\s+public\.telegram_chat_bindings/i);
    expect(executableSql).not.toMatch(/DELETE\s+FROM\s+public\.telegram_chat_bindings/i);
  });

  it("references the binding table only as a return type and row type", () => {
    expect(executableSql).toContain("RETURNS public.telegram_chat_bindings");
    expect(executableSql).toContain("_binding public.telegram_chat_bindings%ROWTYPE");
  });

  it("grants nothing new on telegram_chat_bindings", () => {
    expect(executableSql).not.toMatch(
      /(GRANT|REVOKE)[^;]*ON\s+(TABLE\s+)?public\.telegram_chat_bindings\b/i,
    );
  });
});

// ---------------------------------------------------------------------------
// 10. Credential + command-routing boundary
// ---------------------------------------------------------------------------
describe("TG-2F-A candidate — credential and routing boundary", () => {
  it("contains no credential literal of any class", () => {
    // JWT-shaped literal (three base64url segments).
    expect(executableSql).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./);
    // Telegram bot-token shape: digits, colon, long secret tail.
    expect(executableSql).not.toMatch(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/);
    for (const forbidden of [
      "Authorization",
      "Bearer",
      "service_role_key",
      "SERVICE_ROLE_KEY",
      "LOVABLE_API_KEY",
      "TELEGRAM_API_KEY",
      "X-HTP-Internal-Secret",
      "X-Connection-Api-Key",
      "vault.decrypted_secrets",
      "vault.create_secret",
    ]) {
      expect(executableSql, `unexpected ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("makes no outbound or webhook call", () => {
    for (const forbidden of [
      "api.telegram.org",
      "connector-gateway",
      "net.http_post",
      "net.http_get",
      "setWebhook",
      "sendMessage",
      "getUpdates",
      "webhook",
    ]) {
      expect(executableSql, `unexpected ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("introduces no Telegram command routing syntax", () => {
    for (const command of ["/bind", "/unbind", "/load", "/status", "/dispatch", "/start"]) {
      expect(executableSql, `unexpected command ${command}`).not.toContain(command);
    }
  });

  it("introduces no recruiter slug or public workspace code", () => {
    for (const forbidden of ["slug", "workspace_code", "short_code", "public_code", "join_code"]) {
      expect(executableSql, `unexpected ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. TG-1 dispatch surface untouched
// ---------------------------------------------------------------------------
describe("TG-2F-A candidate — TG-1 dispatch surface untouched", () => {
  it("never references loads, load events or dispatch receipts", () => {
    for (const forbidden of [
      "public.loads",
      "load_events",
      "dispatch_command_receipts",
      "telegram_dispatch_create_driver_load",
      "telegram_dispatch_update_driver_load_status",
      "dispatch_create_driver_load",
    ]) {
      expect(executableSql, `unexpected ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("writes to exactly one table: the new bind-token table", () => {
    const writes = executableSql.match(/(INSERT\s+INTO|UPDATE)\s+public\.[a-z_]+/gi) ?? [];
    for (const write of writes) {
      expect(write).toContain("public.telegram_dispatch_bind_tokens");
    }
    expect(writes.length).toBeGreaterThan(0);
  });
});
