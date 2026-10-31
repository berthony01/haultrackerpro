// Synthetic ports exercise production orchestration; schema/authorization proof
// remains in phaseTGG1BLocalPostgres.test.ts. No network or production writes.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import {
  classifyUpdate, runTelegramPoll, runDispatchReviewDeliveryDrain,
  type TelegramPollLedger, type TelegramGateway,
} from "../../supabase/functions/_shared/telegram-poll-ingest";
import {
  TELEGRAM_SINGLE_LOAD_QA_ENABLED, TGG1B_DISPATCH_GROUP_REVIEW_ENABLED,
  TELEGRAM_SINGLE_LOAD_QA_RPCS, composeDispatchReviewData,
  type DispatchDeliveryLedger,
} from "../../supabase/functions/_shared/telegram-dispatch-group-review";

const GROUP = -100777;
const ID = "00000000-0000-4000-8000-000000000001";
const command = "/cancelled@HaulTrackerBot HTP-QA-L2";
const identity = (text: string, chatId = GROUP) => ({
  telegramUserId: 501, telegramChatId: chatId, chatType: "supergroup",
  text, callbackQueryId: null, callbackData: null, replyToMessageId: null,
});
const message = (text = command, chatId = GROUP) => ({ update_id: 1,
  message: { message_id: 1, from: { id: 501 }, chat: { id: chatId, type: "supergroup" }, text },
});
const callback = (actor = 501, chatId = GROUP, proposalId = ID) => ({ update_id: 2,
  callback_query: { id: "cb2", from: { id: actor }, data: composeDispatchReviewData("accept", proposalId),
    message: { message_id: 1, chat: { id: chatId, type: "supergroup" } } },
});

function fixture(updates: unknown[]) {
  const receipts = new Map<number, string>();
  let status = "pending";
  let proposals = 0;
  const intake = vi.fn(async (i: Parameters<NonNullable<TelegramPollLedger["processQaDispatchGroupUpdate"]>>[0]) => {
    if (i.telegramChatId !== GROUP || i.reference !== "HTP-QA-L2" || i.proposedStatus !== "cancelled") throw new Error("qa_dispatch_scope_denied");
    if (receipts.has(i.updateId)) return { isNew: false, resultCode: "dispatch_review_proposed" as const };
    receipts.set(i.updateId, i.payloadHash); proposals++;
    return { isNew: true, resultCode: "dispatch_review_proposed" as const };
  });
  const review = vi.fn(async (i: Parameters<NonNullable<TelegramPollLedger["processQaDispatchReviewActionUpdate"]>>[0]) => {
    if (i.telegramChatId !== GROUP || i.proposalId !== ID) throw new Error("qa_dispatch_scope_denied");
    if (i.telegramUserId !== 501) return { isNew: true, resultCode: "dispatch_review_denied" as const };
    if (receipts.has(i.updateId)) return { isNew: false, resultCode: "dispatch_review_accepted" as const };
    receipts.set(i.updateId, i.payloadHash); status = "cancelled";
    return { isNew: true, resultCode: "dispatch_review_accepted" as const };
  });
  const genericIntake = vi.fn(); const genericReview = vi.fn();
  const ledger: TelegramPollLedger = {
    claimLease: async () => ({ leaseToken: ID, nextOffset: 1 }), releaseLease: async () => true,
    advanceCursor: async (_lease, id) => id,
    recordIgnoredUpdate: async i => ({ isNew: true, resultCode: i.resultCode }),
    processStartUpdate: async () => ({ isNew: true, resultCode: "link_rejected" }),
    processBindUpdate: async () => ({ isNew: true, resultCode: "bind_rejected" }),
    processConversationActionUpdate: async () => ({ isNew: true, resultCode: "conversation_action_invalid" }),
    processQaDispatchGroupUpdate: intake, processQaDispatchReviewActionUpdate: review,
    processDispatchGroupUpdate: genericIntake, processDispatchReviewActionUpdate: genericReview,
  };
  const send = vi.fn(async () => ({ ok: true, status: 200, result: { message_id: 9 } }));
  const gateway: TelegramGateway = {
    getUpdates: async () => ({ ok: true, status: 200, result: updates }), sendMessage: send,
    answerCallbackQuery: vi.fn(async () => ({ ok: true, status: 200 })),
  };
  const poll = (enabled = true) => runTelegramPoll({ ledger, gateway,
    sha256: async s => createHash("sha256").update(s).digest("hex"), singleLoadQaEnabled: enabled });
  return { ledger, gateway, intake, review, send, genericIntake, genericReview, poll,
    status: () => status, proposals: () => proposals };
}

afterEach(() => vi.useRealTimers());
describe("Single-load QA route", () => {
  it("both mutation gates remain OFF and only QA service RPC names are selected", () => {
    expect(TELEGRAM_SINGLE_LOAD_QA_ENABLED).toBe(false);
    expect(TGG1B_DISPATCH_GROUP_REVIEW_ENABLED).toBe(false);
    expect(TELEGRAM_SINGLE_LOAD_QA_RPCS).toEqual({ intake: "telegram_qa_process_dispatch_group_update",
      review: "telegram_qa_process_dispatch_review_action", claim: "telegram_qa_claim_dispatch_review_delivery" });
  });
  it.each([command, "/cancelled HTP-QA-L2"])("exact command %s enters QA only", text => {
    expect(classifyUpdate(identity(text), false, true)).toMatchObject({ kind: "dispatch_group_message", qaOnly: true });
  });
  it.each(["/cancelled HTP-QA-L3", "/delivered HTP-QA-L2", "/cancelled@OtherBot HTP-QA-L2",
    "Load HTP-QA-L2 cancelled", "/cancelled HTP-QA-L2 extra", "/cancelled HTP-QA-L2\n",
    "/cancelled HTP-QA-L2 HTP-QA-L3", "/menu", "/help", "/dispatch"])("rejects %s from QA", text => {
    expect(classifyUpdate(identity(text), false, true)).toEqual({ kind: "ignored", resultCode: "non_private_message" });
  });
  it("OFF, expired, invalid positive chat and private chats never enter QA", () => {
    expect(classifyUpdate(identity(command), false, false).kind).toBe("ignored");
    expect(classifyUpdate(identity(command, 123), false, true).kind).toBe("ignored");
    expect(classifyUpdate({ ...identity(command), chatType: "private" }, false, true).kind).not.toBe("dispatch_group_message");
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-02T23:59:59Z"));
    expect(classifyUpdate(identity(command), false, true).kind).toBe("ignored");
  });
  it("preserves bind and private help classification", () => {
    expect(classifyUpdate(identity(`/bind ${"a".repeat(64)}`), false, true).kind).toBe("bind");
    expect(classifyUpdate({ ...identity("/help"), chatType: "private" }, false, true)).toEqual({ kind: "menu", command: "help" });
  });
  it("default OFF never invokes any dispatch port", async () => {
    const f = fixture([message(), callback()]); await f.poll(false);
    expect(f.intake).not.toHaveBeenCalled(); expect(f.review).not.toHaveBeenCalled();
    expect(f.genericIntake).not.toHaveBeenCalled(); expect(f.genericReview).not.toHaveBeenCalled();
    expect(f.status()).toBe("pending"); expect(f.send).not.toHaveBeenCalled();
  });
  it("intake/replay only propose, no send or load change before callback", async () => {
    const f = fixture([message()]); await f.poll(); await f.poll();
    expect(f.proposals()).toBe(1); expect(f.status()).toBe("pending"); expect(f.send).not.toHaveBeenCalled();
    expect(f.genericIntake).not.toHaveBeenCalled();
  });
  it("missing intake wrapper fails closed, never falls back", async () => {
    const f = fixture([message()]); delete f.ledger.processQaDispatchGroupUpdate;
    expect((await f.poll()).kind).toBe("failed"); expect(f.send).not.toHaveBeenCalled();
    expect(f.genericIntake).not.toHaveBeenCalled(); expect(f.status()).toBe("pending");
  });
  it("missing review wrapper fails closed, never falls back", async () => {
    const f = fixture([callback()]); delete f.ledger.processQaDispatchReviewActionUpdate;
    expect((await f.poll()).kind).toBe("failed"); expect(f.genericReview).not.toHaveBeenCalled();
    expect(f.gateway.answerCallbackQuery).not.toHaveBeenCalled(); expect(f.status()).toBe("pending");
  });
  it("wrong bound chat denied by QA service port with no proposal", async () => {
    const f = fixture([message(command, -100888)]);
    expect((await f.poll()).kind).toBe("failed"); expect(f.proposals()).toBe(0);
    expect(f.send).not.toHaveBeenCalled(); expect(f.status()).toBe("pending");
  });
  it.each([callback(602), callback(501, -100888), callback(501, GROUP, "00000000-0000-4000-8000-000000000002")])("callback identity/scope is checked by QA service port", async update => {
    const f = fixture([update]); await f.poll(); expect(f.status()).toBe("pending");
    expect(f.genericReview).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("transport callback reaches QA review, replay stays idempotent (synthetic, not human proof)", async () => {
    const f = fixture([message(), callback()]); await f.poll(); await f.poll();
    expect(f.status()).toBe("cancelled"); expect(f.proposals()).toBe(1);
    expect(f.review).toHaveBeenCalledWith(expect.objectContaining({ telegramUserId: 501, proposalId: ID, action: "accept" }));
    expect(f.genericReview).not.toHaveBeenCalled();
  });
});

describe("Single-load QA delivery isolation", () => {
  function delivery(overrides = {}) {
    const claim = { outboxId: ID, claimToken: ID, proposalId: ID, telegramChatId: GROUP,
      loadReference: "HTP-QA-L2", proposedStatus: "cancelled" as const, expiresAt: "2026-11-01T00:00:00Z", ...overrides };
    const ledger: DispatchDeliveryLedger = { claim: vi.fn(async () => claim), ack: vi.fn(async () => true), fail: vi.fn(async () => true) };
    return ledger;
  }
  it("OFF makes zero claims or sends", async () => {
    const f = fixture([]); const qa = delivery();
    expect((await runDispatchReviewDeliveryDrain({ ledger: qa, qaLedger: qa, gateway: f.gateway })).status).toBe("disabled");
    expect(qa.claim).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("ON only claims QA port and acknowledges its claim token", async () => {
    const f = fixture([]); const qa = delivery(); const generic = delivery();
    expect(await runDispatchReviewDeliveryDrain({ ledger: generic, qaLedger: qa, gateway: f.gateway, singleLoadQaEnabled: true, limit: 1 })).toMatchObject({ status: "ok", sent: 1 });
    expect(generic.claim).not.toHaveBeenCalled(); expect(qa.ack).toHaveBeenCalledWith(ID, ID, 9);
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ chatId: GROUP }));
  });
  it("missing QA claim port never claims generic outbox", async () => {
    const f = fixture([]); const generic = delivery();
    expect((await runDispatchReviewDeliveryDrain({ ledger: generic, gateway: f.gateway, singleLoadQaEnabled: true })).status).toBe("failed");
    expect(generic.claim).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([{ loadReference: "OTHER-1" }, { proposedStatus: "completed" }, { telegramChatId: 123 },
    { expiresAt: undefined }, { expiresAt: "bad" }, { expiresAt: "2026-10-30T00:00:00Z" }])("rejects injected unsafe claim %j before send/ack/fail", async overrides => {
    const f = fixture([]); const qa = delivery(overrides);
    expect((await runDispatchReviewDeliveryDrain({ ledger: delivery(), qaLedger: qa, gateway: f.gateway, singleLoadQaEnabled: true })).status).toBe("failed");
    expect(f.send).not.toHaveBeenCalled(); expect(qa.ack).not.toHaveBeenCalled(); expect(qa.fail).not.toHaveBeenCalled();
  });
  it("RPC missing or expiry error cannot send", async () => {
    const f = fixture([]); const qa = delivery(); qa.claim = vi.fn(async () => { throw new Error("rpc_missing"); });
    expect((await runDispatchReviewDeliveryDrain({ ledger: delivery(), qaLedger: qa, gateway: f.gateway, singleLoadQaEnabled: true })).status).toBe("failed");
    expect(f.send).not.toHaveBeenCalled();
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-02T23:59:59Z"));
    expect((await runDispatchReviewDeliveryDrain({ ledger: delivery(), qaLedger: qa, gateway: f.gateway, singleLoadQaEnabled: true })).status).toBe("disabled");
    expect(qa.claim).toHaveBeenCalledTimes(1);
  });
});