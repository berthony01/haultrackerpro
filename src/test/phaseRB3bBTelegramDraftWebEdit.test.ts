// Phase RB-3B-B — Editable Telegram draft handoff (Edit Details + Refresh Review).
//
// Tests:
//   1. Callback grammar: q1:f:<uuid> round-trips as "refresh" and stays far
//      under Telegram's 64-byte callback_data limit.
//   2. Refresh is delivered to the ledger exactly once and is read-only: no
//      extractor call, no confirm/restart/cancel semantics touched.
//   3. Review buttons: Edit Details is a URL button carrying only the draft
//      locator; Confirm / Start Over / Cancel are preserved.
//   4. Edge refresh path re-renders from the CURRENT payload snapshot.
//   5. Migration: authenticated RPCs are actor-scoped, save-only, whitelisted,
//      and can never create or mutate an opportunity.
//   6. Web client never touches the draft table directly and never publishes.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  TELEGRAM_QUICK_POST_ANSWERS,
  composeQuickPostActionData,
  parseQuickPostActionData,
  runTelegramPoll,
  type TelegramGateway,
  type TelegramPollLedger,
  type TelegramQuickPostExtractor,
  type TelegramResultCode,
  type TelegramTerminalResult,
} from "../../supabase/functions/_shared/telegram-poll-ingest.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const stripSqlComments = (s: string) => s.replace(/^\s*--.*$/gm, "");

const ORCHESTRATOR_CODE = stripTsComments(
  read("supabase/functions/_shared/telegram-poll-ingest.ts"),
);
const EDGE_CODE = stripTsComments(read("supabase/functions/telegram-poll/index.ts"));
const HOOK_CODE = stripTsComments(read("src/hooks/opportunities/useTelegramOpportunityDraft.ts"));
const FORM_CODE = stripTsComments(read("src/components/opportunities/RecruiterOpportunityForm.tsx"));
const MANAGER_CODE = stripTsComments(
  read("src/components/opportunities/RecruiterOpportunityManager.tsx"),
);
const MIGRATION_CODE = stripSqlComments(
  read("supabase/migration-candidates/20260923050000_phase_rb3b_b_telegram_draft_web_edit.sql"),
);

const DRAFT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

// ─────────────────── 1. Callback grammar ───────────────────

describe("RB-3B-B 1 — refresh callback grammar", () => {
  it("composes q1:f:<uuid> and round-trips to the refresh action", () => {
    const data = composeQuickPostActionData("refresh", DRAFT_ID);
    expect(data).toBe(`q1:f:${DRAFT_ID}`);
    expect(parseQuickPostActionData(data)).toEqual({ action: "refresh", draftId: DRAFT_ID });
  });

  it("stays inside Telegram's 64-byte callback_data limit", () => {
    const data = composeQuickPostActionData("refresh", DRAFT_ID);
    expect(new TextEncoder().encode(data).byteLength).toBeLessThanOrEqual(64);
  });

  it("does not disturb the existing confirm / restart / cancel letters", () => {
    expect(composeQuickPostActionData("confirm", DRAFT_ID)).toBe(`q1:c:${DRAFT_ID}`);
    expect(composeQuickPostActionData("restart", DRAFT_ID)).toBe(`q1:r:${DRAFT_ID}`);
    expect(composeQuickPostActionData("cancel", DRAFT_ID)).toBe(`q1:x:${DRAFT_ID}`);
  });

  it("rejects malformed refresh payloads instead of guessing a draft", () => {
    expect(parseQuickPostActionData("q1:f:not-a-uuid")).toBeNull();
    expect(parseQuickPostActionData("q1:f:")).toBeNull();
    expect(parseQuickPostActionData(`c1:f:${DRAFT_ID}`)).toBeNull();
  });

  it("registers a bounded answer text for the refreshed result code", () => {
    expect(TELEGRAM_QUICK_POST_ANSWERS.quick_post_review_refreshed).toBeTruthy();
    expect(TELEGRAM_QUICK_POST_ANSWERS.quick_post_review_refreshed.length).toBeLessThanOrEqual(200);
  });
});

// ─────────────────── 2. Runtime delivery (exactly once, read-only) ───────────────────

const callbackUpdate = (updateId: number, data: string) => ({
  update_id: updateId,
  callback_query: {
    id: `cb${updateId}`,
    from: { id: 555 },
    data,
    message: { chat: { id: 555, type: "private" } },
  },
});

const sha256 = async (input: string) =>
  [...input].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(64, "0");

function makeHarness(updates: unknown[]) {
  const actions: Record<string, unknown>[] = [];
  const messages: { chatId: number; text: string }[] = [];
  const answers: string[] = [];
  const extractions: unknown[] = [];
  const receipts = new Map<number, TelegramResultCode>();

  const terminal = (updateId: number, resultCode: TelegramResultCode): TelegramTerminalResult => {
    if (receipts.has(updateId)) {
      return { isNew: false, resultCode: receipts.get(updateId) as TelegramResultCode };
    }
    receipts.set(updateId, resultCode);
    return { isNew: true, resultCode };
  };

  const ledger: TelegramPollLedger = {
    claimLease: async () => ({ leaseToken: "lease", nextOffset: 1 }),
    releaseLease: async () => true,
    advanceCursor: async (_t, id) => id,
    recordIgnoredUpdate: async ({ updateId, resultCode }) => terminal(updateId, resultCode),
    processStartUpdate: async ({ updateId }) => terminal(updateId, "link_success"),
    processBindUpdate: async ({ updateId }) => terminal(updateId, "bind_success"),
    processMenuUpdate: async ({ updateId }) => ({
      ...terminal(updateId, "menu_recruiter"),
      menuText: "menu",
      menuButtons: null,
    }),
    processQuickPostCommandUpdate: async ({ updateId }) => ({
      ...terminal(updateId, "quick_post_started"),
      draftId: DRAFT_ID,
    }),
    processQuickPostSourceUpdate: async ({ updateId }) => ({
      ...terminal(updateId, "quick_post_source_reserved"),
      draftId: DRAFT_ID,
      actorUserId: ACTOR_ID,
    }),
    completeQuickPostExtraction: async ({ draftId }) => ({
      isNew: true,
      resultCode: "quick_post_source_reserved" as TelegramResultCode,
      draftId,
      followUpText: "Review this draft opportunity",
    }),
    processQuickPostActionUpdate: async (input) => {
      if (!receipts.has(input.updateId)) actions.push({ ...input });
      const t = terminal(input.updateId, "quick_post_review_refreshed");
      return { ...t, draftId: input.draftId, followUpText: null };
    },
  };

  const extractor: TelegramQuickPostExtractor = {
    extract: async (input) => {
      extractions.push(input);
      return { ok: true, extracted: {} };
    },
  };

  const gateway: TelegramGateway = {
    getUpdates: async () => ({ ok: true, status: 200, result: updates }),
    sendMessage: async ({ chatId, text }) => {
      messages.push({ chatId, text });
      return { ok: true, status: 200, result: { message_id: 9001 } };
    },
    answerCallbackQuery: async ({ text }) => {
      answers.push(text);
      return { ok: true, status: 200 };
    },
  };

  return { ledger, gateway, extractor, actions, messages, answers, extractions };
}

describe("RB-3B-B 2 — Refresh Review runtime delivery", () => {
  it("routes q1:f to the ledger as a refresh action and never calls the extractor", async () => {
    const h = makeHarness([callbackUpdate(300, composeQuickPostActionData("refresh", DRAFT_ID))]);
    await runTelegramPoll({
      ledger: h.ledger,
      gateway: h.gateway,
      sha256,
      quickPostExtractor: h.extractor,
    });

    expect(h.actions).toHaveLength(1);
    expect(h.actions[0].action).toBe("refresh");
    expect(h.actions[0].draftId).toBe(DRAFT_ID);
    expect(h.extractions).toHaveLength(0);
  });

  it("processes a replayed refresh tap exactly once", async () => {
    const tap = callbackUpdate(301, composeQuickPostActionData("refresh", DRAFT_ID));
    const h = makeHarness([tap, tap]);
    await runTelegramPoll({
      ledger: h.ledger,
      gateway: h.gateway,
      sha256,
      quickPostExtractor: h.extractor,
    });

    expect(h.actions).toHaveLength(1);
    expect(h.answers).toHaveLength(2);
    expect(h.answers[0]).toBe(TELEGRAM_QUICK_POST_ANSWERS.quick_post_review_refreshed);
  });
});

// ─────────────────── 3/4. Review buttons + edge refresh path ───────────────────

describe("RB-3B-B 3 — review buttons and edge refresh path", () => {
  it("offers Edit Details as a URL button carrying only the draft locator", () => {
    expect(EDGE_CODE).toMatch(
      /\$\{APP_BASE_URL\}\/dashboard\?page=recruiter-access:manager&telegramDraft=\$\{draftId\}/,
    );
    expect(EDGE_CODE).toContain("Edit Details");
    expect(EDGE_CODE).toContain("composeQuickPostEditUrl");
  });

  it("preserves Confirm, Start Over and Cancel alongside Refresh Review", () => {
    expect(EDGE_CODE).toContain("Refresh Review");
    expect(EDGE_CODE).toContain('composeQuickPostActionData("refresh", draftId)');
    expect(EDGE_CODE).toContain('composeQuickPostActionData("confirm", draftId)');
    expect(EDGE_CODE).toContain('composeQuickPostActionData("restart", draftId)');
    expect(EDGE_CODE).toContain('composeQuickPostActionData("cancel", draftId)');
  });

  it("re-renders the refreshed review from the current server snapshot only", () => {
    expect(EDGE_CODE).toContain("telegram_quick_post_review_snapshot");
    expect(EDGE_CODE).toMatch(/resultCode === "quick_post_review_refreshed"/);
    expect(EDGE_CODE).toContain("composeQuickPostReview(snapshot.data)");
  });
});

// ─────────────────── 5. Migration authorization contract ───────────────────

describe("RB-3B-B 5 — draft RPC authorization contract", () => {
  it("exposes exactly the two authenticated draft RPCs, both SECURITY DEFINER", () => {
    for (const fn of [
      "get_telegram_opportunity_draft_for_edit",
      "save_telegram_opportunity_draft_payload",
    ]) {
      expect(MIGRATION_CODE).toContain(`public.${fn}`);
      expect(MIGRATION_CODE).toMatch(new RegExp(`${fn}[\\s\\S]{0,1200}?security definer`, "i"));
      expect(MIGRATION_CODE).toMatch(
        new RegExp(`grant execute on function public\\.${fn}[^;]*to authenticated`, "i"),
      );
    }
  });

  it("derives the actor from auth.uid() and never from an argument", () => {
    expect(MIGRATION_CODE).toMatch(/auth\.uid\(\)/);
    expect(MIGRATION_CODE).not.toMatch(
      /save_telegram_opportunity_draft_payload\s*\([^)]*actor_user_id/i,
    );
  });

  it("keeps the snapshot RPC service-role only", () => {
    expect(MIGRATION_CODE).toMatch(
      /grant execute on function public\.telegram_quick_post_review_snapshot[^;]*to service_role/i,
    );
    expect(MIGRATION_CODE).not.toMatch(
      /grant execute on function public\.telegram_quick_post_review_snapshot[^;]*to (authenticated|anon)/i,
    );
  });

  it("never creates or mutates an opportunity from the web save path", () => {
    const saveFn = MIGRATION_CODE.slice(
      MIGRATION_CODE.indexOf("function public.save_telegram_opportunity_draft_payload"),
    );
    expect(saveFn).not.toMatch(/insert\s+into\s+public\.opportunities/i);
    expect(saveFn).not.toMatch(/update\s+public\.opportunities/i);
    expect(saveFn).not.toMatch(/create_recruiter_opportunity/i);
  });

  it("rejects unknown payload keys against the canonical editable whitelist", () => {
    expect(MIGRATION_CODE).toContain("_telegram_quick_post_editable_keys");
    expect(MIGRATION_CODE).toMatch(/raise exception/i);
  });
});

// ─────────────────── 6. Web client boundaries ───────────────────

describe("RB-3B-B 6 — web client boundaries", () => {
  it("reaches the draft only through the two authenticated RPCs", () => {
    expect(HOOK_CODE).toContain("get_telegram_opportunity_draft_for_edit");
    expect(HOOK_CODE).toContain("save_telegram_opportunity_draft_payload");
    expect(HOOK_CODE).not.toContain("from('telegram_opportunity_drafts')");
    expect(HOOK_CODE).not.toContain('from("telegram_opportunity_drafts")');
    expect(HOOK_CODE).not.toContain("SERVICE_ROLE");
  });

  it("validates the untrusted locator as a UUID before use", () => {
    expect(HOOK_CODE).toContain("readTelegramDraftLocator");
    expect(HOOK_CODE).toMatch(/\[0-9a-f\]\{8\}/i);
  });

  it("hides create and publish actions in draft edit mode", () => {
    expect(FORM_CODE).toContain("telegramDraftMode");
    expect(FORM_CODE).toContain("saveTelegramDraft");
    expect(FORM_CODE).toMatch(/if \(telegramDraft\) return;/);
    expect(FORM_CODE).toContain("save-telegram-draft-changes");
  });

  it("falls back neutrally when the draft is unavailable", () => {
    expect(MANAGER_CODE).toContain("telegramDraft.unavailable");
    expect(MANAGER_CODE).toContain("isn't available");
    expect(MANAGER_CODE).toContain("refresh the review before confirming");
  });
});

// ─────────────────── 7. Auth continuation + draft-mode form shape ───────────────────

import { buildAuthUrl, resolvePostAuthDestination, sanitizeNextPath } from "@/lib/authNavigation";

describe("RB-3B-B 7 — auth continuation preserves the whole draft link", () => {
  const dest = `/dashboard?page=recruiter-access:manager&telegramDraft=${DRAFT_ID}`;

  it("keeps the full telegramDraft query through sanitize → auth URL → resolve", () => {
    expect(sanitizeNextPath(dest)).toBe(dest);
    const authUrl = buildAuthUrl(dest);
    expect(resolvePostAuthDestination(authUrl.slice(authUrl.indexOf("?")))).toBe(dest);
  });

  it("still rejects external continuation targets", () => {
    expect(sanitizeNextPath("//evil.example.com")).toBeNull();
    expect(sanitizeNextPath("https://evil.example.com")).toBeNull();
  });
});

describe("RB-3B-B 8 — draft mode form shape", () => {
  it("prefills through the canonical authoring normalizer and starts at Essentials", () => {
    expect(FORM_CODE).toContain("normalizeOpportunityForAuthoring(initial)");
    expect(FORM_CODE).toContain("useState<StageKey>(initial ? 'essentials' : 'write')");
  });

  it("hides Write & Extract so no extraction can rerun on open", () => {
    expect(FORM_CODE).toMatch(/hiddenStages=\{telegramDraft \? \['write'\] : undefined\}/);
    expect(FORM_CODE).toContain("hiddenStages?.includes(s.key)");
  });

  it("labels the mode and points the recruiter back to the bot", () => {
    expect(FORM_CODE).toContain("Edit Telegram Draft");
    expect(FORM_CODE).toContain("https://t.me/HaulTrackerBot");
    expect(FORM_CODE).toContain("tap Refresh Review, then tap Confirm");
  });

  it("serializes saves through the canonical draft payload builder", () => {
    expect(FORM_CODE).toContain("buildOpportunityPersistencePayload(state, 'draft')");
  });
});

// ─────────────────── 9. Lifecycle fields stay server-owned ───────────────────

describe("RB-3B-B 9 — web save cannot touch server-owned lifecycle state", () => {
  const SAVE_FN = MIGRATION_CODE.slice(
    MIGRATION_CODE.indexOf("FUNCTION public.save_telegram_opportunity_draft_payload"),
    MIGRATION_CODE.indexOf("FUNCTION public.telegram_quick_post_review_snapshot"),
  );

  it("strips a caller-supplied status so nothing can be published from the web", () => {
    expect(SAVE_FN).toContain("_payload := _payload - 'status'");
  });

  it("writes only extracted_payload on a still-reviewable, still-owned row", () => {
    expect(SAVE_FN).toMatch(/SET extracted_payload = _filtered/);
    expect(SAVE_FN).toMatch(/AND state = 'review'/);
    expect(SAVE_FN).toMatch(/AND created_opportunity_id IS NULL/);
    const updateStmt = SAVE_FN.slice(
      SAVE_FN.indexOf("UPDATE public.telegram_opportunity_drafts"),
      SAVE_FN.indexOf("RETURN jsonb_build_object("),
    );
    expect(updateStmt).not.toMatch(/(actor_user_id|recruiter_id|telegram_user_id|telegram_chat_id)\s*=/);
    expect(updateStmt).not.toMatch(/SET[\s\S]*state\s*=/);
  });

  it("requires ownership, review state, unexpired and current recruiter capability", () => {
    expect(SAVE_FN).toContain("d.actor_user_id = _actor");
    expect(SAVE_FN).toContain("_draft.expires_at <= now()");
    expect(SAVE_FN).toContain("current_user_can_recruiter_opportunity_action");
  });

  it("never returns Telegram identifiers or raw source to the browser", () => {
    const READ_FN = MIGRATION_CODE.slice(
      MIGRATION_CODE.indexOf("FUNCTION public.get_telegram_opportunity_draft_for_edit"),
      MIGRATION_CODE.indexOf("FUNCTION public.save_telegram_opportunity_draft_payload"),
    );
    expect(READ_FN).not.toContain("telegram_user_id");
    expect(READ_FN).not.toContain("telegram_chat_id");
    expect(READ_FN).not.toContain("raw_source_text");
    expect(READ_FN).not.toContain("source_update_id");
  });

  it("keeps the internal whitelist helper off the authenticated surface", () => {
    expect(MIGRATION_CODE).toMatch(
      /REVOKE ALL ON FUNCTION public\._telegram_quick_post_editable_keys\(\) FROM authenticated/,
    );
  });
});
