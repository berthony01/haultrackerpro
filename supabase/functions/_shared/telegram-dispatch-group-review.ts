// Phase TG-G1B — dispatch-group review adapter (runtime-neutral, pure).
//
// Bridges the TG-G1A deterministic parser to the TG-G1B candidate RPCs
// (supabase/migration-candidates/20261029183000_tgg1b_dispatch_review_queue.sql).
//
// HARD-DISABLED. `TGG1B_DISPATCH_GROUP_REVIEW_ENABLED` is a compile-time
// `false` literal — there is deliberately NO environment/runtime flag. TG-G1C
// stages the poller wiring (telegram-poll-ingest.ts / telegram-poll/index.ts)
// behind this constant, so with it off behaviour is bit-for-bit unchanged.
//
// Activation gates (each separately approved, in order):
//   1. apply the candidate migration and verify receipts/RLS/grants live;
//   2. obtain real sanitized group-message examples and widen tests;
//   3. wire `routeDispatchGroupUpdate` into classifyUpdate AFTER the `/bind`
//      branch and BEFORE the `non_private_message` fallback, and the `g1`
//      callback namespace BEFORE the `c1` fallback;
//   4. flip the constant below in a reviewed commit, set Telegram privacy
//      mode, deploy, and run live E2E.
//
// Never: AI parsing, raw text persistence/logging, identities from chat text
// or callback payloads, automatic load status changes on intake.

import {
  parseDispatchMessageCandidate,
  type DispatchTargetStatus,
} from "./telegram-dispatch-group-proposals.ts";

export const TGG1B_DISPATCH_GROUP_REVIEW_ENABLED = false as const;

/** Callback namespace, disjoint from RB-2B `c1:` and RB-3A `q1:`. */
export const DISPATCH_REVIEW_CALLBACK_PREFIX = "g1:";
const CALLBACK_DATA_MAX_BYTES = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CALLBACK_PATTERN = /^g1:(a|r):([0-9a-f-]{36})$/;
const MAX_REPLY_CHARS = 300;

export type DispatchReviewAction = "accept" | "reject";

export type DispatchIntakeResultCode = "dispatch_review_proposed" | "dispatch_review_no_action";
export type DispatchReviewActionResultCode =
  | "dispatch_review_accepted"
  | "dispatch_review_rejected"
  | "dispatch_review_already_handled"
  | "dispatch_review_expired"
  | "dispatch_review_stale"
  | "dispatch_review_denied"
  | "dispatch_review_invalid";

export const DISPATCH_INTAKE_RESULT_CODES: readonly DispatchIntakeResultCode[] = [
  "dispatch_review_proposed",
  "dispatch_review_no_action",
];
export const DISPATCH_REVIEW_ACTION_RESULT_CODES: readonly DispatchReviewActionResultCode[] = [
  "dispatch_review_accepted",
  "dispatch_review_rejected",
  "dispatch_review_already_handled",
  "dispatch_review_expired",
  "dispatch_review_stale",
  "dispatch_review_denied",
  "dispatch_review_invalid",
];

export function composeDispatchReviewData(action: DispatchReviewAction, proposalId: string): string | null {
  if (!UUID.test(proposalId)) return null;
  const data = `${DISPATCH_REVIEW_CALLBACK_PREFIX}${action === "accept" ? "a" : "r"}:${proposalId}`;
  return new TextEncoder().encode(data).length <= CALLBACK_DATA_MAX_BYTES ? data : null;
}

export function isDispatchReviewCallbackData(data: unknown): boolean {
  return typeof data === "string" && data.startsWith(DISPATCH_REVIEW_CALLBACK_PREFIX);
}

export function parseDispatchReviewData(
  data: unknown,
): { action: DispatchReviewAction; proposalId: string } | null {
  if (typeof data !== "string" || data.length > CALLBACK_DATA_MAX_BYTES) return null;
  const m = CALLBACK_PATTERN.exec(data);
  if (!m || !UUID.test(m[2])) return null;
  return { action: m[1] === "a" ? "accept" : "reject", proposalId: m[2] };
}

/** Routing predicate for the future poller wiring. Always false while the
 *  compile-time gate is off, regardless of input. */
export function routeDispatchGroupUpdate(
  identity: { chatType: string | null; callbackData: string | null; text: string | null },
  enabled: boolean = TGG1B_DISPATCH_GROUP_REVIEW_ENABLED,
): "group_message" | "review_callback" | null {
  if (enabled !== true) return null;
  if (identity.chatType !== "group" && identity.chatType !== "supergroup") return null;
  if (isDispatchReviewCallbackData(identity.callbackData)) return "review_callback";
  if (typeof identity.text === "string" && identity.callbackData == null) return "group_message";
  return null;
}

// ── DB side (mirrors the candidate RPCs) ──────────────────────────────────

export interface DispatchReviewLedger {
  processGroupUpdate(input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
    reference: string | null;
    proposedStatus: DispatchTargetStatus | null;
  }): Promise<{
    isNew: boolean;
    resultCode: DispatchIntakeResultCode;
    proposalId: string | null;
    expiresAt: string | null;
  }>;
  processReviewAction(input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
    action: DispatchReviewAction | null;
    proposalId: string | null;
  }): Promise<{ isNew: boolean; resultCode: DispatchReviewActionResultCode }>;
}

export interface DispatchInlineButton {
  text: string;
  callbackData: string;
}

export interface DispatchGroupOutcome {
  resultCode: DispatchIntakeResultCode;
  isNew: boolean;
  /** Bounded bot reply. Contains only the parser-normalized reference and a
   *  fixed status word — never the original message text. */
  replyText: string | null;
  buttons: DispatchInlineButton[][] | null;
}

const STATUS_WORD: Record<DispatchTargetStatus, string> = {
  completed: "delivered (completed)",
  cancelled: "cancelled",
};

function bound(text: string): string {
  return text.length <= MAX_REPLY_CHARS ? text : text.slice(0, MAX_REPLY_CHARS);
}

/** Intake for one group text message. Never changes a load. DB errors
 *  propagate unchanged so no receipt is written and the cursor stays put. */
export async function processDispatchGroupMessage(
  ledger: DispatchReviewLedger,
  input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
    text: string | null;
  },
): Promise<DispatchGroupOutcome> {
  const candidate = parseDispatchMessageCandidate({
    chatType: input.chatType,
    telegramChatId: input.telegramChatId,
    updateId: input.updateId,
    text: input.text,
  });
  const proposed = candidate.kind === "proposed" ? candidate : null;
  const result = await ledger.processGroupUpdate({
    leaseToken: input.leaseToken,
    updateId: input.updateId,
    payloadHash: input.payloadHash,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    chatType: input.chatType,
    reference: proposed?.reference ?? null,
    proposedStatus: proposed?.event ?? null,
  });

  if (result.resultCode !== "dispatch_review_proposed" || !result.isNew || !proposed || !result.proposalId) {
    return { resultCode: result.resultCode, isNew: result.isNew, replyText: null, buttons: null };
  }
  const accept = composeDispatchReviewData("accept", result.proposalId);
  const reject = composeDispatchReviewData("reject", result.proposalId);
  if (!accept || !reject) {
    return { resultCode: result.resultCode, isNew: result.isNew, replyText: null, buttons: null };
  }
  return {
    resultCode: result.resultCode,
    isNew: true,
    replyText: bound(
      `Review needed: mark load ${proposed.reference} as ${STATUS_WORD[proposed.event]}? ` +
        "Nothing has changed yet. An authorized dispatcher must confirm within 15 minutes.",
    ),
    buttons: [[{ text: "Confirm", callbackData: accept }, { text: "Reject", callbackData: reject }]],
  };
}

export const DISPATCH_REVIEW_ANSWERS: Record<DispatchReviewActionResultCode, string> = {
  dispatch_review_accepted: "Confirmed. The load status was updated.",
  dispatch_review_rejected: "Rejected. No load was changed.",
  dispatch_review_already_handled: "This review was already handled.",
  dispatch_review_expired: "This review expired. No load was changed.",
  dispatch_review_stale: "The load changed since this review. No load was changed.",
  dispatch_review_denied: "You are not authorized to review this load. No load was changed.",
  dispatch_review_invalid: "This review is not available.",
};

/** Review button tap. The reviewer is `callback_query.from.id` supplied by
 *  the trusted poller; the payload is only an untrusted locator. */
export async function processDispatchReviewCallback(
  ledger: DispatchReviewLedger,
  input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
    callbackData: string | null;
  },
): Promise<{ resultCode: DispatchReviewActionResultCode; isNew: boolean; answerText: string }> {
  const parsed = parseDispatchReviewData(input.callbackData);
  const result = await ledger.processReviewAction({
    leaseToken: input.leaseToken,
    updateId: input.updateId,
    payloadHash: input.payloadHash,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    chatType: input.chatType,
    action: parsed?.action ?? null,
    proposalId: parsed?.proposalId ?? null,
  });
  return { resultCode: result.resultCode, isNew: result.isNew, answerText: DISPATCH_REVIEW_ANSWERS[result.resultCode] };
}

export type DispatchDeliveryFailure = "network" | "timeout" | "rate_limited" | "telegram_server" | "telegram_rejected" | "chat_unavailable" | "unknown";
export interface DispatchDeliveryClaim {
  outboxId: string;
  claimToken: string;
  proposalId: string;
  telegramChatId: number;
  loadReference: string;
  proposedStatus: DispatchTargetStatus;
}
export interface DispatchDeliveryLedger {
  claim(): Promise<DispatchDeliveryClaim | null>;
  ack(outboxId: string, claimToken: string, messageId: number): Promise<boolean>;
  fail(outboxId: string, claimToken: string, code: DispatchDeliveryFailure): Promise<boolean>;
}
/** Injected port only: this module performs no network I/O. The durable
 * outbox, NOT the intake reply, owns future notification delivery. */
export interface DispatchDeliveryPort {
  deliver(input: { chatId: number; text: string; buttons: DispatchInlineButton[][] }): Promise<
    { ok: true; messageId: number } | { ok: false; code: DispatchDeliveryFailure }
  >;
}
/** Default OFF. An explicitly supplied test gate exercises the pure adapter.
 * Unknown failures are bounded, never logged/persisted as provider text.
 * Ack errors propagate: the SQL lease will recover, possibly duplicating a
 * successfully delivered message. Exactly-once Telegram delivery is impossible. */
export async function processDispatchDelivery(
  ledger: DispatchDeliveryLedger,
  port: DispatchDeliveryPort,
  enabled: boolean = TGG1B_DISPATCH_GROUP_REVIEW_ENABLED,
): Promise<"disabled" | "empty" | "sent" | "retry" | "lease_lost"> {
  if (enabled !== true) return "disabled";
  const claim = await ledger.claim();
  if (!claim) return "empty";
  const accept = composeDispatchReviewData("accept", claim.proposalId);
  const reject = composeDispatchReviewData("reject", claim.proposalId);
  if (!accept || !reject || !Number.isSafeInteger(claim.telegramChatId) || claim.telegramChatId === 0 ||
      !/^(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{2,22}[A-Z0-9]$/.test(claim.loadReference) ||
      (claim.proposedStatus !== "completed" && claim.proposedStatus !== "cancelled")) {
    return await ledger.fail(claim.outboxId, claim.claimToken, "unknown") ? "retry" : "lease_lost";
  }
  let result: Awaited<ReturnType<DispatchDeliveryPort["deliver"]>>;
  try {
    result = await port.deliver({
      chatId: claim.telegramChatId,
      text: bound(`Review needed: mark load ${claim.loadReference} as ${STATUS_WORD[claim.proposedStatus]}? Nothing has changed yet.`),
      buttons: [[{ text: "Confirm", callbackData: accept }, { text: "Reject", callbackData: reject }]],
    });
  } catch {
    result = { ok: false, code: "unknown" };
  }
  if (result.ok === false) return await ledger.fail(claim.outboxId, claim.claimToken, result.code) ? "retry" : "lease_lost";
  if (!Number.isSafeInteger(result.messageId) || result.messageId <= 0) {
    return await ledger.fail(claim.outboxId, claim.claimToken, "unknown") ? "retry" : "lease_lost";
  }
  return await ledger.ack(claim.outboxId, claim.claimToken, result.messageId) ? "sent" : "lease_lost";
}
