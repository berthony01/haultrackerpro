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
  TELEGRAM_ALERT_ACCEPT_LABEL,
  TELEGRAM_ALERT_BUTTON_LABEL,
  TELEGRAM_ALERT_PASS_LABEL,
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
// RB-2A.1 — the authoritative FINAL definition of the claim RPC.
const RB2A1_SQL = read(
  "supabase/migration-candidates/20260917204500_phase_rb2a1_alert_delivery_ambiguity_hardening.sql",
);

const ORCHESTRATOR_SOURCE = read(
  "supabase/functions/_shared/telegram-poll-ingest.ts",
);
const EDGE_SOURCE = read("supabase/functions/telegram-poll/index.ts");

const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RB2A_CODE = stripSqlComments(RB2A_SQL);
const RB2A1_CODE = stripSqlComments(RB2A1_SQL);

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

const THREAD_ID = "22222222-2222-4222-8222-222222222222";

const CLAIM: TelegramAlertClaim = {
  alertId: "11111111-1111-4111-8111-111111111111",
  threadId: THREAD_ID,
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

  // RB-2B re-pin. RB-2A shipped a URL-ONLY keyboard, so this asserted the
  // absence of any callback button. RB-2B legitimately adds Accept / Pass
  // callback buttons. The assertion is re-pinned EXACTLY to the new keyboard —
  // not loosened — and the protected property (no driver data, no identifier
  // other than the opaque conversation locator, Open Conversations still
  // URL-only) is now asserted more strictly than before.
  it("6) copy is privacy-safe and the keyboard is exactly the RB-2B shape", async () => {
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
    expect(msg.text).not.toContain(THREAD_ID);
    expect(msg.text).not.toMatch(/@|\+1|http/);
    expect(msg.buttons).toEqual([
      [
        { text: TELEGRAM_ALERT_ACCEPT_LABEL, callbackData: `c1:a:${THREAD_ID}` },
        { text: TELEGRAM_ALERT_PASS_LABEL, callbackData: `c1:p:${THREAD_ID}` },
      ],
      [{ text: TELEGRAM_ALERT_BUTTON_LABEL, url: CONVERSATIONS_URL }],
    ]);
    // Open Conversations stays URL-only, and the only identifier anywhere in
    // the keyboard is the opaque conversation locator.
    expect(msg.buttons?.[1][0]).not.toHaveProperty("callbackData");
    expect(JSON.stringify(msg.buttons)).not.toContain(CLAIM.alertId);
  });

  it("7) falls back to generic copy when no opportunity title is available", () => {
    const text = composeConversationAlertText(null);
    expect(text).toBe(`${TELEGRAM_ALERT_HEADER}\n\n${TELEGRAM_ALERT_GENERIC_BODY}`);
    expect(composeConversationAlertText("   ")).toBe(text);
    const rows = composeConversationAlertButtons(CONVERSATIONS_URL, THREAD_ID);
    expect((rows[1][0] as { url: string }).url).toBe(CONVERSATIONS_URL);
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

  // RB-2B re-pin. RB-2A forbade any callback surface because it shipped none.
  // RB-2B legitimately adds ONE, inside the SAME single poller. Re-pinned to
  // the exact new shape, still exhaustive: no webhook, no second poller, and
  // allowed_updates widened by exactly one entry and no more.
  it("3) the only callback surface is the single-poller RB-2B one", () => {
    for (const source of [ORCHESTRATOR_CODE, EDGE_CODE]) {
      expect(source).not.toMatch(/setWebhook|deleteWebhook/i);
    }
    expect(ORCHESTRATOR_CODE).toContain(
      'TELEGRAM_ALLOWED_UPDATES = ["message", "callback_query"]',
    );
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

// ───────────── D. RB-2A.1 — ambiguous delivery outcome is fail-closed ─────────────
//
// Defect: the original claim RPC also re-claimed rows stuck in 'claimed' for
// >10 minutes. Telegram may already have delivered those, so an automatic
// re-claim could DUPLICATE a confirmed delivery. The corrective migration is
// the authoritative final definition of the claim RPC.

describe("RB-2A.1 D — unknown delivery outcome never auto-resends", () => {
  it("1) is a single narrow transaction that replaces only the claim RPC", () => {
    const lines = RB2A1_CODE.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines[0]).toBe("BEGIN;");
    expect(lines[lines.length - 1]).toBe("COMMIT;");
    expect(lines.filter((l) => l === "BEGIN;")).toHaveLength(1);
    const created = RB2A1_CODE.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) ?? [];
    expect(created).toEqual([
      "CREATE OR REPLACE FUNCTION public.telegram_claim_conversation_alerts",
    ]);
    for (const forbidden of [
      "CREATE TABLE",
      "ALTER TABLE",
      "CREATE POLICY",
      "DROP POLICY",
      "DROP TABLE",
      "conversation_threads SET",
      "conversation_messages",
      "recruiter_members",
      "telegram_user_links SET",
    ]) {
      expect(RB2A1_CODE).not.toContain(forbidden);
    }
  });

  it("2) the final claim RPC selects ONLY pending rows", () => {
    const loop = RB2A1_CODE.split("FOR _row IN")[1] ?? "";
    const predicate = loop.split("LOOP")[0] ?? "";
    expect(predicate).toContain("WHERE p.status = 'pending'");
    // The only 'claimed' reference left in the loop is the forward transition.
    expect(predicate).not.toContain("'claimed'");
    expect(predicate).not.toMatch(/\bOR\b\s+\(?\s*p\.status/);
  });

  it("3) the stale-claimed reclaim window is gone and cannot return", () => {
    expect(RB2A_CODE).toContain("interval '10 minutes'"); // the original defect
    expect(RB2A1_CODE).not.toContain("interval");
    expect(RB2A1_CODE).not.toMatch(/status\s*=\s*'claimed'\s*AND\s*claimed_at/);
    expect(RB2A1_CODE).not.toMatch(/claimed_at\s*<\s*now\(\)/);
  });

  it("4) reconciliation neither sends nor rewrites an ambiguous row", () => {
    // No resolver function is introduced, and nothing downgrades 'claimed'
    // back to a deliverable state outside the explicit failure RPC.
    expect(RB2A1_CODE).not.toContain("reconcile");
    expect(RB2A1_CODE).not.toMatch(/SET status = 'pending'/);
    expect(RB2A1_CODE).not.toMatch(/SET status = 'sent'/);
    expect(RB2A1_CODE).not.toContain("sendMessage");
  });

  it("5) known failure stays retryable and confirmed success stays terminal", () => {
    // Untouched by RB-2A.1 — still owned by the RB-2A mark RPCs.
    expect(RB2A1_CODE).not.toContain("telegram_mark_conversation_alert_sent(uuid)");
    expect(RB2A1_CODE).not.toContain("telegram_mark_conversation_alert_failed(uuid");
    expect(RB2A_CODE).toContain(
      "SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END",
    );
    expect(RB2A_CODE).toMatch(
      /SET status = 'sent'[\s\S]*?WHERE id = _alert_id\s*AND status = 'claimed'/,
    );
  });

  it("6) authorization, privacy and ACLs are unchanged by the correction", () => {
    expect(RB2A1_CODE).toContain("public.telegram_user_can_receive_conversation_alert(");
    expect(RB2A1_CODE).toContain("l.user_id <> _thread.driver_user_id");
    expect(RB2A1_CODE).toContain("FOR UPDATE SKIP LOCKED");
    expect(RB2A1_CODE).toContain("SECURITY DEFINER");
    expect(RB2A1_CODE).toContain(
      "GRANT EXECUTE ON FUNCTION public.telegram_claim_conversation_alerts(integer) TO service_role",
    );
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(RB2A1_CODE).toContain(
        `REVOKE ALL ON FUNCTION public.telegram_claim_conversation_alerts(integer) FROM ${role}`,
      );
    }
    expect(RB2A1_CODE).not.toMatch(/GRANT EXECUTE ON FUNCTION[^;]*TO (anon|authenticated)/);
  });

  it("7) an unresolved send is never re-sent by the drain itself", async () => {
    // mark_sent throws AFTER a successful Telegram send: the row is left
    // ambiguous. The drain must not retry it, and the next drain gets nothing
    // back from the claim RPC because 'claimed' is no longer send-eligible.
    const claim: TelegramAlertClaim = {
      alertId: "a1",
      threadId: THREAD_ID,
      telegramChatId: 111,
      opportunityTitle: null,
    };
    let claimCalls = 0;
    const sends: number[] = [];
    const outbox: TelegramAlertOutbox = {
      claimConversationAlerts: async () => (claimCalls++ === 0 ? [claim] : []),
      markConversationAlertSent: async () => {
        throw new Error("connection_lost");
      },
      markConversationAlertFailed: async () => {
        throw new Error("must_not_be_called");
      },
    };
    const gateway: TelegramGateway = {
      sendMessage: async (m) => {
        sends.push(m.chatId);
        return { ok: true };
      },
    } as unknown as TelegramGateway;

    const first = await runTelegramAlertDrain({
      outbox,
      gateway,
      conversationsUrl: CONVERSATIONS_URL,
    });
    const second = await runTelegramAlertDrain({
      outbox,
      gateway,
      conversationsUrl: CONVERSATIONS_URL,
    });

    expect(first).toEqual({ claimed: 1, sent: 0, failed: 0 });
    expect(second).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(sends).toEqual([111]); // sent exactly once, never duplicated
  });
});
