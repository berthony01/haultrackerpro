// Phase TG-2D — Telegram server adapter + polling intake foundation.
//
// Two halves:
//   1. SQL source-contract assertions over the CANDIDATE migration (not live);
//   2. behavioural assertions over the SHARED orchestrator that the Edge
//      Function itself runs, driven through injected fakes.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  TELEGRAM_ALLOWED_UPDATES,
  TELEGRAM_GET_UPDATES_LIMIT,
  TELEGRAM_GET_UPDATES_TIMEOUT_SECONDS,
  TELEGRAM_LINK_FAILURE_MESSAGE,
  TELEGRAM_LINK_SUCCESS_MESSAGE,
  classifyUpdate,
  runTelegramPoll,
  sanitizeErrorCode,
  stableStringify,
  type TelegramGateway,
  type TelegramGatewayResponse,
  type TelegramPollLedger,
  type TelegramTerminalResult,
} from "../../supabase/functions/_shared/telegram-poll-ingest.ts";

const ROOT = process.cwd();

const CANDIDATE_SQL = readFileSync(
  path.join(
    ROOT,
    "supabase/migration-candidates/20260820043000_phase_tg2d_telegram_polling_intake_foundation.sql",
  ),
  "utf8",
);

const ORCHESTRATOR_SOURCE = readFileSync(
  path.join(ROOT, "supabase/functions/_shared/telegram-poll-ingest.ts"),
  "utf8",
);

const EDGE_SOURCE = readFileSync(
  path.join(ROOT, "supabase/functions/telegram-poll/index.ts"),
  "utf8",
);

/** Executable SQL only — `--` prose is stripped so a comment that merely
 *  NAMES a forbidden construct cannot pass or fail a contract assertion. */
const CANDIDATE_CODE = CANDIDATE_SQL.replace(/--.*$/gm, "");

/** Executable TypeScript only, for the same reason. */
const stripTsComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ORCHESTRATOR_CODE = stripTsComments(ORCHESTRATOR_SOURCE);
const EDGE_CODE = stripTsComments(EDGE_SOURCE);

// ───────────────────────────── SQL contract ─────────────────────────────

describe("TG-2D candidate SQL — object surface", () => {
  it("is explicitly marked candidate-only", () => {
    expect(CANDIDATE_SQL).toContain("CANDIDATE MIGRATION — NOT APPLIED LIVE");
    expect(CANDIDATE_SQL).toContain("BEGIN;");
    expect(CANDIDATE_SQL.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("creates exactly the two authorised tables", () => {
    const tables = [...CANDIDATE_SQL.matchAll(/CREATE TABLE public\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(tables.sort()).toEqual([
      "telegram_poll_state",
      "telegram_update_receipts",
    ]);
  });

  it("creates exactly the five authorized TG-2D RPCs and nothing else", () => {
    const functions = [...CANDIDATE_CODE.matchAll(/CREATE FUNCTION public\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(functions.sort()).toEqual([
      "telegram_advance_poll_cursor",
      "telegram_claim_poll_lease",
      "telegram_process_start_update",
      "telegram_record_ignored_update",
      "telegram_release_poll_lease",
    ]);
  });

  it("declares no sixth function and no private lease helper", () => {
    expect(CANDIDATE_CODE.match(/CREATE FUNCTION/g) ?? []).toHaveLength(5);
    expect(CANDIDATE_CODE).not.toContain("_telegram_assert_poll_lease");
    expect(CANDIDATE_CODE).not.toMatch(/CREATE FUNCTION public\._/);
  });


  it("never uses CREATE OR REPLACE or DROP", () => {
    expect(CANDIDATE_CODE).not.toMatch(/CREATE OR REPLACE/i);
    expect(CANDIDATE_CODE).not.toMatch(/\bDROP\b/i);
  });

  it("creates no other database object vocabulary", () => {
    expect(CANDIDATE_SQL).not.toMatch(/CREATE (TYPE|TRIGGER|VIEW|SCHEMA|EXTENSION)/i);
    expect(CANDIDATE_SQL).not.toMatch(/ALTER TYPE/i);
  });
});

describe("TG-2D candidate SQL — RLS and privileges", () => {
  it("enables RLS on both tables", () => {
    expect(CANDIDATE_SQL).toContain(
      "ALTER TABLE public.telegram_poll_state ENABLE ROW LEVEL SECURITY",
    );
    expect(CANDIDATE_SQL).toContain(
      "ALTER TABLE public.telegram_update_receipts ENABLE ROW LEVEL SECURITY",
    );
  });

  it("declares zero client policies", () => {
    expect(CANDIDATE_SQL).not.toMatch(/CREATE POLICY/i);
  });

  it("revokes both tables from every client role and grants service_role only", () => {
    for (const table of ["telegram_poll_state", "telegram_update_receipts"]) {
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(CANDIDATE_SQL).toContain(
          `REVOKE ALL ON TABLE public.${table} FROM ${role};`,
        );
      }
      expect(CANDIDATE_SQL).toContain(
        `GRANT ALL ON TABLE public.${table} TO service_role;`,
      );
      expect(CANDIDATE_SQL).not.toMatch(
        new RegExp(`GRANT [^;]*ON TABLE public\\.${table} TO (anon|authenticated)`),
      );
    }
  });

  it("makes every function SECURITY DEFINER with a pinned search_path", () => {
    const definerCount = (CANDIDATE_CODE.match(/SECURITY DEFINER/g) ?? []).length;
    const searchPathCount = (
      CANDIDATE_CODE.match(/SET search_path TO 'pg_catalog', 'public'/g) ?? []
    ).length;
    expect(definerCount).toBe(5);
    expect(searchPathCount).toBe(5);
    expect(CANDIDATE_SQL).not.toMatch(/SET search_path TO 'public'/);
  });

  it("grants EXECUTE to service_role only", () => {
    const executeGrants = [
      ...CANDIDATE_CODE.matchAll(/GRANT EXECUTE ON FUNCTION [^;]+TO (\w+);/g),
    ].map((m) => m[1]);
    expect(executeGrants).toHaveLength(5);
    expect(new Set(executeGrants)).toEqual(new Set(["service_role"]));

    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      const revokes = [
        ...CANDIDATE_CODE.matchAll(
          new RegExp(`REVOKE ALL ON FUNCTION [^;]+FROM ${role};`, "g"),
        ),
      ];
      expect(revokes).toHaveLength(5);
    }
  });
});

describe("TG-2D candidate SQL — poll state shape", () => {
  it("is a singleton with a nonnegative cursor and paired lease columns", () => {
    expect(CANDIDATE_SQL).toContain("id smallint PRIMARY KEY DEFAULT 1");
    expect(CANDIDATE_SQL).toContain("CHECK (id = 1)");
    expect(CANDIDATE_SQL).toContain("CHECK (last_confirmed_update_id >= 0)");
    expect(CANDIDATE_SQL).toContain(
      "(lease_token IS NULL AND lease_expires_at IS NULL)",
    );
    expect(CANDIDATE_SQL).toContain(
      "OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)",
    );
  });

  it("seeds exactly the singleton row", () => {
    const inserts = [
      ...CANDIDATE_SQL.matchAll(/INSERT INTO public\.telegram_poll_state/g),
    ];
    expect(inserts).toHaveLength(1);
    expect(CANDIDATE_SQL).toContain("VALUES (1, 0);");
  });

  it("uses a 90-second lease and never steals a live one", () => {
    const leaseWindows = [
      ...CANDIDATE_SQL.matchAll(/now\(\) \+ interval '90 seconds'/g),
    ];
    expect(leaseWindows.length).toBeGreaterThanOrEqual(2);
    expect(CANDIDATE_SQL).toContain(
      "IF _state.lease_token IS NOT NULL AND _state.lease_expires_at > now() THEN",
    );
    expect(CANDIDATE_SQL).toContain("FOR UPDATE");
  });

  it("releases only on an exact token match, expired or not", () => {
    expect(CANDIDATE_SQL).toContain("AND s.lease_token = _lease_token");
    const releaseBody = CANDIDATE_SQL.slice(
      CANDIDATE_SQL.indexOf("CREATE FUNCTION public.telegram_release_poll_lease"),
      CANDIDATE_SQL.indexOf("CREATE FUNCTION public.telegram_advance_poll_cursor"),
    );
    expect(releaseBody).not.toContain("lease_expires_at >");
    expect(releaseBody).toContain("RETURN _released > 0;");
  });
});

describe("TG-2D candidate SQL — cursor advancement", () => {
  const advanceBody = CANDIDATE_SQL.slice(
    CANDIDATE_SQL.indexOf("CREATE FUNCTION public.telegram_advance_poll_cursor"),
    CANDIDATE_SQL.indexOf("CREATE FUNCTION public.telegram_record_ignored_update"),
  );

  it("requires a live matching lease", () => {
    expect(advanceBody).toContain("_state.lease_token <> _lease_token");
    expect(advanceBody).toContain("_state.lease_expires_at <= now()");
    expect(advanceBody).toContain("RAISE EXCEPTION 'telegram_poll_lease_invalid'");
  });

  it("rejects regression and non-terminal updates with the exact codes", () => {
    expect(advanceBody).toContain(
      "IF _last_update_id < _state.last_confirmed_update_id THEN",
    );
    expect(advanceBody).toContain(
      "RAISE EXCEPTION 'telegram_poll_cursor_regression'",
    );
    expect(advanceBody).toContain("FROM public.telegram_update_receipts r");
    expect(advanceBody).toContain("r.status = ANY (ARRAY['processed','ignored'])");
    expect(advanceBody).toContain(
      "RAISE EXCEPTION 'telegram_poll_update_not_terminal'",
    );
  });

  it("renews the lease while advancing", () => {
    expect(advanceBody).toContain("lease_expires_at = now() + interval '90 seconds'");
    expect(advanceBody).toContain("last_confirmed_update_id = _last_update_id");
  });
});

describe("TG-2D candidate SQL — receipt privacy and vocabulary", () => {
  const receiptTable = CANDIDATE_SQL.slice(
    CANDIDATE_SQL.indexOf("CREATE TABLE public.telegram_update_receipts"),
    CANDIDATE_SQL.indexOf("A3. RLS"),
  );

  it("stores no raw payload, text, token, or personal identifiers", () => {
    for (const forbidden of [
      "payload jsonb",
      "raw_update",
      "message_text",
      " text_content",
      "raw_token",
      "username",
      "chat_title",
      "first_name",
      "last_name",
      "phone",
    ]) {
      expect(receiptTable).not.toContain(forbidden);
    }
    expect(receiptTable).not.toMatch(/\bjsonb\b/);
  });

  it("constrains the payload hash to 64 lowercase hex chars", () => {
    expect(receiptTable).toContain("payload_hash text NOT NULL");
    expect(receiptTable).toContain("payload_hash ~ '^[0-9a-f]{64}$'");
  });

  it("constrains identifiers and the exact status/result vocabulary", () => {
    expect(receiptTable).toContain("CHECK (update_id > 0)");
    expect(receiptTable).toContain("CHECK (update_type = 'message')");
    expect(receiptTable).toContain(
      "CHECK (telegram_user_id IS NULL OR telegram_user_id > 0)",
    );
    expect(receiptTable).toContain(
      "CHECK (telegram_chat_id IS NULL OR telegram_chat_id <> 0)",
    );
    expect(receiptTable).toContain("CHECK (status = ANY (ARRAY['processed','ignored']))");
    for (const code of [
      "link_success",
      "link_rejected",
      "non_private_message",
      "non_start_message",
      "invalid_start_command",
      "invalid_update_shape",
    ]) {
      expect(receiptTable).toContain(`'${code}'`);
    }
  });
});

describe("TG-2D candidate SQL — terminal record RPCs", () => {
  const ignoredBody = CANDIDATE_SQL.slice(
    CANDIDATE_SQL.indexOf("CREATE FUNCTION public.telegram_record_ignored_update"),
    CANDIDATE_SQL.indexOf("CREATE FUNCTION public.telegram_process_start_update"),
  );
  const startBody = CANDIDATE_SQL.slice(
    CANDIDATE_SQL.indexOf("CREATE FUNCTION public.telegram_process_start_update"),
  );

  /** The exact inline fail-closed lease predicate both terminal RPCs must carry
   *  now that the unauthorized shared helper has been removed. */
  const INLINE_LEASE_ASSERTION = [
    "IF _lease_token IS NULL OR NOT EXISTS (",
    "    SELECT 1",
    "    FROM public.telegram_poll_state s",
    "    WHERE s.id = 1",
    "      AND s.lease_token = _lease_token",
    "      AND s.lease_expires_at > now()",
    "  ) THEN",
    "    RAISE EXCEPTION 'telegram_poll_lease_invalid';",
    "  END IF;",
  ].join("\n");

  it("both return (is_new, result_code) and inline the live-lease assertion", () => {
    expect(ignoredBody).toContain("RETURNS TABLE(is_new boolean, result_code text)");
    expect(startBody).toContain("RETURNS TABLE(is_new boolean, result_code text)");
    expect(ignoredBody).toContain(INLINE_LEASE_ASSERTION);
    expect(startBody).toContain(INLINE_LEASE_ASSERTION);
    expect(ignoredBody).not.toContain("_telegram_assert_poll_lease");
    expect(startBody).not.toContain("_telegram_assert_poll_lease");
  });

  it("restricts the ignored RPC to the four ignore codes", () => {
    expect(ignoredBody).toContain("'non_private_message'");
    expect(ignoredBody).toContain("'non_start_message'");
    expect(ignoredBody).toContain("'invalid_start_command'");
    expect(ignoredBody).toContain("'invalid_update_shape'");
    expect(ignoredBody).not.toContain("'link_success'");
    expect(ignoredBody).not.toContain("'link_rejected'");
  });

  it("treats an exact replay as a duplicate and any mismatch as a conflict", () => {
    for (const body of [ignoredBody, startBody]) {
      expect(body).toContain("_existing.payload_hash = _payload_hash");
      expect(body).toContain(
        "_existing.telegram_user_id IS NOT DISTINCT FROM _telegram_user_id",
      );
      expect(body).toContain(
        "_existing.telegram_chat_id IS NOT DISTINCT FROM _telegram_chat_id",
      );
      expect(body).toContain("is_new := false;");
      expect(body).toContain("RAISE EXCEPTION 'telegram_update_conflict'");
    }
    expect(ignoredBody).toContain("_existing.status = 'ignored'");
    expect(startBody).toContain("_existing.status = 'processed'");
  });

  it("calls TG-2B consume inside the same transaction and never persists the raw token", () => {
    expect(startBody).toContain(
      "PERFORM public.consume_telegram_link_token(_raw_token, _telegram_user_id);",
    );
    expect(startBody).not.toMatch(/ROLLBACK|dblink|pg_background/i);
    // The only COMMIT in the candidate is the single closing statement.
    expect(CANDIDATE_CODE.match(/\bCOMMIT\b/gi) ?? []).toHaveLength(1);
    // `_raw_token` is only validated and passed through — never inserted.
    const insertBlock = startBody.slice(
      startBody.indexOf("INSERT INTO public.telegram_update_receipts"),
    );
    expect(insertBlock).not.toContain("_raw_token");
    expect(startBody).not.toMatch(/RAISE (NOTICE|LOG|WARNING)/i);
  });

  it("translates only the four expected TG-2B rejections and re-raises anything else", () => {
    expect(startBody).toContain("'telegram_link_token_invalid'");
    expect(startBody).toContain("'telegram_user_already_linked'");
    expect(startBody).toContain("'telegram_account_already_linked'");
    expect(startBody).toContain("'telegram_link_conflict'");
    expect(startBody).toContain("_outcome := 'link_rejected';");
    expect(startBody).toContain("ELSE\n        RAISE;");
    expect(startBody).toContain("_outcome := 'link_success';");
  });

  it("validates the start command shape before doing anything", () => {
    expect(startBody).toContain("_chat_type IS DISTINCT FROM 'private'");
    expect(startBody).toContain("_raw_token !~ '^[0-9a-f]{64}$'");
    expect(startBody).toContain("RAISE EXCEPTION 'telegram_update_invalid'");
  });
});

describe("TG-2D candidate SQL — no TG-1 / TG-2C entanglement", () => {
  it("never creates, redefines, grants, revokes, or calls a dispatch object", () => {
    for (const forbidden of [
      "dispatch_create_driver_load",
      "dispatch_update_driver_load_status",
      "dispatch_command_receipts",
      "telegram_dispatch_create_driver_load",
      "telegram_dispatch_update_driver_load_status",
      "telegram_bind_dispatch_chat",
      "telegram_revoke_dispatch_chat",
      "telegram_chat_bindings",
      "carrier_driver_relationships",
      "request.jwt.claim.sub",
      "loads_dispatch",
    ]) {
      expect(CANDIDATE_CODE).not.toContain(forbidden);
    }
    expect(CANDIDATE_CODE).not.toMatch(/ALTER TABLE public\.loads/i);
  });

  it("touches TG-2B only through the consume call", () => {
    const tg2bMentions = [
      ...CANDIDATE_CODE.matchAll(/consume_telegram_link_token/g),
    ];
    expect(tg2bMentions).toHaveLength(1);
    expect(CANDIDATE_CODE).not.toContain("issue_telegram_link_token");
    expect(CANDIDATE_CODE).not.toContain("revoke_my_telegram_link");
    expect(CANDIDATE_CODE).not.toContain("telegram_user_links");
    expect(CANDIDATE_CODE).not.toContain("telegram_link_tokens");
  });

  it("contains no webhook, bot token, or secret vocabulary", () => {
    expect(CANDIDATE_CODE).not.toMatch(/api\.telegram\.org/);
    expect(CANDIDATE_CODE).not.toMatch(/setWebhook/i);
    expect(CANDIDATE_CODE).not.toMatch(/bot_token|BOT_TOKEN/);
    expect(CANDIDATE_CODE).not.toMatch(/vault\./i);
  });
});

// ─────────────────────────── Orchestrator behaviour ───────────────────────

interface FakeState {
  cursor: number;
  leaseToken: string | null;
  terminal: Set<number>;
}

function makeLedger(options: {
  busy?: boolean;
  startResult?: TelegramTerminalResult;
  ignoredResult?: TelegramTerminalResult;
  failTerminalOn?: number;
  failAdvanceOn?: number;
} = {}) {
  const state: FakeState = { cursor: 0, leaseToken: null, terminal: new Set() };
  const calls: string[] = [];

  const ledger: TelegramPollLedger = {
    async claimLease() {
      calls.push("claimLease");
      if (options.busy) return null;
      state.leaseToken = "lease-1";
      return { leaseToken: state.leaseToken, nextOffset: state.cursor + 1 };
    },
    async releaseLease(token) {
      calls.push("releaseLease");
      if (state.leaseToken !== token) return false;
      state.leaseToken = null;
      return true;
    },
    async advanceCursor(token, lastUpdateId) {
      calls.push(`advanceCursor:${lastUpdateId}`);
      if (options.failAdvanceOn === lastUpdateId) {
        throw new Error("telegram_poll_lease_invalid");
      }
      if (state.leaseToken !== token) throw new Error("telegram_poll_lease_invalid");
      if (!state.terminal.has(lastUpdateId)) {
        throw new Error("telegram_poll_update_not_terminal");
      }
      state.cursor = lastUpdateId;
      return lastUpdateId;
    },
    async recordIgnoredUpdate(input) {
      calls.push(`recordIgnored:${input.updateId}:${input.resultCode}`);
      if (options.failTerminalOn === input.updateId) {
        throw new Error("telegram_update_conflict");
      }
      state.terminal.add(input.updateId);
      return (
        options.ignoredResult ?? { isNew: true, resultCode: input.resultCode }
      );
    },
    async processStartUpdate(input) {
      calls.push(`processStart:${input.updateId}`);
      if (options.failTerminalOn === input.updateId) {
        throw new Error("telegram_update_conflict");
      }
      state.terminal.add(input.updateId);
      return options.startResult ?? { isNew: true, resultCode: "link_success" };
    },
  };

  return { ledger, state, calls };
}

function makeGateway(options: {
  updates?: unknown[];
  getUpdatesResponse?: TelegramGatewayResponse<unknown[]>;
  sendFails?: boolean;
  sendThrows?: boolean;
}) {
  const getUpdates = vi.fn(async () =>
    options.getUpdatesResponse ??
      ({ ok: true, status: 200, result: options.updates ?? [] } as TelegramGatewayResponse<unknown[]>),
  );
  const sendMessage = vi.fn(async () => {
    if (options.sendThrows) throw new Error("boom with secret text");
    return options.sendFails
      ? ({ ok: false, status: 400, errorCode: "telegram_bot_api_error" } as TelegramGatewayResponse<unknown>)
      : ({ ok: true, status: 200 } as TelegramGatewayResponse<unknown>);
  });
  const gateway: TelegramGateway = { getUpdates, sendMessage };
  return { gateway, getUpdates, sendMessage };
}

const sha256 = async (input: string) => {
  // Deterministic 64-hex stand-in; the real Edge Function uses Web Crypto.
  let h1 = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0").repeat(8);
};

const TOKEN = "a".repeat(64);

const privateStartUpdate = (updateId: number, text = `/start ${TOKEN}`) => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    from: { id: 555001, is_bot: false },
    chat: { id: 555001, type: "private" },
    text,
  },
});

const groupUpdate = (updateId: number) => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    from: { id: 555001 },
    chat: { id: -100200300, type: "supergroup" },
    text: `/start ${TOKEN}`,
  },
});

describe("TG-2D orchestrator — lease and gateway discipline", () => {
  it("makes zero gateway calls when the lease is busy", async () => {
    const { ledger } = makeLedger({ busy: true });
    const { gateway, getUpdates, sendMessage } = makeGateway({});
    const result = await runTelegramPoll({ ledger, gateway, sha256 });
    expect(result).toEqual({ kind: "busy" });
    expect(getUpdates).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("cold start polls offset 1 with the exact required options", async () => {
    const { ledger } = makeLedger({});
    const { gateway, getUpdates } = makeGateway({ updates: [] });
    const result = await runTelegramPoll({ ledger, gateway, sha256 });
    expect(getUpdates).toHaveBeenCalledWith({
      offset: 1,
      limit: TELEGRAM_GET_UPDATES_LIMIT,
      timeout: TELEGRAM_GET_UPDATES_TIMEOUT_SECONDS,
      allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
    });
    expect(TELEGRAM_GET_UPDATES_LIMIT).toBe(25);
    expect(TELEGRAM_GET_UPDATES_TIMEOUT_SECONDS).toBe(20);
    expect(TELEGRAM_ALLOWED_UPDATES).toEqual(["message"]);
    expect(result).toEqual({
      kind: "ok",
      processed: 0,
      advancedTo: null,
      resultCodes: [],
    });
  });

  it("releases the lease and advances nothing on a gateway HTTP failure", async () => {
    const { ledger, state, calls } = makeLedger({});
    const { gateway } = makeGateway({
      getUpdatesResponse: { ok: false, status: 502, errorCode: "telegram_gateway_http_error" },
    });
    const result = await runTelegramPoll({ ledger, gateway, sha256 });
    expect(result).toMatchObject({ kind: "failed", errorCode: "telegram_gateway_http_error" });
    expect(state.cursor).toBe(0);
    expect(calls).toContain("releaseLease");
    expect(calls.some((c) => c.startsWith("advanceCursor"))).toBe(false);
  });

  it("treats a 200 response with ok=false as a transient failure", async () => {
    const { ledger, state } = makeLedger({});
    const { gateway } = makeGateway({
      getUpdatesResponse: { ok: false, status: 200, errorCode: "telegram_bot_api_error" },
    });
    const result = await runTelegramPoll({ ledger, gateway, sha256 });
    expect(result).toMatchObject({ kind: "failed", errorCode: "telegram_bot_api_error" });
    expect(state.cursor).toBe(0);
  });
});

describe("TG-2D orchestrator — classification and ordering", () => {
  it("processes updates in ascending update_id order", async () => {
    const { ledger, calls, state } = makeLedger({});
    const { gateway } = makeGateway({
      updates: [privateStartUpdate(12, "hello"), privateStartUpdate(10, "hi"), privateStartUpdate(11, "yo")],
    });
    await runTelegramPoll({ ledger, gateway, sha256 });
    const advances = calls.filter((c) => c.startsWith("advanceCursor"));
    expect(advances).toEqual(["advanceCursor:10", "advanceCursor:11", "advanceCursor:12"]);
    expect(state.cursor).toBe(12);
  });

  it("routes a valid private /start to processStartUpdate and advances after it", async () => {
    const { ledger, calls, state } = makeLedger({});
    const { gateway } = makeGateway({ updates: [privateStartUpdate(7)] });
    const result = await runTelegramPoll({ ledger, gateway, sha256 });
    expect(calls).toEqual([
      "claimLease",
      "processStart:7",
      "advanceCursor:7",
      "releaseLease",
    ]);
    expect(state.cursor).toBe(7);
    expect(result).toMatchObject({ kind: "ok", processed: 1, advancedTo: 7 });
  });

  it("ignores group, non-start, malformed-start, and shapeless updates", async () => {
    const { ledger, calls } = makeLedger({});
    const { gateway } = makeGateway({
      updates: [
        groupUpdate(1),
        privateStartUpdate(2, "how much is this load"),
        privateStartUpdate(3, "/start not-a-token"),
        { update_id: 4, message: { chat: { type: "private" }, text: "/start" } },
      ],
    });
    await runTelegramPoll({ ledger, gateway, sha256 });
    expect(calls).toContain("recordIgnored:1:non_private_message");
    expect(calls).toContain("recordIgnored:2:non_start_message");
    expect(calls).toContain("recordIgnored:3:invalid_start_command");
    expect(calls).toContain("recordIgnored:4:invalid_update_shape");
    expect(calls.some((c) => c.startsWith("processStart"))).toBe(false);
  });

  it("classifies uppercase-hex and over-length tokens as malformed, not valid", () => {
    expect(
      classifyUpdate({
        updateId: 1,
        telegramUserId: 1,
        telegramChatId: 1,
        chatType: "private",
        text: `/start ${"A".repeat(64)}`,
      }),
    ).toEqual({ kind: "ignored", resultCode: "invalid_start_command" });
    expect(
      classifyUpdate({
        updateId: 1,
        telegramUserId: 1,
        telegramChatId: 1,
        chatType: "private",
        text: `/start ${"a".repeat(65)}`,
      }),
    ).toEqual({ kind: "ignored", resultCode: "invalid_start_command" });
    expect(
      classifyUpdate({
        updateId: 1,
        telegramUserId: 1,
        telegramChatId: 1,
        chatType: "private",
        text: `/start ${TOKEN}`,
      }),
    ).toEqual({ kind: "start", rawToken: TOKEN });
  });

  it("hashes a stable serialization regardless of key order", async () => {
    const a = stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } });
    const b = stableStringify({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(await sha256(a)).toBe(await sha256(b));
  });
});

describe("TG-2D orchestrator — best-effort feedback", () => {
  it("sends success feedback exactly once for a new link_success", async () => {
    const { ledger } = makeLedger({});
    const { gateway, sendMessage } = makeGateway({ updates: [privateStartUpdate(3)] });
    await runTelegramPoll({ ledger, gateway, sha256 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      chatId: 555001,
      text: TELEGRAM_LINK_SUCCESS_MESSAGE,
    });
  });

  it("sends the retry guidance for a new link_rejected", async () => {
    const { ledger } = makeLedger({
      startResult: { isNew: true, resultCode: "link_rejected" },
    });
    const { gateway, sendMessage } = makeGateway({ updates: [privateStartUpdate(4)] });
    await runTelegramPoll({ ledger, gateway, sha256 });
    expect(sendMessage).toHaveBeenCalledWith({
      chatId: 555001,
      text: TELEGRAM_LINK_FAILURE_MESSAGE,
    });
  });

  it("never re-sends feedback for a duplicate receipt", async () => {
    const { ledger, state } = makeLedger({
      startResult: { isNew: false, resultCode: "link_success" },
    });
    const { gateway, sendMessage } = makeGateway({ updates: [privateStartUpdate(9)] });
    await runTelegramPoll({ ledger, gateway, sha256 });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(state.cursor).toBe(9);
  });

  it("sends nothing for ignored group or plain messages", async () => {
    const { ledger } = makeLedger({});
    const { gateway, sendMessage } = makeGateway({
      updates: [groupUpdate(1), privateStartUpdate(2, "hello")],
    });
    await runTelegramPoll({ ledger, gateway, sha256 });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("advances the cursor even when the send fails or throws", async () => {
    for (const opts of [{ sendFails: true }, { sendThrows: true }]) {
      const { ledger, state } = makeLedger({});
      const { gateway } = makeGateway({ updates: [privateStartUpdate(5)], ...opts });
      const result = await runTelegramPoll({ ledger, gateway, sha256 });
      expect(result).toMatchObject({ kind: "ok", advancedTo: 5 });
      expect(state.cursor).toBe(5);
    }
  });
});

describe("TG-2D orchestrator — failure containment", () => {
  it("does not advance past an update whose terminal receipt failed", async () => {
    const { ledger, state, calls } = makeLedger({ failTerminalOn: 21 });
    const { gateway } = makeGateway({
      updates: [privateStartUpdate(20, "hi"), privateStartUpdate(21, "yo"), privateStartUpdate(22, "sup")],
    });
    const result = await runTelegramPoll({ ledger, gateway, sha256 });
    expect(result).toMatchObject({ kind: "failed", errorCode: "telegram_update_conflict" });
    expect(state.cursor).toBe(20);
    expect(calls).not.toContain("recordIgnored:22:non_start_message");
    expect(calls).toContain("releaseLease");
  });

  it("stops the batch when cursor advancement itself fails", async () => {
    const { ledger, state, calls } = makeLedger({ failAdvanceOn: 30 });
    const { gateway } = makeGateway({
      updates: [privateStartUpdate(30, "hi"), privateStartUpdate(31, "yo")],
    });
    const result = await runTelegramPoll({ ledger, gateway, sha256 });
    expect(result).toMatchObject({ kind: "failed", errorCode: "telegram_poll_lease_invalid" });
    expect(state.cursor).toBe(0);
    expect(calls.filter((c) => c.startsWith("advanceCursor"))).toEqual(["advanceCursor:30"]);
  });

  it("fails the batch on an unusable update_id rather than skipping it", async () => {
    const { ledger, state } = makeLedger({});
    const { gateway } = makeGateway({ updates: [{ update_id: "nope", message: {} }] });
    const result = await runTelegramPoll({ ledger, gateway, sha256 });
    expect(result).toMatchObject({ kind: "failed", errorCode: "telegram_update_id_invalid" });
    expect(state.cursor).toBe(0);
  });
});

describe("TG-2D orchestrator — leakage control", () => {
  it("reduces arbitrary error text to an opaque code", () => {
    expect(sanitizeErrorCode(new Error(`token ${TOKEN} for @driver said hello`))).toBe(
      "telegram_poll_unexpected_error",
    );
    expect(sanitizeErrorCode(new Error("telegram_update_conflict"))).toBe(
      "telegram_update_conflict",
    );
  });

  it("never logs message text, tokens, chat ids, or raw payloads", async () => {
    const logged: string[] = [];
    const { ledger } = makeLedger({});
    const { gateway } = makeGateway({
      updates: [privateStartUpdate(40), privateStartUpdate(41, "secret dispatch chatter")],
    });
    await runTelegramPoll({
      ledger,
      gateway,
      sha256,
      log: (event, details) => logged.push(`${event} ${JSON.stringify(details ?? {})}`),
    });
    const blob = logged.join("\n");
    expect(blob).not.toContain(TOKEN);
    expect(blob).not.toContain("secret dispatch chatter");
    expect(blob).not.toContain("/start");
    expect(blob).not.toContain("555001");
    expect(blob).toContain("update_terminal");
  });

  it("keeps the shared orchestrator runtime-neutral", () => {
    expect(ORCHESTRATOR_CODE).not.toMatch(/\bDeno\b/);
    expect(ORCHESTRATOR_CODE).not.toMatch(/https?:\/\//);
    expect(ORCHESTRATOR_CODE).not.toMatch(/fetch\(/);
    expect(EDGE_CODE).toContain("runTelegramPoll");
  });
});

// ───────────────────────────── Edge shell contract ────────────────────────

describe("TG-2D edge function shell", () => {
  it("uses the Lovable connector gateway with managed keys only", () => {
    expect(EDGE_SOURCE).toContain("https://connector-gateway.lovable.dev/telegram");
    expect(EDGE_SOURCE).toContain('Deno.env.get("LOVABLE_API_KEY")');
    expect(EDGE_SOURCE).toContain('Deno.env.get("TELEGRAM_API_KEY")');
    expect(EDGE_SOURCE).toContain("Authorization: `Bearer ${lovableApiKey}`");
    expect(EDGE_SOURCE).toContain('"X-Connection-Api-Key": connectionKey');
  });

  it("contains no direct Telegram host, webhook registration, or bot token", () => {
    expect(EDGE_SOURCE).not.toMatch(/api\.telegram\.org/);
    expect(EDGE_SOURCE).not.toMatch(/setWebhook|deleteWebhook|getWebhookInfo/i);
    expect(EDGE_SOURCE).not.toMatch(/bot_token|BOT_TOKEN|botToken/);
    expect(EDGE_SOURCE).not.toMatch(/\/bot\$\{|\/bot</);
  });

  it("requires an exact service-role bearer and fails closed without a connection", () => {
    expect(EDGE_SOURCE).toContain('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
    expect(EDGE_SOURCE).toContain("safeEqual(authorization, `Bearer ${serviceRoleKey}`)");
    expect(EDGE_SOURCE).toContain('json({ error: "unauthorized" }, 401)');
    expect(EDGE_SOURCE).toContain('json({ error: "telegram_connection_not_configured" }, 503)');
  });

  it("handles both HTTP status and Bot API ok, and drops provider bodies", () => {
    expect(EDGE_SOURCE).toContain("if (!response.ok)");
    expect(EDGE_SOURCE).toContain("body?.ok !== true");
    expect(EDGE_SOURCE).not.toMatch(/console\.log\([^)]*body/);
  });

  it("drives the shared orchestrator and only the five TG-2D RPCs", () => {
    expect(EDGE_SOURCE).toContain("runTelegramPoll");
    const rpcs = [...EDGE_SOURCE.matchAll(/supabase\.rpc\("(\w+)"/g)].map((m) => m[1]);
    expect(rpcs.sort()).toEqual([
      "telegram_advance_poll_cursor",
      "telegram_claim_poll_lease",
      "telegram_process_start_update",
      "telegram_record_ignored_update",
      "telegram_release_poll_lease",
    ]);
  });

  it("implements no callback, chat-binding, load, or TG-2C dispatch behaviour", () => {
    for (const forbidden of [
      "callback_query",
      "answerCallbackQuery",
      "telegram_bind_dispatch_chat",
      "telegram_dispatch_create_driver_load",
      "telegram_dispatch_update_driver_load_status",
      "dispatch_create_driver_load",
      "loads",
    ]) {
      expect(EDGE_SOURCE).not.toContain(forbidden);
    }
  });
});
