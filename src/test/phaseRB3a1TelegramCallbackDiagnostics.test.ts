/**
 * RB-3A.1 — bounded callback RPC diagnostics.
 *
 * A failed Quick Post / conversation callback database call previously
 * collapsed into the generic `telegram_poll_unexpected_error`, which made the
 * real failure unobservable. The callback adapters now surface the SHORT
 * machine code only. Nothing else about the error may ever escape: no message,
 * details, hint, SQL, identifier, chat content or credential.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  boundedRpcErrorCode,
  sanitizeErrorCode,
} from "../../supabase/functions/_shared/telegram-poll-ingest.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const EDGE_CODE = read("supabase/functions/telegram-poll/index.ts");
const ORCHESTRATOR_CODE = read(
  "supabase/functions/_shared/telegram-poll-ingest.ts",
);
const QUICK_POST_SQL = read(
  "supabase/migration-candidates/20260922050000_phase_rb3a_telegram_quick_post.sql",
);
const FIX_SQL = read(
  "supabase/migration-candidates/20260922060000_phase_rb3a1_quick_post_recruiter_min_uuid_fix.sql",
);

describe("RB-3A.1 — bounded callback RPC error codes", () => {
  it("maps a PostgREST code to a bounded snake_case code", () => {
    expect(boundedRpcErrorCode({ code: "PGRST202" })).toBe("rpc_error_pgrst202");
  });

  it("maps a SQLSTATE code to a bounded snake_case code", () => {
    expect(boundedRpcErrorCode({ code: "42501" })).toBe("rpc_error_42501");
    expect(boundedRpcErrorCode({ code: 42883 })).toBe("rpc_error_42883");
  });

  it("falls back to the existing generic code when no usable code exists", () => {
    for (
      const input of [
        {},
        { code: null },
        { code: "" },
        { code: "   " },
        { code: { nested: true } },
        null,
        undefined,
        new Error("permission denied for function telegram_x"),
      ]
    ) {
      expect(boundedRpcErrorCode(input)).toBe("telegram_poll_unexpected_error");
    }
  });

  it("never lets a message, details, hint or identifier through", () => {
    const code = boundedRpcErrorCode({
      code: "PGRST202",
      message:
        "Could not find the function public.telegram_process_quick_post_action_update(_action, _chat_type) in the schema cache",
      details: "chat 12345 user secret-token",
      hint: "Perhaps you meant to call another function",
    });
    expect(code).toBe("rpc_error_pgrst202");
    expect(code).not.toMatch(/schema cache|12345|secret|hint|Perhaps/i);
  });

  it("rejects any code shape that is not short and alphanumeric", () => {
    expect(boundedRpcErrorCode({ code: "PGRST 202; drop table" })).toBe(
      "telegram_poll_unexpected_error",
    );
    expect(boundedRpcErrorCode({ code: "x".repeat(41) })).toBe(
      "telegram_poll_unexpected_error",
    );
  });

  it("emits codes that survive the strict sanitizer unchanged", () => {
    expect(sanitizeErrorCode(new Error(boundedRpcErrorCode({ code: "PGRST202" }))))
      .toBe("rpc_error_pgrst202");
  });

  it("keeps sanitizeErrorCode itself strict", () => {
    expect(sanitizeErrorCode(new Error("Could not find the function"))).toBe(
      "telegram_poll_unexpected_error",
    );
    expect(ORCHESTRATOR_CODE).toContain("/^[a-z0-9_]{3,64}$/");
  });

  it("applies the bounded wrapper to both callback adapters only", () => {
    expect(EDGE_CODE.split("boundedRpcErrorCode(error)").length - 1).toBe(2);
    expect(EDGE_CODE).toMatch(
      /telegram_process_conversation_action_update[\s\S]{0,600}?boundedRpcErrorCode\(error\)/,
    );
    expect(EDGE_CODE).toMatch(
      /telegram_process_quick_post_action_update[\s\S]{0,900}?boundedRpcErrorCode\(error\)/,
    );
  });

  it("adds only the classification kind to the terminal-failure log", () => {
    expect(ORCHESTRATOR_CODE).toMatch(
      /log\("update_terminal_failed",\s*\{\s*updateId,\s*code: errorCode,\s*kind: classification\.kind,\s*\}\)/,
    );
    expect(ORCHESTRATOR_CODE).not.toMatch(
      /log\("update_terminal_failed"[\s\S]{0,200}(text|chatId|userId|payload|draftId)/,
    );
  });
});

/**
 * RB-3A.1 root cause. Every Quick Post callback aborted with SQLSTATE 42883
 * (`function min(uuid) does not exist`) because the recruiter resolver
 * aggregated a uuid with min(). The corrective migration must remove that
 * aggregate while keeping the fail-closed ambiguity rule intact.
 */
describe("RB-3A.1 — quick post recruiter resolver min(uuid) regression", () => {
  it("no longer aggregates the recruiter uuid with min()", () => {
    expect(FIX_SQL).not.toMatch(/min\s*\(\s*r?\.?recruiter_id/i);
    expect(FIX_SQL).toContain("array_agg(r.recruiter_id)");
  });

  it("keeps the exact fail-closed ambiguity rule", () => {
    expect(FIX_SQL).toMatch(
      /IF _ids IS NULL OR array_length\(_ids, 1\) <> 1 THEN\s*\n\s*RETURN NULL;/,
    );
  });

  it("keeps the same signature, security posture and grants", () => {
    expect(FIX_SQL).toContain(
      "CREATE OR REPLACE FUNCTION public._telegram_quick_post_recruiter(",
    );
    expect(FIX_SQL).toContain("_telegram_user_id bigint");
    expect(FIX_SQL).toContain("RETURNS uuid");
    expect(FIX_SQL).toContain("SECURITY DEFINER");
    expect(FIX_SQL).toContain("SET search_path TO 'pg_catalog', 'public', 'auth'");
    expect(FIX_SQL).toContain(
      "GRANT EXECUTE ON FUNCTION public._telegram_quick_post_recruiter(bigint) TO service_role",
    );
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(FIX_SQL).toContain(
        `REVOKE ALL ON FUNCTION public._telegram_quick_post_recruiter(bigint) FROM ${role}`,
      );
    }
  });

  it("changes nothing else: only this one helper is redefined", () => {
    expect(FIX_SQL.match(/CREATE (OR REPLACE )?FUNCTION/g)?.length).toBe(1);
    expect(FIX_SQL).not.toMatch(
      /CREATE TABLE|DROP |ALTER TABLE|CREATE POLICY|create_recruiter_opportunity|telegram_process_/,
    );
    // The RB-3A state machine, callback vocabulary and creation delegation are
    // untouched by the correction.
    expect(QUICK_POST_SQL).toContain(
      "public.create_recruiter_opportunity_as_actor(",
    );
    expect(QUICK_POST_SQL).toContain("_telegram_quick_post_recruiter(");
  });
});
