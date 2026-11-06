// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { composeDispatchReviewData, parseDispatchReviewData } from "../../supabase/functions/_shared/telegram-dispatch-group-review";

// Execute the actual Edge pilot boundary without starting Deno or a poller.
const edge = readFileSync("supabase/functions/telegram-poll/index.ts", "utf8");
const boundary = edge.slice(edge.indexOf("const GENERAL_PILOT ="), edge.indexOf("// TG-G1C (gated). Durable"));
const code = transformSync(`${boundary}\nglobalThis.pilot = { config: GENERAL_PILOT, active: generalPilotActive, scope: generalPilotScope, load: generalPilotLoadMatches, proposal: generalPilotProposalMatches, gateway: generalPilotDeliveryGateway };`, { loader: "ts", target: "es2022" }).code;

function world() {
  let now = Date.parse("2026-11-06T08:00:00Z");
  class Clock extends Date { static now() { return now; } }
  const context: any = { Date: Clock, parseDispatchReviewData, log: vi.fn() };
  runInNewContext(code, context);
  return { p: context.pilot, expire: () => { now = context.pilot.config.cutoff; } };
}

function database(rows: Record<string, unknown>[], afterRead = () => {}) {
  return { from: () => {
    const filters: [string, unknown][] = [];
    const matched = () => rows.filter(row => filters.every(([key, value]) => row[key] === value));
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      limit: async (count: number) => { const data = matched().slice(0, count); afterRead(); return { data, error: null }; },
      maybeSingle: async () => { const data = matched(); afterRead(); return { data: data.length === 1 ? data[0] : null, error: data.length > 1 ? {} : null }; },
    };
    return query;
  } };
}

const proposalId = "10000000-0000-4000-8000-000000000001";
const callbackData = composeDispatchReviewData("accept", proposalId)!;

describe("restricted live dispatch acceptance boundary", () => {
  it("admits only each addressed command in the configured group", () => {
    const { p } = world();
    const base = { telegramChatId: p.config.chatId, chatType: "group", callbackQueryId: null, callbackData: null };
    expect(p.scope({ ...base, text: "/cancelled@HaulTrackerBot HTP-QA-GEN2" })).toBe(true);
    expect(p.scope({ ...base, text: "/delivered@HaulTrackerBot HTP-QA-GEN3" })).toBe(true);
    for (const text of ["/delivered@HaulTrackerBot HTP-QA-GEN2", "/cancelled@HaulTrackerBot HTP-QA-GEN3", "/cancelled HTP-QA-GEN2", "/cancelled@HaulTrackerBot CUSTOMER-1"]) {
      expect(p.scope({ ...base, text })).toBe(false);
    }
    expect(p.scope({ ...base, telegramChatId: -987, text: "/cancelled@HaulTrackerBot HTP-QA-GEN2" })).toBe(false);
    expect(p.scope({ ...base, chatType: "private", text: "/cancelled@HaulTrackerBot HTP-QA-GEN2" })).toBe(false);
  });

  it("rejects malformed review data and callbacks from another group", () => {
    const { p } = world();
    const base = { telegramChatId: p.config.chatId, chatType: "supergroup", callbackQueryId: "callback", text: null };
    expect(p.scope({ ...base, callbackData })).toBe(true);
    expect(p.scope({ ...base, callbackData: "g1:a:invalid" })).toBe(false);
    expect(p.scope({ ...base, telegramChatId: -987, callbackData })).toBe(false);
  });

  it("requires one load with the pinned ID and the correct reference/status pair", async () => {
    const { p } = world();
    for (const target of p.config.targets) {
      const row = { id: target.loadId, load_reference: target.reference };
      expect(await p.load(database([row]), target.reference, target.status)).toBe(true);
      expect(await p.load(database([row, { ...row, id: "another-id" }]), target.reference, target.status)).toBe(false);
      expect(await p.load(database([{ ...row, id: "another-id" }]), target.reference, target.status)).toBe(false);
      expect(await p.load(database([row]), target.reference, target.status === "completed" ? "cancelled" : "completed")).toBe(false);
    }
  });

  it("rechecks the cutoff after the load lookup", async () => {
    const { p, expire } = world();
    const target = p.config.targets[0];
    expect(await p.load(database([{ id: target.loadId, load_reference: target.reference }], expire), target.reference, target.status)).toBe(false);
  });

  it("pins proposal identity, group, load ID, reference and status together", async () => {
    const { p } = world();
    for (const target of p.config.targets) {
      const row = { id: proposalId, telegram_chat_id: p.config.chatId, load_id: target.loadId, load_reference: target.reference, proposed_status: target.status };
      expect(await p.proposal(database([row]), proposalId)).toBe(true);
      for (const changed of [{ load_id: "customer-id" }, { load_reference: "CUSTOMER-1" }, { telegram_chat_id: -987 }, { id: "other-proposal" }, { proposed_status: target.status === "completed" ? "cancelled" : "completed" }]) {
        expect(await p.proposal(database([{ ...row, ...changed }]), proposalId)).toBe(false);
      }
    }
  });

  it("rechecks the cutoff after the proposal lookup", async () => {
    const { p, expire } = world();
    const target = p.config.targets[0];
    const row = { id: proposalId, telegram_chat_id: p.config.chatId, load_id: target.loadId, load_reference: target.reference, proposed_status: target.status };
    expect(await p.proposal(database([row], expire), proposalId)).toBe(false);
  });

  it("does not send a review for a customer load or to another group", async () => {
    const { p } = world();
    const target = p.config.targets[0];
    const row = { id: proposalId, telegram_chat_id: p.config.chatId, load_id: target.loadId, load_reference: target.reference, proposed_status: target.status };
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const input = { chatId: p.config.chatId, text: "Review", buttons: [[{ text: "Confirm", callbackData }]] };
    expect((await p.gateway(database([row]), { sendMessage }).sendMessage(input)).ok).toBe(true);
    expect((await p.gateway(database([{ ...row, load_id: "customer-id" }]), { sendMessage }).sendMessage(input)).ok).toBe(false);
    expect((await p.gateway(database([row]), { sendMessage }).sendMessage({ ...input, chatId: -987 })).ok).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("closes intake, proposal lookup and sends when the window expires", async () => {
    const { p, expire } = world();
    expire();
    const db = { from: vi.fn() };
    const sendMessage = vi.fn();
    expect(p.active()).toBe(false);
    expect(p.scope({ telegramChatId: p.config.chatId, chatType: "group", text: "/cancelled@HaulTrackerBot HTP-QA-GEN2", callbackQueryId: null })).toBe(false);
    expect(await p.load(db, "HTP-QA-GEN2", "cancelled")).toBe(false);
    expect(await p.proposal(db, proposalId)).toBe(false);
    expect((await p.gateway(db, { sendMessage }).sendMessage({ chatId: p.config.chatId, buttons: [[{ callbackData }]] })).ok).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
