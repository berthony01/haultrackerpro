// Phase TG-G1B — dispatch review queue. Static SQL-contract checks plus a
// MOCKED in-memory ledger that mirrors the candidate RPC semantics. This is
// NOT a real Postgres integration test and NOT live Telegram E2E.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TGG1B_DISPATCH_GROUP_REVIEW_ENABLED,
  composeDispatchReviewData,
  parseDispatchReviewData,
  isDispatchReviewCallbackData,
  routeDispatchGroupUpdate,
  processDispatchGroupMessage,
  processDispatchReviewCallback,
  DISPATCH_REVIEW_ACTION_RESULT_CODES,
  DISPATCH_INTAKE_RESULT_CODES,
  type DispatchReviewLedger,
} from "../../supabase/functions/_shared/telegram-dispatch-group-review";
import { classifyUpdate } from "../../supabase/functions/_shared/telegram-poll-ingest";

const root = resolve(__dirname, "../..");
const SQL = readFileSync(resolve(root, "supabase/migration-candidates/20261029183000_tgg1b_dispatch_review_queue.sql"), "utf8");
const ADAPTER = readFileSync(resolve(root, "supabase/functions/_shared/telegram-dispatch-group-review.ts"), "utf8");
const INGEST = readFileSync(resolve(root, "supabase/functions/_shared/telegram-poll-ingest.ts"), "utf8");
const POLL = readFileSync(resolve(root, "supabase/functions/telegram-poll/index.ts"), "utf8");

const LIVE_CODES = [
  "link_success","link_rejected","non_private_message","non_start_message","invalid_start_command",
  "invalid_update_shape","bind_success","bind_rejected","menu_recruiter","menu_linked_no_workspace",
  "menu_unlinked","menu_driver","menu_multi_role","menu_linked_unsupported","conversation_accepted",
  "conversation_passed","conversation_already_handled","conversation_action_unavailable",
  "conversation_action_denied","conversation_action_invalid","conversation_reply_sent",
  "conversation_reply_denied","conversation_reply_unavailable","conversation_reply_invalid",
  "conversation_reply_unroutable","quick_post_started","quick_post_denied","quick_post_unavailable",
  "quick_post_source_reserved","quick_post_source_rejected","quick_post_created",
  "quick_post_already_completed","quick_post_create_blocked","quick_post_cancelled",
  "quick_post_restarted","quick_post_review_refreshed","quick_post_action_invalid",
  "quick_post_action_denied","quick_post_action_unavailable",
];

describe("TG-G1B SQL candidate (static contract only)", () => {
  it("is labelled candidate, not applied, and lives outside supabase/migrations", () => {
    expect(SQL).toMatch(/CANDIDATE ONLY — NOT APPLIED LIVE/);
  });
  it("preserves every live receipt code and adds only dispatch_review_* codes", () => {
    const block = SQL.split("ADD CONSTRAINT telegram_update_receipts_result_code_check")[1].split("]));")[0];
    const codes = [...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    for (const c of LIVE_CODES) expect(codes).toContain(c);
    const added = codes.filter(c => !LIVE_CODES.includes(c));
    expect(added.every(c => c.startsWith("dispatch_review_"))).toBe(true);
    expect(new Set(added)).toEqual(new Set([...DISPATCH_INTAKE_RESULT_CODES, ...DISPATCH_REVIEW_ACTION_RESULT_CODES]));
  });
  it("table stores no raw text/names/tokens and is service-role only with RLS and no policies", () => {
    const table = SQL.split("CREATE TABLE public.telegram_dispatch_review_proposals")[1].split(");\n")[0];
    expect(table).not.toMatch(/\b(text_body|message_text|raw|driver_name|token|username|title)\b/);
    expect(SQL).toMatch(/REVOKE ALL ON public\.telegram_dispatch_review_proposals FROM anon/);
    expect(SQL).toMatch(/REVOKE ALL ON public\.telegram_dispatch_review_proposals FROM authenticated/);
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SQL).not.toMatch(/CREATE POLICY/);
    expect(SQL).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    expect(table).toMatch(/UNIQUE \(telegram_chat_id, source_update_id\)/);
    expect(table).toMatch(/UNIQUE \(proposal_key\)/);
    expect(table).toMatch(/interval '15 minutes'/);
    expect(SQL).toMatch(/one_pending_per_load[\s\S]*WHERE status = 'pending'/);
  });
  it("both RPCs require lease, dedupe receipts, and are service-role-only", () => {
    for (const fn of ["telegram_process_dispatch_group_update", "telegram_process_dispatch_review_action"]) {
      const body = SQL.split(`CREATE FUNCTION public.${fn}(`)[1].split("$$;")[0];
      expect(body).toMatch(/telegram_poll_lease_invalid/);
      expect(body).toMatch(/telegram_update_conflict/);
      expect(body).toMatch(/INSERT INTO public\.telegram_update_receipts/);
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM authenticated`));
      expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`));
    }
  });
  it("intake never mutates a load and scopes to bound recruiter's active relationships", () => {
    const body = SQL.split("CREATE FUNCTION public.telegram_process_dispatch_group_update(")[1].split("$$;")[0];
    expect(body).not.toMatch(/UPDATE public\.loads/);
    expect(body).not.toMatch(/telegram_dispatch_update_driver_load_status|load_events/);
    expect(body).toMatch(/r\.recruiter_id = _binding\.recruiter_id/);
    expect(body).toMatch(/r\.status = 'active'/);
    expect(body).toMatch(/l\.user_id = r\.driver_user_id/);
    expect(body).toMatch(/_match_count = 1/);
  });
  it("review locks proposal and load, checks expected status, uses existing wrapper, inserts no load_events", () => {
    const body = SQL.split("CREATE FUNCTION public.telegram_process_dispatch_review_action(")[1].split("$$;")[0];
    expect(body).toMatch(/telegram_dispatch_review_proposals p\s+WHERE p\.id = _proposal_id\s+FOR UPDATE/);
    expect(body).toMatch(/FROM public\.loads l\s+WHERE l\.id = _p\.load_id\s+FOR UPDATE/);
    expect(body).toMatch(/_load_status IS DISTINCT FROM _p\.expected_previous_status/);
    expect(body).toMatch(/PERFORM public\.telegram_dispatch_update_driver_load_status\(/);
    expect(body).toMatch(/'tg-dg-review:v1:' \|\| _p\.id::text/);
    expect(body).toMatch(/'loads_update_status'/);
    expect(body).toMatch(/ELSE\s+RAISE;/);
    expect(body).not.toMatch(/INSERT INTO public\.load_events|UPDATE public\.loads/);
    expect(SQL).not.toMatch(/(CREATE OR REPLACE|ALTER) FUNCTION public\.(telegram_)?dispatch_update_driver_load_status/);
  });
});

describe("TG-G1B gate and namespace", () => {
  it("is a compile-time false literal with no env flag", () => {
    expect(TGG1B_DISPATCH_GROUP_REVIEW_ENABLED).toBe(false);
    expect(ADAPTER).not.toMatch(/Deno\.env|process\.env|import\.meta\.env/);
    expect(routeDispatchGroupUpdate({ chatType: "group", callbackData: null, text: "Load #AB-123 delivered" })).toBeNull();
    expect(routeDispatchGroupUpdate({ chatType: "group", callbackData: null, text: "x" }, true)).toBe("group_message");
    expect(routeDispatchGroupUpdate({ chatType: "private", callbackData: null, text: "x" }, true)).toBeNull();
  });
  it("live poller does not import or reference the new module", () => {
    for (const src of [INGEST, POLL]) {
      expect(src).not.toMatch(/telegram-dispatch-group-review|dispatch_review|TGG1B/);
    }
  });
  it("default classification is unchanged: group text → non_private_message, /bind stays bind, g1 tap fails closed in c1 path", () => {
    const base = { updateId: 1, telegramUserId: 11, telegramChatId: -22, chatType: "group", callbackQueryId: null, callbackData: null, replyToMessageId: null };
    expect(classifyUpdate({ ...base, text: "Load #AB-123 delivered" } as never)).toEqual({ kind: "ignored", resultCode: "non_private_message" });
    expect(classifyUpdate({ ...base, text: `/bind ${"a".repeat(64)}` } as never).kind).toBe("bind");
    const data = composeDispatchReviewData("accept", "00000000-0000-4000-8000-000000000001")!;
    const tap = classifyUpdate({ ...base, text: null, callbackQueryId: "q", callbackData: data } as never);
    expect(tap).toMatchObject({ kind: "conversation_action", action: null });
  });
  it("callback data is disjoint from c1/q1, ≤64 bytes, and strict", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const a = composeDispatchReviewData("accept", id)!;
    expect(a.startsWith("g1:")).toBe(true);
    expect(new TextEncoder().encode(a).length).toBeLessThanOrEqual(64);
    expect(parseDispatchReviewData(a)).toEqual({ action: "accept", proposalId: id });
    expect(parseDispatchReviewData(composeDispatchReviewData("reject", id))).toEqual({ action: "reject", proposalId: id });
    expect(composeDispatchReviewData("accept", "not-a-uuid")).toBeNull();
    for (const bad of ["g1:x:" + id, "g1:a:" + id + "x", "q1:a:" + id, "c1:a:" + id, "g1:a:", 5, null]) {
      expect(parseDispatchReviewData(bad)).toBeNull();
    }
    expect(isDispatchReviewCallbackData("q1:new")).toBe(false);
  });
});

// ── Mocked ledger mirroring the candidate SQL ─────────────────────────────

type Load = { id: string; relationshipId: string; ownerId: string; reference: string | null; status: string };
const REC = "rec-1";
const LEASE = "lease-1";
const HASH = (n: number) => n.toString(16).padStart(64, "0");

function makeWorld() {
  const w = {
    lease: LEASE as string | null,
    now: 0,
    bindings: new Map<number, { id: string; recruiterId: string; active: boolean }>([[-100, { id: "b1", recruiterId: REC, active: true }]]),
    rels: new Map<string, { recruiterId: string; driverId: string; active: boolean }>([
      ["rel-1", { recruiterId: REC, driverId: "drv-1", active: true }],
      ["rel-other", { recruiterId: "rec-2", driverId: "drv-2", active: true }],
    ]),
    links: new Map<number, string>([[501, "user-auth"], [502, "user-noperm"]]),
    perms: new Set<string>(["user-auth"]),
    loads: [
      { id: "load-1", relationshipId: "rel-1", ownerId: "drv-1", reference: "AB-123", status: "en_route" },
      { id: "load-2", relationshipId: "rel-other", ownerId: "drv-2", reference: "ZZ-999", status: "pending" },
    ] as Load[],
    receipts: new Map<number, { hash: string; type: string; user: number; chat: number; code: string }>(),
    proposals: [] as Array<{ id: string; key: string; chat: number; update: number; bindingId: string; loadId: string; relationshipId: string; expected: string; target: string; status: string; expiresAt: number; reviewer?: string }>,
    statusCalls: [] as Array<{ loadId: string; status: string; key: string }>,
    failNextWrapper: false,
  };
  let seq = 0;
  const clone = () => JSON.parse(JSON.stringify({ loads: w.loads, proposals: w.proposals, statusCalls: w.statusCalls, receipts: [...w.receipts] }));
  const restore = (s: ReturnType<typeof clone>) => { w.loads = s.loads; w.proposals = s.proposals; w.statusCalls = s.statusCalls; w.receipts = new Map(s.receipts); };
  const tx = async <T,>(fn: () => T): Promise<T> => { const snap = clone(); try { return fn(); } catch (e) { restore(snap); throw e; } };

  const ledger: DispatchReviewLedger = {
    processGroupUpdate: (i) => tx(() => {
      if (i.leaseToken !== w.lease) throw new Error("telegram_poll_lease_invalid");
      const ex = w.receipts.get(i.updateId);
      if (ex) {
        if (ex.hash === i.payloadHash && ex.type === "message" && ex.chat === i.telegramChatId && ex.code.startsWith("dispatch_review_")) {
          const p = w.proposals.find(p => p.chat === i.telegramChatId && p.update === i.updateId);
          return { isNew: false, resultCode: ex.code as never, proposalId: p?.id ?? null, expiresAt: null };
        }
        throw new Error("telegram_update_conflict");
      }
      let code: "dispatch_review_proposed" | "dispatch_review_no_action" = "dispatch_review_no_action";
      let pid: string | null = null;
      const b = w.bindings.get(i.telegramChatId);
      if (i.reference && b?.active) {
        const matches = w.loads.filter(l => {
          const r = w.rels.get(l.relationshipId);
          return r && r.active && r.recruiterId === b.recruiterId && r.driverId === l.ownerId && l.reference?.trim().toUpperCase() === i.reference;
        });
        if (matches.length === 1 && ["pending", "en_route"].includes(matches[0].status)) {
          const l = matches[0];
          w.proposals.forEach(p => { if (p.loadId === l.id && p.status === "pending" && p.expiresAt <= w.now) p.status = "expired"; });
          if (!w.proposals.some(p => p.loadId === l.id && p.status === "pending")) {
            pid = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
            w.proposals.push({ id: pid, key: `tg-dg:v1:${i.telegramChatId}:${i.updateId}:${l.id}:${i.proposedStatus}`, chat: i.telegramChatId, update: i.updateId, bindingId: b.id, loadId: l.id, relationshipId: l.relationshipId, expected: l.status, target: i.proposedStatus!, status: "pending", expiresAt: w.now + 15 });
            code = "dispatch_review_proposed";
          }
        }
      }
      w.receipts.set(i.updateId, { hash: i.payloadHash, type: "message", user: i.telegramUserId, chat: i.telegramChatId, code });
      return { isNew: true, resultCode: code, proposalId: pid, expiresAt: null };
    }),
    processReviewAction: (i) => tx(() => {
      if (i.leaseToken !== w.lease) throw new Error("telegram_poll_lease_invalid");
      const ex = w.receipts.get(i.updateId);
      if (ex) {
        if (ex.hash === i.payloadHash && ex.type === "callback_query" && ex.chat === i.telegramChatId && ex.user === i.telegramUserId) return { isNew: false, resultCode: ex.code as never };
        throw new Error("telegram_update_conflict");
      }
      let code: string | null = null;
      const p = i.proposalId ? w.proposals.find(p => p.id === i.proposalId) : undefined;
      if (!i.action || !p || p.chat !== i.telegramChatId || !["group", "supergroup"].includes(i.chatType)) code = "dispatch_review_invalid";
      else if (p.status !== "pending") code = "dispatch_review_already_handled";
      else if (p.expiresAt <= w.now) { p.status = "expired"; code = "dispatch_review_expired"; }
      const reviewer = w.links.get(i.telegramUserId);
      const b = w.bindings.get(i.telegramChatId);
      const rel = p ? w.rels.get(p.relationshipId) : undefined;
      if (!code && (!b?.active || b.id !== p!.bindingId || !reviewer || !rel?.active)) code = "dispatch_review_denied";
      const load = p ? w.loads.find(l => l.id === p.loadId) : undefined;
      if (!code && (!load || load.relationshipId !== p!.relationshipId || load.status !== p!.expected)) { p!.status = "stale"; code = "dispatch_review_stale"; }
      if (!code) {
        if (!w.perms.has(reviewer!)) code = "dispatch_review_denied";
        else if (i.action === "reject") { p!.status = "rejected"; p!.reviewer = reviewer; code = "dispatch_review_rejected"; }
        else {
          if (w.failNextWrapper) { w.failNextWrapper = false; throw new Error("deadlock_detected"); }
          w.statusCalls.push({ loadId: load!.id, status: p!.target, key: `tg-dg-review:v1:${p!.id}` });
          load!.status = p!.target; p!.status = "accepted"; p!.reviewer = reviewer; code = "dispatch_review_accepted";
        }
      }
      w.receipts.set(i.updateId, { hash: i.payloadHash, type: "callback_query", user: i.telegramUserId, chat: i.telegramChatId, code: code! });
      return { isNew: true, resultCode: code as never };
    }),
  };
  return { w, ledger };
}

const msg = (updateId: number, text: string | null, chat = -100) => ({
  leaseToken: LEASE, updateId, payloadHash: HASH(updateId), telegramUserId: 900, telegramChatId: chat, chatType: "group", text,
});
const tap = (updateId: number, data: string | null, user = 501, chat = -100) => ({
  leaseToken: LEASE, updateId, payloadHash: HASH(updateId), telegramUserId: user, telegramChatId: chat, chatType: "group", callbackData: data,
});

async function propose(ledger: DispatchReviewLedger) {
  const out = await processDispatchGroupMessage(ledger, msg(10, "Load #AB-123 delivered"));
  expect(out.resultCode).toBe("dispatch_review_proposed");
  return out;
}

describe("TG-G1B adapter with mocked ledger", () => {
  it("proposes for exactly one scoped load, never changes the load, bounded reply without raw text", async () => {
    const { w, ledger } = makeWorld();
    const out = await propose(ledger);
    expect(w.loads[0].status).toBe("en_route");
    expect(w.statusCalls).toHaveLength(0);
    expect(out.replyText!.length).toBeLessThanOrEqual(300);
    expect(out.replyText).toContain("AB-123");
    expect(out.replyText).not.toMatch(/Load #AB-123 delivered/);
    expect(out.buttons![0].map(b => b.callbackData.slice(0, 5))).toEqual(["g1:a:", "g1:r:"]);
    expect(w.proposals[0]).toMatchObject({ expected: "en_route", target: "completed", status: "pending" });
  });
  it("nonqualifying, malicious, other-tenant and unbound messages get terminal no_action receipts", async () => {
    const { w, ledger } = makeWorld();
    const texts = ["hello", "Load #AB-123 delivered? maybe", "Load #ZZ-999 delivered", "Load #AB-123 delivered and ref NO-0001 cancelled", "'; DROP TABLE loads; -- ref AB-123 delivered", null];
    let id = 20;
    for (const t of texts) {
      const out = await processDispatchGroupMessage(ledger, msg(id, t));
      expect(out.resultCode).toBe("dispatch_review_no_action");
      expect(out.buttons).toBeNull();
      expect(w.receipts.get(id)?.code).toBe("dispatch_review_no_action");
      id++;
    }
    expect((await processDispatchGroupMessage(ledger, msg(99, "Load #AB-123 delivered", -555))).resultCode).toBe("dispatch_review_no_action");
    expect(w.proposals).toHaveLength(0);
  });
  it("duplicate references across scoped loads do not propose", async () => {
    const { w, ledger } = makeWorld();
    w.loads.push({ id: "load-3", relationshipId: "rel-1", ownerId: "drv-1", reference: "ab-123 ", status: "pending" });
    expect((await processDispatchGroupMessage(ledger, msg(11, "Load #AB-123 delivered"))).resultCode).toBe("dispatch_review_no_action");
  });
  it("identical replay is idempotent; same update with different content conflicts and rolls back", async () => {
    const { w, ledger } = makeWorld();
    await propose(ledger);
    const replay = await processDispatchGroupMessage(ledger, msg(10, "Load #AB-123 delivered"));
    expect(replay).toMatchObject({ isNew: false, resultCode: "dispatch_review_proposed", buttons: null });
    await expect(processDispatchGroupMessage(ledger, { ...msg(10, "x"), payloadHash: HASH(777) })).rejects.toThrow("telegram_update_conflict");
    expect(w.proposals).toHaveLength(1);
  });
  it("invalid lease writes nothing (cursor cannot advance)", async () => {
    const { w, ledger } = makeWorld();
    w.lease = "other";
    await expect(processDispatchGroupMessage(ledger, msg(10, "Load #AB-123 delivered"))).rejects.toThrow("telegram_poll_lease_invalid");
    expect(w.receipts.size).toBe(0);
  });
  it("authorized accept updates status once via canonical path with stable key", async () => {
    const { w, ledger } = makeWorld();
    const out = await propose(ledger);
    const r = await processDispatchReviewCallback(ledger, tap(30, out.buttons![0][0].callbackData));
    expect(r.resultCode).toBe("dispatch_review_accepted");
    expect(w.statusCalls).toEqual([{ loadId: "load-1", status: "completed", key: `tg-dg-review:v1:${w.proposals[0].id}` }]);
  });
  it("double-submit: second tap is already_handled, single status call; replay of same tap idempotent", async () => {
    const { w, ledger } = makeWorld();
    const out = await propose(ledger);
    const data = out.buttons![0][0].callbackData;
    const [a, b] = await Promise.all([processDispatchReviewCallback(ledger, tap(30, data)), processDispatchReviewCallback(ledger, tap(31, data))]);
    expect([a.resultCode, b.resultCode].sort()).toEqual(["dispatch_review_accepted", "dispatch_review_already_handled"]);
    expect(w.statusCalls).toHaveLength(1);
    expect((await processDispatchReviewCallback(ledger, tap(30, data))).isNew).toBe(false);
    expect(w.statusCalls).toHaveLength(1);
  });
  it("unpermitted, unlinked, or wrong-chat reviewers cannot approve", async () => {
    const { w, ledger } = makeWorld();
    const data = (await propose(ledger)).buttons![0][0].callbackData;
    expect((await processDispatchReviewCallback(ledger, tap(30, data, 502))).resultCode).toBe("dispatch_review_denied");
    expect((await processDispatchReviewCallback(ledger, tap(31, data, 999))).resultCode).toBe("dispatch_review_denied");
    expect((await processDispatchReviewCallback(ledger, tap(32, data, 501, -555))).resultCode).toBe("dispatch_review_invalid");
    expect(w.statusCalls).toHaveLength(0);
    expect(w.proposals[0].status).toBe("pending");
  });
  it("revoked binding or ended relationship denies", async () => {
    const { w, ledger } = makeWorld();
    const data = (await propose(ledger)).buttons![0][0].callbackData;
    w.rels.get("rel-1")!.active = false;
    expect((await processDispatchReviewCallback(ledger, tap(30, data))).resultCode).toBe("dispatch_review_denied");
    w.rels.get("rel-1")!.active = true;
    w.bindings.get(-100)!.active = false;
    expect((await processDispatchReviewCallback(ledger, tap(31, data))).resultCode).toBe("dispatch_review_denied");
    expect(w.statusCalls).toHaveLength(0);
  });
  it("stale status and expired proposals never update", async () => {
    const s = makeWorld();
    const d1 = (await propose(s.ledger)).buttons![0][0].callbackData;
    s.w.loads[0].status = "cancelled";
    expect((await processDispatchReviewCallback(s.ledger, tap(30, d1))).resultCode).toBe("dispatch_review_stale");
    const e = makeWorld();
    const d2 = (await propose(e.ledger)).buttons![0][0].callbackData;
    e.w.now = 16;
    expect((await processDispatchReviewCallback(e.ledger, tap(30, d2))).resultCode).toBe("dispatch_review_expired");
    expect(s.w.statusCalls.length + e.w.statusCalls.length).toBe(0);
  });
  it("reject changes nothing; malformed payload is invalid", async () => {
    const { w, ledger } = makeWorld();
    const out = await propose(ledger);
    expect((await processDispatchReviewCallback(ledger, tap(30, out.buttons![0][1].callbackData))).resultCode).toBe("dispatch_review_rejected");
    expect((await processDispatchReviewCallback(ledger, tap(31, "g1:a:garbage"))).resultCode).toBe("dispatch_review_invalid");
    expect(w.loads[0].status).toBe("en_route");
  });
  it("unexpected DB failure rolls back: no receipt, proposal still pending, retry succeeds", async () => {
    const { w, ledger } = makeWorld();
    const data = (await propose(ledger)).buttons![0][0].callbackData;
    w.failNextWrapper = true;
    await expect(processDispatchReviewCallback(ledger, tap(30, data))).rejects.toThrow("deadlock_detected");
    expect(w.receipts.has(30)).toBe(false);
    expect(w.proposals[0].status).toBe("pending");
    expect((await processDispatchReviewCallback(ledger, tap(30, data))).resultCode).toBe("dispatch_review_accepted");
  });
  it("per-load cap: a second report while one is pending does not create another proposal", async () => {
    const { w, ledger } = makeWorld();
    await propose(ledger);
    expect((await processDispatchGroupMessage(ledger, msg(12, "Load #AB-123 cancelled"))).resultCode).toBe("dispatch_review_no_action");
    expect(w.proposals).toHaveLength(1);
  });
});
