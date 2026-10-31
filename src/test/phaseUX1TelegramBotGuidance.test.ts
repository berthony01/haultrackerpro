import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { classifyUpdate } from "../../supabase/functions/_shared/telegram-poll-ingest";
import {
  TGG1B_DISPATCH_GROUP_REVIEW_ENABLED,
  dispatchReviewButtonLabels,
  DISPATCH_REJECT_LABEL,
} from "../../supabase/functions/_shared/telegram-dispatch-group-review";

const EDGE = readFileSync("supabase/functions/telegram-poll/index.ts", "utf8");
const id = (text: string, chatType = "private") => ({
  updateId: 1, telegramUserId: 7, telegramChatId: chatType === "private" ? 7 : -100,
  chatType, text, callbackQueryId: null, callbackData: null, replyToMessageId: null,
}) as never;

describe("UX-1 Telegram bot guidance", () => {
  it("keeps the dispatch gate compile-time false", () => {
    expect(TGG1B_DISPATCH_GROUP_REVIEW_ENABLED).toBe(false);
  });
  it("routes private /help through the read-only menu path", () => {
    expect(classifyUpdate(id("/help"))).toEqual({ kind: "menu", command: "help" });
    for (const c of ["/start", "/menu", "/status"]) expect(classifyUpdate(id(c)).kind).toBe("menu");
  });
  it("does not answer /help or /dispatch in groups (no bound-chat check exists)", () => {
    for (const t of ["/help", "/help@HaulTrackerBot", "/dispatch", "/dispatch@HaulTrackerBot", "Load AB123 delivered"]) {
      expect(classifyUpdate(id(t, "supergroup"))).toEqual({ kind: "ignored", resultCode: "non_private_message" });
    }
  });
  it("keeps /bind backward compatible", () => {
    const tok = "a".repeat(64);
    expect(classifyUpdate(id(`/bind ${tok}`, "group"))).toEqual({ kind: "bind", rawToken: tok, chatType: "group" });
    expect(classifyUpdate(id(`/bind@HaulTrackerBot ${tok}`, "supergroup")).kind).toBe("bind");
  });
  it("help copy says dispatch is not active and offers no dispatch control", () => {
    expect(EDGE).toContain("Dispatch group updates: not active yet.");
    // New independent guidance gate remains OFF; existing help is unchanged.
    expect(EDGE).toContain("authorizeDispatchGuidance: TELEGRAM_DISPATCH_GUIDANCE_ENABLED");
    expect(EDGE).not.toContain("setMyCommands(");
  });
  it("uses explicit review labels", () => {
    expect(dispatchReviewButtonLabels("completed")).toEqual(["✅ Confirm Delivery", DISPATCH_REJECT_LABEL]);
    expect(dispatchReviewButtonLabels("cancelled")[0]).toBe("✅ Confirm Cancellation");
  });
});
