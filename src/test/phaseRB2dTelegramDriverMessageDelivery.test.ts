// Phase RB-2D — driver HaulTracker message → recruiter Telegram delivery.
//
// Four parts:
//   A. eligibility / echo / backlog / recipient contract, asserted against the
//      SQL that actually owns those decisions;
//   B. drain behaviour through the SHARED helper the Edge Function calls:
//      exactly-once, ambiguity-safe, retry-on-known-failure, no truncation;
//   C. RB-2C reply bridge extension — a delivered driver message is a second
//      safe locator source and nothing else changes;
//   D. regression re-pins: commands, callbacks, alerts and ACLs unchanged.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  TELEGRAM_ALLOWED_UPDATES,
  TELEGRAM_MESSAGE_DELIVERY_PREFIX,
  TELEGRAM_SEND_MESSAGE_MAX_CHARS,
  classifyUpdate,
  composeDriverMessageText,
  runTelegramMessageDeliveryDrain,
  type TelegramGateway,
  type TelegramMessageDeliveryClaim,
  type TelegramMessageDeliveryOutbox,
} from "../../supabase/functions/_shared/telegram-poll-ingest.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const RB2D_SQL = read(
  "supabase/migration-candidates/20260920050000_phase_rb2d_driver_message_telegram_delivery.sql",
);
const ORCHESTRATOR_SOURCE = read(
  "supabase/functions/_shared/telegram-poll-ingest.ts",
);
const EDGE_SOURCE = read("supabase/functions/telegram-poll/index.ts");

const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SQL = stripSqlComments(RB2D_SQL);
const ORCHESTRATOR_CODE = stripTsComments(ORCHESTRATOR_SOURCE);
const EDGE_CODE = stripTsComments(EDGE_SOURCE);

// ──────────────── A. eligibility, echo, backlog, recipient rule ────────────────

describe("RB-2D A — only driver-authored post-acceptance active-thread messages", () => {
  it("1) eligibility requires the sender to be exactly the thread's driver", () => {
    expect(SQL).toContain("m.sender_user_id = th.driver_user_id");
    expect(SQL).toContain("m.sender_actor_type = 'driver'");
  });

  it("2) recruiter-authored messages (web or RB-2C Telegram reply) can never be eligible", () => {
    // There is exactly ONE sender predicate and it pins the driver, so a
    // recruiter-authored row cannot enter the materialisation set.
    const senderPredicates = SQL.match(/m\.sender_actor_type\s*=\s*'[a-z]+'/g) ?? [];
    expect(senderPredicates).toEqual(["m.sender_actor_type = 'driver'"]);
    expect(SQL).not.toMatch(/sender_actor_type\s*=\s*'recruiter'/);
  });

  it("3) no historical blast: strictly after the canonical acceptance time", () => {
    expect(SQL).toContain("th.accepted_at IS NOT NULL");
    expect(SQL).toContain("m.created_at > th.accepted_at");
    expect(SQL).not.toMatch(/m\.created_at\s*>=\s*th\.accepted_at/);
  });

  it("4) requested / declined / closed threads are never eligible", () => {
    expect(SQL).toContain("th.status = 'active'");
    for (const status of ["requested", "declined", "closed"]) {
      expect(SQL).not.toContain(`th.status = '${status}'`);
    }
  });

  it("5) recipients are exactly the accounts that received a SENT alert", () => {
    expect(SQL).toContain("JOIN public.telegram_conversation_alerts a");
    expect(SQL).toContain("a.thread_id = th.id");
    expect(SQL).toContain("a.status = 'sent'");
    expect(SQL).toContain("a.recipient_user_id <> th.driver_user_id");
  });

  it("6) authorization is re-resolved at enqueue AND again at claim time", () => {
    const checks =
      SQL.match(/public\.telegram_user_can_receive_conversation_alert\(/g) ?? [];
    expect(checks.length).toBe(2);
    expect(SQL).toContain("SET status = 'skipped', last_error_code = 'not_authorized_at_send'");
    expect(SQL).toContain("SET status = 'skipped', last_error_code = 'telegram_link_inactive'");
  });

  it("7) one message + recipient can produce at most one delivery row", () => {
    expect(SQL).toContain(
      "UNIQUE (conversation_message_id, recipient_user_id)",
    );
    expect(SQL).toContain(
      "ON CONFLICT (conversation_message_id, recipient_user_id) DO NOTHING",
    );
  });

  it("8) claim is pending-only — a stale claimed row is never auto-reclaimed", () => {
    expect(SQL).toContain("WHERE p.status = 'pending'");
    expect(SQL).toContain("FOR UPDATE SKIP LOCKED");
    expect(SQL).not.toMatch(/claimed_at\s*<\s*now\(\)\s*-\s*interval/);
    expect(SQL).not.toMatch(/status = 'claimed' AND/);
  });

  it("9) a known send failure retries through pending, bounded by attempts", () => {
    expect(SQL).toContain(
      "SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END",
    );
    expect(SQL).toContain("AND status = 'claimed'");
  });

  it("10) only a confirmed send reaches 'sent', persisting chat + message id", () => {
    expect(SQL).toContain("SET status = 'sent'");
    expect(SQL).toContain("telegram_message_id = CASE");
    expect(SQL).toContain("telegram_chat_id = CASE");
    expect(SQL).toMatch(/WHERE id = _delivery_id\s+AND status = 'claimed'/);
  });

  it("11) the delivery table is transport state only — no body, no PII", () => {
    const table = SQL.slice(
      SQL.indexOf("CREATE TABLE IF NOT EXISTS public.telegram_conversation_message_deliveries"),
      SQL.indexOf("REVOKE ALL ON public.telegram_conversation_message_deliveries"),
    );
    expect(table.length).toBeGreaterThan(0);
    for (const forbidden of ["body", "text", "email", "phone", "name"]) {
      expect(table).not.toMatch(new RegExp(`\\n\\s+${forbidden}\\s`, "i"));
    }
    // The canonical body is read from CF-1 at claim time instead.
    expect(SQL).toContain("SELECT m.body INTO _body");
  });

  it("12) CF-1 tables are never written or altered by this migration", () => {
    for (const t of [
      "conversation_threads",
      "conversation_messages",
      "conversation_participants",
      "conversation_events",
    ]) {
      expect(SQL).not.toMatch(new RegExp(`INSERT INTO public\\.${t}\\b`));
      expect(SQL).not.toMatch(new RegExp(`UPDATE public\\.${t}\\b`));
      expect(SQL).not.toMatch(new RegExp(`DELETE FROM public\\.${t}\\b`));
      expect(SQL).not.toMatch(new RegExp(`ALTER TABLE public\\.${t}\\b`));
    }
  });

  it("13) the delivery table is service-role only with RLS on and no policy", () => {
    expect(SQL).toContain(
      "REVOKE ALL ON public.telegram_conversation_message_deliveries FROM anon",
    );
    expect(SQL).toContain(
      "REVOKE ALL ON public.telegram_conversation_message_deliveries FROM authenticated",
    );
    expect(SQL).toContain(
      "GRANT ALL ON public.telegram_conversation_message_deliveries TO service_role",
    );
    expect(SQL).toContain("ENABLE ROW LEVEL SECURITY");
    expect(SQL).not.toMatch(/CREATE POLICY/i);
  });

  it("14) every new function is SECURITY DEFINER and service-role only", () => {
    for (const fn of [
      "public.telegram_claim_conversation_message_deliveries(integer)",
      "public.telegram_mark_conversation_message_delivery_sent(uuid, bigint, bigint)",
      "public.telegram_mark_conversation_message_delivery_failed(uuid, text)",
      "public.telegram_process_conversation_reply_update(uuid, bigint, text, bigint, bigint, text, bigint, text)",
    ]) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`);
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM anon`);
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM authenticated`);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role`);
    }
    expect(SQL).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.telegram_(claim|mark)_conversation_message[^\n]*TO (anon|authenticated)/);
  });

  it("15) a delivered bot message is uniquely addressable per chat", () => {
    expect(SQL).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_conv_msg_deliveries_chat_message",
    );
    expect(SQL).toContain("WHERE telegram_message_id IS NOT NULL");
  });
});

// ─────────────────────────── B. drain behaviour ───────────────────────────

const CLAIM: TelegramMessageDeliveryClaim = {
  deliveryId: "d1",
  telegramChatId: 777,
  messageBody: "Can you send the rate confirmation?",
};

interface Recorded {
  sent: { deliveryId: string; messageId: number | null; chatId: number | null }[];
  failed: { deliveryId: string; errorCode: string }[];
  payloads: Record<string, unknown>[];
}

function harness(options: {
  claims?: TelegramMessageDeliveryClaim[];
  sendOk?: boolean;
  sendMessageId?: number | null;
  markSentThrows?: boolean;
  claimThrows?: boolean;
}) {
  const recorded: Recorded = { sent: [], failed: [], payloads: [] };

  const outbox: TelegramMessageDeliveryOutbox = {
    claimConversationMessageDeliveries: async () => {
      if (options.claimThrows) throw new Error("db_unavailable");
      return options.claims ?? [CLAIM];
    },
    markConversationMessageDeliverySent: async (deliveryId, messageId, chatId) => {
      if (options.markSentThrows) throw new Error("db_unavailable");
      recorded.sent.push({ deliveryId, messageId, chatId });
    },
    markConversationMessageDeliveryFailed: async (deliveryId, errorCode) => {
      recorded.failed.push({ deliveryId, errorCode });
    },
  };

  const gateway: TelegramGateway = {
    getUpdates: async () => ({ ok: true, status: 200, result: [] }),
    sendMessage: async (payload) => {
      recorded.payloads.push(payload as unknown as Record<string, unknown>);
      return options.sendOk === false
        ? { ok: false, status: 400, errorCode: "telegram_bot_api_error" }
        : {
            ok: true,
            status: 200,
            result: {
              message_id:
                "sendMessageId" in options
                  ? (options.sendMessageId as number | null ?? undefined)
                  : 9001,
            },
          };
    },
  };

  return { outbox, gateway, recorded };
}

describe("RB-2D B — delivery drain is exactly-once and ambiguity-safe", () => {
  it("16) a confirmed send persists the Telegram message id and chat id", async () => {
    const h = harness({});
    const result = await runTelegramMessageDeliveryDrain({
      outbox: h.outbox,
      gateway: h.gateway,
    });
    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(h.recorded.sent).toEqual([
      { deliveryId: "d1", messageId: 9001, chatId: 777 },
    ]);
  });

  it("17) a known send failure is reported for retry, never marked sent", async () => {
    const h = harness({ sendOk: false });
    const result = await runTelegramMessageDeliveryDrain({
      outbox: h.outbox,
      gateway: h.gateway,
    });
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(h.recorded.sent).toEqual([]);
    expect(h.recorded.failed).toEqual([
      { deliveryId: "d1", errorCode: "telegram_bot_api_error" },
    ]);
  });

  it("18) mark-sent failure after a successful send leaves it ambiguous, never failed", async () => {
    const h = harness({ markSentThrows: true });
    const result = await runTelegramMessageDeliveryDrain({
      outbox: h.outbox,
      gateway: h.gateway,
    });
    // Neither sent nor failed is recorded: the row stays 'claimed' and the SQL
    // above proves 'claimed' is never re-claimed, so it cannot be resent.
    expect(result.sent).toBe(0);
    expect(h.recorded.failed).toEqual([]);
    expect(h.recorded.sent).toEqual([]);
  });

  it("19) an unusable message id degrades to null rather than a guessed locator", async () => {
    for (const bad of [0, -3, 1.5, null]) {
      const h = harness({ sendMessageId: bad as number | null });
      await runTelegramMessageDeliveryDrain({ outbox: h.outbox, gateway: h.gateway });
      expect(h.recorded.sent[0].messageId).toBeNull();
    }
  });

  it("20) the drain never throws, even when claiming fails", async () => {
    const h = harness({ claimThrows: true });
    await expect(
      runTelegramMessageDeliveryDrain({ outbox: h.outbox, gateway: h.gateway }),
    ).resolves.toEqual({ claimed: 0, sent: 0, failed: 0 });
  });

  it("21) one failing delivery does not block the others", async () => {
    let call = 0;
    const h = harness({
      claims: [
        CLAIM,
        { deliveryId: "d2", telegramChatId: 777, messageBody: "second" },
      ],
    });
    const gateway: TelegramGateway = {
      ...h.gateway,
      sendMessage: async () => {
        call += 1;
        return call === 1
          ? { ok: false, status: 400, errorCode: "telegram_bot_api_error" }
          : { ok: true, status: 200, result: { message_id: 42 } };
      },
    };
    const result = await runTelegramMessageDeliveryDrain({
      outbox: h.outbox,
      gateway,
    });
    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1 });
  });

  it("22) the driver body is delivered verbatim, prefixed, never truncated", async () => {
    const body = "Y".repeat(4000);
    const h = harness({
      claims: [{ deliveryId: "d1", telegramChatId: 777, messageBody: body }],
    });
    await runTelegramMessageDeliveryDrain({ outbox: h.outbox, gateway: h.gateway });
    const payload = h.recorded.payloads[0] as { text: string };
    expect(payload.text).toBe(`${TELEGRAM_MESSAGE_DELIVERY_PREFIX}${body}`);
    expect(payload.text).toContain(body);
    expect(payload.text.length).toBeLessThanOrEqual(TELEGRAM_SEND_MESSAGE_MAX_CHARS);
  });

  it("23) composition never mutates the body and refuses rather than truncating", () => {
    expect(composeDriverMessageText("hi")).toBe(
      `${TELEGRAM_MESSAGE_DELIVERY_PREFIX}hi`,
    );
    // Prefix would overflow: body alone, still unmutated.
    const nearLimit = "Z".repeat(TELEGRAM_SEND_MESSAGE_MAX_CHARS - 1);
    expect(composeDriverMessageText(nearLimit)).toBe(nearLimit);
    // Impossible under the CF-1 1..4000 contract, but refused rather than cut.
    expect(
      composeDriverMessageText("Z".repeat(TELEGRAM_SEND_MESSAGE_MAX_CHARS + 1)),
    ).toBeNull();
  });

  it("24) outbound driver messages are plain text: no parse_mode, no buttons", async () => {
    const h = harness({});
    await runTelegramMessageDeliveryDrain({ outbox: h.outbox, gateway: h.gateway });
    const payload = h.recorded.payloads[0];
    expect(Object.keys(payload).sort()).toEqual(["chatId", "text"]);
    expect(ORCHESTRATOR_CODE).not.toMatch(/parse_mode/);
    expect(EDGE_CODE).not.toMatch(/parse_mode/);
  });

  it("25) no driver identity or thread identifier is representable in the copy", () => {
    expect(TELEGRAM_MESSAGE_DELIVERY_PREFIX).toBe("Driver message:\n\n");
    for (const forbidden of [
      "thread_id",
      "recruiter_id",
      "workspace",
      "user_id",
      "email",
      "phone",
    ]) {
      expect(TELEGRAM_MESSAGE_DELIVERY_PREFIX).not.toContain(forbidden);
    }
  });
});

// ─────────────── C. RB-2C reply bridge — one extra locator source ───────────────

describe("RB-2D C — replying to a delivered driver message resolves the same thread", () => {
  it("26) the reply processor accepts a sent delivery as a second locator", () => {
    expect(SQL).toContain(
      "FROM public.telegram_conversation_message_deliveries d",
    );
    expect(SQL).toContain("d.recipient_user_id = _actor_user_id");
    expect(SQL).toContain("d.telegram_chat_id = _telegram_chat_id");
    expect(SQL).toContain("d.telegram_message_id = _reply_to_message_id");
    expect(SQL).toContain("d.status = 'sent'");
  });

  it("27) the original RB-2A alert mapping still resolves first", () => {
    expect(SQL).toContain("FROM public.telegram_conversation_alerts a");
    expect(SQL).toContain("a.recipient_user_id = _actor_user_id");
    expect(SQL).toContain("a.telegram_message_id = _reply_to_message_id");
    const reply = SQL.slice(
      SQL.indexOf("CREATE OR REPLACE FUNCTION public.telegram_process_conversation_reply_update"),
    );
    const alertLookup = reply.indexOf("FROM public.telegram_conversation_alerts a");
    const deliveryLookup = reply.indexOf(
      "FROM public.telegram_conversation_message_deliveries d",
    );
    expect(alertLookup).toBeGreaterThan(-1);
    expect(deliveryLookup).toBeGreaterThan(alertLookup);
  });

  it("28) a copied id from another account or chat resolves to nothing", () => {
    // Both locator lookups are scoped to the acting account AND its own chat.
    expect(SQL).toContain("_outcome := 'conversation_reply_unroutable'");
    expect(SQL).toContain("_linked_chat_id IS DISTINCT FROM _telegram_chat_id");
  });

  it("29) private chat only, and the driver can never act as recruiter", () => {
    expect(SQL).toContain("_chat_type IS DISTINCT FROM 'private'");
    expect(SQL).toContain("_t.driver_user_id = _actor_user_id");
  });

  it("30) the canonical CF-1 write and its exactly-once receipt are unchanged", () => {
    expect(SQL).toContain("PERFORM public.conversation_post_message(");
    expect(SQL).toContain(
      "_client_message_id :=\n              (md5('telegram-reply:' || _update_id::text))::uuid;",
    );
    expect(SQL).toContain("INSERT INTO public.telegram_update_receipts (");
    expect(SQL).toContain("public.current_user_can_conversation_action(_thread_id, 'reply')");
  });

  it("31) the receipt vocabulary is NOT widened by RB-2D", () => {
    expect(SQL).not.toMatch(/telegram_update_receipts_result_code_check/);
    expect(SQL).not.toMatch(/telegram_update_receipts_update_type_check/);
  });
});

// ───────────────────────── D. regression re-pins ─────────────────────────

describe("RB-2D D — inbound handling is untouched", () => {
  const identity = (over: Record<string, unknown> = {}) => ({
    updateId: 1,
    telegramUserId: 555,
    telegramChatId: 555,
    chatType: "private",
    text: "hello",
    replyToMessageId: null,
    ...over,
  });

  it("32) commands keep their exact classification", () => {
    expect(classifyUpdate(identity({ text: "/menu" })).kind).toBe("menu");
    expect(classifyUpdate(identity({ text: "/status" })).kind).toBe("menu");
    expect(classifyUpdate(identity({ text: "/start" })).kind).toBe("menu");
    expect(
      classifyUpdate(identity({ text: `/start ${"a".repeat(64)}` })).kind,
    ).toBe("start");
    expect(
      classifyUpdate(
        identity({
          text: `/bind ${"b".repeat(64)}`,
          chatType: "supergroup",
        }),
      ).kind,
    ).toBe("bind");
  });

  it("33) RB-2B callback taps and RB-2C replies still classify exactly as before", () => {
    expect(
      classifyUpdate(
        identity({
          callbackQueryId: "cb1",
          callbackData: "c1:a:3a3b3c3d-1111-4e22-8f33-aabbccddeeff",
          text: null,
        }),
      ).kind,
    ).toBe("conversation_action");
    expect(classifyUpdate(identity({ replyToMessageId: 42 })).kind).toBe(
      "conversation_reply",
    );
  });

  it("34) the allowed update types are still exactly message + callback_query", () => {
    expect([...TELEGRAM_ALLOWED_UPDATES]).toEqual(["message", "callback_query"]);
  });

  it("35) delivery drains strictly after inbound polling and the alert drain", () => {
    const poll = EDGE_CODE.indexOf("await runTelegramPoll(");
    const alerts = EDGE_CODE.indexOf("await drainAlerts()");
    const deliveries = EDGE_CODE.indexOf("await drainMessageDeliveries()");
    expect(poll).toBeGreaterThan(-1);
    expect(alerts).toBeGreaterThan(poll);
    expect(deliveries).toBeGreaterThan(alerts);
  });

  it("36) the runtime never logs the message body", () => {
    expect(ORCHESTRATOR_CODE).not.toMatch(/log\([^)]*messageBody/);
    expect(EDGE_CODE).not.toMatch(/log\([^)]*message_body/);
  });

  it("37) exactly the three RB-2D RPCs are called by the adapter", () => {
    const rpcs = [...EDGE_CODE.matchAll(/supabase\.rpc\(\s*\n?\s*"([a-z0-9_]+)"/g)]
      .map((m) => m[1])
      .filter((name) => name.includes("conversation_message"));
    expect(rpcs.sort()).toEqual([
      "telegram_claim_conversation_message_deliveries",
      "telegram_mark_conversation_message_delivery_failed",
      "telegram_mark_conversation_message_delivery_sent",
    ]);
  });
});
