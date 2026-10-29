import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseDispatchMessageCandidate,
  resolveDispatchCandidate,
  buildDispatchProposalKey,
  validateDispatchReviewDecision,
  summarizeDispatchProposal,
  DISPATCH_REVIEW_UNREPRESENTED_SERVER_CHECKS,
  type DispatchReviewProposal,
  type ScopedCandidateLoad,
} from "../../supabase/functions/_shared/telegram-dispatch-group-proposals";
import { classifyUpdate } from "../../supabase/functions/_shared/telegram-poll-ingest";

const CHAT = -1001234567890;
const LOAD_A = "11111111-1111-4111-8111-111111111111";
const LOAD_B = "22222222-2222-4222-8222-222222222222";
const REL = "33333333-3333-4333-8333-333333333333";
const REL_OTHER = "44444444-4444-4444-8444-444444444444";

const msg = (text: unknown, over: Record<string, unknown> = {}) =>
  parseDispatchMessageCandidate({ chatType: "supergroup", telegramChatId: CHAT, updateId: 77, text, ...over });
const loadRow = (over: Partial<ScopedCandidateLoad> = {}): ScopedCandidateLoad =>
  ({ loadId: LOAD_A, relationshipId: REL, reference: "ABC123", status: "en_route", ...over });
const scope = { telegramChatId: CHAT, activeRelationshipIds: [REL] };

function proposalFor(text = "Load #ABC123 delivered", loads: unknown[] = [loadRow()]): DispatchReviewProposal {
  const r = resolveDispatchCandidate(msg(text), loads, scope);
  if (r.kind !== "review_proposal") throw new Error(`expected proposal, got ${JSON.stringify(r)}`);
  return r;
}

describe("TG-G1A parse — high-confidence past-tense events", () => {
  it.each([
    ["Load #ABC123 delivered", "completed"],
    ["Load #abc123 completed", "completed"],
    ["Ref ABC123 delivered at 3pm", "completed"],
    ["Ref: ABC123 cancelled by broker", "cancelled"],
    ["load reference ABC123 canceled", "cancelled"],
    ["Load ref ABC-123 delivered", "completed"],
  ])("%s → %s", (text, event) => {
    const c = msg(text);
    expect(c.kind).toBe("proposed");
    if (c.kind === "proposed") {
      expect(c.event).toBe(event);
      expect(c.telegramChatId).toBe(CHAT);
      expect(c.updateId).toBe(77);
    }
  });
  it("accepts group as well as supergroup", () => {
    expect(msg("Load #ABC123 delivered", { chatType: "group" }).kind).toBe("proposed");
  });
});

describe("TG-G1A parse — negation, intent, questions, quotes, examples are no-ops", () => {
  it.each([
    "Load #ABC123 not delivered",
    "Load #ABC123 wasn't delivered",
    "Load #ABC123 never delivered",
    "Can we cancel Load #ABC123",
    "Please cancel Load #ABC123",
    "please mark Load #ABC123 cancelled",
    "Will deliver Load #ABC123 tomorrow",
    "Load #ABC123 delivered?",
    "Was Load #ABC123 delivered",
    "\"Load #ABC123 delivered\"",
    "> Load #ABC123 delivered",
    "Ignore this: Load #ABC123 cancelled",
    "Example: Load #ABC123 delivered",
    "test Load #ABC123 cancelled",
    "If Load #ABC123 delivered then pay",
    "Load #ABC123 should be delivered",
    "Load #ABC123 delivering now",
    "cancel Load #ABC123",
    "Load #ABC123 cancelled by mistake, undo",
    "/status Load #ABC123 delivered",
  ])("%s", text => {
    expect(msg(text).kind).toBe("no_op");
  });
  it("no event / no reference / non-group / invalid metadata are no-ops", () => {
    expect(msg("Load #ABC123 picked up")).toEqual({ kind: "no_op", reason: "no_event" });
    expect(msg("delivered")).toEqual({ kind: "no_op", reason: "no_reference" });
    expect(msg("ABC123 delivered")).toEqual({ kind: "no_op", reason: "no_reference" });
    expect(msg("Load #ABC123 delivered", { chatType: "private" })).toEqual({ kind: "no_op", reason: "not_group_chat" });
    expect(msg("Load #ABC123 delivered", { chatType: "channel" })).toEqual({ kind: "no_op", reason: "not_group_chat" });
    for (const bad of [0, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 2]) {
      expect(msg("Load #ABC123 delivered", { telegramChatId: bad }).kind).toBe("no_op");
    }
    for (const bad of [0, -1, 2.5, "7", null]) {
      expect(msg("Load #ABC123 delivered", { updateId: bad }).kind).toBe("no_op");
    }
    expect(msg(null)).toEqual({ kind: "no_op", reason: "no_text" });
    expect(msg("   ")).toEqual({ kind: "no_op", reason: "no_text" });
    expect(msg(`Load #ABC123 delivered ${"x".repeat(600)}`)).toEqual({ kind: "no_op", reason: "text_too_long" });
  });
});

describe("TG-G1A parse — corrupt or ambiguous references", () => {
  it.each([
    ["Load #ABC123 delivered and cancelled", "conflicting_events"],
    ["Load #ABC123 and Load #XYZ789 delivered", "multiple_references"],
    ["Load #ABCDEF delivered", "invalid_reference"],
    ["Load #AB1 delivered", "invalid_reference"],
    [`Load #A${"1".repeat(30)} delivered`, "invalid_reference"],
  ])("%s → %s", (text, reason) => {
    expect(msg(text)).toEqual({ kind: "ambiguous", reason });
  });
  it("same reference twice is still a single reference", () => {
    expect(msg("Load #ABC123 delivered, Ref ABC123").kind).toBe("proposed");
  });
  it("driver names in text never appear in the candidate", () => {
    const c = msg("John Smith Load #ABC123 delivered");
    expect(JSON.stringify(c)).not.toMatch(/john|smith/i);
    expect(Object.keys(c).sort()).toEqual(["event", "kind", "reference", "telegramChatId", "updateId"]);
  });
});

describe("TG-G1A resolve — exact scoped single match only", () => {
  it("single open match yields an uncommitted review proposal", () => {
    const p = proposalFor();
    expect(p).toEqual({
      kind: "review_proposal",
      proposalKey: `tg-dg:v1:${CHAT}:77:${LOAD_A}:completed`,
      telegramChatId: CHAT, updateId: 77, loadId: LOAD_A, relationshipId: REL,
      reference: "ABC123", expectedPreviousStatus: "en_route", targetStatus: "completed",
      committed: false, requiresServerAuthorization: true,
    });
  });
  it("pending → cancelled is a valid proposal", () => {
    expect(proposalFor("Ref ABC123 cancelled", [loadRow({ status: "pending" })]).targetStatus).toBe("cancelled");
  });
  it("zero / duplicate matches", () => {
    expect(resolveDispatchCandidate(msg("Load #ZZZ999 delivered"), [loadRow()], scope)).toEqual({ kind: "no_action", reason: "no_match" });
    expect(resolveDispatchCandidate(msg("Load #ABC123 delivered"), [loadRow(), loadRow({ loadId: LOAD_B, reference: "abc123" })], scope))
      .toEqual({ kind: "requires_review", reason: "multiple_matches" });
  });
  it("no fuzzy matching: prefix/suffix references do not match", () => {
    expect(resolveDispatchCandidate(msg("Load #ABC12 delivered"), [loadRow()], scope).kind).toBe("no_action");
    expect(resolveDispatchCandidate(msg("Load #ABC1234 delivered"), [loadRow()], scope).kind).toBe("no_action");
  });
  it("terminal statuses and conflicting updates", () => {
    expect(resolveDispatchCandidate(msg("Load #ABC123 delivered"), [loadRow({ status: "completed" })], scope))
      .toEqual({ kind: "no_action", reason: "already_in_target_status" });
    expect(resolveDispatchCandidate(msg("Load #ABC123 cancelled"), [loadRow({ status: "completed" })], scope))
      .toEqual({ kind: "requires_review", reason: "terminal_status_conflict" });
    expect(resolveDispatchCandidate(msg("Load #ABC123 delivered"), [loadRow({ status: "cancelled" })], scope))
      .toEqual({ kind: "requires_review", reason: "terminal_status_conflict" });
  });
  it("unscoped / unauthorized / untrusted candidates fail closed", () => {
    const c = msg("Load #ABC123 delivered");
    expect(resolveDispatchCandidate(c, [loadRow({ relationshipId: REL_OTHER })], scope))
      .toEqual({ kind: "requires_review", reason: "relationship_not_in_scope" });
    expect(resolveDispatchCandidate(c, [loadRow()], { ...scope, telegramChatId: -999 }))
      .toEqual({ kind: "requires_review", reason: "scope_mismatch" });
    expect(resolveDispatchCandidate(c, [loadRow()], { telegramChatId: CHAT, activeRelationshipIds: ["nope"] }))
      .toEqual({ kind: "requires_review", reason: "invalid_scope" });
    for (const bad of [
      { ...loadRow(), driverUserId: "55555555-5555-4555-8555-555555555555" },
      { ...loadRow(), ownerUserId: "x" },
      loadRow({ status: "delivered" }),
      loadRow({ loadId: "not-a-uuid" }),
      loadRow({ reference: "??" }),
      null,
    ]) {
      expect(resolveDispatchCandidate(c, [bad], scope)).toEqual({ kind: "requires_review", reason: "untrusted_candidate_field" });
    }
    expect(resolveDispatchCandidate({ kind: "no_op", reason: "no_event" }, [loadRow()], scope))
      .toEqual({ kind: "no_action", reason: "candidate_not_proposed" });
  });
  it("driver hints never affect matching or output", () => {
    const p = proposalFor("Load #ABC123 delivered", [loadRow({ driverHint: "Jane Doe" })]);
    expect(JSON.stringify(p)).not.toContain("Jane");
  });
  it("never mutates inputs", () => {
    const loads = [loadRow()];
    const sc = { telegramChatId: CHAT, activeRelationshipIds: [REL] };
    const before = JSON.stringify([loads, sc]);
    const c = msg("Load #ABC123 delivered");
    const cBefore = JSON.stringify(c);
    resolveDispatchCandidate(c, Object.freeze(loads.map(l => Object.freeze({ ...l }))), Object.freeze(sc));
    resolveDispatchCandidate(c, loads, sc);
    expect(JSON.stringify([loads, sc])).toBe(before);
    expect(JSON.stringify(c)).toBe(cBefore);
  });
});

describe("TG-G1A proposal key", () => {
  it("is stable, unique per chat/update/load/target, and bounded", () => {
    const k = buildDispatchProposalKey({ telegramChatId: CHAT, updateId: 77, loadId: LOAD_A, targetStatus: "completed" });
    expect(k).toBe(buildDispatchProposalKey({ telegramChatId: CHAT, updateId: 77, loadId: LOAD_A, targetStatus: "completed" }));
    const others = [
      buildDispatchProposalKey({ telegramChatId: CHAT, updateId: 78, loadId: LOAD_A, targetStatus: "completed" }),
      buildDispatchProposalKey({ telegramChatId: -5, updateId: 77, loadId: LOAD_A, targetStatus: "completed" }),
      buildDispatchProposalKey({ telegramChatId: CHAT, updateId: 77, loadId: LOAD_B, targetStatus: "completed" }),
      buildDispatchProposalKey({ telegramChatId: CHAT, updateId: 77, loadId: LOAD_A, targetStatus: "cancelled" }),
      buildDispatchProposalKey({ telegramChatId: CHAT, updateId: 77 }),
    ];
    expect(new Set([k, ...others]).size).toBe(6);
    expect(k!.length).toBeLessThanOrEqual(200);
    expect(k).toMatch(/^tg-dg:v1:-?\d+:\d+(:[0-9a-f-]{36}:(completed|cancelled))?$/);
  });
  it("rejects invalid parts and never embeds text", () => {
    expect(buildDispatchProposalKey({ telegramChatId: 0, updateId: 1 })).toBeNull();
    expect(buildDispatchProposalKey({ telegramChatId: CHAT, updateId: -1 })).toBeNull();
    expect(buildDispatchProposalKey({ telegramChatId: CHAT, updateId: 1, loadId: "'; DROP TABLE loads;--" })).toBeNull();
    expect(buildDispatchProposalKey({ telegramChatId: CHAT, updateId: 1, loadId: LOAD_A, targetStatus: "pending" })).toBeNull();
  });
});

describe("TG-G1A review decision — never approved locally", () => {
  const p = proposalFor();
  const decision = (over: Record<string, unknown> = {}) => ({
    action: "accept", proposalKey: p.proposalKey, telegramChatId: p.telegramChatId, updateId: p.updateId,
    loadId: p.loadId, expectedPreviousStatus: p.expectedPreviousStatus, reviewerTelegramUserId: 9001, ...over,
  });
  it("accept yields pending_server_authorization intent for the existing wrapper", () => {
    const r = validateDispatchReviewDecision(p, "pending", decision());
    expect(r.kind).toBe("pending_server_authorization");
    if (r.kind !== "pending_server_authorization") return;
    expect(r.intent.rpc).toBe("telegram_dispatch_update_driver_load_status");
    expect(r.intent.args).toEqual({
      _telegram_user_id: 9001, _telegram_chat_id: CHAT, _relationship_id: REL,
      _load_id: LOAD_A, _new_status: "completed", _idempotency_key: p.proposalKey,
    });
    expect(r.intent.requiredServerChecks).toEqual(expect.arrayContaining([
      "active_chat_binding_for_telegram_chat_id", "active_linked_reviewer_identity",
      "recruiter_permission_loads_update_status", "active_driver_relationship_for_binding_recruiter",
      "current_load_status_equals_expected_previous_status",
    ]));
    expect(r.intent.unrepresentedServerChecks).toEqual(DISPATCH_REVIEW_UNREPRESENTED_SERVER_CHECKS);
    expect(JSON.stringify(r)).not.toMatch(/approved/);
  });
  it("reject yields declined", () => {
    expect(validateDispatchReviewDecision(p, "pending", decision({ action: "reject" }))).toEqual({ kind: "declined", proposalKey: p.proposalKey });
  });
  it.each(["accepted", "rejected", "expired", "superseded"] as const)("stale state %s is refused", state => {
    expect(validateDispatchReviewDecision(p, state, decision())).toEqual({ kind: "invalid", reason: "proposal_not_pending" });
  });
  it.each([
    ["proposalKey", "tg-dg:v1:1:1"], ["telegramChatId", -42], ["updateId", 78],
    ["loadId", LOAD_B], ["expectedPreviousStatus", "pending"],
  ])("mismatched %s is refused", (field, value) => {
    expect(validateDispatchReviewDecision(p, "pending", decision({ [field]: value }))).toEqual({ kind: "invalid", reason: "proposal_mismatch" });
  });
  it("unknown actions, free text, and bad reviewer ids are refused", () => {
    for (const action of ["approve", "yes", "ACCEPT", "accept; UPDATE loads", null]) {
      expect(validateDispatchReviewDecision(p, "pending", decision({ action })).kind).toBe("invalid");
    }
    for (const id of [0, -1, "9001", 1.5, null]) {
      expect(validateDispatchReviewDecision(p, "pending", decision({ reviewerTelegramUserId: id }))).toEqual({ kind: "invalid", reason: "malformed_decision" });
    }
  });
  it("tampered proposals are refused", () => {
    expect(validateDispatchReviewDecision({ ...p, targetStatus: "cancelled" }, "pending", decision()).kind).toBe("invalid");
    expect(validateDispatchReviewDecision({ ...p, committed: true } as any, "pending", decision()).kind).toBe("invalid");
    expect(validateDispatchReviewDecision({ ...p, relationshipId: "x" }, "pending", decision()).kind).toBe("invalid");
  });
});

describe("TG-G1A display summary + no raw text / secrets", () => {
  it("is bounded fixed vocabulary", () => {
    const raw = "Driver Bob 555-0100 Load #ABC123 delivered secret-token-xyz";
    const c = msg(raw);
    expect(c.kind).toBe("proposed");
    const p = proposalFor(raw);
    const s = summarizeDispatchProposal(p)!;
    expect(s).toEqual({
      title: "Mark load completed?", reference: "ABC123", fromStatusLabel: "En route", toStatusLabel: "Completed",
      note: expect.stringContaining("Nothing changes until an authorized reviewer approves"),
    });
    const all = JSON.stringify([c, p, s]);
    for (const leaked of ["Bob", "555-0100", "secret-token-xyz", raw]) expect(all).not.toContain(leaked);
  });
  it("module is side-effect free (no env, network, db)", () => {
    const src = readFileSync("supabase/functions/_shared/telegram-dispatch-group-proposals.ts", "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/Deno\.env|process\.env|fetch\(|createClient|\.rpc\(/);
  });
});

describe("TG-G1A live classifier unchanged", () => {
  it("ordinary group text is still ignored and /bind still binds", () => {
    const base = { updateId: 1, telegramUserId: 111, telegramChatId: -222, chatType: "group" };
    expect(classifyUpdate({ ...base, text: "Load #ABC123 delivered" } as any)).toEqual({ kind: "ignored", resultCode: "non_private_message" });
    const hex = "a".repeat(64);
    expect(classifyUpdate({ ...base, text: `/bind ${hex}` } as any)).toEqual({ kind: "bind", rawToken: hex, chatType: "group" });
  });
});
