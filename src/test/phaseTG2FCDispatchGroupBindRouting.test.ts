/**
 * Phase TG-2F-C1 — dispatch group `/bind` routing contract.
 *
 * Two halves:
 *   A. behavioural tests against the SHARED orchestrator (the same module the
 *      Edge Function drives — tests must not fork a separate flow);
 *   B. static source assertions against the candidate SQL and the Edge
 *      Function adapter, pinning the atomicity and privilege contract.
 *
 * No network, no database, no secret access.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  classifyUpdate,
  runTelegramPoll,
  TELEGRAM_BIND_FAILURE_MESSAGE,
  TELEGRAM_BIND_SUCCESS_MESSAGE,
  TELEGRAM_LINK_FAILURE_MESSAGE,
  TELEGRAM_LINK_SUCCESS_MESSAGE,
  type TelegramGateway,
  type TelegramGatewayResponse,
  type TelegramPollLedger,
  type TelegramTerminalResult,
} from "../../supabase/functions/_shared/telegram-poll-ingest.ts";

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const CANDIDATE_PATH =
  "supabase/migration-candidates/20260824114000_phase_tg2fc_dispatch_group_bind_routing.sql";
const INGEST_PATH = "supabase/functions/_shared/telegram-poll-ingest.ts";
const EDGE_PATH = "supabase/functions/telegram-poll/index.ts";

const CANDIDATE = read(CANDIDATE_PATH);
const INGEST_SOURCE = read(INGEST_PATH);
const EDGE_SOURCE = read(EDGE_PATH);
const CANDIDATE_EXEC = CANDIDATE.replace(/--.*$/gm, "");

const HEX64 = "a".repeat(64);
const HEX64_B = "b".repeat(64);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function identity(overrides: Partial<{
  updateId: number;
  telegramUserId: number | null;
  telegramChatId: number | null;
  chatType: string | null;
  text: string | null;
}> = {}) {
  return {
    updateId: 1,
    telegramUserId: 111,
    telegramChatId: -222,
    chatType: "group",
    text: `/bind ${HEX64}`,
    ...overrides,
  };
}

function makeLedger(options: {
  bindResult?: TelegramTerminalResult;
  startResult?: TelegramTerminalResult;
  bindThrows?: boolean;
} = {}) {
  const calls: string[] = [];
  const bindInputs: Record<string, unknown>[] = [];
  const terminal = new Set<number>();

  const ledger: TelegramPollLedger = {
    async claimLease() {
      return { leaseToken: "lease-1", nextOffset: 1 };
    },
    async releaseLease() {
      return true;
    },
    async advanceCursor(_token, lastUpdateId) {
      if (!terminal.has(lastUpdateId)) {
        throw new Error("telegram_poll_update_not_terminal");
      }
      calls.push(`advanceCursor:${lastUpdateId}`);
      return lastUpdateId;
    },
    async recordIgnoredUpdate(input) {
      calls.push(`recordIgnored:${input.updateId}:${input.resultCode}`);
      terminal.add(input.updateId);
      return { isNew: true, resultCode: input.resultCode };
    },
    async processStartUpdate(input) {
      calls.push(`processStart:${input.updateId}`);
      terminal.add(input.updateId);
      return options.startResult ?? { isNew: true, resultCode: "link_success" };
    },
    async processBindUpdate(input) {
      calls.push(`processBind:${input.updateId}`);
      bindInputs.push({ ...input });
      if (options.bindThrows) throw new Error("telegram_update_conflict");
      terminal.add(input.updateId);
      return options.bindResult ?? { isNew: true, resultCode: "bind_success" };
    },
  };

  return { ledger, calls, bindInputs };
}

function makeGateway(updates: unknown[]) {
  const sendMessage = vi.fn(
    async () => ({ ok: true, status: 200 } as TelegramGatewayResponse<unknown>),
  );
  const gateway: TelegramGateway = {
    getUpdates: async () =>
      ({ ok: true, status: 200, result: updates } as TelegramGatewayResponse<unknown[]>),
    sendMessage,
  };
  return { gateway, sendMessage };
}

const sha256 = async (input: string) =>
  Array.from(input)
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(64, "0")
    .slice(0, 64);

function groupUpdate(updateId: number, text: string, chatType = "group") {
  return {
    update_id: updateId,
    message: {
      from: { id: 111 },
      chat: { id: -222, type: chatType },
      text,
    },
  };
}

// ---------------------------------------------------------------------------
// A. Classification
// ---------------------------------------------------------------------------

describe("TG-2F-C A — bind command recognition", () => {
  it.each(["group", "supergroup"])("routes /bind in a %s chat to the bind path", (chatType) => {
    const result = classifyUpdate(identity({ chatType }));
    expect(result).toEqual({ kind: "bind", rawToken: HEX64, chatType });
  });

  it("accepts the bot-addressed form", () => {
    const result = classifyUpdate(
      identity({ text: `/bind@HaulTrackerProDispatchBot ${HEX64}` }),
    );
    expect(result).toEqual({ kind: "bind", rawToken: HEX64, chatType: "group" });
  });

  it("passes the exact raw token through unmodified", () => {
    const result = classifyUpdate(identity({ text: `/bind ${HEX64_B}` }));
    expect(result).toEqual({ kind: "bind", rawToken: HEX64_B, chatType: "group" });
  });

  it.each([
    ["/bind", "bare command"],
    [`/bind ${"A".repeat(64)}`, "uppercase hex"],
    [`/bind ${"a".repeat(63)}`, "short token"],
    [`/bind ${"a".repeat(65)}`, "long token"],
    [`/bind  ${HEX64}`, "double space"],
    [`/bind ${HEX64} extra`, "trailing content"],
    [`/bind@OtherBot ${HEX64}`, "foreign bot mention"],
    [`bind ${HEX64}`, "missing slash"],
    [`/BIND ${HEX64}`, "uppercase command"],
    [`/bindx ${HEX64}`, "command prefix collision"],
  ])("does NOT treat %s (%s) as a bind command", (text) => {
    const result = classifyUpdate(identity({ text }));
    expect(result).toEqual({ kind: "ignored", resultCode: "non_private_message" });
  });

  it("does not bind from a private chat", () => {
    const result = classifyUpdate(identity({ chatType: "private" }));
    expect(result).toEqual({ kind: "ignored", resultCode: "non_start_message" });
  });

  it("does not bind from a channel", () => {
    const result = classifyUpdate(identity({ chatType: "channel" }));
    expect(result).toEqual({ kind: "ignored", resultCode: "non_private_message" });
  });

  it("fails closed on an unusable shape even with a perfect bind command", () => {
    expect(classifyUpdate(identity({ telegramUserId: null }))).toEqual({
      kind: "ignored",
      resultCode: "invalid_update_shape",
    });
    expect(classifyUpdate(identity({ telegramChatId: null }))).toEqual({
      kind: "ignored",
      resultCode: "invalid_update_shape",
    });
  });
});

describe("TG-2F-C B — pre-existing TG-2D classification is unchanged", () => {
  it("keeps /start in a group as non_private_message", () => {
    expect(classifyUpdate(identity({ text: `/start ${HEX64}` }))).toEqual({
      kind: "ignored",
      resultCode: "non_private_message",
    });
  });

  it("keeps valid private /start on the start path", () => {
    expect(
      classifyUpdate(identity({ chatType: "private", text: `/start ${HEX64}` })),
    ).toEqual({ kind: "start", rawToken: HEX64 });
  });

  it("keeps malformed private /start as invalid_start_command", () => {
    expect(classifyUpdate(identity({ chatType: "private", text: "/start nope" }))).toEqual({
      kind: "ignored",
      resultCode: "invalid_start_command",
    });
  });

  it("keeps ordinary private text as non_start_message", () => {
    expect(classifyUpdate(identity({ chatType: "private", text: "hello" }))).toEqual({
      kind: "ignored",
      resultCode: "non_start_message",
    });
  });

  it("keeps a textless group message as non_private_message", () => {
    expect(classifyUpdate(identity({ text: null }))).toEqual({
      kind: "ignored",
      resultCode: "non_private_message",
    });
  });
});

// ---------------------------------------------------------------------------
// C. Orchestration
// ---------------------------------------------------------------------------

describe("TG-2F-C C — orchestrator routes bind updates atomically", () => {
  it("calls processBindUpdate with the group chat type and advances after it", async () => {
    const { ledger, calls, bindInputs } = makeLedger();
    const { gateway } = makeGateway([groupUpdate(9, `/bind ${HEX64}`, "supergroup")]);

    const result = await runTelegramPoll({ ledger, gateway, sha256 });

    expect(result).toMatchObject({ kind: "ok", processed: 1, advancedTo: 9 });
    expect(calls).toEqual(["processBind:9", "advanceCursor:9"]);
    expect(bindInputs[0]).toMatchObject({
      updateId: 9,
      telegramUserId: 111,
      telegramChatId: -222,
      chatType: "supergroup",
      rawToken: HEX64,
      leaseToken: "lease-1",
    });
  });

  it("never routes a bind update through the start or ignored path", async () => {
    const { ledger, calls } = makeLedger();
    const { gateway } = makeGateway([groupUpdate(4, `/bind ${HEX64}`)]);
    await runTelegramPoll({ ledger, gateway, sha256 });
    expect(calls.some((c) => c.startsWith("processStart"))).toBe(false);
    expect(calls.some((c) => c.startsWith("recordIgnored"))).toBe(false);
  });

  it("does NOT advance the cursor when the bind processor throws", async () => {
    const { ledger, calls } = makeLedger({ bindThrows: true });
    const { gateway } = makeGateway([groupUpdate(5, `/bind ${HEX64}`)]);

    const result = await runTelegramPoll({ ledger, gateway, sha256 });

    expect(result).toEqual({
      kind: "failed",
      errorCode: "telegram_update_conflict",
      processed: 0,
      advancedTo: null,
    });
    expect(calls).not.toContain("advanceCursor:5");
  });

  it("sends the generic success confirmation for a NEW bind_success", async () => {
    const { ledger } = makeLedger();
    const { gateway, sendMessage } = makeGateway([groupUpdate(1, `/bind ${HEX64}`)]);
    await runTelegramPoll({ ledger, gateway, sha256 });
    expect(sendMessage).toHaveBeenCalledWith({
      chatId: -222,
      text: TELEGRAM_BIND_SUCCESS_MESSAGE,
    });
  });

  it("sends the generic guidance for a NEW bind_rejected", async () => {
    const { ledger } = makeLedger({
      bindResult: { isNew: true, resultCode: "bind_rejected" },
    });
    const { gateway, sendMessage } = makeGateway([groupUpdate(1, `/bind ${HEX64}`)]);
    await runTelegramPoll({ ledger, gateway, sha256 });
    expect(sendMessage).toHaveBeenCalledWith({
      chatId: -222,
      text: TELEGRAM_BIND_FAILURE_MESSAGE,
    });
  });

  it("stays silent on a replayed (isNew=false) bind outcome", async () => {
    const { ledger } = makeLedger({
      bindResult: { isNew: false, resultCode: "bind_success" },
    });
    const { gateway, sendMessage } = makeGateway([groupUpdate(1, `/bind ${HEX64}`)]);
    const result = await runTelegramPoll({ ledger, gateway, sha256 });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "ok", advancedTo: 1 });
  });

  it("still advances when best-effort bot feedback fails", async () => {
    const { ledger } = makeLedger();
    const gateway: TelegramGateway = {
      getUpdates: async () =>
        ({
          ok: true,
          status: 200,
          result: [groupUpdate(3, `/bind ${HEX64}`)],
        } as TelegramGatewayResponse<unknown[]>),
      sendMessage: async () => {
        throw new Error("gateway exploded with message text");
      },
    };
    const result = await runTelegramPoll({ ledger, gateway, sha256 });
    expect(result).toMatchObject({ kind: "ok", processed: 1, advancedTo: 3 });
  });

  it("keeps the /start path and its messages intact alongside bind", async () => {
    const { ledger, calls } = makeLedger();
    const privateStart = {
      update_id: 2,
      message: { from: { id: 5 }, chat: { id: 5, type: "private" }, text: `/start ${HEX64}` },
    };
    const { gateway, sendMessage } = makeGateway([
      privateStart,
      groupUpdate(3, `/bind ${HEX64_B}`),
    ]);

    const result = await runTelegramPoll({ ledger, gateway, sha256 });

    expect(calls).toEqual([
      "processStart:2",
      "advanceCursor:2",
      "processBind:3",
      "advanceCursor:3",
    ]);
    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      chatId: 5,
      text: TELEGRAM_LINK_SUCCESS_MESSAGE,
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      chatId: -222,
      text: TELEGRAM_BIND_SUCCESS_MESSAGE,
    });
    expect(result).toMatchObject({
      kind: "ok",
      resultCodes: ["link_success", "bind_success"],
    });
  });
});

describe("TG-2F-C D — bot feedback discloses nothing", () => {
  const messages = [TELEGRAM_BIND_SUCCESS_MESSAGE, TELEGRAM_BIND_FAILURE_MESSAGE];

  it.each(messages)("%s contains no token, id, or internal reason", (message) => {
    expect(message).not.toMatch(/[0-9a-f]{16,}/i);
    expect(message).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(message).not.toContain("@");
    expect(message).not.toContain("telegram_");
    expect(message).not.toContain("recruiter_id");
  });

  it("keeps the link messages byte-identical to TG-2D", () => {
    expect(TELEGRAM_LINK_SUCCESS_MESSAGE).toBe(
      "Your Telegram account is now linked to HaulTracker Pro.",
    );
    expect(TELEGRAM_LINK_FAILURE_MESSAGE).toBe(
      "That link is invalid or expired. Generate a new Telegram link in HaulTracker Pro and try again.",
    );
  });
});

// ---------------------------------------------------------------------------
// E. Edge Function adapter
// ---------------------------------------------------------------------------

describe("TG-2F-C E — edge adapter delegates to the atomic RPC only", () => {
  it("calls telegram_process_bind_update and nothing else new", () => {
    const rpcs = [...EDGE_SOURCE.matchAll(/supabase\.rpc\("(\w+)"/g)].map((m) => m[1]);
    expect(rpcs.sort()).toEqual([
      "telegram_advance_poll_cursor",
      "telegram_claim_poll_lease",
      "telegram_process_bind_update",
      "telegram_process_start_update",
      "telegram_record_ignored_update",
      "telegram_release_poll_lease",
    ]);
  });

  it("never calls the consume RPC directly", () => {
    expect(EDGE_SOURCE).not.toContain("consume_telegram_dispatch_bind_token");
    expect(EDGE_SOURCE).not.toContain("telegram_bind_dispatch_chat");
  });

  it("passes every required bind argument", () => {
    const block = /telegram_process_bind_update[\s\S]*?\}\);/.exec(EDGE_SOURCE)?.[0] ?? "";
    for (const arg of [
      "_lease_token",
      "_update_id",
      "_payload_hash",
      "_telegram_user_id",
      "_telegram_chat_id",
      "_chat_type",
      "_raw_token",
    ]) {
      expect(block).toContain(arg);
    }
  });

  it("adds no secret, webhook, or direct Telegram host surface", () => {
    for (const forbidden of [
      "api.telegram.org",
      "setWebhook",
      "deleteWebhook",
      "secret_token",
      "bot_token",
    ]) {
      expect(EDGE_SOURCE).not.toContain(forbidden);
    }
  });

  it("never logs or returns the raw bind token", () => {
    const emitters = EDGE_SOURCE.match(/(?:json|log|console\.log)\([\s\S]*?\);/g) ?? [];
    expect(emitters.length).toBeGreaterThan(0);
    for (const emitter of emitters) {
      expect(emitter).not.toContain("rawToken");
      expect(emitter).not.toContain("_raw_token");
    }
  });
});

describe("TG-2F-C F — shared orchestrator holds no token or command surface", () => {
  it("never logs the raw token", () => {
    const logCalls = INGEST_SOURCE.match(/log\([\s\S]*?\);/g) ?? [];
    for (const call of logCalls) {
      expect(call).not.toContain("rawToken");
      expect(call).not.toContain("identity.text");
    }
  });

  it("adds no command beyond /start and /bind", () => {
    for (const forbidden of ["/load", "/status", "/help", "/unbind"]) {
      expect(INGEST_SOURCE).not.toContain(forbidden);
    }
  });

  it("adds no result code beyond bind_success and bind_rejected", () => {
    const codes = [...INGEST_SOURCE.matchAll(/"(bind_[a-z_]+)"/g)].map((m) => m[1]);
    expect([...new Set(codes)].sort()).toEqual(["bind_rejected", "bind_success"]);
  });
});

// ---------------------------------------------------------------------------
// G. Candidate SQL contract
// ---------------------------------------------------------------------------

describe("TG-2F-C G — candidate additively extends the result-code vocabulary", () => {
  it("replaces exactly the result_code check constraint", () => {
    expect(CANDIDATE_EXEC).toContain(
      "DROP CONSTRAINT telegram_update_receipts_result_code_check",
    );
    const drops = CANDIDATE_EXEC.match(/DROP CONSTRAINT/g) ?? [];
    expect(drops).toHaveLength(1);
  });

  it("preserves all six live TG-2D result codes", () => {
    for (const code of [
      "link_success",
      "link_rejected",
      "non_private_message",
      "non_start_message",
      "invalid_start_command",
      "invalid_update_shape",
    ]) {
      expect(CANDIDATE_EXEC).toContain(`'${code}'`);
    }
  });

  it("adds exactly bind_success and bind_rejected", () => {
    expect(CANDIDATE_EXEC).toContain("'bind_success'");
    expect(CANDIDATE_EXEC).toContain("'bind_rejected'");
  });

  it("alters no other table and drops nothing else", () => {
    const altered = [...CANDIDATE_EXEC.matchAll(/ALTER TABLE\s+([\w.]+)/g)].map((m) => m[1]);
    expect([...new Set(altered)]).toEqual(["public.telegram_update_receipts"]);
    expect(CANDIDATE_EXEC).not.toMatch(/DROP\s+(TABLE|FUNCTION|INDEX|POLICY|COLUMN)/i);
  });

  it("touches no receipt column, status constraint, cursor, or poll state table", () => {
    expect(CANDIDATE_EXEC).not.toMatch(/ADD COLUMN|ALTER COLUMN/i);
    expect(CANDIDATE_EXEC).not.toContain("telegram_update_receipts_status_check");
    expect(CANDIDATE_EXEC).not.toMatch(/UPDATE\s+public\.telegram_poll_state/i);
    expect(CANDIDATE_EXEC).not.toMatch(/CREATE TABLE/i);
  });
});

describe("TG-2F-C H — telegram_process_bind_update contract", () => {
  it("is created once with the exact signature", () => {
    const created = [...CANDIDATE_EXEC.matchAll(/CREATE FUNCTION\s+([\w.]+)/g)].map((m) => m[1]);
    expect(created).toEqual(["public.telegram_process_bind_update"]);
    expect(CANDIDATE_EXEC).not.toMatch(/CREATE OR REPLACE FUNCTION/i);
    for (const param of [
      "_lease_token uuid",
      "_update_id bigint",
      "_payload_hash text",
      "_telegram_user_id bigint",
      "_telegram_chat_id bigint",
      "_chat_type text",
      "_raw_token text",
    ]) {
      expect(CANDIDATE_EXEC).toContain(param);
    }
    expect(CANDIDATE_EXEC).toContain("RETURNS TABLE(is_new boolean, result_code text)");
  });

  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(CANDIDATE_EXEC).toContain("SECURITY DEFINER");
    expect(CANDIDATE_EXEC).toContain("SET search_path TO 'pg_catalog', 'public'");
  });

  it("validates every input before touching state", () => {
    for (const guard of [
      "_update_id <= 0",
      "_payload_hash !~ '^[0-9a-f]{64}$'",
      "_telegram_user_id <= 0",
      "_telegram_chat_id = 0",
      "_chat_type NOT IN ('group', 'supergroup')",
      "_raw_token !~ '^[0-9a-f]{64}$'",
      "RAISE EXCEPTION 'telegram_update_invalid'",
    ]) {
      expect(CANDIDATE_EXEC).toContain(guard);
    }
  });

  it("requires a live unexpired poll lease", () => {
    expect(CANDIDATE_EXEC).toContain("s.lease_token = _lease_token");
    expect(CANDIDATE_EXEC).toContain("s.lease_expires_at > now()");
    expect(CANDIDATE_EXEC).toContain("RAISE EXCEPTION 'telegram_poll_lease_invalid'");
  });

  it("locks the existing receipt and replays only exact bind terminals", () => {
    expect(CANDIDATE_EXEC).toContain("WHERE r.update_id = _update_id");
    expect(CANDIDATE_EXEC).toContain("FOR UPDATE");
    expect(CANDIDATE_EXEC).toContain("_existing.payload_hash = _payload_hash");
    expect(CANDIDATE_EXEC).toContain("_existing.status = 'processed'");
    expect(CANDIDATE_EXEC).toContain(
      "_existing.result_code = ANY (ARRAY['bind_success','bind_rejected'])",
    );
    expect(CANDIDATE_EXEC).toContain("is_new := false");
    expect(CANDIDATE_EXEC).toContain("RAISE EXCEPTION 'telegram_update_conflict'");
  });

  it("consumes through the existing TG-2F-B function only", () => {
    expect(CANDIDATE_EXEC).toContain("PERFORM public.consume_telegram_dispatch_bind_token(");
    expect(CANDIDATE_EXEC).not.toContain("public.telegram_bind_dispatch_chat(");
    expect(CANDIDATE_EXEC).not.toMatch(/INSERT INTO public\.telegram_chat_bindings/i);
    expect(CANDIDATE_EXEC).not.toMatch(
      /INSERT INTO public\.telegram_dispatch_bind_tokens|UPDATE public\.telegram_dispatch_bind_tokens/i,
    );
  });

  it("collapses exactly the eight expected P0001 outcomes to bind_rejected", () => {
    const block = /GET STACKED DIAGNOSTICS[\s\S]*?END;/.exec(CANDIDATE_EXEC)?.[0] ?? "";
    expect(block).toContain("_sqlstate = 'P0001'");
    const expected = [
      "telegram_dispatch_bind_invalid_input",
      "telegram_dispatch_bind_token_invalid",
      "telegram_bind_invalid_input",
      "telegram_actor_not_linked",
      "telegram_workspace_not_available",
      "telegram_dispatch_not_authorized",
      "telegram_chat_already_bound",
      "telegram_chat_bind_conflict",
    ];
    for (const code of expected) {
      expect(block).toContain(`'${code}'`);
    }
    const listed = [...block.matchAll(/'(telegram_[a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(listed)].sort()).toEqual([...expected].sort());
    expect(block).toContain("_outcome := 'bind_rejected'");
    expect(block).toContain("RAISE;");
  });

  it("writes one terminal processed receipt with no raw text or token", () => {
    const insert =
      /INSERT INTO public\.telegram_update_receipts[\s\S]*?\);/.exec(CANDIDATE_EXEC)?.[0] ?? "";
    expect(insert).toContain("'processed'");
    expect(insert).toContain("_outcome");
    expect(insert).not.toContain("_raw_token");
    expect(insert).not.toContain("text");
    const inserts = CANDIDATE_EXEC.match(/INSERT INTO/g) ?? [];
    expect(inserts).toHaveLength(1);
  });

  it("is executable by service_role only", () => {
    const sig =
      "public.telegram_process_bind_update(uuid, bigint, text, bigint, bigint, text, text)";
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(CANDIDATE_EXEC).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`);
    }
    expect(CANDIDATE_EXEC).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
    expect(CANDIDATE_EXEC).not.toMatch(/GRANT EXECUTE[^\n]*TO (anon|authenticated)/);
  });

  it("is wrapped in a single transaction", () => {
    expect(CANDIDATE_EXEC.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(CANDIDATE_EXEC.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("introduces no unrelated command, notification, or slug surface", () => {
    for (const forbidden of [
      "telegram_dispatch_create_driver_load",
      "notifications",
      "unbind",
      "slug",
      "cron",
    ]) {
      expect(CANDIDATE_EXEC.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("TG-2F-C I — candidate stays out of applied migrations", () => {
  it("lives under migration-candidates only", () => {
    expect(CANDIDATE_PATH.startsWith("supabase/migration-candidates/")).toBe(true);
  });
});
