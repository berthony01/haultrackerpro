// Phase RB-2B — recruiter Accept / Pass from the private Telegram alert.
//
// Four parts:
//   A. pure locator contract — compact, versioned, PII-free, fail-closed;
//   B. classification — a tap is never reinterpreted as a message command;
//   C. orchestration through the SHARED helper the Edge Function actually
//      calls, driven by injected fakes: exactly-once, answer-after-action,
//      answer failure cannot re-apply, inbound messages unaffected;
//   D. SQL + adapter source contract — canonical CF-1 reuse, server-derived
//      identity, private chat only, tenant safety, locked ACLs.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  TELEGRAM_ALERT_ACCEPT_LABEL,
  TELEGRAM_ALERT_PASS_LABEL,
  TELEGRAM_ALLOWED_UPDATES,
  TELEGRAM_CALLBACK_DATA_MAX_BYTES,
  TELEGRAM_CONVERSATION_ACTION_ANSWERS,
  TELEGRAM_CONVERSATION_ACTION_RESULT_CODES,
  classifyUpdate,
  composeConversationActionAnswer,
  composeConversationActionData,
  composeConversationAlertButtons,
  parseConversationActionData,
  runTelegramPoll,
  type TelegramGateway,
  type TelegramPollLedger,
  type TelegramResultCode,
  type TelegramTerminalResult,
} from "../../supabase/functions/_shared/telegram-poll-ingest.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const RB2B_SQL = read(
  "supabase/migration-candidates/20260918200000_phase_rb2b_telegram_conversation_action_callback.sql",
);
const ORCHESTRATOR_SOURCE = read(
  "supabase/functions/_shared/telegram-poll-ingest.ts",
);
const EDGE_SOURCE = read("supabase/functions/telegram-poll/index.ts");

const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RB2B_CODE = stripSqlComments(RB2B_SQL);
const ORCHESTRATOR_CODE = stripTsComments(ORCHESTRATOR_SOURCE);
const EDGE_CODE = stripTsComments(EDGE_SOURCE);

const THREAD_ID = "3a3b3c3d-1111-4e22-8f33-aabbccddeeff";

// ─────────────────────────── A. locator contract ───────────────────────────

describe("RB-2B A — the callback payload is a compact, PII-free locator", () => {
  it("1) round-trips both actions in the versioned compact form", () => {
    expect(composeConversationActionData("accept", THREAD_ID)).toBe(`c1:a:${THREAD_ID}`);
    expect(composeConversationActionData("pass", THREAD_ID)).toBe(`c1:p:${THREAD_ID}`);
    expect(parseConversationActionData(`c1:a:${THREAD_ID}`)).toEqual({
      action: "accept",
      threadId: THREAD_ID,
    });
    expect(parseConversationActionData(`c1:p:${THREAD_ID}`)).toEqual({
      action: "pass",
      threadId: THREAD_ID,
    });
  });

  it("2) stays inside Telegram's 64-byte callback_data limit", () => {
    for (const action of ["accept", "pass"] as const) {
      const data = composeConversationActionData(action, THREAD_ID);
      expect(new TextEncoder().encode(data).byteLength).toBeLessThanOrEqual(
        TELEGRAM_CALLBACK_DATA_MAX_BYTES,
      );
    }
  });

  it("3) carries no recruiter, workspace, account or driver identity", () => {
    const data = composeConversationActionData("accept", THREAD_ID);
    // Exactly three colon-separated parts: version, action letter, locator.
    expect(data.split(":")).toHaveLength(3);
    expect(data.replace(`c1:a:${THREAD_ID}`, "")).toBe("");
    expect(data).not.toMatch(/@|recruiter|driver|user|workspace|email|phone/i);
  });

  it("4) fails closed on every malformed, unknown or hostile payload", () => {
    for (const bad of [
      null,
      undefined,
      42,
      {},
      "",
      "c1:a:",
      "c1:x:" + THREAD_ID,
      "c2:a:" + THREAD_ID,
      "c1:a:not-a-uuid",
      `c1:a:${THREAD_ID} `,
      ` c1:a:${THREAD_ID}`,
      `c1:a:${THREAD_ID};DROP TABLE conversation_threads`,
      `c1:a:${THREAD_ID.toUpperCase()}`,
      `c1:a:${THREAD_ID}:extra`,
    ]) {
      expect(parseConversationActionData(bad)).toBeNull();
    }
  });

  it("5) alert buttons pair callback actions with a URL-only inbox link", () => {
    const rows = composeConversationAlertButtons("https://x.test/inbox", THREAD_ID);
    expect(rows).toEqual([
      [
        { text: TELEGRAM_ALERT_ACCEPT_LABEL, callbackData: `c1:a:${THREAD_ID}` },
        { text: TELEGRAM_ALERT_PASS_LABEL, callbackData: `c1:p:${THREAD_ID}` },
      ],
      [{ text: "Open Conversations", url: "https://x.test/inbox" }],
    ]);
  });

  it("6) every answer is a fixed, bounded, privacy-safe string", () => {
    expect([...TELEGRAM_CONVERSATION_ACTION_RESULT_CODES].sort()).toEqual([
      "conversation_accepted",
      "conversation_action_denied",
      "conversation_action_invalid",
      "conversation_action_unavailable",
      "conversation_already_handled",
      "conversation_passed",
    ]);
    for (const code of TELEGRAM_CONVERSATION_ACTION_RESULT_CODES) {
      const answer = TELEGRAM_CONVERSATION_ACTION_ANSWERS[code];
      expect(answer.length).toBeGreaterThan(0);
      expect(answer.length).toBeLessThanOrEqual(200);
      expect(answer).not.toMatch(/@|http|\+1|uuid|[0-9a-f]{8}-/i);
      expect(composeConversationActionAnswer(code)).toBe(answer);
    }
    // An unexpected code can never leak raw text back to Telegram.
    expect(composeConversationActionAnswer("link_success" as TelegramResultCode)).toBe(
      TELEGRAM_CONVERSATION_ACTION_ANSWERS.conversation_action_invalid,
    );
  });
});

// ───────────────────────────── B. classification ─────────────────────────────

const callbackIdentity = (over: Record<string, unknown> = {}) => ({
  updateId: 1,
  telegramUserId: 999,
  telegramChatId: 999,
  chatType: "private",
  text: null,
  callbackQueryId: "cbq-1",
  callbackData: `c1:a:${THREAD_ID}`,
  ...over,
});

describe("RB-2B B — a tap is classified as an action, never as a command", () => {
  it("1) a valid private accept tap routes to the action processor", () => {
    expect(classifyUpdate(callbackIdentity())).toEqual({
      kind: "conversation_action",
      action: "accept",
      threadId: THREAD_ID,
      chatType: "private",
    });
  });

  it("2) a valid private pass tap routes to the action processor", () => {
    expect(
      classifyUpdate(callbackIdentity({ callbackData: `c1:p:${THREAD_ID}` })),
    ).toEqual({
      kind: "conversation_action",
      action: "pass",
      threadId: THREAD_ID,
      chatType: "private",
    });
  });

  it("3) a group tap still routes to the processor, which denies it", () => {
    // Classification does NOT decide authority. The chat type is carried
    // through so the database records a proper callback receipt and denies.
    expect(classifyUpdate(callbackIdentity({ chatType: "supergroup" }))).toEqual({
      kind: "conversation_action",
      action: "accept",
      threadId: THREAD_ID,
      chatType: "supergroup",
    });
  });

  it("4) malformed payloads reach the processor with a null action", () => {
    expect(classifyUpdate(callbackIdentity({ callbackData: "nonsense" }))).toEqual({
      kind: "conversation_action",
      action: null,
      threadId: null,
      chatType: "private",
    });
  });

  it("5) an unusable tap shape is ignored, never acted on", () => {
    expect(classifyUpdate(callbackIdentity({ telegramUserId: null }))).toEqual({
      kind: "ignored",
      resultCode: "invalid_update_shape",
    });
  });

  it("6) callback text is never reinterpreted as a message command", () => {
    // Even if a payload mimics a command, the tap path wins and no start,
    // bind or menu classification is possible.
    expect(
      classifyUpdate(callbackIdentity({ callbackData: "/start", text: "/start" })).kind,
    ).toBe("conversation_action");
  });

  it("7) an ordinary message is completely unaffected", () => {
    expect(
      classifyUpdate({
        updateId: 2,
        telegramUserId: 999,
        telegramChatId: 999,
        chatType: "private",
        text: "/menu",
      }),
    ).toEqual({ kind: "menu", command: "menu" });
  });
});

// ───────────────────────────── C. orchestration ─────────────────────────────

const sha256 = async (input: string) =>
  [...input].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(64, "0");

const callbackUpdate = (updateId: number, data = `c1:a:${THREAD_ID}`) => ({
  update_id: updateId,
  callback_query: {
    id: `cbq-${updateId}`,
    from: { id: 555 },
    message: { chat: { id: 555, type: "private" } },
    data,
  },
});

const messageUpdate = (updateId: number, text: string) => ({
  update_id: updateId,
  message: { from: { id: 555 }, chat: { id: 555, type: "private" }, text },
});

interface Harness {
  ledger: TelegramPollLedger;
  gateway: TelegramGateway;
  actions: Record<string, unknown>[];
  answers: { callbackQueryId: string; text: string }[];
  messages: { chatId: number; text: string }[];
  receipts: Map<number, TelegramResultCode>;
}

function makeHarness(options: {
  updates: unknown[];
  outcome?: (input: { action: string | null }) => TelegramResultCode;
  answerFails?: "error" | "throw" | null;
  omitActionProcessor?: boolean;
}): Harness {
  const actions: Record<string, unknown>[] = [];
  const answers: { callbackQueryId: string; text: string }[] = [];
  const messages: { chatId: number; text: string }[] = [];
  const receipts = new Map<number, TelegramResultCode>();

  const terminal = (
    updateId: number,
    resultCode: TelegramResultCode,
  ): TelegramTerminalResult => {
    // Mirrors the database: the receipt is keyed on update_id, so a duplicate
    // delivery replays the recorded outcome and performs no action.
    if (receipts.has(updateId)) {
      return { isNew: false, resultCode: receipts.get(updateId) as TelegramResultCode };
    }
    receipts.set(updateId, resultCode);
    return { isNew: true, resultCode };
  };

  const ledger: TelegramPollLedger = {
    claimLease: async () => ({ leaseToken: "lease", nextOffset: 1 }),
    releaseLease: async () => true,
    advanceCursor: async (_t, id) => id,
    recordIgnoredUpdate: async ({ updateId }) =>
      terminal(updateId, "non_start_message"),
    processStartUpdate: async ({ updateId }) => terminal(updateId, "link_success"),
    processBindUpdate: async ({ updateId }) => terminal(updateId, "bind_success"),
    processMenuUpdate: async ({ updateId }) => ({
      ...terminal(updateId, "menu_recruiter"),
      menuText: "menu",
      menuButtons: null,
    }),
  };

  if (!options.omitActionProcessor) {
    ledger.processConversationActionUpdate = async (input) => {
      const replayed = receipts.has(input.updateId);
      if (!replayed) actions.push({ ...input });
      const code = options.outcome
        ? options.outcome({ action: input.action })
        : input.action === "accept"
        ? "conversation_accepted"
        : "conversation_passed";
      return terminal(input.updateId, code as TelegramResultCode);
    };
  }

  const gateway: TelegramGateway = {
    getUpdates: async () => ({ ok: true, status: 200, result: options.updates }),
    sendMessage: async ({ chatId, text }) => {
      messages.push({ chatId, text });
      return { ok: true, status: 200 };
    },
    answerCallbackQuery: async (input) => {
      if (options.answerFails === "throw") throw new Error("telegram_down");
      answers.push(input);
      return options.answerFails === "error"
        ? { ok: false, status: 502, errorCode: "telegram_bot_api_error" }
        : { ok: true, status: 200 };
    },
  };

  return { ledger, gateway, actions, answers, messages, receipts };
}

describe("RB-2B C — orchestration is exactly-once and answer-independent", () => {
  it("1) a valid accept tap performs one action and answers the tap", async () => {
    const h = makeHarness({ updates: [callbackUpdate(10)] });
    const result = await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(result).toMatchObject({
      kind: "ok",
      processed: 1,
      resultCodes: ["conversation_accepted"],
    });
    expect(h.actions).toHaveLength(1);
    expect(h.actions[0]).toMatchObject({
      action: "accept",
      threadId: THREAD_ID,
      chatType: "private",
      telegramUserId: 555,
      telegramChatId: 555,
    });
    // No recruiter, workspace or account id is ever sent from the runtime.
    expect(Object.keys(h.actions[0]).sort()).toEqual([
      "action",
      "chatType",
      "leaseToken",
      "payloadHash",
      "telegramChatId",
      "telegramUserId",
      "threadId",
      "updateId",
    ]);
    expect(h.answers).toEqual([
      {
        callbackQueryId: "cbq-10",
        text: TELEGRAM_CONVERSATION_ACTION_ANSWERS.conversation_accepted,
      },
    ]);
    // A tap is answered, never replied to with a new chat message.
    expect(h.messages).toHaveLength(0);
  });

  it("2) a pass tap uses the pass action and its own answer", async () => {
    const h = makeHarness({ updates: [callbackUpdate(11, `c1:p:${THREAD_ID}`)] });
    await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(h.actions[0]).toMatchObject({ action: "pass", threadId: THREAD_ID });
    expect(h.answers[0].text).toBe(
      TELEGRAM_CONVERSATION_ACTION_ANSWERS.conversation_passed,
    );
  });

  it("3) a duplicate delivery of the same update never re-acts", async () => {
    const h = makeHarness({ updates: [callbackUpdate(12), callbackUpdate(12)] });
    const result = await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(result).toMatchObject({ kind: "ok", processed: 2 });
    // One action, but both deliveries are answered so no spinner is left hung.
    expect(h.actions).toHaveLength(1);
    expect(h.answers).toHaveLength(2);
    expect(h.answers[1].text).toBe(
      TELEGRAM_CONVERSATION_ACTION_ANSWERS.conversation_accepted,
    );
  });

  it("4) a repeated tap on an already handled conversation never re-acts", async () => {
    const h = makeHarness({
      updates: [callbackUpdate(13), callbackUpdate(14)],
      outcome: () => "conversation_already_handled",
    });
    await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    // The second tap is a distinct update, so the processor is consulted
    // again — and the database, not the runtime, reports "already handled".
    expect(h.actions).toHaveLength(2);
    expect(h.answers.map((a) => a.text)).toEqual([
      TELEGRAM_CONVERSATION_ACTION_ANSWERS.conversation_already_handled,
      TELEGRAM_CONVERSATION_ACTION_ANSWERS.conversation_already_handled,
    ]);
  });

  it("5) an answer failure after a successful action never repeats it", async () => {
    for (const mode of ["error", "throw"] as const) {
      const h = makeHarness({ updates: [callbackUpdate(15)], answerFails: mode });
      const result = await runTelegramPoll({
        ledger: h.ledger,
        gateway: h.gateway,
        sha256,
      });
      // The action is committed, the cursor still advances, and the update is
      // never retried, so the mutation cannot be applied twice.
      expect(result).toMatchObject({ kind: "ok", processed: 1, advancedTo: 15 });
      expect(h.actions).toHaveLength(1);
    }
  });

  it("6) a failing action leaves the cursor pinned and records no success", async () => {
    const h = makeHarness({ updates: [callbackUpdate(16), callbackUpdate(17)] });
    h.ledger.processConversationActionUpdate = async () => {
      throw new Error("db_unavailable");
    };
    const result = await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(result).toMatchObject({
      kind: "failed",
      errorCode: "db_unavailable",
      processed: 0,
      advancedTo: null,
    });
    expect(h.answers).toHaveLength(0);
  });

  it("7) fails closed when no action processor is wired", async () => {
    const h = makeHarness({ updates: [callbackUpdate(18)], omitActionProcessor: true });
    const result = await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(result).toMatchObject({
      kind: "failed",
      errorCode: "telegram_conversation_action_processor_unavailable",
      processed: 0,
    });
    expect(h.answers).toHaveLength(0);
  });

  it("8) a malformed tap is recorded and answered without any action", async () => {
    const h = makeHarness({
      updates: [callbackUpdate(19, "totally-bogus")],
      outcome: () => "conversation_action_invalid",
    });
    await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(h.actions[0]).toMatchObject({ action: null, threadId: null });
    expect(h.answers[0].text).toBe(
      TELEGRAM_CONVERSATION_ACTION_ANSWERS.conversation_action_invalid,
    );
  });

  it("9) inbound message commands still work alongside taps", async () => {
    const h = makeHarness({
      updates: [messageUpdate(20, "/menu"), callbackUpdate(21), messageUpdate(22, "/status")],
    });
    const result = await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(result).toMatchObject({
      kind: "ok",
      processed: 3,
      advancedTo: 22,
      resultCodes: ["menu_recruiter", "conversation_accepted", "menu_recruiter"],
    });
    expect(h.messages).toHaveLength(2);
    expect(h.answers).toHaveLength(1);
  });

  it("10) a tap requests exactly the two allowed update types", async () => {
    const h = makeHarness({ updates: [] });
    const spy = vi.spyOn(h.gateway, "getUpdates");
    await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(spy.mock.calls[0][0].allowed_updates).toEqual([
      ...TELEGRAM_ALLOWED_UPDATES,
    ]);
    expect([...TELEGRAM_ALLOWED_UPDATES]).toEqual(["message", "callback_query"]);
  });
});

// ──────────────────── D. SQL + adapter source contract ────────────────────

describe("RB-2B D — the database owns authority, CF-1 owns the transition", () => {
  it("1) is one narrow transaction adding exactly two functions", () => {
    const lines = RB2B_CODE.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines[0]).toBe("BEGIN;");
    expect(lines[lines.length - 1]).toBe("COMMIT;");
    expect(lines.filter((l) => l === "BEGIN;")).toHaveLength(1);
    const created = [...RB2B_CODE.matchAll(/CREATE FUNCTION public\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(created.sort()).toEqual([
      "telegram_claim_conversation_alerts",
      "telegram_process_conversation_action_update",
    ]);
  });

  it("2) creates no new table, policy or conversation architecture", () => {
    for (const forbidden of [
      "CREATE TABLE",
      "CREATE POLICY",
      "DROP POLICY",
      "DROP TABLE",
      "ENABLE ROW LEVEL SECURITY",
      "CREATE TYPE",
      "INSERT INTO public.conversation_",
      "UPDATE public.conversation_threads",
      "DELETE FROM public.conversation_",
    ]) {
      expect(RB2B_CODE).not.toContain(forbidden);
    }
    // The ONLY altered table is the receipt ledger's own check constraints.
    const altered = [...RB2B_CODE.matchAll(/ALTER TABLE public\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(altered)]).toEqual(["telegram_update_receipts"]);
  });

  it("3) delegates every state transition to the canonical CF-1 functions", () => {
    expect(RB2B_CODE).toContain("public.accept_conversation_thread(_thread_id)");
    expect(RB2B_CODE).toContain("public.decline_conversation_thread(_thread_id)");
    expect(RB2B_CODE).toContain("public.current_user_can_conversation_action(");
    // No parallel state machine: the migration never writes a thread status.
    expect(RB2B_CODE).not.toMatch(/status\s*=\s*'active'/);
    expect(RB2B_CODE).not.toMatch(/status\s*=\s*'declined'/);
  });

  it("4) derives the actor and never accepts one from Telegram", () => {
    expect(RB2B_CODE).toContain("FROM public.telegram_user_links l");
    expect(RB2B_CODE).toContain("AND l.status = 'active'");
    expect(RB2B_CODE).toContain(
      "PERFORM pg_catalog.set_config(\n          'request.jwt.claim.sub', _actor_user_id::text, true)",
    );
    // No caller-supplied identity parameter exists at all.
    const signature = RB2B_CODE.split(
      "CREATE FUNCTION public.telegram_process_conversation_action_update(",
    )[1].split(")")[0];
    expect(signature).not.toMatch(/_recruiter_id|_user_id uuid|_actor|_driver/);
  });

  it("5) is private-chat only and tenant-safe against a guessed locator", () => {
    expect(RB2B_CODE).toContain("_chat_type IS DISTINCT FROM 'private'");
    expect(RB2B_CODE).toContain("_linked_chat_id IS DISTINCT FROM _telegram_chat_id");
    // An alert must already have been addressed to this account for this
    // conversation, so a copied uuid from another workspace grants nothing.
    expect(RB2B_CODE).toContain("FROM public.telegram_conversation_alerts a");
    expect(RB2B_CODE).toContain("AND a.recipient_user_id = _actor_user_id");
    expect(RB2B_CODE).toContain("_t.driver_user_id = _actor_user_id");
  });

  it("6) writes the terminal receipt in the same transaction as the action", () => {
    expect(RB2B_CODE).toContain("INSERT INTO public.telegram_update_receipts");
    expect(RB2B_CODE).toContain("'callback_query',");
    // Duplicate delivery replays the recorded outcome instead of re-acting.
    expect(RB2B_CODE).toContain("is_new := false;");
    expect(RB2B_CODE).toContain("RAISE EXCEPTION 'telegram_update_conflict'");
    expect(RB2B_CODE).toContain("telegram_poll_lease_invalid");
  });

  it("7) both functions are service-role only", () => {
    const fns = [
      "public.telegram_claim_conversation_alerts(integer)",
      "public.telegram_process_conversation_action_update(uuid, bigint, text, bigint, bigint, text, text, uuid)",
    ];
    for (const fn of fns) {
      expect(RB2B_CODE).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role`);
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(RB2B_CODE).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM ${role}`);
      }
    }
    expect(RB2B_CODE).not.toMatch(/GRANT EXECUTE ON FUNCTION[^;]*TO (anon|authenticated)/);
    expect(RB2B_CODE).toContain("SECURITY DEFINER");
  });

  it("8) the runtime adds one callback path and no second bot surface", () => {
    expect(EDGE_CODE).toContain("telegram_process_conversation_action_update");
    expect(EDGE_CODE).toContain("answerCallbackQuery");
    for (const forbidden of [
      "setWebhook",
      "deleteWebhook",
      "editMessageReplyMarkup",
      "sendPhoto",
      "getMe(",
    ]) {
      expect(EDGE_CODE).not.toContain(forbidden);
    }
    // The tap answer is best-effort and strictly after the terminal result.
    const orchestrator = ORCHESTRATOR_CODE.split("runTelegramPoll")[1] ?? "";
    expect(orchestrator.indexOf("answerCallbackQuery")).toBeGreaterThan(
      orchestrator.indexOf("resultCodes.push(terminal.resultCode)"),
    );
  });

  it("9) no driver identity or contact data is representable in the runtime", () => {
    for (const forbidden of [
      "driver_user_id",
      "driver_email",
      "phone",
      "profiles",
      "conversation_messages",
    ]) {
      expect(EDGE_CODE).not.toContain(forbidden);
    }
  });
});
