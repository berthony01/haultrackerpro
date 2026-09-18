// Phase RB-3A — recruiter text Quick Post + review/confirm in @HaulTrackerBot.
//
// Five parts:
//   A. classification — `/post`, the `q1` callback namespace and Quick Post
//      source text, all strictly BEHIND every pre-existing routing rule;
//   B. orchestration through the SHARED helper the Edge Function actually
//      calls: exactly one extraction per unique update, no creation before
//      Confirm, fail-closed when a processor is absent;
//   C. presentation — the review renders ONLY approved fields, missing values
//      read `Not provided`, and nothing is inferred;
//   D. SQL contract — service-role-only ACLs, canonical delegated creation
//      only, no direct opportunity INSERT, receipt atomicity;
//   E. adapter contract — one poller, one extractor, no prompt/model/provider
//      and no secret or raw text in a log line.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  TELEGRAM_QUICK_POST_ANSWERS,
  TELEGRAM_QUICK_POST_RESULT_CODES,
  classifyUpdate,
  composeQuickPostActionData,
  composeQuickPostNewData,
  isQuickPostCallbackData,
  isQuickPostResultCode,
  parseQuickPostActionData,
  runTelegramPoll,
  type TelegramGateway,
  type TelegramInlineButton,
  type TelegramPollLedger,
  type TelegramQuickPostExtractor,
  type TelegramResultCode,
  type TelegramTerminalResult,
} from "../../supabase/functions/_shared/telegram-poll-ingest.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const RB3A_SQL = read(
  "supabase/migration-candidates/20260922050000_phase_rb3a_telegram_quick_post.sql",
);
const ORCHESTRATOR_SOURCE = read(
  "supabase/functions/_shared/telegram-poll-ingest.ts",
);
const EDGE_SOURCE = read("supabase/functions/telegram-poll/index.ts");

const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RB3A_CODE = stripSqlComments(RB3A_SQL);
const ORCHESTRATOR_CODE = stripTsComments(ORCHESTRATOR_SOURCE);
const EDGE_CODE = stripTsComments(EDGE_SOURCE);

const DRAFT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

// ───────────────────────────── A. classification ─────────────────────────────

const identity = (over: Record<string, unknown> = {}) => ({
  updateId: 1,
  telegramUserId: 555,
  telegramChatId: 555,
  chatType: "private",
  text: "Hiring OTR reefer drivers, 0.62 cpm, home weekly.",
  replyToMessageId: null,
  callbackQueryId: null,
  callbackData: null,
  ...over,
});

describe("RB-3A A — Quick Post routing sits behind every existing rule", () => {
  it("1) `/post` is a Quick Post command in a private chat", () => {
    expect(classifyUpdate(identity({ text: "/post" }))).toEqual({
      kind: "quick_post_command",
    });
    expect(classifyUpdate(identity({ text: "/post@HaulTrackerBot" }))).toEqual({
      kind: "quick_post_command",
    });
  });

  it("2) `/post` in a group is never routed", () => {
    for (const chatType of ["group", "supergroup", "channel"]) {
      expect(classifyUpdate(identity({ chatType, text: "/post" }))).toEqual({
        kind: "ignored",
        resultCode: "non_private_message",
      });
    }
  });

  it("3) every pre-existing command keeps its exact meaning", () => {
    expect(classifyUpdate(identity({ text: "/menu" }))).toEqual({
      kind: "menu",
      command: "menu",
    });
    expect(classifyUpdate(identity({ text: "/status" }))).toEqual({
      kind: "menu",
      command: "status",
    });
    expect(classifyUpdate(identity({ text: "/start" }))).toEqual({
      kind: "menu",
      command: "start",
    });
    expect(classifyUpdate(identity({ text: "/start@HaulTrackerBot" }))).toEqual({
      kind: "ignored",
      resultCode: "invalid_start_command",
    });
    // Variants of /post are commands, not Quick Post source text.
    for (const text of ["/post extra", "/posting", "/post@OtherBot"]) {
      expect(classifyUpdate(identity({ text }))).toEqual({
        kind: "ignored",
        resultCode: "non_start_message",
      });
    }
  });

  it("4) an RB-2C reply ALWAYS wins over Quick Post source ingestion", () => {
    expect(classifyUpdate(identity({ replyToMessageId: 4242 }))).toEqual({
      kind: "conversation_reply",
      replyToMessageId: 4242,
      text: "Hiring OTR reefer drivers, 0.62 cpm, home weekly.",
    });
  });

  it("5) ordinary private non-reply text is offered as Quick Post source", () => {
    expect(classifyUpdate(identity())).toEqual({
      kind: "quick_post_source",
      text: "Hiring OTR reefer drivers, 0.62 cpm, home weekly.",
    });
  });

  it("6) non-text and malformed updates are still ignored, never routed", () => {
    expect(classifyUpdate(identity({ text: null }))).toEqual({
      kind: "ignored",
      resultCode: "non_start_message",
    });
    expect(classifyUpdate(identity({ telegramUserId: null }))).toEqual({
      kind: "ignored",
      resultCode: "invalid_update_shape",
    });
  });

  it("7) the q1 callback namespace is disjoint from the RB-2B c1 namespace", () => {
    expect(composeQuickPostNewData()).toBe("q1:n");
    expect(composeQuickPostActionData("confirm", DRAFT_ID)).toBe(`q1:c:${DRAFT_ID}`);
    for (const data of [
      composeQuickPostNewData(),
      composeQuickPostActionData("confirm", DRAFT_ID),
      composeQuickPostActionData("restart", DRAFT_ID),
      composeQuickPostActionData("cancel", DRAFT_ID),
    ]) {
      expect(data.length).toBeLessThanOrEqual(64);
      expect(isQuickPostCallbackData(data)).toBe(true);
      expect(data.startsWith("c1:")).toBe(false);
    }
    // An RB-2B payload is never a Quick Post payload.
    expect(isQuickPostCallbackData(`c1:a:${DRAFT_ID}`)).toBe(false);
  });

  it("8) a q1 callback routes to the Quick Post action, an RB-2B one does not", () => {
    expect(
      classifyUpdate(
        identity({ callbackQueryId: "cb1", callbackData: `q1:c:${DRAFT_ID}`, text: null }),
      ),
    ).toEqual({
      kind: "quick_post_action",
      action: "confirm",
      draftId: DRAFT_ID,
      chatType: "private",
    });
    expect(
      classifyUpdate(
        identity({ callbackQueryId: "cb1", callbackData: `c1:a:${DRAFT_ID}`, text: null }),
      ),
    ).toMatchObject({ kind: "conversation_action" });
  });

  it("9) a malformed q1 payload stays in Quick Post and fails closed", () => {
    for (const data of ["q1:", "q1:z:" + DRAFT_ID, "q1:c:not-a-uuid", "q1:c:"]) {
      expect(parseQuickPostActionData(data)).toBeNull();
      expect(
        classifyUpdate(identity({ callbackQueryId: "cb1", callbackData: data, text: null })),
      ).toEqual({
        kind: "quick_post_action",
        action: null,
        draftId: null,
        chatType: "private",
      });
    }
  });

  it("10) every Quick Post outcome has a bounded, privacy-safe answer", () => {
    for (const code of TELEGRAM_QUICK_POST_RESULT_CODES) {
      const answer = TELEGRAM_QUICK_POST_ANSWERS[code];
      expect(answer.length).toBeGreaterThan(0);
      expect(answer.length).toBeLessThanOrEqual(200);
      expect(answer).not.toMatch(/@|http|\+1|[0-9a-f]{8}-/i);
      expect(isQuickPostResultCode(code)).toBe(true);
    }
    expect(isQuickPostResultCode("link_success" as TelegramResultCode)).toBe(false);
    expect(isQuickPostResultCode("conversation_reply_sent" as TelegramResultCode)).toBe(
      false,
    );
  });
});

// ───────────────────────────── B. orchestration ─────────────────────────────

const sha256 = async (input: string) =>
  [...input].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(64, "0");

const textUpdate = (updateId: number, text: string) => ({
  update_id: updateId,
  message: { from: { id: 555 }, chat: { id: 555, type: "private" }, text },
});

const callbackUpdate = (updateId: number, data: string) => ({
  update_id: updateId,
  callback_query: {
    id: `cb${updateId}`,
    from: { id: 555 },
    data,
    message: { chat: { id: 555, type: "private" } },
  },
});

interface Harness {
  ledger: TelegramPollLedger;
  gateway: TelegramGateway;
  extractor: TelegramQuickPostExtractor;
  extractions: { actorUserId: string; text: string }[];
  completions: { draftId: string; extracted: unknown; errorCode: string | null }[];
  actions: Record<string, unknown>[];
  ignored: number[];
  messages: { chatId: number; text: string }[];
  answers: string[];
}

function makeHarness(options: {
  updates: unknown[];
  sourceOutcome?: TelegramResultCode;
  actionOutcome?: TelegramResultCode;
  extractorFails?: boolean;
  omitExtractor?: boolean;
  omitActionProcessor?: boolean;
  omitCommandProcessor?: boolean;
}): Harness {
  const extractions: Harness["extractions"] = [];
  const completions: Harness["completions"] = [];
  const actions: Record<string, unknown>[] = [];
  const ignored: number[] = [];
  const messages: { chatId: number; text: string }[] = [];
  const answers: string[] = [];
  const receipts = new Map<number, TelegramResultCode>();

  const terminal = (
    updateId: number,
    resultCode: TelegramResultCode,
  ): TelegramTerminalResult => {
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
    recordIgnoredUpdate: async ({ updateId, resultCode }) => {
      ignored.push(updateId);
      return terminal(updateId, resultCode);
    },
    processStartUpdate: async ({ updateId }) => terminal(updateId, "link_success"),
    processBindUpdate: async ({ updateId }) => terminal(updateId, "bind_success"),
    processMenuUpdate: async ({ updateId }) => ({
      ...terminal(updateId, "menu_recruiter"),
      menuText: "menu",
      menuButtons: null,
    }),
    processQuickPostSourceUpdate: async ({ updateId }) => ({
      ...terminal(updateId, options.sourceOutcome ?? "quick_post_source_reserved"),
      draftId: DRAFT_ID,
      actorUserId: ACTOR_ID,
    }),
    completeQuickPostExtraction: async ({ draftId, extracted, errorCode }) => {
      completions.push({ draftId, extracted, errorCode });
      if (errorCode !== null) {
        return {
          isNew: true,
          resultCode: "quick_post_source_rejected",
          draftId,
          followUpText: "That job post couldn't be read.",
        };
      }
      return {
        isNew: true,
        resultCode: "quick_post_source_reserved",
        draftId,
        followUpText: "Review this draft opportunity\n\nTitle: Not provided",
        followUpButtons: [
          [{ text: "Confirm", callbackData: composeQuickPostActionData("confirm", draftId) }],
        ] as TelegramInlineButton[][],
      };
    },
  };

  if (!options.omitCommandProcessor) {
    ledger.processQuickPostCommandUpdate = async ({ updateId }) => ({
      ...terminal(updateId, "quick_post_started"),
      draftId: DRAFT_ID,
    });
  }

  if (!options.omitActionProcessor) {
    ledger.processQuickPostActionUpdate = async (input) => {
      const replayed = receipts.has(input.updateId);
      if (!replayed) actions.push({ ...input });
      return {
        ...terminal(input.updateId, options.actionOutcome ?? "quick_post_created"),
        draftId: input.draftId,
      };
    };
  }

  const extractor: TelegramQuickPostExtractor = {
    extract: async (input) => {
      extractions.push({ ...input });
      return options.extractorFails
        ? { ok: false, errorCode: "extraction_failed" }
        : { ok: true, extracted: { title: "OTR Reefer Driver" } };
    },
  };

  const gateway: TelegramGateway = {
    getUpdates: async () => ({ ok: true, status: 200, result: options.updates }),
    sendMessage: async ({ chatId, text }) => {
      messages.push({ chatId, text });
      return { ok: true, status: 200, result: { message_id: 9001 } };
    },
    answerCallbackQuery: async ({ text }) => {
      answers.push(text);
      return { ok: true, status: 200 };
    },
  };

  return { ledger, gateway, extractor, extractions, completions, actions, ignored, messages, answers };
}

const runHarness = (h: Harness, omitExtractor = false) =>
  runTelegramPoll({
    ledger: h.ledger,
    gateway: h.gateway,
    sha256,
    ...(omitExtractor ? {} : { quickPostExtractor: h.extractor }),
  });

describe("RB-3A B — exactly one extraction, nothing created before Confirm", () => {
  it("1) a reserved source update extracts exactly once and shows a review", async () => {
    const h = makeHarness({ updates: [textUpdate(11, "Hiring OTR reefer drivers.")] });
    await runHarness(h);

    expect(h.extractions).toEqual([
      { actorUserId: ACTOR_ID, text: "Hiring OTR reefer drivers." },
    ]);
    expect(h.completions).toEqual([
      { draftId: DRAFT_ID, extracted: { title: "OTR Reefer Driver" }, errorCode: null },
    ]);
    // Review is shown; NOTHING was created.
    expect(h.messages.some((m) => m.text.startsWith("Review this draft opportunity"))).toBe(
      true,
    );
    expect(h.actions).toEqual([]);
  });

  it("2) a duplicate delivery never spends a second extraction", async () => {
    const update = textUpdate(11, "Hiring OTR reefer drivers.");
    const h = makeHarness({ updates: [update, update] });
    await runHarness(h);
    expect(h.extractions).toHaveLength(1);
    expect(h.completions).toHaveLength(1);
  });

  it("3) text without a live draft records non_start_message and never extracts", async () => {
    const h = makeHarness({
      updates: [textUpdate(12, "hello there")],
      sourceOutcome: "non_start_message",
    });
    await runHarness(h);
    expect(h.extractions).toEqual([]);
    expect(h.completions).toEqual([]);
    expect(h.actions).toEqual([]);
  });

  it("4) an extractor failure is persisted as a failure, never as a draft", async () => {
    const h = makeHarness({
      updates: [textUpdate(13, "Hiring OTR reefer drivers.")],
      extractorFails: true,
    });
    await runHarness(h);
    expect(h.completions).toEqual([
      { draftId: DRAFT_ID, extracted: null, errorCode: "extraction_failed" },
    ]);
    expect(h.actions).toEqual([]);
  });

  it("5) with no extractor wired the draft fails closed and no model is implied", async () => {
    const h = makeHarness({ updates: [textUpdate(14, "Hiring OTR reefer drivers.")] });
    await runHarness(h, true);
    expect(h.extractions).toEqual([]);
    expect(h.completions).toEqual([
      { draftId: DRAFT_ID, extracted: null, errorCode: "extractor_unavailable" },
    ]);
  });

  it("6) Confirm reaches the processor once and a replay creates nothing more", async () => {
    const confirm = callbackUpdate(21, composeQuickPostActionData("confirm", DRAFT_ID));
    const h = makeHarness({ updates: [confirm, confirm] });
    await runHarness(h);
    expect(h.actions).toHaveLength(1);
    expect(h.actions[0]).toMatchObject({
      action: "confirm",
      draftId: DRAFT_ID,
      chatType: "private",
    });
    expect(h.answers).toEqual([
      TELEGRAM_QUICK_POST_ANSWERS.quick_post_created,
      TELEGRAM_QUICK_POST_ANSWERS.quick_post_created,
    ]);
  });

  it("7) Cancel and Start Over transport their own action, never a creation", async () => {
    for (const action of ["cancel", "restart"] as const) {
      const h = makeHarness({
        updates: [callbackUpdate(31, composeQuickPostActionData(action, DRAFT_ID))],
        actionOutcome: action === "cancel" ? "quick_post_cancelled" : "quick_post_restarted",
      });
      await runHarness(h);
      expect(h.actions[0]).toMatchObject({ action, draftId: DRAFT_ID });
      expect(h.extractions).toEqual([]);
    }
  });

  it("8) `/post` opens a draft and never extracts or creates", async () => {
    const h = makeHarness({ updates: [textUpdate(41, "/post")] });
    await runHarness(h);
    expect(h.extractions).toEqual([]);
    expect(h.actions).toEqual([]);
    expect(h.messages[0]?.text).toBe(TELEGRAM_QUICK_POST_ANSWERS.quick_post_started);
  });

  it("9) without a command processor `/post` keeps its exact pre-RB-3A outcome", async () => {
    const h = makeHarness({ updates: [textUpdate(42, "/post")], omitCommandProcessor: true });
    await runHarness(h);
    expect(h.ignored).toEqual([42]);
    expect(h.extractions).toEqual([]);
    expect(h.actions).toEqual([]);
  });

  it("10) without an action processor a q1 tap fails CLOSED and does not advance", async () => {
    const h = makeHarness({
      updates: [callbackUpdate(51, composeQuickPostActionData("confirm", DRAFT_ID))],
      omitActionProcessor: true,
    });
    const result = await runHarness(h);
    expect(result.kind).toBe("failed");
    expect(h.actions).toEqual([]);
  });
});

// ───────────────────────────── C. presentation ─────────────────────────────

describe("RB-3A C — the review shows approved fields only, nothing inferred", () => {
  it("renders `Not provided` rather than guessing a missing field", () => {
    expect(EDGE_CODE).toContain('const QUICK_POST_NOT_PROVIDED = "Not provided"');
    expect(EDGE_CODE).toContain("QUICK_POST_REVIEW_FIELDS");
    // The review is built ONLY by iterating the approved field list.
    expect(EDGE_CODE).toContain(
      "QUICK_POST_REVIEW_FIELDS.map(",
    );
    // No default, fallback or inferred value anywhere in the composer.
    expect(EDGE_CODE).not.toMatch(/label: "Title" \}[\s\S]{0,200}default/);
  });

  it("never echoes the raw source text back to the chat", () => {
    expect(EDGE_CODE).not.toContain("raw_source_text");
    expect(ORCHESTRATOR_CODE).not.toContain("raw_source_text");
  });

  it("offers exactly Confirm, Start Over and Cancel on a review", () => {
    expect(EDGE_CODE).toContain('text: "✅ Confirm"');
    expect(EDGE_CODE).toContain('text: "🔄 Start Over"');
    expect(EDGE_CODE).toContain('text: "✖️ Cancel"');
  });

  it("adds exactly ONE recruiter Quick Post button and leaves Driver buttons URL-only", () => {
    expect(EDGE_CODE.split("composeQuickPostNewData()").length - 1).toBe(1);
    const workButtons = EDGE_CODE.slice(
      EDGE_CODE.indexOf("const WORK_BUTTONS"),
      EDGE_CODE.indexOf("const RECRUITER_BUTTONS"),
    );
    expect(workButtons).not.toContain("callback_data");
    expect(workButtons).toContain("URL_FIND_WORK");
    expect(workButtons).toContain("URL_WORK_PROFILE");
  });
});

// ───────────────────────────── D. SQL contract ─────────────────────────────

describe("RB-3A D — the database owns authorization, creation and exactly-once", () => {
  it("creates opportunities ONLY through the canonical delegated creator", () => {
    expect(RB3A_CODE).toContain("create_recruiter_opportunity_as_actor");
    // No Quick Post function writes to opportunities directly.
    expect(RB3A_CODE).not.toMatch(/INSERT\s+INTO\s+public\.opportunities/i);
    expect(RB3A_CODE).not.toMatch(/UPDATE\s+public\.opportunities/i);
  });

  it("re-derives the actor server-side and never trusts the callback payload", () => {
    expect(RB3A_CODE).toContain("telegram_resolve_recruiter_actor");
    expect(RB3A_CODE).toContain("_telegram_quick_post_recruiter");
  });

  it("locks every Quick Post function to service_role", () => {
    for (const fn of [
      "telegram_process_quick_post_command_update",
      "telegram_process_quick_post_source_update",
      "telegram_complete_quick_post_extraction",
      "telegram_process_quick_post_action_update",
    ]) {
      expect(RB3A_CODE).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM anon`),
      );
      expect(RB3A_CODE).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM authenticated`),
      );
      expect(RB3A_CODE).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`),
      );
    }
  });

  it("hardens the search path on every SECURITY DEFINER function it defines", () => {
    const definers = RB3A_CODE.split("SECURITY DEFINER").length - 1;
    const hardened =
      RB3A_CODE.split("SET search_path TO 'pg_catalog', 'public', 'auth'").length - 1;
    expect(definers).toBeGreaterThan(0);
    expect(hardened).toBe(definers);
  });

  it("keeps the draft table service-role only with RLS enabled", () => {
    expect(RB3A_CODE).toContain(
      "ALTER TABLE public.telegram_opportunity_drafts ENABLE ROW LEVEL SECURITY",
    );
    expect(RB3A_CODE).toMatch(
      /GRANT ALL ON TABLE public\.telegram_opportunity_drafts TO service_role/,
    );
    expect(RB3A_CODE).not.toMatch(
      /GRANT[^;]*ON TABLE public\.telegram_opportunity_drafts TO (anon|authenticated)/,
    );
  });

  it("filters the extractor payload through an explicit allowlist", () => {
    expect(RB3A_CODE).toContain("_telegram_quick_post_filter_payload");
  });

  it("writes the terminal receipt in the same transaction as every action", () => {
    const actionFn = RB3A_CODE.slice(
      RB3A_CODE.indexOf("FUNCTION public.telegram_process_quick_post_action_update"),
    );
    expect(actionFn).toContain("INSERT INTO public.telegram_update_receipts");
  });
});

// ───────────────────────────── E. adapter contract ─────────────────────────────

describe("RB-3A E — one poller, one extractor, no secret or content in a log", () => {
  it("reuses the SINGLE ai-insight delegated extractor and forks no prompt or model", () => {
    expect(EDGE_CODE).toContain("/functions/v1/ai-insight");
    expect(EDGE_CODE).toContain("delegated_actor_user_id");
    expect(EDGE_CODE).toContain('type: "parse_opportunity"');
    expect(EDGE_CODE).not.toContain("gemini");
    expect(EDGE_CODE).not.toContain("extract_opportunity");
    expect(EDGE_CODE).not.toContain("ai.gateway.lovable.dev");
    expect(EDGE_CODE).not.toContain("SYSTEM_PROMPT");
  });

  it("adds no second poller and no webhook", () => {
    expect(EDGE_CODE).not.toContain("setWebhook");
    expect(EDGE_CODE.split("runTelegramPoll(").length - 1).toBe(1);
  });

  it("never logs a token, the source text, an actor or extracted content", () => {
    expect(EDGE_CODE).not.toMatch(/log\([^)]*(token|serviceRoleKey|SERVICE_ROLE)/);
    expect(EDGE_CODE).not.toMatch(/log\([^)]*(text|actorUserId|payload|extracted)/);
    expect(ORCHESTRATOR_CODE).not.toMatch(
      /log\([^)]*(text|actorUserId|draftId|extracted)/,
    );
  });

  it("keeps the delegated creator and extractor prerequisites referenced, not reimplemented", () => {
    expect(EDGE_CODE).not.toContain("create_recruiter_opportunity");
    expect(ORCHESTRATOR_CODE).not.toContain("create_recruiter_opportunity");
  });
});
