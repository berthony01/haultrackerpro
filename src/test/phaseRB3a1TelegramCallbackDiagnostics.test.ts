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
