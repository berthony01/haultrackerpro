import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase TG-2C — Telegram actor authorization + chat-binding bridge.
 *
 * Source-contract test over the TG-2C candidate migration (and, where useful,
 * the TG-2B candidate). The candidate is NOT applied live; these assertions
 * therefore verify the authored SQL contract, not runtime behaviour.
 */

const CANDIDATE_PATH = resolve(
  process.cwd(),
  "supabase/migration-candidates/20260820013000_phase_tg2c_telegram_actor_authorization_bridge.sql",
);
const TG2B_PATH = resolve(
  process.cwd(),
  "supabase/migration-candidates/20260819213000_phase_tg2b_telegram_identity_linking_foundation.sql",
);

const sql = readFileSync(CANDIDATE_PATH, "utf8");
/** Executable SQL only: `--` commentary is documentation, not behaviour. */
const executableSql = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const tg2bSql = readFileSync(TG2B_PATH, "utf8");

const BRIDGE_FUNCTIONS = [
  "telegram_bind_dispatch_chat",
  "telegram_revoke_dispatch_chat",
  "telegram_dispatch_create_driver_load",
  "telegram_dispatch_update_driver_load_status",
] as const;

type BridgeFunction = (typeof BRIDGE_FUNCTIONS)[number];

/** Full `CREATE FUNCTION ... $$;` block for one bridge function. */
function functionBlock(name: BridgeFunction): string {
  const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
  expect(start, `missing CREATE FUNCTION for ${name}`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  expect(end, `unterminated function body for ${name}`).toBeGreaterThan(start);
  return sql.slice(start, end + 4);
}

/** Just the plpgsql body (between the AS $$ and the closing $$). */
function functionBody(name: BridgeFunction): string {
  const block = functionBlock(name);
  const bodyStart = block.indexOf("AS $$");
  expect(bodyStart, `missing AS $$ for ${name}`).toBeGreaterThan(-1);
  return block.slice(bodyStart);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("TG-2C candidate — surface shape", () => {
  it("creates exactly the four bridge RPCs and nothing else", () => {
    expect(countOccurrences(sql, "CREATE FUNCTION ")).toBe(4);
    for (const name of BRIDGE_FUNCTIONS) {
      expect(sql).toContain(`CREATE FUNCTION public.${name}(`);
    }
  });

  it("creates zero tables, types, policies, triggers, or indexes", () => {
    expect(sql).not.toMatch(/CREATE\s+(TABLE|TYPE|POLICY|TRIGGER)\b/i);
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX\b/i);
  });

  it("is a single self-contained transaction", () => {
    expect(countOccurrences(sql, "\nBEGIN;")).toBe(1);
    expect(countOccurrences(sql, "\nCOMMIT;")).toBe(1);
  });

  it("does not redefine, alter, drop, or re-privilege TG-1 / TG-2B objects", () => {
    expect(executableSql).not.toMatch(/CREATE\s+OR\s+REPLACE/i);
    expect(executableSql).not.toMatch(/^\s*(ALTER|DROP)\b/im);
    // No GRANT/REVOKE aimed at a TG-1 dispatch function (the bridge's own
    // grants all name public.telegram_* functions).
    expect(sql).not.toMatch(/(GRANT|REVOKE)[^;]*ON\s+FUNCTION\s+public\.dispatch_/i);
    expect(sql).not.toMatch(/(GRANT|REVOKE)[^;]*ON\s+(TABLE\s+)?public\.(loads|load_events|dispatch_command_receipts|telegram_user_links|telegram_chat_bindings|telegram_link_tokens)\b/i);
    expect(sql).not.toMatch(/auth\.uid\s*\(\s*\)\s*RETURNS/i);
  });
});

describe("TG-2C candidate — security posture", () => {
  it.each(BRIDGE_FUNCTIONS)("%s is SECURITY DEFINER plpgsql with a hardened search_path", (name) => {
    const block = functionBlock(name);
    expect(block).toContain("LANGUAGE plpgsql");
    expect(block).toContain("SECURITY DEFINER");
    expect(block).toContain("SET search_path TO 'pg_catalog', 'public', 'auth'");
    expect(block).not.toContain("'extensions'");
  });

  it.each(BRIDGE_FUNCTIONS)("%s is executable only by service_role", (name) => {
    const grantLines = sql
      .split("\n")
      .filter((line) => /^(GRANT|REVOKE)\b/.test(line) && line.includes(`public.${name}(`));

    expect(grantLines.some((l) => /^REVOKE ALL ON FUNCTION .* FROM PUBLIC;$/.test(l))).toBe(true);
    expect(grantLines.some((l) => /^REVOKE ALL ON FUNCTION .* FROM anon;$/.test(l))).toBe(true);
    expect(grantLines.some((l) => /^REVOKE ALL ON FUNCTION .* FROM authenticated;$/.test(l))).toBe(true);

    const grants = grantLines.filter((l) => l.startsWith("GRANT "));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/GRANT EXECUTE ON FUNCTION .* TO service_role;$/);
  });

  it("never grants execute to a browser role", () => {
    expect(sql).not.toMatch(/GRANT[^;]*TO\s+(anon|authenticated|PUBLIC)\b/i);
  });

  it.each(BRIDGE_FUNCTIONS)("%s sets the actor context transaction-locally only", (name) => {
    const body = functionBody(name);
    expect(countOccurrences(body, "pg_catalog.set_config('request.jwt.claim.sub'")).toBe(1);
    expect(body).toContain(
      "pg_catalog.set_config('request.jwt.claim.sub', _actor_user_id::text, true)",
    );
    // No session-persistent variant.
    expect(body).not.toMatch(/set_config\([^)]*,\s*false\s*\)/i);
    expect(body).not.toMatch(/\bSET\s+SESSION\b/i);
  });

  it("mints, stores or refreshes no JWT and holds no Telegram secret or API surface", () => {
    expect(executableSql).not.toMatch(/\bjwt_secret\b|\bsign_jwt\b|\bjwt\.sign\b|\baccess_token\b|\brefresh_token\b/i);
    expect(executableSql).not.toMatch(/\bbot_token\b|\bapi\.telegram\.org\b|\bsetWebhook\b|\bwebhook\b/i);
    expect(executableSql).not.toMatch(/\bhttp_post\b|\bnet\.http\b|\bextensions\.http\b|CREATE\s+EXTENSION/i);
    expect(executableSql).not.toMatch(/\bconnector_id\b|\bgateway_url\b|\bcurrent_setting\('app\.settings/i);
    // Usernames are never identity input.
    expect(executableSql).not.toMatch(/telegram_username/i);
  });
});

describe("TG-2C candidate — actor and workspace derivation", () => {
  it.each(BRIDGE_FUNCTIONS)("%s derives the actor solely from ACTIVE telegram_user_links", (name) => {
    const body = functionBody(name);
    expect(body).toContain("FROM public.telegram_user_links l");
    expect(body).toContain("WHERE l.telegram_user_id = _telegram_user_id");
    expect(body).toContain("AND l.status = 'active'");
    expect(body).toContain("RAISE EXCEPTION 'telegram_actor_not_linked'");
  });

  it("accepts no caller-supplied actor, user, driver or source identity in any signature", () => {
    for (const name of BRIDGE_FUNCTIONS) {
      const block = functionBlock(name);
      const signature = block.slice(0, block.indexOf("RETURNS "));
      expect(signature).not.toMatch(/_actor_user_id|_user_id\s+uuid|_driver_user_id|_source_channel/);
    }
  });

  it("dispatch wrappers accept no recruiter id and the create wrapper accepts no status", () => {
    for (const name of ["telegram_dispatch_create_driver_load", "telegram_dispatch_update_driver_load_status"] as const) {
      const block = functionBlock(name);
      const signature = block.slice(0, block.indexOf("RETURNS "));
      expect(signature).not.toMatch(/_recruiter_id/);
    }
    const createSignature = functionBlock("telegram_dispatch_create_driver_load");
    expect(createSignature.slice(0, createSignature.indexOf("RETURNS "))).not.toMatch(/_status\b/);
  });

  it.each([
    "telegram_dispatch_create_driver_load",
    "telegram_dispatch_update_driver_load_status",
  ] as const)("%s takes the workspace only from an ACTIVE chat binding", (name) => {
    const body = functionBody(name);
    expect(body).toContain("FROM public.telegram_chat_bindings b");
    expect(body).toContain("WHERE b.telegram_chat_id = _telegram_chat_id");
    expect(body).toContain("AND b.status = 'active'");
    expect(body).toContain("RAISE EXCEPTION 'telegram_chat_not_bound'");
    expect(body).toContain("_binding.recruiter_id");
  });

  it.each([
    "telegram_dispatch_create_driver_load",
    "telegram_dispatch_update_driver_load_status",
  ] as const)("%s derives the driver from an ACTIVE relationship scoped to the bound workspace", (name) => {
    const body = functionBody(name);
    expect(body).toContain("SELECT r.driver_user_id INTO _driver_user_id");
    expect(body).toContain("FROM public.carrier_driver_relationships r");
    expect(body).toContain("WHERE r.id = _relationship_id");
    expect(body).toContain("AND r.recruiter_id = _binding.recruiter_id");
    expect(body).toContain("AND r.status = 'active'");
    expect(body).toContain("RAISE EXCEPTION 'telegram_driver_relationship_not_available'");
  });
});

describe("TG-2C candidate — bind / revoke authorization", () => {
  it.each(["telegram_bind_dispatch_chat", "telegram_revoke_dispatch_chat"] as const)(
    "%s resolves loads_dispatch dynamically AFTER the actor context is set",
    (name) => {
      const body = functionBody(name);
      const setConfigAt = body.indexOf("pg_catalog.set_config('request.jwt.claim.sub'");
      const permAt = body.indexOf("public.current_user_has_recruiter_permission(");
      expect(setConfigAt).toBeGreaterThan(-1);
      expect(permAt).toBeGreaterThan(setConfigAt);
      expect(body).toContain("'loads_dispatch'");
      expect(body).toContain("RAISE EXCEPTION 'telegram_dispatch_not_authorized'");
      // No role-label shortcut, no copied permission set.
      expect(body).not.toMatch(/recruiter_owner|recruiter_admin|recruiter_staff/);
    },
  );

  it("bind validates input shape and workspace availability", () => {
    const body = functionBody("telegram_bind_dispatch_chat");
    expect(body).toContain("RAISE EXCEPTION 'telegram_bind_invalid_input'");
    expect(body).toContain("_telegram_user_id <= 0");
    expect(body).toContain("_telegram_chat_id = 0");
    expect(body).toContain("_chat_type NOT IN ('group', 'supergroup')");
    expect(body).toContain("FROM public.recruiter_profiles rp");
    expect(body).toContain("AND rp.status = 'active'");
    expect(body).toContain("RAISE EXCEPTION 'telegram_workspace_not_available'");
  });

  it("bind is idempotent for the same recruiter/chat_type and conflicts otherwise", () => {
    const body = functionBody("telegram_bind_dispatch_chat");
    expect(body).toContain("FOR UPDATE");
    expect(body).toContain("_existing.recruiter_id = _recruiter_id AND _existing.chat_type = _chat_type");
    expect(body).toContain("RETURN _existing");
    expect(body).toContain("RAISE EXCEPTION 'telegram_chat_already_bound'");
  });

  it("bind fails closed on a concurrent unique violation", () => {
    const body = functionBody("telegram_bind_dispatch_chat");
    expect(body).toMatch(/EXCEPTION\s+WHEN unique_violation THEN/);
    expect(body).toContain("RAISE EXCEPTION 'telegram_chat_bind_conflict'");
  });

  it("revoke locks the active binding, is idempotent when absent, and keeps history", () => {
    const body = functionBody("telegram_revoke_dispatch_chat");
    expect(body).toContain("RAISE EXCEPTION 'telegram_bind_invalid_input'");
    expect(body).toContain("FOR UPDATE");
    expect(body).toContain("IF NOT FOUND THEN\n    RETURN false;");
    expect(body).toContain("SET status = 'revoked'");
    expect(body).toContain("revoked_at = now()");
    expect(body).toContain("RETURN true;");
    expect(body).not.toMatch(/DELETE\s+FROM/i);
  });
});

describe("TG-2C candidate — thin bridge to TG-1", () => {
  it("create wrapper invokes the TG-1 create RPC exactly once with a hardcoded telegram source", () => {
    const body = functionBody("telegram_dispatch_create_driver_load");
    expect(countOccurrences(body, "public.dispatch_create_driver_load(")).toBe(1);
    expect(body).toContain("'telegram',");
    expect(body).toContain("_binding.recruiter_id,");
    expect(body).toContain("_driver_user_id,");
    expect(body).toContain("RAISE EXCEPTION 'telegram_dispatch_invalid_context'");
  });

  it("status wrapper invokes the TG-1 status RPC exactly once with a hardcoded telegram source", () => {
    const body = functionBody("telegram_dispatch_update_driver_load_status");
    expect(countOccurrences(body, "public.dispatch_update_driver_load_status(")).toBe(1);
    expect(body).toContain("'telegram'");
    expect(body).toContain("_new_status,");
    expect(body).toContain("RAISE EXCEPTION 'telegram_dispatch_invalid_context'");
  });

  it.each([
    "telegram_dispatch_create_driver_load",
    "telegram_dispatch_update_driver_load_status",
  ] as const)("%s never writes loads, load_events or dispatch_command_receipts", (name) => {
    const body = functionBody(name);
    expect(body).not.toMatch(/INSERT\s+INTO\s+public\.(loads|load_events|dispatch_command_receipts)\b/i);
    expect(body).not.toMatch(/UPDATE\s+public\.(loads|load_events|dispatch_command_receipts)\b/i);
    expect(body).not.toMatch(/DELETE\s+FROM\s+public\.(loads|load_events|dispatch_command_receipts)\b/i);
  });

  it("dispatch wrappers duplicate none of the TG-1 permission or idempotency logic", () => {
    for (const name of [
      "telegram_dispatch_create_driver_load",
      "telegram_dispatch_update_driver_load_status",
    ] as const) {
      const body = functionBody(name);
      expect(body).not.toContain("current_user_has_recruiter_permission");
      expect(body).not.toContain("current_user_can_dispatch_load_action");
      expect(body).not.toMatch(/idempotency_key\s*=|command_hash|receipt/i);
      expect(body).not.toContain("canonical_load_operating_miles");
      expect(body).not.toMatch(/en_route|'delivered'|'cancelled'/);
    }
  });

  it("carries the TG-1 optional business inputs through unchanged", () => {
    const block = functionBlock("telegram_dispatch_create_driver_load");
    const signature = block.slice(0, block.indexOf("RETURNS "));
    for (const arg of [
      "_load_reference text",
      "_dropoff_date date",
      "_loaded_miles numeric",
      "_deadhead_miles numeric",
      "_total_miles numeric",
      "_rate_per_mile numeric",
      "_pay_model text",
      "_flat_rate_amount numeric",
      "_deadhead_rate_per_mile numeric",
      "_wait_fee numeric",
      "_detention_fee numeric",
      "_other_fees numeric",
      "_estimated_pay numeric",
      "_notes text",
    ]) {
      expect(signature).toContain(arg);
    }
  });

  it("wrapper optional business defaults match TG-1 dispatch_create_driver_load exactly", () => {
    const block = functionBlock("telegram_dispatch_create_driver_load");
    const signature = block.slice(0, block.indexOf("RETURNS "));
    // Each entry is the exact wrapper declaration "<param> <type> DEFAULT <value>,"
    // and must equal the corresponding TG-1 dispatch_create_driver_load default
    // in value semantics (NULL vs 0). TG-1 uses bare NULL/0; the wrapper spells
    // the cast form, which is value-equivalent.
    const expectedDeclarations = [
      "_load_reference text DEFAULT NULL::text,",
      "_dropoff_date date DEFAULT NULL::date,",
      "_loaded_miles numeric DEFAULT 0,",
      "_deadhead_miles numeric DEFAULT 0,",
      "_total_miles numeric DEFAULT NULL::numeric,",
      "_rate_per_mile numeric DEFAULT 0,",
      "_pay_model text DEFAULT NULL::text,",
      "_flat_rate_amount numeric DEFAULT NULL::numeric,",
      "_deadhead_rate_per_mile numeric DEFAULT NULL::numeric,",
      "_wait_fee numeric DEFAULT 0,",
      "_detention_fee numeric DEFAULT 0,",
      "_other_fees numeric DEFAULT 0,",
      "_estimated_pay numeric DEFAULT NULL::numeric,",
      "_notes text DEFAULT NULL::text",
    ];
    for (const decl of expectedDeclarations) {
      expect(
        signature,
        `expected wrapper signature to contain "${decl}"`,
      ).toContain(decl);
    }
  });
});

describe("TG-2C candidate — TG-2B prerequisite alignment", () => {
  it("references only TG-2B tables that the TG-2B candidate actually creates", () => {
    expect(tg2bSql).toContain("CREATE TABLE public.telegram_user_links");
    expect(tg2bSql).toContain("CREATE TABLE public.telegram_chat_bindings");
    expect(sql).toContain("public.telegram_user_links");
    expect(sql).toContain("public.telegram_chat_bindings");
    // TG-2C never touches the token table.
    expect(sql).not.toContain("telegram_link_tokens");
  });

  it("relies on the TG-2B partial ACTIVE unique index for chat binding enforcement", () => {
    expect(tg2bSql).toContain("telegram_chat_bindings_active_chat_id_unique");
  });
});
