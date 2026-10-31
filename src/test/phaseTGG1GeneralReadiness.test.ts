// Synthetic transport tests exercise production orchestration, not SQL authorization.
// Authorization and financial preservation remain covered by disposable PG tests.
import { describe, it, expect, vi } from "vitest";
import { runTelegramPoll, runDispatchReviewDeliveryDrain, classifyUpdate,
  type TelegramPollLedger, type TelegramGateway } from "../../supabase/functions/_shared/telegram-poll-ingest";
import { composeDispatchReviewData, type DispatchDeliveryLedger,
  type DispatchReviewActionResultCode } from "../../supabase/functions/_shared/telegram-dispatch-group-review";

const ID = "00000000-0000-4000-8000-000000000001";
const GROUP = -100777;
function fixture(code: DispatchReviewActionResultCode = "dispatch_review_accepted", action: "accept" | "reject" = "accept", chatId = GROUP, chatType = "supergroup") {
  let committed = false;
  const review = vi.fn(async () => { const isNew = !committed; committed = true; return { isNew, resultCode: code }; });
  const qaReview = vi.fn();
  const ledger: TelegramPollLedger = {
    claimLease: vi.fn(async () => ({ leaseToken: ID, nextOffset: 1 })),
    releaseLease: vi.fn(async () => true), advanceCursor: vi.fn(async (_token, id) => id),
    recordIgnoredUpdate: async i => ({ isNew: true, resultCode: i.resultCode }),
    processStartUpdate: async () => ({ isNew: true, resultCode: "link_rejected" }),
    processBindUpdate: async () => ({ isNew: true, resultCode: "bind_rejected" }),
    processConversationActionUpdate: async () => ({ isNew: true, resultCode: "conversation_action_invalid" }),
    processDispatchReviewActionUpdate: review, processQaDispatchReviewActionUpdate: qaReview,
  };
  const update = { update_id: 1, callback_query: { id: "cb1", from: { id: 601 },
    data: composeDispatchReviewData(action, ID), message: { chat: { id: chatId, type: chatType } } } };
  const send = vi.fn(async () => { expect(committed).toBe(true); return { ok: true, status: 200 }; });
  const gateway: TelegramGateway = { getUpdates: vi.fn(async () => ({ ok: true, status: 200, result: [update] })),
    sendMessage: send, answerCallbackQuery: vi.fn(async () => ({ ok: true, status: 200 })) };
  const log = vi.fn();
  const poll = (general = true, qa = false) => runTelegramPoll({ ledger, gateway, sha256: async () => "hash",
    dispatchReviewEnabled: general, singleLoadQaEnabled: qa, log });
  return { ledger, gateway, send, review, qaReview, update, poll, log };
}
describe("General dispatch staged feedback", () => {
  it.each(["accept", "reject"] as const)("new %s attempts one post-commit button-free notification; replay sends none", async action => {
    const f = fixture(action === "accept" ? "dispatch_review_accepted" : "dispatch_review_rejected", action);
    expect(await f.poll()).toMatchObject({ kind: "ok", advancedTo: 1 });
    expect(f.send.mock.calls).toEqual([[{ chatId: GROUP, text: action === "accept"
      ? "✅ Dispatch review confirmed. The approved load status was updated in HaulTracker Pro."
      : "❌ Dispatch review rejected. No load was changed." }]]);
    await f.poll(); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.qaReview).not.toHaveBeenCalled();
    expect(f.review).toHaveBeenCalledWith(expect.objectContaining({ telegramUserId: 601, telegramChatId: GROUP, proposalId: ID, action }));
  });
  it.each(["dispatch_review_denied", "dispatch_review_stale", "dispatch_review_expired", "dispatch_review_invalid", "dispatch_review_already_handled"] as const)("%s never sends", async code => {
    const f = fixture(code); await f.poll(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([[123, "supergroup"], [GROUP, "private"]] as const)("invalid transport %s/%s never sends even with injected success", async (chat, type) => {
    const f = fixture("dispatch_review_accepted", "accept", chat, type); await f.poll(); expect(f.send).not.toHaveBeenCalled();
  });
  it("mismatched action/result never sends", async () => {
    const f = fixture("dispatch_review_accepted", "reject"); await f.poll(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["g1:invalid", `c1:a:${ID}`, "q1:n"])("other or invalid callback %s never sends", async data => {
    const f = fixture(); f.update.callback_query.data = data; await f.poll(); expect(f.send).not.toHaveBeenCalled();
  });
  it("missing general wrapper fails closed", async () => {
    const f = fixture(); delete f.ledger.processDispatchReviewActionUpdate;
    expect(await f.poll()).toMatchObject({ kind: "failed", advancedTo: null });
    expect(f.send).not.toHaveBeenCalled(); expect(f.qaReview).not.toHaveBeenCalled();
  });
  it.each(["response", "throw"])("send %s failure is sanitized and never retried or rolled back", async failure => {
    const f = fixture(); f.gateway.sendMessage = vi.fn(async () => {
      if (failure === "throw") throw new Error("private provider detail");
      return { ok: false, status: 403, errorCode: "private provider detail" };
    });
    expect(await f.poll()).toMatchObject({ kind: "ok", advancedTo: 1 });
    expect(f.log).toHaveBeenCalledWith("dispatch_review_ack_failed", { code: "telegram_poll_unexpected_error" });
    await f.poll(); expect(f.gateway.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("callback answer failure cannot suppress committed group feedback", async () => {
    const f = fixture(); f.gateway.answerCallbackQuery = vi.fn(async () => { throw new Error("toast_failed"); });
    expect(await f.poll()).toMatchObject({ kind: "ok", advancedTo: 1 }); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("both OFF never invoke dispatch or send", async () => {
    const f = fixture(); await f.poll(false); expect(f.review).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("conflicting flags stop before lease, transport, RPC or outbox claim", async () => {
    const f = fixture(); expect(await f.poll(true, true)).toMatchObject({ kind: "failed", errorCode: "dispatch_modes_conflict" });
    expect(f.ledger.claimLease).not.toHaveBeenCalled(); expect(f.gateway.getUpdates).not.toHaveBeenCalled(); expect(f.review).not.toHaveBeenCalled();
    const delivery: DispatchDeliveryLedger = { claim: vi.fn(async () => null), ack: vi.fn(async () => true), fail: vi.fn(async () => true) };
    expect(await runDispatchReviewDeliveryDrain({ ledger: delivery, qaLedger: delivery, gateway: f.gateway, enabled: true, singleLoadQaEnabled: true })).toMatchObject({ status: "failed" });
    expect(delivery.claim).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    const identity = { updateId: 1, telegramUserId: 601, telegramChatId: GROUP, chatType: "supergroup", text: "/cancelled HTP-QA-L2",
      callbackQueryId: null, callbackData: null, replyToMessageId: null };
    expect(classifyUpdate(identity, true, true).kind).toBe("ignored");
    expect(classifyUpdate({ ...identity, text: `/bind ${"a".repeat(64)}` }, true, true).kind).toBe("bind");
  });
});