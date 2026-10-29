// TG-G1A — Dispatch Telegram group recognition + review decision foundation.
//
// PURE, FAIL-CLOSED, SIDE-EFFECT-FREE. Runtime-neutral TypeScript: no env, no
// network, no database, no external libraries. NOT wired into the live poller.
//
// Contract:
//   1. parseDispatchMessageCandidate — conservative deterministic recognition
//      of an explicit past-tense completion/cancellation that names exactly one
//      explicit load reference. False negatives are intended; any negation,
//      intent, request, question, quotation or future wording is a no-op.
//   2. resolveDispatchCandidate — exact normalized reference match against a
//      CALLER-SUPPLIED, workspace-scoped set of current loads. Produces at most
//      an uncommitted review proposal. Never mutates anything.
//   3. buildDispatchProposalKey — stable, non-sensitive key (<= 200 chars)
//      from validated Telegram chat id + update id + load + target status.
//   4. validateDispatchReviewDecision — explicit accept/reject bound to the
//      same pending proposal. Accept never yields "approved": it yields
//      `pending_server_authorization` with a typed intent for the existing
//      telegram_dispatch_update_driver_load_status wrapper plus the server
//      checks that must be enforced atomically there.
//   5. summarizeDispatchProposal — bounded display summary; never echoes raw
//      group message text.
//
// Driver names or hints in text NEVER become a driver user id or authority.
// The Telegram sender id is NEVER treated as an authorized actor here.
// Real sanitized dispatch-group message examples are still required before any
// broader wording is recognized.

export const DISPATCH_LOAD_STATUSES = ["pending", "en_route", "completed", "cancelled"] as const;
export type DispatchLoadStatus = (typeof DISPATCH_LOAD_STATUSES)[number];
export type DispatchTargetStatus = "completed" | "cancelled";

const TERMINAL: ReadonlySet<string> = new Set(["completed", "cancelled"]);
const OPEN: ReadonlySet<string> = new Set(["pending", "en_route"]);
const MAX_TEXT = 500;
const MAX_KEY = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Explicit labelled reference: "Load #ABC123", "Ref ABC123", "Ref: ABC123",
// "load reference ABC123", "load ref ABC123". 4–24 chars, A–Z/0–9/hyphen,
// must contain a digit, must start and end alphanumeric.
// The label captures the whole following token; shape is validated afterwards
// so a labelled-but-malformed reference is reported, never silently skipped.
const REFERENCE_LABEL = /\b(?:load\s*#|load\s+ref(?:erence)?\s*[:#]?|ref\s*[:#]?)\s*([A-Za-z0-9-]*)/gi;
const REFERENCE_SHAPE = /^(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{2,22}[A-Z0-9]$/;
const COMPLETION = /\b(?:completed|delivered)\b/i;
const CANCELLATION = /\b(?:cancelled|canceled)\b/i;
// Any of these makes the message non-assertive → no-op.
const DISQUALIFIERS: RegExp[] = [
  /[?"“”‘’'`«»]/, // questions, quotations, contractions (n't)
  /^\s*>/m, // quoted reply lines
  /\b(?:not|no|never|nor|without|isn|wasn|hasn|haven|didn|won|cannot)\b/i,
  /\b(?:will|shall|going|gonna|about|soon|tomorrow|later|tonight|eta|expected|expect|scheduled|schedule|plan|planned|planning)\b/i,
  /\b(?:please|pls|plz|can|could|should|would|may|might|must|need|needs|want|wants|let|lets|request|requested|asking|ask)\b/i,
  /\b(?:was|were|did|does|do|is|are|has|have|had|who|what|why|how|which|where)\b/i, // question forms without "?"
  /\b(?:if|when|whether|unless|maybe|perhaps|possibly|probably)\b/i,
  /\b(?:ignore|test|testing|example|sample|demo|undo|revert|reverse|reversed|mistake|wrong|oops|disregard|correction)\b/i,
  /\b(?:cancel|deliver|complete|delivering|completing|cancelling|canceling)\b/i, // present/progressive forms
];

export interface DispatchGroupMessageInput {
  chatType: unknown;
  telegramChatId: unknown;
  updateId: unknown;
  text: unknown;
}

export type DispatchNoOpReason =
  | "not_group_chat"
  | "invalid_metadata"
  | "no_text"
  | "text_too_long"
  | "non_assertive_wording"
  | "no_event"
  | "no_reference";

export type DispatchAmbiguousReason = "conflicting_events" | "multiple_references" | "invalid_reference";

export type DispatchMessageCandidate =
  | { kind: "no_op"; reason: DispatchNoOpReason }
  | { kind: "ambiguous"; reason: DispatchAmbiguousReason }
  | {
      kind: "proposed";
      event: DispatchTargetStatus;
      reference: string;
      telegramChatId: number;
      updateId: number;
    };

export function isValidTelegramChatId(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v !== 0;
}
export function isValidTelegramUpdateId(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

export function normalizeDispatchReference(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const r = v.trim().toUpperCase();
  return REFERENCE_SHAPE.test(r) ? r : null;
}

export function parseDispatchMessageCandidate(input: DispatchGroupMessageInput): DispatchMessageCandidate {
  if (input == null || typeof input !== "object") return { kind: "no_op", reason: "invalid_metadata" };
  if (input.chatType !== "group" && input.chatType !== "supergroup") return { kind: "no_op", reason: "not_group_chat" };
  if (!isValidTelegramChatId(input.telegramChatId) || !isValidTelegramUpdateId(input.updateId)) {
    return { kind: "no_op", reason: "invalid_metadata" };
  }
  if (typeof input.text !== "string" || input.text.trim() === "") return { kind: "no_op", reason: "no_text" };
  const text = input.text;
  if (text.length > MAX_TEXT) return { kind: "no_op", reason: "text_too_long" };
  if (text.trim().startsWith("/")) return { kind: "no_op", reason: "non_assertive_wording" };
  if (DISQUALIFIERS.some(rx => rx.test(text))) return { kind: "no_op", reason: "non_assertive_wording" };

  const completed = COMPLETION.test(text);
  const cancelled = CANCELLATION.test(text);
  if (!completed && !cancelled) return { kind: "no_op", reason: "no_event" };
  if (completed && cancelled) return { kind: "ambiguous", reason: "conflicting_events" };

  const refs = new Set<string>();
  let invalid = false;
  for (const m of text.matchAll(REFERENCE_LABEL)) {
    const r = normalizeDispatchReference(m[1]);
    if (r) refs.add(r); else invalid = true;
  }
  if (refs.size === 0) return invalid ? { kind: "ambiguous", reason: "invalid_reference" } : { kind: "no_op", reason: "no_reference" };
  if (refs.size > 1 || invalid) return { kind: "ambiguous", reason: "multiple_references" };

  return {
    kind: "proposed",
    event: completed ? "completed" : "cancelled",
    reference: [...refs][0],
    telegramChatId: input.telegramChatId,
    updateId: input.updateId,
  };
}

// ── Resolution ────────────────────────────────────────────────────────────

/** Caller-supplied CURRENT workspace-scoped load. Only these keys are trusted. */
export interface ScopedCandidateLoad {
  loadId: string;
  relationshipId: string;
  reference: string;
  status: string;
  /** Display-only metadata. Never used for matching or authority. */
  driverHint?: string | null;
}
const LOAD_KEYS = new Set(["loadId", "relationshipId", "reference", "status", "driverHint"]);

export interface DispatchResolutionScope {
  /** The bound chat the candidate loads were scoped to by the caller. */
  telegramChatId: number;
  /** Active relationship ids the caller verified for that chat binding. */
  activeRelationshipIds: readonly string[];
}

export interface DispatchReviewProposal {
  kind: "review_proposal";
  proposalKey: string;
  telegramChatId: number;
  updateId: number;
  loadId: string;
  relationshipId: string;
  reference: string;
  expectedPreviousStatus: "pending" | "en_route";
  targetStatus: DispatchTargetStatus;
  committed: false;
  requiresServerAuthorization: true;
}

export type DispatchResolution =
  | { kind: "no_action"; reason: "candidate_not_proposed" | "no_match" | "already_in_target_status" }
  | {
      kind: "requires_review";
      reason:
        | "invalid_scope"
        | "scope_mismatch"
        | "untrusted_candidate_field"
        | "multiple_matches"
        | "relationship_not_in_scope"
        | "terminal_status_conflict"
        | "invalid_transition";
    }
  | DispatchReviewProposal;

function isTrustedLoad(l: unknown): l is ScopedCandidateLoad {
  if (l == null || typeof l !== "object" || Array.isArray(l)) return false;
  for (const k of Object.keys(l)) if (!LOAD_KEYS.has(k)) return false;
  const x = l as Record<string, unknown>;
  return (
    typeof x.loadId === "string" && UUID.test(x.loadId) &&
    typeof x.relationshipId === "string" && UUID.test(x.relationshipId) &&
    normalizeDispatchReference(x.reference) !== null &&
    typeof x.status === "string" && (DISPATCH_LOAD_STATUSES as readonly string[]).includes(x.status) &&
    (x.driverHint === undefined || x.driverHint === null || typeof x.driverHint === "string")
  );
}

export function resolveDispatchCandidate(
  candidate: DispatchMessageCandidate,
  loads: readonly unknown[],
  scope: DispatchResolutionScope,
): DispatchResolution {
  if (candidate?.kind !== "proposed") return { kind: "no_action", reason: "candidate_not_proposed" };
  if (
    scope == null || !isValidTelegramChatId(scope.telegramChatId) || !Array.isArray(scope.activeRelationshipIds) ||
    !scope.activeRelationshipIds.every(id => typeof id === "string" && UUID.test(id)) || !Array.isArray(loads)
  ) return { kind: "requires_review", reason: "invalid_scope" };
  if (scope.telegramChatId !== candidate.telegramChatId) return { kind: "requires_review", reason: "scope_mismatch" };
  if (!loads.every(isTrustedLoad)) return { kind: "requires_review", reason: "untrusted_candidate_field" };

  const matches = (loads as ScopedCandidateLoad[]).filter(l => normalizeDispatchReference(l.reference) === candidate.reference);
  if (matches.length === 0) return { kind: "no_action", reason: "no_match" };
  if (matches.length > 1) return { kind: "requires_review", reason: "multiple_matches" };
  const load = matches[0];
  if (!scope.activeRelationshipIds.includes(load.relationshipId)) return { kind: "requires_review", reason: "relationship_not_in_scope" };
  if (TERMINAL.has(load.status)) {
    return load.status === candidate.event
      ? { kind: "no_action", reason: "already_in_target_status" }
      : { kind: "requires_review", reason: "terminal_status_conflict" };
  }
  if (!OPEN.has(load.status)) return { kind: "requires_review", reason: "invalid_transition" };

  const proposalKey = buildDispatchProposalKey({
    telegramChatId: candidate.telegramChatId, updateId: candidate.updateId,
    loadId: load.loadId, targetStatus: candidate.event,
  });
  if (proposalKey === null) return { kind: "requires_review", reason: "invalid_scope" };
  return {
    kind: "review_proposal",
    proposalKey,
    telegramChatId: candidate.telegramChatId,
    updateId: candidate.updateId,
    loadId: load.loadId,
    relationshipId: load.relationshipId,
    reference: candidate.reference,
    expectedPreviousStatus: load.status as "pending" | "en_route",
    targetStatus: candidate.event,
    committed: false,
    requiresServerAuthorization: true,
  };
}

// ── Stable proposal / dedupe key ──────────────────────────────────────────

/**
 * Deterministic, non-sensitive key. Contains only validated numeric Telegram
 * ids, a UUID and a fixed status token — no message text, names or secrets.
 * Not a DB idempotency reservation; the server remains the idempotency owner.
 */
export function buildDispatchProposalKey(parts: {
  telegramChatId: unknown;
  updateId: unknown;
  loadId?: unknown;
  targetStatus?: unknown;
}): string | null {
  if (!isValidTelegramChatId(parts.telegramChatId) || !isValidTelegramUpdateId(parts.updateId)) return null;
  let key = `tg-dg:v1:${parts.telegramChatId}:${parts.updateId}`;
  if (parts.loadId !== undefined) {
    if (typeof parts.loadId !== "string" || !UUID.test(parts.loadId)) return null;
    key += `:${parts.loadId}`;
  }
  if (parts.targetStatus !== undefined) {
    if (parts.targetStatus !== "completed" && parts.targetStatus !== "cancelled") return null;
    key += `:${parts.targetStatus}`;
  }
  return key.length <= MAX_KEY ? key : null;
}

// ── Review decision validator ─────────────────────────────────────────────

export type DispatchProposalState = "pending" | "accepted" | "rejected" | "expired" | "superseded";

export interface DispatchReviewDecisionInput {
  action: unknown;
  proposalKey: unknown;
  telegramChatId: unknown;
  updateId: unknown;
  loadId: unknown;
  expectedPreviousStatus: unknown;
  /** Telegram id of the person pressing the button. NOT authority. */
  reviewerTelegramUserId: unknown;
}

/** Checks the backend MUST perform atomically before any status change. */
export const DISPATCH_REVIEW_REQUIRED_SERVER_CHECKS = [
  "active_chat_binding_for_telegram_chat_id",
  "active_linked_reviewer_identity",
  "recruiter_permission_loads_update_status",
  "active_driver_relationship_for_binding_recruiter",
  "current_load_status_equals_expected_previous_status",
  "proposal_still_pending_and_unconsumed",
] as const;

/**
 * Checks the existing telegram_dispatch_update_driver_load_status wrapper does
 * not take as input today and therefore cannot be proven by this contract.
 */
export const DISPATCH_REVIEW_UNREPRESENTED_SERVER_CHECKS = [
  "current_load_status_equals_expected_previous_status",
  "proposal_still_pending_and_unconsumed",
] as const;

export interface DispatchStatusUpdateIntent {
  rpc: "telegram_dispatch_update_driver_load_status";
  args: {
    _telegram_user_id: number;
    _telegram_chat_id: number;
    _relationship_id: string;
    _load_id: string;
    _new_status: DispatchTargetStatus;
    _idempotency_key: string;
  };
  expectedPreviousStatus: "pending" | "en_route";
  requiredServerChecks: readonly string[];
  unrepresentedServerChecks: readonly string[];
}

export type DispatchReviewDecisionResult =
  | { kind: "invalid"; reason: "malformed_decision" | "unknown_action" | "proposal_not_pending" | "proposal_mismatch" | "invalid_proposal" }
  | { kind: "declined"; proposalKey: string }
  | { kind: "pending_server_authorization"; intent: DispatchStatusUpdateIntent };

export function validateDispatchReviewDecision(
  proposal: DispatchReviewProposal,
  proposalState: DispatchProposalState,
  decision: DispatchReviewDecisionInput,
): DispatchReviewDecisionResult {
  if (proposal?.kind !== "review_proposal" || proposal.committed !== false) return { kind: "invalid", reason: "invalid_proposal" };
  const expectedKey = buildDispatchProposalKey({
    telegramChatId: proposal.telegramChatId, updateId: proposal.updateId,
    loadId: proposal.loadId, targetStatus: proposal.targetStatus,
  });
  if (expectedKey === null || expectedKey !== proposal.proposalKey || !UUID.test(proposal.relationshipId) || !OPEN.has(proposal.expectedPreviousStatus)) {
    return { kind: "invalid", reason: "invalid_proposal" };
  }
  if (decision == null || typeof decision !== "object") return { kind: "invalid", reason: "malformed_decision" };
  if (decision.action !== "accept" && decision.action !== "reject") return { kind: "invalid", reason: "unknown_action" };
  if (proposalState !== "pending") return { kind: "invalid", reason: "proposal_not_pending" };
  if (
    decision.proposalKey !== proposal.proposalKey ||
    decision.telegramChatId !== proposal.telegramChatId ||
    decision.updateId !== proposal.updateId ||
    decision.loadId !== proposal.loadId ||
    decision.expectedPreviousStatus !== proposal.expectedPreviousStatus
  ) return { kind: "invalid", reason: "proposal_mismatch" };
  const reviewer = decision.reviewerTelegramUserId;
  if (typeof reviewer !== "number" || !Number.isSafeInteger(reviewer) || reviewer <= 0) {
    return { kind: "invalid", reason: "malformed_decision" };
  }
  if (decision.action === "reject") return { kind: "declined", proposalKey: proposal.proposalKey };
  return {
    kind: "pending_server_authorization",
    intent: {
      rpc: "telegram_dispatch_update_driver_load_status",
      args: {
        _telegram_user_id: reviewer,
        _telegram_chat_id: proposal.telegramChatId,
        _relationship_id: proposal.relationshipId,
        _load_id: proposal.loadId,
        _new_status: proposal.targetStatus,
        _idempotency_key: proposal.proposalKey,
      },
      expectedPreviousStatus: proposal.expectedPreviousStatus,
      requiredServerChecks: DISPATCH_REVIEW_REQUIRED_SERVER_CHECKS,
      unrepresentedServerChecks: DISPATCH_REVIEW_UNREPRESENTED_SERVER_CHECKS,
    },
  };
}

// ── Display summary ───────────────────────────────────────────────────────

export interface DispatchProposalDisplaySummary {
  title: string;
  reference: string;
  fromStatusLabel: string;
  toStatusLabel: string;
  note: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", en_route: "En route", completed: "Completed", cancelled: "Cancelled",
};

/** Bounded, fixed-vocabulary summary. Never includes raw group message text or driver hints. */
export function summarizeDispatchProposal(proposal: DispatchReviewProposal): DispatchProposalDisplaySummary | null {
  if (proposal?.kind !== "review_proposal") return null;
  const reference = normalizeDispatchReference(proposal.reference);
  const from = STATUS_LABEL[proposal.expectedPreviousStatus];
  const to = STATUS_LABEL[proposal.targetStatus];
  if (!reference || !from || !to) return null;
  return {
    title: proposal.targetStatus === "completed" ? "Mark load completed?" : "Mark load cancelled?",
    reference,
    fromStatusLabel: from,
    toStatusLabel: to,
    note: "Suggested from a group message. Nothing changes until an authorized reviewer approves and the server re-checks access.",
  };
}
