// Phase RB-2C — recruiter Telegram reply → existing CF-1 conversation message.
//
// Four parts:
//   A. classification — a reply is routed ONLY when Telegram says it is a
//      reply, and never in place of an existing command;
//   B. orchestration through the SHARED helper the Edge Function actually
//      calls: exactly-once, acknowledgement-independent, fail-closed;
//   C. alert mapping — the delivered Telegram message id is persisted only on
//      a confirmed send, and the alert copy explains the only routing that
//      works;
//   D. SQL + adapter source contract — canonical CF-1 reuse, server-derived
//      identity, private chat only, tenant safety, locked ACLs, no PII.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  TELEGRAM_ALERT_REPLY_HINT,
  TELEGRAM_ALLOWED_UPDATES,
  TELEGRAM_CONVERSATION_REPLY_ANSWERS,
  TELEGRAM_CONVERSATION_REPLY_RESULT_CODES,
  classifyUpdate,
  composeConversationAlertText,
  isConversationReplyResultCode,
  runTelegramAlertDrain,
  runTelegramPoll,
  type TelegramAlertOutbox,
  type TelegramGateway,
  type TelegramPollLedger,
  type TelegramResultCode,
  type TelegramTerminalResult,
} from "../../supabase/functions/_shared/telegram-poll-ingest.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const RB2C_SQL = read(
  "supabase/migration-candidates/20260919040000_phase_rb2c_telegram_conversation_reply_bridge.sql",
);
const ORCHESTRATOR_SOURCE = read(
  "supabase/functions/_shared/telegram-poll-ingest.ts",
);
const EDGE_SOURCE = read("supabase/functions/telegram-poll/index.ts");

const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RB2C_CODE = stripSqlComments(RB2C_SQL);
const ORCHESTRATOR_CODE = stripTsComments(ORCHESTRATOR_SOURCE);
const EDGE_CODE = stripTsComments(EDGE_SOURCE);

const THREAD_ID = "3a3b3c3d-1111-4e22-8f33-aabbccddeeff";

// ───────────────────────────── A. classification ─────────────────────────────

const messageIdentity = (over: Record<string, unknown> = {}) => ({
  updateId: 1,
  telegramUserId: 555,
  telegramChatId: 555,
  chatType: "private",
  text: "Thanks, when can you start?",
  replyToMessageId: 4242,
  ...over,
});

describe("RB-2C A — free text routes ONLY as an explicit reply to an alert", () => {
  it("1) a private reply with plain text becomes a conversation reply", () => {
    expect(classifyUpdate(messageIdentity())).toEqual({
      kind: "conversation_reply",
      replyToMessageId: 4242,
      text: "Thanks, when can you start?",
    });
  });

  it("2) free text that is NOT a reply is never routed as a conversation reply", () => {
    // RB-3A re-pin: non-reply private text is now offered to the Quick Post
    // SOURCE processor, which records the unchanged `non_start_message`
    // outcome unless the acting account holds a live awaiting-input draft.
    // The RB-2C invariant under test is unchanged and asserted exactly: this
    // text must NEVER become a conversation reply.
    for (const replyToMessageId of [null, undefined, 0, -1]) {
      const classification = classifyUpdate(messageIdentity({ replyToMessageId }));
      expect(classification).toEqual({
        kind: "quick_post_source",
        text: "Thanks, when can you start?",
      });
      expect(classification.kind).not.toBe("conversation_reply");
    }
  });

  it("3) command precedence is completely unchanged", () => {
    // Even when the recruiter replies to the alert, a command stays a command.
    expect(classifyUpdate(messageIdentity({ text: "/menu" }))).toEqual({
      kind: "menu",
      command: "menu",
    });
    expect(classifyUpdate(messageIdentity({ text: "/status" }))).toEqual({
      kind: "menu",
      command: "status",
    });
    expect(classifyUpdate(messageIdentity({ text: `/start ${"a".repeat(64)}` }))).toEqual({
      kind: "start",
      rawToken: "a".repeat(64),
    });
    // RB-1B: a bare /start is the account home, and stays so.
    expect(classifyUpdate(messageIdentity({ text: "/start" })).kind).toBe("menu");
    expect(classifyUpdate(messageIdentity({ text: "/start oops" }))).toEqual({
      kind: "ignored",
      resultCode: "invalid_start_command",
    });
  });

  it("4) no slash-prefixed text is ever routed as conversation text", () => {
    for (const text of ["/bind abc", "/whatever", "/", "/start@HaulTrackerBot"]) {
      expect(classifyUpdate(messageIdentity({ text })).kind).not.toBe(
        "conversation_reply",
      );
    }
  });

  it("5) a group reply is never a conversation reply", () => {
    expect(classifyUpdate(messageIdentity({ chatType: "supergroup" }))).toEqual({
      kind: "ignored",
      resultCode: "non_private_message",
    });
  });

  it("6) an unusable update shape is ignored, never routed", () => {
    expect(classifyUpdate(messageIdentity({ telegramUserId: null }))).toEqual({
      kind: "ignored",
      resultCode: "invalid_update_shape",
    });
  });

  it("7) media, stickers and other non-text replies are never routed", () => {
    // parseIdentity yields text: null for any non-text message type.
    expect(classifyUpdate(messageIdentity({ text: null }))).toEqual({
      kind: "ignored",
      resultCode: "non_start_message",
    });
  });

  it("8) every reply outcome is a fixed, bounded, privacy-safe string", () => {
    expect([...TELEGRAM_CONVERSATION_REPLY_RESULT_CODES].sort()).toEqual([
      "conversation_reply_denied",
      "conversation_reply_invalid",
      "conversation_reply_sent",
      "conversation_reply_unavailable",
      "conversation_reply_unroutable",
    ]);
    for (const code of TELEGRAM_CONVERSATION_REPLY_RESULT_CODES) {
      const answer = TELEGRAM_CONVERSATION_REPLY_ANSWERS[code];
      expect(answer.length).toBeGreaterThan(0);
      expect(answer.length).toBeLessThanOrEqual(200);
      expect(answer).not.toMatch(/@|http|\+1|[0-9a-f]{8}-/i);
      expect(isConversationReplyResultCode(code)).toBe(true);
    }
    expect(isConversationReplyResultCode("link_success" as TelegramResultCode)).toBe(
      false,
    );
  });
});

// ───────────────────────────── B. orchestration ─────────────────────────────

const sha256 = async (input: string) =>
  [...input].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(64, "0");

const replyUpdate = (
  updateId: number,
  text = "Sounds good, call me tomorrow.",
  over: Record<string, unknown> = {},
) => ({
  update_id: updateId,
  message: {
    from: { id: 555 },
    chat: { id: 555, type: "private" },
    text,
    reply_to_message: { message_id: 4242 },
    ...over,
  },
});

const plainUpdate = (updateId: number, text: string) => ({
  update_id: updateId,
  message: { from: { id: 555 }, chat: { id: 555, type: "private" }, text },
});

interface Harness {
  ledger: TelegramPollLedger;
  gateway: TelegramGateway;
  replies: Record<string, unknown>[];
  ignored: number[];
  messages: { chatId: number; text: string }[];
}

function makeHarness(options: {
  updates: unknown[];
  outcome?: TelegramResultCode;
  sendFails?: "error" | "throw" | null;
  omitReplyProcessor?: boolean;
}): Harness {
  const replies: Record<string, unknown>[] = [];
  const ignored: number[] = [];
  const messages: { chatId: number; text: string }[] = [];
  const receipts = new Map<number, TelegramResultCode>();

  const terminal = (
    updateId: number,
    resultCode: TelegramResultCode,
  ): TelegramTerminalResult => {
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
    recordIgnoredUpdate: async ({ updateId }) => {
      ignored.push(updateId);
      return terminal(updateId, "non_start_message");
    },
    processStartUpdate: async ({ updateId }) => terminal(updateId, "link_success"),
    processBindUpdate: async ({ updateId }) => terminal(updateId, "bind_success"),
    processMenuUpdate: async ({ updateId }) => ({
      ...terminal(updateId, "menu_recruiter"),
      menuText: "menu",
      menuButtons: null,
    }),
  };

  if (!options.omitReplyProcessor) {
    ledger.processConversationReplyUpdate = async (input) => {
      // Mirrors the database: the message write and the receipt share one
      // transaction, so a replayed update performs no second write.
      const replayed = receipts.has(input.updateId);
      if (!replayed) replies.push({ ...input });
      return terminal(input.updateId, options.outcome ?? "conversation_reply_sent");
    };
  }

  const gateway: TelegramGateway = {
    getUpdates: async () => ({ ok: true, status: 200, result: options.updates }),
    sendMessage: async ({ chatId, text }) => {
      if (options.sendFails === "throw") throw new Error("telegram_down");
      messages.push({ chatId, text });
      return options.sendFails === "error"
        ? { ok: false, status: 502, errorCode: "telegram_bot_api_error" }
        : { ok: true, status: 200, result: { message_id: 9001 } };
    },
    answerCallbackQuery: async () => ({ ok: true, status: 200 }),
  };

  return { ledger, gateway, replies, ignored, messages };
}

describe("RB-2C B — orchestration is exactly-once and acknowledgement-independent", () => {
  it("1) a valid reply reaches the processor with only transport inputs", async () => {
    const h = makeHarness({ updates: [replyUpdate(30)] });
    const result = await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(result).toMatchObject({
      kind: "ok",
      processed: 1,
      resultCodes: ["conversation_reply_sent"],
    });
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toMatchObject({
      telegramUserId: 555,
      telegramChatId: 555,
      chatType: "private",
      replyToMessageId: 4242,
      text: "Sounds good, call me tomorrow.",
    });
    // No thread, recruiter, workspace or driver identity is sent by the runtime.
    expect(Object.keys(h.replies[0]).sort()).toEqual([
      "chatType",
      "leaseToken",
      "payloadHash",
      "replyToMessageId",
      "telegramChatId",
      "telegramUserId",
      "text",
      "updateId",
    ]);
    expect(h.messages[0].text).toBe(
      TELEGRAM_CONVERSATION_REPLY_ANSWERS.conversation_reply_sent,
    );
  });

  it("2) a duplicate delivery creates exactly one conversation message", async () => {
    const h = makeHarness({ updates: [replyUpdate(31), replyUpdate(31)] });
    const result = await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(result).toMatchObject({ kind: "ok", processed: 2 });
    expect(h.replies).toHaveLength(1);
    // The replayed delivery is not acknowledged a second time.
    expect(h.messages).toHaveLength(1);
  });

  it("3) an acknowledgement failure after a committed write cannot reapply it", async () => {
    for (const mode of ["error", "throw"] as const) {
      const h = makeHarness({ updates: [replyUpdate(32)], sendFails: mode });
      const result = await runTelegramPoll({
        ledger: h.ledger,
        gateway: h.gateway,
        sha256,
      });
      expect(result).toMatchObject({ kind: "ok", processed: 1, advancedTo: 32 });
      expect(h.replies).toHaveLength(1);
    }
  });

  it("4) a failing write records no success and pins the cursor", async () => {
    const h = makeHarness({ updates: [replyUpdate(33), replyUpdate(34)] });
    h.ledger.processConversationReplyUpdate = async () => {
      throw new Error("db_unavailable");
    };
    const result = await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(result).toMatchObject({
      kind: "failed",
      errorCode: "db_unavailable",
      processed: 0,
      advancedTo: null,
    });
    expect(h.messages).toHaveLength(0);
  });

  it("5) fails closed when no reply processor is wired", async () => {
    const h = makeHarness({ updates: [replyUpdate(35)], omitReplyProcessor: true });
    const result = await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(result).toMatchObject({
      kind: "failed",
      errorCode: "telegram_conversation_reply_processor_unavailable",
      processed: 0,
    });
    expect(h.replies).toHaveLength(0);
  });

  it("6) an unroutable reply gets bounded guidance and touches no thread", async () => {
    const h = makeHarness({
      updates: [replyUpdate(36)],
      outcome: "conversation_reply_unroutable",
    });
    await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(h.messages[0].text).toBe(
      "To message a driver, reply directly to that conversation alert.",
    );
  });

  it("7) each denial outcome answers with its own fixed copy", async () => {
    for (const code of [
      "conversation_reply_denied",
      "conversation_reply_unavailable",
      "conversation_reply_invalid",
    ] as const) {
      const h = makeHarness({ updates: [replyUpdate(40)], outcome: code });
      await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
      expect(h.messages[0].text).toBe(TELEGRAM_CONVERSATION_REPLY_ANSWERS[code]);
      expect(h.messages[0].text).not.toContain("Sounds good");
    }
  });

  it("8) non-reply free text is recorded as ignored and never routed", async () => {
    const h = makeHarness({ updates: [plainUpdate(41, "hello there")] });
    const result = await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(result).toMatchObject({ resultCodes: ["non_start_message"] });
    expect(h.replies).toHaveLength(0);
    expect(h.ignored).toEqual([41]);
  });

  it("9) commands and replies coexist without regression", async () => {
    const h = makeHarness({
      updates: [plainUpdate(50, "/menu"), replyUpdate(51), plainUpdate(52, "/status")],
    });
    const result = await runTelegramPoll({ ledger: h.ledger, gateway: h.gateway, sha256 });
    expect(result).toMatchObject({
      kind: "ok",
      processed: 3,
      advancedTo: 52,
      resultCodes: ["menu_recruiter", "conversation_reply_sent", "menu_recruiter"],
    });
    expect(h.replies).toHaveLength(1);
  });

  it("10) the allowed update vocabulary is unchanged", () => {
    expect([...TELEGRAM_ALLOWED_UPDATES]).toEqual(["message", "callback_query"]);
  });
});

// ───────────────────────── C. alert → message mapping ─────────────────────────

describe("RB-2C C — the reply locator is persisted only on a confirmed send", () => {
  const claim = {
    alertId: "11111111-2222-4333-8444-555555555555",
    threadId: THREAD_ID,
    telegramChatId: 555,
    opportunityTitle: "Regional dry van",
  };

  const makeOutbox = (recorded: unknown[], failed: unknown[]): TelegramAlertOutbox => ({
    claimConversationAlerts: async () => [claim],
    markConversationAlertSent: async (alertId, messageId, chatId) => {
      recorded.push({ alertId, messageId, chatId });
    },
    markConversationAlertFailed: async (alertId, errorCode) => {
      failed.push({ alertId, errorCode });
    },
  });

  it("1) stores the delivered Telegram message id and chat", async () => {
    const recorded: unknown[] = [];
    const failed: unknown[] = [];
    const gateway = {
      getUpdates: async () => ({ ok: true, status: 200, result: [] }),
      sendMessage: async () => ({ ok: true, status: 200, result: { message_id: 7777 } }),
      answerCallbackQuery: async () => ({ ok: true, status: 200 }),
    } as TelegramGateway;

    const result = await runTelegramAlertDrain({
      outbox: makeOutbox(recorded, failed),
      gateway,
      conversationsUrl: "https://x.test/inbox",
    });
    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(recorded).toEqual([
      { alertId: claim.alertId, messageId: 7777, chatId: 555 },
    ]);
  });

  it("2) records no locator and no delivery when the send fails", async () => {
    const recorded: unknown[] = [];
    const failed: unknown[] = [];
    const gateway = {
      getUpdates: async () => ({ ok: true, status: 200, result: [] }),
      sendMessage: async () => ({ ok: false, status: 502, errorCode: "telegram_bot_api_error" }),
      answerCallbackQuery: async () => ({ ok: true, status: 200 }),
    } as TelegramGateway;

    const result = await runTelegramAlertDrain({
      outbox: makeOutbox(recorded, failed),
      gateway,
      conversationsUrl: "https://x.test/inbox",
    });
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(recorded).toHaveLength(0);
  });

  it("3) an absent or unusable message id degrades to null, never a guess", async () => {
    for (const bad of [undefined, 0, -3, 1.5, "7777"]) {
      const recorded: unknown[] = [];
      const gateway = {
        getUpdates: async () => ({ ok: true, status: 200, result: [] }),
        sendMessage: async () => ({
          ok: true,
          status: 200,
          result: { message_id: bad as number | undefined },
        }),
        answerCallbackQuery: async () => ({ ok: true, status: 200 }),
      } as TelegramGateway;
      await runTelegramAlertDrain({
        outbox: makeOutbox(recorded, []),
        gateway,
        conversationsUrl: "https://x.test/inbox",
      });
      expect(recorded).toEqual([
        { alertId: claim.alertId, messageId: null, chatId: 555 },
      ]);
    }
  });

  it("4) the alert explains the only routing that works, with no PII", () => {
    const text = composeConversationAlertText("Regional dry van");
    expect(text).toContain(TELEGRAM_ALERT_REPLY_HINT);
    expect(TELEGRAM_ALERT_REPLY_HINT).toBe(
      "Accept the conversation, then reply to this alert to message the driver.",
    );
    expect(composeConversationAlertText(null)).toContain(TELEGRAM_ALERT_REPLY_HINT);
    // No driver identity, contact detail, guarantee or availability promise.
    expect(text).not.toMatch(/@|phone|email|guarantee|hired|available now/i);
  });
});

// ──────────────────── D. SQL + adapter source contract ────────────────────

describe("RB-2C D — the database owns authority, CF-1 owns the message", () => {
  it("1) is one narrow transaction with no new conversation architecture", () => {
    const lines = RB2C_CODE.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines[0]).toBe("BEGIN;");
    expect(lines[lines.length - 1]).toBe("COMMIT;");
    expect(lines.filter((l) => l === "BEGIN;")).toHaveLength(1);
    for (const forbidden of [
      "CREATE TABLE",
      "CREATE POLICY",
      "DROP POLICY",
      "DISABLE ROW LEVEL SECURITY",
      "INSERT INTO public.conversation_messages",
      "UPDATE public.conversation_threads",
      "DELETE FROM",
      "api.telegram.org",
    ]) {
      expect(RB2C_CODE).not.toContain(forbidden);
    }
  });

  it("2) writes the Driver-visible message ONLY through canonical CF-1", () => {
    expect(RB2C_CODE).toContain("public.conversation_post_message(");
    expect(RB2C_CODE).toMatch(
      /current_user_can_conversation_action\(\s*_thread_id\s*,\s*'reply'\s*\)/,
    );
  });

  it("3) derives the actor server-side from the active Telegram link only", () => {
    expect(RB2C_CODE).toMatch(
      /FROM public\.telegram_user_links l[\s\S]{0,200}l\.status = 'active'/,
    );
    expect(RB2C_CODE).toContain("set_config(");
    expect(RB2C_CODE).toContain("'request.jwt.claim.sub'");
    // Identity is never taken from the caller's own arguments.
    expect(RB2C_CODE).not.toMatch(/_actor_user_id\s+uuid\s+DEFAULT/);
    expect(RB2C_CODE).not.toMatch(/_recruiter_id|_user_id uuid,/);
  });

  it("4) requires private chat and the account's own chat", () => {
    expect(RB2C_CODE).toMatch(/_chat_type IS DISTINCT FROM 'private'/);
    expect(RB2C_CODE).toMatch(/_linked_chat_id IS DISTINCT FROM _telegram_chat_id/);
  });

  it("5) resolves the thread only from an alert delivered to that actor", () => {
    expect(RB2C_CODE).toMatch(
      /FROM public\.telegram_conversation_alerts a[\s\S]{0,400}a\.recipient_user_id = _actor_user_id[\s\S]{0,400}a\.telegram_chat_id = _telegram_chat_id[\s\S]{0,400}a\.telegram_message_id = _reply_to_message_id[\s\S]{0,200}a\.status = 'sent'/,
    );
    // A guessed or copied locator resolves to nothing, never to a fallback.
    expect(RB2C_CODE).not.toMatch(/ORDER BY[\s\S]{0,80}created_at DESC[\s\S]{0,80}LIMIT 1/i);
  });

  it("6) is exactly-once: receipt and message share one transaction", () => {
    expect(RB2C_CODE).toMatch(/FROM public\.telegram_update_receipts r[\s\S]{0,200}FOR UPDATE/);
    expect(RB2C_CODE).toContain("INSERT INTO public.telegram_update_receipts");
    expect(RB2C_CODE).toContain("md5('telegram-reply:' || _update_id::text)");
    expect(RB2C_CODE).toContain("RAISE EXCEPTION 'telegram_update_conflict'");
  });

  it("7) the alert locator mapping is unique and transport-only", () => {
    expect(RB2C_CODE).toContain("ADD COLUMN IF NOT EXISTS telegram_message_id bigint");
    expect(RB2C_CODE).toContain("ADD COLUMN IF NOT EXISTS telegram_chat_id bigint");
    expect(RB2C_CODE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_conversation_alerts_chat_message/,
    );
  });

  it("8) every RB-2C function is service-role only", () => {
    for (const signature of [
      "public.telegram_mark_conversation_alert_sent(uuid, bigint, bigint)",
      "public.telegram_process_conversation_reply_update(uuid, bigint, text, bigint, bigint, text, bigint, text)",
    ]) {
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(RB2C_CODE).toContain(
          `REVOKE ALL ON FUNCTION ${signature} FROM ${role};`,
        );
      }
      expect(RB2C_CODE).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`,
      );
      expect(RB2C_CODE).not.toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION ${signature.replace(/[().*+?^${}|[\]\\]/g, "\\$&")} TO (anon|authenticated|PUBLIC)`),
      );
    }
  });

  it("9) the receipt vocabulary is extended, never loosened", () => {
    for (const code of [
      "link_success",
      "link_rejected",
      "non_private_message",
      "non_start_message",
      "invalid_start_command",
      "invalid_update_shape",
      "bind_success",
      "bind_rejected",
      "menu_recruiter",
      "menu_linked_no_workspace",
      "menu_unlinked",
      "menu_driver",
      "menu_multi_role",
      "menu_linked_unsupported",
      "conversation_accepted",
      "conversation_passed",
      "conversation_already_handled",
      "conversation_action_unavailable",
      "conversation_action_denied",
      "conversation_action_invalid",
      ...TELEGRAM_CONVERSATION_REPLY_RESULT_CODES,
    ]) {
      expect(RB2C_CODE).toContain(`'${code}'::text`);
    }
    // The update_type vocabulary is untouched: a reply is an ordinary message.
    expect(RB2C_CODE).not.toContain("update_type_check");
  });

  it("10) the runtime transports the outcome without inventing authority", () => {
    expect(ORCHESTRATOR_CODE).toContain(
      "telegram_conversation_reply_processor_unavailable",
    );
    expect(EDGE_CODE).toContain("telegram_process_conversation_reply_update");
    expect(EDGE_CODE).toContain("_reply_to_message_id: input.replyToMessageId");
    // No second poller, webhook, bot token or direct Telegram host.
    for (const forbidden of ["api.telegram.org", "setWebhook", "bot_token", "parse_mode"]) {
      expect(ORCHESTRATOR_CODE).not.toContain(forbidden);
      expect(EDGE_CODE).not.toContain(forbidden);
    }
  });

  it("11) the recruiter's text is never logged", () => {
    const logCalls = ORCHESTRATOR_CODE.match(/log\([\s\S]{0,200}?\);/g) ?? [];
    expect(logCalls.length).toBeGreaterThan(0);
    for (const call of logCalls) {
      expect(call).not.toMatch(/\btext\b/);
    }
  });
});
