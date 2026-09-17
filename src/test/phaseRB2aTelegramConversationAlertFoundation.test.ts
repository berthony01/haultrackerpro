// Phase RB-2A — recruiter Telegram conversation alert foundation.
//
// Three parts:
//   A. SQL source contract over the RB-2A candidate (never live) — reuse of the
//      CF-1 authority, tenant isolation, at-most-once semantics, locked ACLs;
//   B. drain behaviour through the SHARED orchestrator helper the Edge Function
//      actually calls, driven by injected fakes;
//   C. adapter source contract — URL-only button, private chat only, inbound
//      cursor isolation, no callback surface, no driver PII.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  TELEGRAM_ALERT_BUTTON_LABEL,
  TELEGRAM_ALERT_DRAIN_LIMIT,
  TELEGRAM_ALERT_GENERIC_BODY,
  TELEGRAM_ALERT_HEADER,
  composeConversationAlertButtons,
  composeConversationAlertText,
  runTelegramAlertDrain,
  type TelegramAlertClaim,
  type TelegramAlertOutbox,
  type TelegramGateway,
} from "../../supabase/functions/_shared/telegram-poll-ingest.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const RB2A_SQL = read(
  "supabase/migration-candidates/20260918120000_phase_rb2a_telegram_conversation_alert_outbox.sql",
);
const ORCHESTRATOR_SOURCE = read(
  "supabase/functions/_shared/telegram-poll-ingest.ts",
);
const EDGE_SOURCE = read("supabase/functions/telegram-poll/index.ts");

const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RB2A_CODE = stripSqlComments(RB2A_SQL);
const ORCHESTRATOR_CODE = stripTsComments(ORCHESTRATOR_SOURCE);
const EDGE_CODE = stripTsComments(EDGE_SOURCE);

const CONVERSATIONS_URL =
  "https://haultrackerpro.com/dashboard?page=recruiter-access:applications";

// ─────────────────────────── A. SQL source contract ───────────────────────────

describe("RB-2A A — one narrow, additive outbox migration", () => {
  it("1) is a single transaction", () => {
    const lines = RB2A_CODE.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines.filter((l) => l === "BEGIN;")).toHaveLength(1);
    expect(lines.filter((l) => l === "COMMIT;")).toHaveLength(1);
    expect(lines[0]).toBe("BEGIN;");
    expect(lines[lines.length - 1]).toBe("COMMIT;");
  });

  it("2) creates exactly one table, and it is the alert outbox", () => {
    const creates = RB2A_CODE.match(/CREATE TABLE[^;]*?public\.(\w+)/gi) ?? [];
    expect(creates).toHaveLength(1);
    expect(creates[0]).toContain("public.telegram_conversation_alerts");
  });

  it("3) never writes to, drops, or re-policies the CF-1 conversation system", () => {
    const upper = RB2A_CODE.toUpperCase();
    for (const table of [
      "CONVERSATION_THREADS",
      "CONVERSATION_PARTICIPANTS",
      "CONVERSATION_MESSAGES",
      "CONVERSATION_EVENTS",
    ]) {
      expect(upper).not.toContain(`INSERT INTO PUBLIC.${table}`);
      expect(upper).not.toContain(`UPDATE PUBLIC.${table}`);
      expect(upper).not.toContain(`DELETE FROM PUBLIC.${table}`);
      expect(upper).not.toContain(`ALTER TABLE PUBLIC.${table}`);
      expect(upper).not.toContain(`DROP TABLE PUBLIC.${table}`);
    }
    expect(upper).not.toContain("DROP POLICY");
    expect(upper).not.toContain("CREATE TYPE");
    expect(upper).not.toContain("ALTER TYPE");
  });

  it("4) the outbox is service-role only: RLS on, no policy, no end-user grant", () => {
    expect(RB2A_CODE).toContain(
      "ALTER TABLE public.telegram_conversation_alerts ENABLE ROW LEVEL SECURITY",
    );
    expect(RB2A_CODE.toUpperCase()).not.toContain("CREATE POLICY");
    expect(RB2A_CODE).toContain(
      "GRANT ALL ON public.telegram_conversation_alerts TO service_role",
    );
    expect(RB2A_CODE).not.toMatch(
      /GRANT[^;]*ON public\.telegram_conversation_alerts TO (anon|authenticated)/,
    );
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(RB2A_CODE).toContain(
        `REVOKE ALL ON public.telegram_conversation_alerts FROM ${role}`,
      );
    }
  });

  it("5) every new function is service-role only and never authenticated", () => {
    const fns = [
      "public.telegram_user_can_receive_conversation_alert(uuid, uuid)",
      "public.telegram_claim_conversation_alerts(integer)",
      "public.telegram_mark_conversation_alert_sent(uuid)",
      "public.telegram_mark_conversation_alert_failed(uuid, text)",
    ];
    for (const fn of fns) {
      expect(RB2A_CODE).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role`);
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(RB2A_CODE).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM ${role}`);
      }
    }
    expect(RB2A_CODE).not.toMatch(/GRANT EXECUTE ON FUNCTION[^;]*TO (anon|authenticated)/);
  });

  it("6) reuses the canonical CF-1 authority and invents no parallel ownership", () => {
    expect(RB2A_CODE).toContain("public.current_user_can_conversation_action");
    expect(RB2A_CODE).toContain("public.current_user_has_recruiter_permission");
    expect(RB2A_CODE).toContain("'conversations_view'");
    expect(RB2A_CODE).toContain("public.recruiter_profile_can_manage_opportunities");
  });

  it("7) excludes the driver and any non-open thread from recipient eligibility", () => {
    expect(RB2A_CODE).toContain("_t.driver_user_id = _user_id");
    expect(RB2A_CODE).toContain("l.user_id <> _thread.driver_user_id");
    expect(RB2A_CODE).toContain("_t.status NOT IN ('requested', 'active')");
  });

  it("8) carries a durable at-most-once idempotency key", () => {
    expect(RB2A_CODE).toContain(
      "UNIQUE (thread_id, recipient_user_id, notification_kind)",
    );
    expect(RB2A_CODE).toContain(
      "ON CONFLICT (thread_id, recipient_user_id, notification_kind) DO NOTHING",
    );
  });

  it("9) only a confirmed send reaches 'sent'; a failure returns to 'pending'", () => {
    expect(RB2A_CODE).toMatch(
      /SET status = 'sent'[\s\S]*?WHERE id = _alert_id\s*AND status = 'claimed'/,
    );
    expect(RB2A_CODE).toContain(
      "SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END",
    );
  });

  it("10) claims concurrently-safely and re-checks authority at send time", () => {
    expect(RB2A_CODE).toContain("FOR UPDATE SKIP LOCKED");
    const claimBody = RB2A_CODE.split("3b.")[1] ?? RB2A_CODE;
    expect(claimBody).toContain(
      "IF NOT public.telegram_user_can_receive_conversation_alert(",
    );
    expect(claimBody).toContain("'not_authorized_at_send'");
    expect(claimBody).toContain("'telegram_link_inactive'");
  });

  it("11) exposes no driver PII column or projection", () => {
    const lower = RB2A_CODE.toLowerCase();
    for (const forbidden of [
      "driver_email",
      "driver_phone",
      "recruiter_email",
      "phone",
      "full_name",
      "body",
      "message",
    ]) {
      expect(lower).not.toContain(`${forbidden},`);
    }
    // The only projected variable content is the recruiter's own opportunity title.
    expect(RB2A_CODE).toContain("SELECT o.title INTO _title");
  });
});

// ─────────────────────────── B. drain behaviour ───────────────────────────

interface FakeState {
  sent: string[];
  failed: { id: string; code: string }[];
  messages: { chatId: number; text: string; buttons: unknown }[];
}

function makeOutbox(claims: TelegramAlertClaim[], state: FakeState): TelegramAlertOutbox {
  let drained = false;
  return {
    async claimConversationAlerts(limit: number) {
      expect(limit).toBe(TELEGRAM_ALERT_DRAIN_LIMIT);
      if (drained) return [];
      drained = true;
      return claims;
    },
    async markConversationAlertSent(alertId) {
      state.sent.push(alertId);
    },
    async markConversationAlertFailed(alertId, code) {
      state.failed.push({ id: alertId, code });
    },
  };
}

function makeGateway(
  state: FakeState,
  behaviour: (chatId: number) => { ok: boolean; errorCode?: string } | "throw",
): TelegramGateway {
  return {
    async getUpdates() {
      throw new Error("getUpdates must not be called by the alert drain");
    },
    async sendMessage({ chatId, text, buttons }) {
      state.messages.push({ chatId, text, buttons });
      const outcome = behaviour(chatId);
      if (outcome === "throw") throw new Error("network down");
      return outcome.ok
        ? { ok: true, status: 200, result: {} }
        : { ok: false, status: 400, errorCode: outcome.errorCode };
    },
  };
}

const CLAIM: TelegramAlertClaim = {
  alertId: "11111111-1111-4111-8111-111111111111",
  telegramChatId: 4242,
  opportunityTitle: "Regional Dry Van — Midwest",
};

describe("RB-2A B — outbound drain semantics", () => {
  it("1) sends to the private linked chat and marks delivered only on success", async () => {
    const state: FakeState = { sent: [], failed: [], messages: [] };
    const result = await runTelegramAlertDrain({
      outbox: makeOutbox([CLAIM], state),
      gateway: makeGateway(state, () => ({ ok: true })),
      conversationsUrl: CONVERSATIONS_URL,
    });
    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(state.sent).toEqual([CLAIM.alertId]);
    expect(state.failed).toHaveLength(0);
    expect(state.messages[0].chatId).toBe(4242);
  });

  it("2) a gateway failure never marks delivered and reports a retryable code", async () => {
    const state: FakeState = { sent: [], failed: [], messages: [] };
    const result = await runTelegramAlertDrain({
      outbox: makeOutbox([CLAIM], state),
      gateway: makeGateway(state, () => ({ ok: false, errorCode: "telegram_bot_api_error" })),
      conversationsUrl: CONVERSATIONS_URL,
    });
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(state.sent).toHaveLength(0);
    expect(state.failed).toEqual([
      { id: CLAIM.alertId, code: "telegram_bot_api_error" },
    ]);
  });

  it("3) a thrown transport error is caught, not marked sent", async () => {
    const state: FakeState = { sent: [], failed: [], messages: [] };
    const result = await runTelegramAlertDrain({
      outbox: makeOutbox([CLAIM], state),
      gateway: makeGateway(state, () => "throw"),
      conversationsUrl: CONVERSATIONS_URL,
    });
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(state.sent).toHaveLength(0);
  });

  it("4) a claim RPC failure degrades to a no-op and never throws", async () => {
    const state: FakeState = { sent: [], failed: [], messages: [] };
    const result = await runTelegramAlertDrain({
      outbox: {
        async claimConversationAlerts() {
          throw new Error("db unavailable");
        },
        async markConversationAlertSent() {},
        async markConversationAlertFailed() {},
      },
      gateway: makeGateway(state, () => ({ ok: true })),
      conversationsUrl: CONVERSATIONS_URL,
    });
    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(state.messages).toHaveLength(0);
  });

  it("5) nothing is claimed twice in one drain (no duplicate delivery)", async () => {
    const state: FakeState = { sent: [], failed: [], messages: [] };
    const outbox = makeOutbox([CLAIM], state);
    await runTelegramAlertDrain({
      outbox,
      gateway: makeGateway(state, () => ({ ok: true })),
      conversationsUrl: CONVERSATIONS_URL,
    });
    const second = await runTelegramAlertDrain({
      outbox,
      gateway: makeGateway(state, () => ({ ok: true })),
      conversationsUrl: CONVERSATIONS_URL,
    });
    expect(second).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(state.sent).toEqual([CLAIM.alertId]);
  });

  it("6) copy is privacy-safe and the button is URL-only to the proven inbox", async () => {
    const state: FakeState = { sent: [], failed: [], messages: [] };
    await runTelegramAlertDrain({
      outbox: makeOutbox([CLAIM], state),
      gateway: makeGateway(state, () => ({ ok: true })),
      conversationsUrl: CONVERSATIONS_URL,
    });
    const msg = state.messages[0];
    expect(msg.text).toContain(TELEGRAM_ALERT_HEADER);
    expect(msg.text).toContain("Regional Dry Van — Midwest");
    expect(msg.text).not.toContain(CLAIM.alertId);
    expect(msg.text).not.toMatch(/@|\+1|http/);
    expect(msg.buttons).toEqual([
      [{ text: TELEGRAM_ALERT_BUTTON_LABEL, url: CONVERSATIONS_URL }],
    ]);
    expect(JSON.stringify(msg.buttons)).not.toContain("callback");
  });

  it("7) falls back to generic copy when no opportunity title is available", () => {
    const text = composeConversationAlertText(null);
    expect(text).toBe(`${TELEGRAM_ALERT_HEADER}\n\n${TELEGRAM_ALERT_GENERIC_BODY}`);
    expect(composeConversationAlertText("   ")).toBe(text);
    expect(composeConversationAlertButtons(CONVERSATIONS_URL)[0][0].url).toBe(
      CONVERSATIONS_URL,
    );
  });
});

// ─────────────────────── C. adapter / isolation contract ───────────────────────

describe("RB-2A C — runtime wiring stays inside the RB-2A cone", () => {
  it("1) the drain runs after inbound polling and cannot throw into it", () => {
    expect(EDGE_CODE).toContain("await drainAlerts();");
    expect(EDGE_CODE).toMatch(
      /const drainAlerts[\s\S]*?try \{[\s\S]*?runTelegramAlertDrain[\s\S]*?catch/,
    );
    const pollIndex = EDGE_CODE.indexOf("runTelegramPoll({");
    const drainIndex = EDGE_CODE.indexOf("await drainAlerts();");
    expect(pollIndex).toBeGreaterThan(-1);
    expect(drainIndex).toBeGreaterThan(pollIndex);
  });

  it("2) the drain never touches the lease, cursor or receipts", () => {
    const drain = ORCHESTRATOR_CODE.split("runTelegramAlertDrain")[1] ?? "";
    for (const forbidden of [
      "claimLease",
      "releaseLease",
      "advanceCursor",
      "recordIgnoredUpdate",
      "getUpdates",
    ]) {
      expect(drain).not.toContain(forbidden);
    }
  });

  it("3) no callback surface is introduced anywhere", () => {
    for (const source of [ORCHESTRATOR_CODE, EDGE_CODE]) {
      expect(source).not.toContain("callback_query");
      expect(source).not.toContain("callback_data");
      expect(source).not.toContain("setWebhook");
    }
    expect(ORCHESTRATOR_CODE).toContain('TELEGRAM_ALLOWED_UPDATES = ["message"]');
  });

  it("4) the alert destination is the proven recruiter conversations inbox", () => {
    expect(EDGE_CODE).toContain("conversationsUrl: URL_CONVERSATIONS");
    expect(EDGE_CODE).toContain(
      "const URL_CONVERSATIONS = `${APP_BASE_URL}/dashboard?page=recruiter-access:applications`",
    );
  });

  it("5) the adapter only transports ids and delivery outcomes", () => {
    const adapter = EDGE_CODE.split("function buildAlertOutbox")[1]?.split(
      "const APP_BASE_URL",
    )[0] ?? "";
    expect(adapter).toContain("telegram_claim_conversation_alerts");
    expect(adapter).toContain("telegram_mark_conversation_alert_sent");
    expect(adapter).toContain("telegram_mark_conversation_alert_failed");
    expect(adapter).not.toContain("from(");
    expect(adapter).not.toContain("driver");
  });
});
