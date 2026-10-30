// Phase TG-G1C — staged dispatch-group poller wiring. SYNTHETIC ONLY: fake
// gateway + in-memory fake ledger mirroring the TG-G1B candidate RPC contract.
// Real SQL semantics are covered by phaseTGG1BLocalPostgres.test.ts. Nothing
// here touches production, the network, or real Telegram.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyUpdate,
  runDispatchReviewDeliveryDrain,
  runTelegramPoll,
  classifyDispatchDeliveryFailure,
  type TelegramGateway,
  type TelegramPollLedger,
  type TelegramTerminalResult,
} from "../../supabase/functions/_shared/telegram-poll-ingest";
import {
  TGG1B_DISPATCH_GROUP_REVIEW_ENABLED,
  composeDispatchReviewData,
  type DispatchDeliveryClaim,
  type DispatchDeliveryLedger,
} from "../../supabase/functions/_shared/telegram-dispatch-group-review";

const sha256 = async (s: string) => createHash("sha256").update(s).digest("hex");
const GROUP = -100777;
const OTHER_GROUP = -100888;
const SENDER = 501;
const REVIEWER = 601;
const UNAUTH = 602;
let uuidN = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, "0")}`;

type Status = "pending" | "en_route" | "completed" | "cancelled";
interface Proposal { id: string; chatId: number; loadRef: string; prior: Status; target: "completed" | "cancelled"; state: "pending" | "accepted" | "rejected" | "expired" | "stale"; expired?: boolean }

function makeWorld() {
  const bound = new Set<number>([GROUP]);
  const permitted = new Set<number>([REVIEWER]);
  const loads = new Map<string, { status: Status; relActive: boolean }>([
    ["AB-123", { status: "en_route", relActive: true }],
    ["AB-124", { status: "pending", relActive: true }],
    ["CD-900", { status: "en_route", relActive: false }],
    ["DUP-1", { status: "pending", relActive: true }],
  ]);
  const dupRefs = new Set(["DUP-1"]);
  const receipts = new Map<number, { hash: string; result: TelegramTerminalResult }>();
  const proposals = new Map<string, Proposal>();
  const outbox: Array<{ id: string; proposalId: string; state: "pending" | "sending" | "sent" | "failed"; token: string | null; attempts: number; messageId?: number }> = [];
  const calls: string[] = [];
  let cursor = 0;
  let leaseHeld = false;

  const receipt = (updateId: number, hash: string, fn: () => TelegramTerminalResult): TelegramTerminalResult => {
    const prev = receipts.get(updateId);
    if (prev) {
      if (prev.hash !== hash) throw new Error("telegram_update_conflict");
      return { ...prev.result, isNew: false };
    }
    const r = fn();
    receipts.set(updateId, { hash, result: r });
    return r;
  };

  const ledger: TelegramPollLedger = {
    async claimLease() { calls.push("claimLease"); if (leaseHeld) return null; leaseHeld = true; return { leaseToken: "lease-1", nextOffset: cursor + 1 }; },
    async releaseLease() { calls.push("releaseLease"); leaseHeld = false; return true; },
    async advanceCursor(_t, id) { calls.push("advanceCursor"); cursor = id; return id; },
    async recordIgnoredUpdate(i) { calls.push(`ignored:${i.resultCode}`); return receipt(i.updateId, i.payloadHash, () => ({ isNew: true, resultCode: i.resultCode })); },
    async processStartUpdate(i) { calls.push("start"); return receipt(i.updateId, i.payloadHash, () => ({ isNew: true, resultCode: "link_rejected" })); },
    async processBindUpdate(i) { calls.push("bind"); return receipt(i.updateId, i.payloadHash, () => ({ isNew: true, resultCode: "bind_rejected" })); },
    async processConversationActionUpdate(i) { calls.push("c1"); return receipt(i.updateId, i.payloadHash, () => ({ isNew: true, resultCode: "conversation_action_invalid" as never })); },
    async processQuickPostActionUpdate(i) { calls.push("q1"); return receipt(i.updateId, i.payloadHash, () => ({ isNew: true, resultCode: "quick_post_invalid" as never })); },
    async processDispatchGroupUpdate(i) {
      calls.push("dispatch_intake");
      return receipt(i.updateId, i.payloadHash, () => {
        const load = i.reference ? loads.get(i.reference) : undefined;
        const ok = bound.has(i.telegramChatId) && i.reference && i.proposedStatus && load && load.relActive &&
          !dupRefs.has(i.reference) && (load.status === "pending" || load.status === "en_route");
        if (!ok) return { isNew: true, resultCode: "dispatch_review_no_action" };
        const id = uuid();
        proposals.set(id, { id, chatId: i.telegramChatId, loadRef: i.reference!, prior: load!.status, target: i.proposedStatus!, state: "pending" });
        outbox.push({ id: uuid(), proposalId: id, state: "pending", token: null, attempts: 0 });
        return { isNew: true, resultCode: "dispatch_review_proposed" };
      });
    },
    async processDispatchReviewActionUpdate(i) {
      calls.push("dispatch_review");
      return receipt(i.updateId, i.payloadHash, () => {
        const p = i.proposalId ? proposals.get(i.proposalId) : undefined;
        if (!p || !i.action || p.chatId !== i.telegramChatId) return { isNew: true, resultCode: "dispatch_review_invalid" };
        if (p.state !== "pending") return { isNew: true, resultCode: "dispatch_review_already_handled" };
        if (p.expired) { p.state = "expired"; return { isNew: true, resultCode: "dispatch_review_expired" }; }
        if (!bound.has(p.chatId) || !permitted.has(i.telegramUserId)) return { isNew: true, resultCode: "dispatch_review_denied" };
        const load = loads.get(p.loadRef)!;
        if (load.status !== p.prior || !load.relActive) { p.state = "stale"; return { isNew: true, resultCode: "dispatch_review_stale" }; }
        if (i.action === "reject") { p.state = "rejected"; return { isNew: true, resultCode: "dispatch_review_rejected" }; }
        load.status = p.target; p.state = "accepted";
        return { isNew: true, resultCode: "dispatch_review_accepted" };
      });
    },
  };

  const delivery: DispatchDeliveryLedger = {
    async claim(): Promise<DispatchDeliveryClaim | null> {
      calls.push("claim");
      const o = outbox.find((x) => x.state === "pending" || x.state === "failed");
      if (!o) return null;
      o.state = "sending"; o.token = uuid(); o.attempts += 1;
      const p = proposals.get(o.proposalId)!;
      return { outboxId: o.id, claimToken: o.token, proposalId: p.id, telegramChatId: p.chatId, loadReference: p.loadRef, proposedStatus: p.target };
    },
    async ack(id, token, messageId) { calls.push("ack"); const o = outbox.find((x) => x.id === id); if (!o || o.token !== token) return false; o.state = "sent"; o.token = null; o.messageId = messageId; return true; },
    async fail(id, token, code) { calls.push(`fail:${code}`); const o = outbox.find((x) => x.id === id); if (!o || o.token !== token) return false; o.state = "failed"; o.token = null; return true; },
  };

  return { ledger, delivery, loads, proposals, outbox, receipts, calls, bound, permitted, getCursor: () => cursor };
}

function makeGateway(updates: unknown[], opts: { sendStatus?: number[] } = {}) {
  const sent: Array<{ chatId: number; text: string; buttons?: unknown }> = [];
  const answers: string[] = [];
  const statuses = [...(opts.sendStatus ?? [])];
  let msgId = 9000;
  const gateway: TelegramGateway = {
    async getUpdates() { return { ok: true, status: 200, result: updates }; },
    async sendMessage(i) {
      sent.push({ chatId: i.chatId, text: i.text, buttons: i.buttons });
      const s = statuses.length ? statuses.shift()! : 200;
      return s === 200 ? { ok: true, status: 200, result: { message_id: ++msgId } } : { ok: false, status: s, errorCode: "telegram_gateway_http_error" };
    },
    async answerCallbackQuery(i) { answers.push(i.text); return { ok: true, status: 200 }; },
  };
  return { gateway, sent, answers };
}

const groupMsg = (updateId: number, text: string, chatId = GROUP, from = SENDER) => ({
  update_id: updateId,
  message: { message_id: updateId, from: { id: from }, chat: { id: chatId, type: "supergroup" }, text },
});
const tap = (updateId: number, data: string, from = REVIEWER, chatId = GROUP) => ({
  update_id: updateId,
  callback_query: { id: `cb${updateId}`, from: { id: from }, data, message: { message_id: 1, chat: { id: chatId, type: "supergroup" } } },
});

async function poll(w: ReturnType<typeof makeWorld>, updates: unknown[], enabled = true) {
  const g = makeGateway(updates);
  const r = await runTelegramPoll({ ledger: w.ledger, gateway: g.gateway, sha256, dispatchReviewEnabled: enabled });
  return { r, ...g };
}

describe("TG-G1C gate", () => {
  it("compile-time gate is false and the Edge Function never injects enabled", () => {
    expect(TGG1B_DISPATCH_GROUP_REVIEW_ENABLED).toBe(false);
    const POLL = readFileSync(resolve(__dirname, "../../supabase/functions/telegram-poll/index.ts"), "utf8");
    expect(POLL).not.toMatch(/dispatchReviewEnabled|enabled:\s*true/);
    expect(POLL).not.toMatch(/Deno\.env\.get\(["'][^"']*(DISPATCH|TGG1)/i);
  });

  it("disabled (default deps): group text → non_private_message, g1 tap → c1 path, zero dispatch RPCs/sends", async () => {
    const w = makeWorld();
    const g = makeGateway([groupMsg(1, "Load #AB-123 delivered"), tap(2, composeDispatchReviewData("accept", uuid())!)]);
    const r = await runTelegramPoll({ ledger: w.ledger, gateway: g.gateway, sha256 });
    expect(r.kind).toBe("ok");
    expect(w.calls).toContain("ignored:non_private_message");
    expect(w.calls).toContain("c1");
    expect(w.calls.some((c) => c.startsWith("dispatch"))).toBe(false);
    expect(g.sent).toHaveLength(0);
    const d = await runDispatchReviewDeliveryDrain({ ledger: w.delivery, gateway: g.gateway });
    expect(d.status).toBe("disabled");
    expect(w.calls).not.toContain("claim");
    expect(w.loads.get("AB-123")!.status).toBe("en_route");
  });

  it("classification: /bind, c1, q1 unchanged with gate on; slash commands in groups stay non_private_message", () => {
    const base = { updateId: 1, telegramUserId: 1, telegramChatId: GROUP, chatType: "group", callbackQueryId: null, callbackData: null, replyToMessageId: null };
    expect(classifyUpdate({ ...base, text: `/bind ${"a".repeat(64)}` } as never, true).kind).toBe("bind");
    expect(classifyUpdate({ ...base, text: "/start" } as never, true)).toEqual({ kind: "ignored", resultCode: "non_private_message" });
    expect(classifyUpdate({ ...base, text: "hello" } as never, true).kind).toBe("dispatch_group_message");
    expect(classifyUpdate({ ...base, chatType: "private", text: "hello" } as never, true).kind).toBe("quick_post_source");
    const cb = { ...base, text: null, callbackQueryId: "q" };
    expect(classifyUpdate({ ...cb, callbackData: `c1:a:${uuid()}` } as never, true).kind).toBe("conversation_action");
    expect(classifyUpdate({ ...cb, callbackData: "q1:n" } as never, true).kind).toBe("quick_post_action");
    expect(classifyUpdate({ ...cb, callbackData: composeDispatchReviewData("reject", uuid())! } as never, true))
      .toMatchObject({ kind: "dispatch_review_action", action: "reject" });
    expect(classifyUpdate({ ...cb, callbackData: "g1:zz" } as never, true))
      .toMatchObject({ kind: "dispatch_review_action", action: null, proposalId: null });
  });
});

describe("TG-G1C intake (enabled synthetic)", () => {
  it("delivered and cancelled create proposals + outbox, never change loads, never send on intake", async () => {
    const w = makeWorld();
    const { r, sent } = await poll(w, [groupMsg(1, "Load #AB-123 delivered"), groupMsg(2, "Load #AB-124 cancelled")]);
    expect(r).toMatchObject({ kind: "ok", processed: 2, advancedTo: 2 });
    expect([...w.proposals.values()].map((p) => [p.loadRef, p.target])).toEqual([["AB-123", "completed"], ["AB-124", "cancelled"]]);
    expect(w.outbox).toHaveLength(2);
    expect(sent).toHaveLength(0);
    expect(w.loads.get("AB-123")!.status).toBe("en_route");
    expect(w.loads.get("AB-124")!.status).toBe("pending");
  });

  it("chatter, unknown ref, duplicate ref, inactive relationship, unbound group → no_action receipt, no proposal", async () => {
    const w = makeWorld();
    const { r } = await poll(w, [
      groupMsg(1, "morning all, traffic is bad"),
      groupMsg(2, "Load #ZZ-404 delivered"),
      groupMsg(3, "Load #DUP-1 delivered"),
      groupMsg(4, "Load #CD-900 delivered"),
      groupMsg(5, "Load #AB-123 delivered", OTHER_GROUP),
      groupMsg(6, "can we cancel Load #AB-124?"),
    ]);
    expect(r.kind === "ok" && r.resultCodes.every((c) => c === "dispatch_review_no_action")).toBe(true);
    expect(w.proposals.size).toBe(0);
    expect(w.getCursor()).toBe(6);
  });

  it("replay of the same update is idempotent; conflicting payload fails closed without advancing", async () => {
    const w = makeWorld();
    await poll(w, [groupMsg(1, "Load #AB-123 delivered")]);
    expect(w.proposals.size).toBe(1);
    const { r } = await poll(w, [groupMsg(1, "Load #AB-123 delivered")]);
    expect(w.proposals.size).toBe(1);
    expect(r.kind).toBe("ok");
    const before = w.getCursor();
    const c = await poll(w, [groupMsg(1, "Load #AB-124 cancelled")]);
    expect(c.r.kind).toBe("failed");
    expect(w.getCursor()).toBe(before);
  });

  it("missing dispatch processor fails closed: no receipt, no cursor advance", async () => {
    const w = makeWorld();
    const ledger = { ...w.ledger, processDispatchGroupUpdate: undefined };
    const g = makeGateway([groupMsg(1, "Load #AB-123 delivered")]);
    const r = await runTelegramPoll({ ledger, gateway: g.gateway, sha256, dispatchReviewEnabled: true });
    expect(r.kind).toBe("failed");
    expect(w.receipts.size).toBe(0);
    expect(w.getCursor()).toBe(0);
  });
});

describe("TG-G1C outbox drain + review", () => {
  it("full flow: getUpdates → proposal/outbox → drain sendMessage → g1 Confirm → accepted status", async () => {
    const w = makeWorld();
    await poll(w, [groupMsg(1, "Load #AB-123 delivered")]);
    const g = makeGateway([]);
    const d = await runDispatchReviewDeliveryDrain({ ledger: w.delivery, gateway: g.gateway, enabled: true });
    expect(d).toMatchObject({ status: "ok", sent: 1, retried: 0 });
    expect(g.sent).toHaveLength(1);
    expect(g.sent[0].chatId).toBe(GROUP);
    expect(g.sent[0].text).toContain("AB-123");
    expect(g.sent[0].text).not.toContain("Load #AB-123 delivered");
    const accept = (g.sent[0].buttons as Array<Array<{ callbackData: string }>>)[0][0].callbackData;
    expect(accept.startsWith("g1:a:")).toBe(true);
    const { answers, sent } = await poll(w, [tap(2, accept)]);
    expect(w.loads.get("AB-123")!.status).toBe("completed");
    expect(answers).toEqual(["Confirmed. The load status was updated."]);
    expect(sent).toHaveLength(0);
    // second drain: nothing left
    expect((await runDispatchReviewDeliveryDrain({ ledger: w.delivery, gateway: g.gateway, enabled: true })).sent).toBe(0);
  });

  it("drain failure is bounded and retried, then acked", async () => {
    const w = makeWorld();
    await poll(w, [groupMsg(1, "Load #AB-123 delivered")]);
    const g = makeGateway([], { sendStatus: [429] });
    const d1 = await runDispatchReviewDeliveryDrain({ ledger: w.delivery, gateway: g.gateway, enabled: true, limit: 1 });
    expect(d1).toMatchObject({ retried: 1, sent: 0 });
    expect(w.calls).toContain("fail:rate_limited");
    const d2 = await runDispatchReviewDeliveryDrain({ ledger: w.delivery, gateway: g.gateway, enabled: true, limit: 1 });
    expect(d2.sent).toBe(1);
    expect(w.outbox[0].state).toBe("sent");
    expect(classifyDispatchDeliveryFailure({ status: 0 })).toBe("network");
    expect(classifyDispatchDeliveryFailure({ status: 403 })).toBe("chat_unavailable");
    expect(classifyDispatchDeliveryFailure({ status: 502 })).toBe("telegram_server");
    expect(classifyDispatchDeliveryFailure({ status: 400 })).toBe("telegram_rejected");
  });

  it("unauthorized, revoked binding, wrong chat, stale, expired, double tap, reject — no unauthorized load change", async () => {
    const w = makeWorld();
    await poll(w, [groupMsg(1, "Load #AB-123 delivered"), groupMsg(2, "Load #AB-124 cancelled")]);
    const [p1, p2] = [...w.proposals.values()];
    const a1 = composeDispatchReviewData("accept", p1.id)!;
    let res = await poll(w, [tap(10, a1, UNAUTH)]);
    expect(res.answers[0]).toMatch(/not authorized/);
    res = await poll(w, [tap(11, a1, REVIEWER, OTHER_GROUP)]);
    expect(res.answers[0]).toMatch(/not available/);
    w.bound.delete(GROUP);
    res = await poll(w, [tap(12, a1)]);
    expect(res.answers[0]).toMatch(/not authorized/);
    w.bound.add(GROUP);
    expect(w.loads.get("AB-123")!.status).toBe("en_route");
    w.loads.get("AB-123")!.status = "pending"; // changed elsewhere
    res = await poll(w, [tap(13, a1)]);
    expect(res.answers[0]).toMatch(/changed since/);
    expect(w.loads.get("AB-123")!.status).toBe("pending");
    p2.expired = true;
    res = await poll(w, [tap(14, composeDispatchReviewData("accept", p2.id)!)]);
    expect(res.answers[0]).toMatch(/expired/);
    expect(w.loads.get("AB-124")!.status).toBe("pending");
    res = await poll(w, [tap(15, composeDispatchReviewData("accept", p2.id)!)]);
    expect(res.answers[0]).toMatch(/already handled/);
  });

  it("reject leaves load unchanged; replayed tap answers again without re-applying", async () => {
    const w = makeWorld();
    await poll(w, [groupMsg(1, "Load #AB-124 cancelled")]);
    const [p] = [...w.proposals.values()];
    const rj = composeDispatchReviewData("reject", p.id)!;
    let res = await poll(w, [tap(20, rj)]);
    expect(res.answers[0]).toMatch(/Rejected/);
    res = await poll(w, [tap(20, rj)]);
    expect(res.answers[0]).toMatch(/Rejected/);
    expect(w.loads.get("AB-124")!.status).toBe("pending");
    expect(p.state).toBe("rejected");
  });

  it("drain logs carry no raw text or chat ids", async () => {
    const w = makeWorld();
    await poll(w, [groupMsg(1, "Load #AB-123 delivered")]);
    const logs: string[] = [];
    await runDispatchReviewDeliveryDrain({ ledger: w.delivery, gateway: makeGateway([]).gateway, enabled: true, log: (e, d) => logs.push(e + JSON.stringify(d ?? {})) });
    expect(logs.join()).not.toMatch(/AB-123|delivered|-100777/);
  });
});
