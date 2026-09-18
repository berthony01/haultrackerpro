// Phase RB-3B-A — Quick Post guidance + processing UX + extraction truthfulness.
//
// Tests:
//   1. q1:n callback sends a real chat message with guidance copy, exactly once.
//   2. Processing feedback is sent BEFORE the extraction call.
//   3. Replay does not duplicate the instruction, progress message, or model spend.
//   4-8. Extraction prompt truthfulness rules (source inspection).
//   9. RB-2 conversation reply precedence intact.
//   10. RB-3A Confirm/Restart/Cancel intact.
//   11. Review fields use correct field names matching the tool schema.
//   12. No raw text, tokens, or identifiers in log lines.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  QUICK_POST_PROCESSING_TEXT,
  TELEGRAM_QUICK_POST_ANSWERS,
  composeQuickPostActionData,
  composeQuickPostNewData,
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

const ORCHESTRATOR_SOURCE = read("supabase/functions/_shared/telegram-poll-ingest.ts");
const EDGE_SOURCE = read("supabase/functions/telegram-poll/index.ts");
const AI_SOURCE = read("supabase/functions/ai-insight/index.ts");

const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ORCHESTRATOR_CODE = stripTsComments(ORCHESTRATOR_SOURCE);
const EDGE_CODE = stripTsComments(EDGE_SOURCE);
const AI_CODE = stripTsComments(AI_SOURCE);

const DRAFT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

// ─────────────────── Harness ───────────────────

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
  messages: { chatId: number; text: string }[];
  answers: string[];
  events: { type: string; text?: string }[];
}

function makeHarness(options: {
  updates: unknown[];
  sourceOutcome?: TelegramResultCode;
  actionOutcome?: TelegramResultCode;
  extractorFails?: boolean;
}): Harness {
  const extractions: Harness["extractions"] = [];
  const completions: Harness["completions"] = [];
  const actions: Record<string, unknown>[] = [];
  const messages: Harness["messages"] = [];
  const answers: string[] = [];
  const events: Harness["events"] = [];
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

  // Mirrors the real adapter's composeQuickPostActionFollowUp.
  const actionFollowUp = (resultCode: TelegramResultCode): string | null => {
    if (resultCode === "quick_post_started") {
      return "Ready to post an opportunity.\n\nPaste the full job post here as one message. I'll extract the details and show you a review before anything is created.\n\nNothing is posted until you confirm.";
    }
    if (resultCode === "quick_post_created") {
      return "Draft opportunity created in HaulTracker Pro. Open it to review the details and publish when you're ready.";
    }
    if (resultCode === "quick_post_create_blocked") {
      return "That couldn't be created from here. Open HaulTracker Pro to finish this opportunity.";
    }
    return null;
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
    processQuickPostActionUpdate: async (input) => {
      const replayed = receipts.has(input.updateId);
      if (!replayed) actions.push({ ...input });
      const resultCode = options.actionOutcome ?? "quick_post_created";
      const t = terminal(input.updateId, resultCode);
      return {
        ...t,
        draftId: input.draftId,
        followUpText: actionFollowUp(resultCode),
        followUpButtons:
          resultCode === "quick_post_created"
            ? null
            : null,
      };
    },
  };

  const extractor: TelegramQuickPostExtractor = {
    extract: async (input) => {
      events.push({ type: "extraction" });
      extractions.push({ ...input });
      return options.extractorFails
        ? { ok: false, errorCode: "extraction_failed" }
        : { ok: true, extracted: { title: "OTR Reefer Driver" } };
    },
  };

  const gateway: TelegramGateway = {
    getUpdates: async () => ({ ok: true, status: 200, result: options.updates }),
    sendMessage: async ({ chatId, text }) => {
      events.push({ type: "message", text });
      messages.push({ chatId, text });
      return { ok: true, status: 200, result: { message_id: 9001 } };
    },
    answerCallbackQuery: async ({ text }) => {
      answers.push(text);
      return { ok: true, status: 200 };
    },
  };

  return { ledger, gateway, extractor, extractions, completions, actions, messages, answers, events };
}

const runHarness = (h: Harness) =>
  runTelegramPoll({
    ledger: h.ledger,
    gateway: h.gateway,
    sha256,
    quickPostExtractor: h.extractor,
  });

// ─────────────────── 1. q1:n guidance message ───────────────────

describe("RB-3B-A 1 — q1:n sends a visible guidance message exactly once", () => {
  it("sends a real chat message after Post Opportunity (q1:n) is accepted", async () => {
    const h = makeHarness({
      updates: [callbackUpdate(100, composeQuickPostNewData())],
      actionOutcome: "quick_post_started",
    });
    await runHarness(h);

    // The guidance message must be a real sendMessage, not just a toast.
    const guidance = h.messages.find(
      (m) => m.text.startsWith("Ready to post an opportunity"),
    );
    expect(guidance).toBeTruthy();
    expect(guidance!.text).toContain("Paste the full job post");
    expect(guidance!.text).toContain("Nothing is posted until you confirm");
  });

  it("does not duplicate the guidance on a replay of the same q1:n callback", async () => {
    const tap = callbackUpdate(101, composeQuickPostNewData());
    const h = makeHarness({ updates: [tap, tap], actionOutcome: "quick_post_started" });
    await runHarness(h);

    const guidanceMessages = h.messages.filter((m) =>
      m.text.startsWith("Ready to post an opportunity"),
    );
    expect(guidanceMessages).toHaveLength(1);
  });

  it("still answers the callback query (toast) on both first tap and replay", async () => {
    const tap = callbackUpdate(102, composeQuickPostNewData());
    const h = makeHarness({ updates: [tap, tap], actionOutcome: "quick_post_started" });
    await runHarness(h);

    expect(h.answers).toHaveLength(2);
    expect(h.answers[0]).toBe(TELEGRAM_QUICK_POST_ANSWERS.quick_post_started);
    expect(h.answers[1]).toBe(TELEGRAM_QUICK_POST_ANSWERS.quick_post_started);
  });
});

// ─────────────────── 2. processing feedback before extraction ───────────────────

describe("RB-3B-A 2 — processing feedback sent before extraction", () => {
  it("sends a processing message before the extractor runs", async () => {
    const h = makeHarness({
      updates: [textUpdate(200, "Hiring OTR reefer drivers, 0.62 cpm, home weekly.")],
    });
    await runHarness(h);

    // The events array records operations in order.
    const processingIdx = h.events.findIndex(
      (e) => e.type === "message" && e.text === QUICK_POST_PROCESSING_TEXT,
    );
    const extractionIdx = h.events.findIndex((e) => e.type === "extraction");

    expect(processingIdx).toBeGreaterThanOrEqual(0);
    expect(extractionIdx).toBeGreaterThanOrEqual(0);
    expect(processingIdx).toBeLessThan(extractionIdx);
  });

  it("the processing text mentions extraction and a few-seconds wait", () => {
    expect(QUICK_POST_PROCESSING_TEXT).toContain("extracting");
    expect(QUICK_POST_PROCESSING_TEXT).toContain("few seconds");
    expect(QUICK_POST_PROCESSING_TEXT).toContain("review");
  });

  it("does not send the processing message on a replayed source update", async () => {
    const update = textUpdate(201, "Hiring OTR reefer drivers, 0.62 cpm, home weekly.");
    const h = makeHarness({ updates: [update, update] });
    await runHarness(h);

    const processingMessages = h.messages.filter(
      (m) => m.text === QUICK_POST_PROCESSING_TEXT,
    );
    expect(processingMessages).toHaveLength(1);
    expect(h.extractions).toHaveLength(1);
  });

  it("does not send the old 'Reading that job post…' answer as a separate message", async () => {
    const h = makeHarness({
      updates: [textUpdate(202, "Hiring OTR reefer drivers, 0.62 cpm, home weekly.")],
    });
    await runHarness(h);

    expect(h.messages.some((m) => m.text === "Reading that job post…")).toBe(false);
  });
});

// ─────────────────── 3. no duplicate model spend on replay ───────────────────

describe("RB-3B-A 3 — replay does not duplicate instruction, progress, or model spend", () => {
  it("a full Quick Post flow (q1:n → source → review) then replay source = no second extraction", async () => {
    const source = textUpdate(300, "Hiring OTR reefer drivers, 0.62 cpm, home weekly.");
    const h = makeHarness({
      updates: [callbackUpdate(301, composeQuickPostNewData()), source, source],
      actionOutcome: "quick_post_started",
    });
    await runHarness(h);

    // One extraction for the first source delivery, zero for the replay.
    expect(h.extractions).toHaveLength(1);
    expect(h.completions).toHaveLength(1);

    // Processing message sent once, not twice.
    const processingMessages = h.messages.filter(
      (m) => m.text === QUICK_POST_PROCESSING_TEXT,
    );
    expect(processingMessages).toHaveLength(1);
  });
});

// ─────────────────── 4-8. extraction truthfulness (source inspection) ───────────────────

describe("RB-3B-A 4-8 — extraction prompt truthfulness", () => {
  it("4) never emits min_years_experience=0 for 'not provided'", () => {
    expect(AI_CODE).toContain("NEVER emit 0 to represent");
    expect(AI_CODE).toContain('omit the field entirely');
    // The tool schema must not have minimum: 0 on min_years_experience.
    expect(AI_CODE).not.toMatch(/min_years_experience[\s\S]{0,200}minimum:\s*0/);
  });

  it("5) hiring_states must only include explicitly present state codes", () => {
    expect(AI_CODE).toContain('Include ONLY state codes that appear explicitly in the source text');
    expect(AI_CODE).toContain('Never infer a state from a city name');
    expect(AI_CODE).toContain('Never add a state that does not appear in the source');
  });

  it("6) multi-rate or range CPM must be omitted, not flattened; pay wording preserved in description", () => {
    expect(AI_CODE).toContain('different rates for Solo vs Team');
    expect(AI_CODE).toContain('never pick one endpoint of a range');
    expect(AI_CODE).toContain('OMIT cpm entirely');
    expect(AI_CODE).toContain('Preserve the exact pay wording in the description field');
  });

  it("7) a headline can be cleaned into a factual title", () => {
    expect(AI_CODE).toContain('derive from the headline or job title in the source');
    expect(AI_CODE).toContain('HIRING CDL-A drivers ASAP');
    expect(AI_CODE).toContain('Never invent a title from a contact name');
  });

  it("8) company_name must be omitted when not provided, never derived from contact name", () => {
    expect(AI_CODE).toContain('company_name: omit when the source does not name a company');
    expect(AI_CODE).toContain('Never derive from a contact name or recruiter name');
  });

  it("preserves complex pay wording in the description field for review", () => {
    expect(AI_CODE).toContain('include the exact pay wording from the source here so it survives into review');
    expect(AI_CODE).toContain('Include benefits when stated');
  });

  it("driver_type does not invent solo+team from route or trailer type", () => {
    expect(AI_CODE).toContain('Use "team" when the source explicitly mentions team driving');
    expect(AI_CODE).toContain('otherwise omit');
  });
});

// ─────────────────── 9. RB-2 reply precedence intact ───────────────────

describe("RB-3B-A 9 — RB-2 conversation reply precedence intact", () => {
  it("a reply-to message is never swallowed by Quick Post source routing", async () => {
    const h = makeHarness({
      updates: [
        {
          update_id: 400,
          message: {
            from: { id: 555 },
            chat: { id: 555, type: "private" },
            text: "I accept this load",
            reply_to_message: { message_id: 4242 },
          },
        },
      ],
    });
    await runHarness(h);
    // A reply must never trigger extraction.
    expect(h.extractions).toEqual([]);
  });
});

// ─────────────────── 10. RB-3A Confirm/Restart/Cancel intact ───────────────────

describe("RB-3B-A 10 — RB-3A Confirm/Start Over/Cancel intact", () => {
  it("Confirm reaches the processor once; replay does not create again", async () => {
    const confirm = callbackUpdate(500, composeQuickPostActionData("confirm", DRAFT_ID));
    const h = makeHarness({ updates: [confirm, confirm] });
    await runHarness(h);
    expect(h.actions).toHaveLength(1);
    expect(h.actions[0]).toMatchObject({ action: "confirm", draftId: DRAFT_ID });
  });

  it("Cancel and Start Over transport their action, never a creation", async () => {
    for (const action of ["cancel", "restart"] as const) {
      const h = makeHarness({
        updates: [callbackUpdate(510, composeQuickPostActionData(action, DRAFT_ID))],
        actionOutcome: action === "cancel" ? "quick_post_cancelled" : "quick_post_restarted",
      });
      await runHarness(h);
      expect(h.actions[0]).toMatchObject({ action });
      expect(h.extractions).toEqual([]);
    }
  });

  it("a created follow-up message is not duplicated on replay", async () => {
    const confirm = callbackUpdate(520, composeQuickPostActionData("confirm", DRAFT_ID));
    const h = makeHarness({ updates: [confirm, confirm] });
    await runHarness(h);
    const createdMessages = h.messages.filter((m) =>
      m.text.startsWith("Draft opportunity created"),
    );
    expect(createdMessages).toHaveLength(1);
  });
});

// ─────────────────── 11. review field names ───────────────────

describe("RB-3B-A 11 — review fields use correct tool-schema field names", () => {
  it("uses cpm (not cpm_rate) for the rate-per-mile field", () => {
    expect(EDGE_CODE).toContain('{ key: "cpm", label: "Rate per mile" }');
    expect(EDGE_CODE).not.toContain('cpm_rate');
  });

  it("uses percentage_pay (not percentage_rate)", () => {
    expect(EDGE_CODE).toContain('{ key: "percentage_pay", label: "Percentage" }');
    expect(EDGE_CODE).not.toContain('percentage_rate');
  });

  it("uses flat_weekly_pay (not flat_rate_amount)", () => {
    expect(EDGE_CODE).toContain('{ key: "flat_weekly_pay", label: "Flat weekly pay" }');
    expect(EDGE_CODE).not.toContain('flat_rate_amount');
  });

  it("includes hiring_states for multi-state postings", () => {
    expect(EDGE_CODE).toContain('{ key: "hiring_states", label: "States" }');
  });

  it("includes description for pay details / summary", () => {
    expect(EDGE_CODE).toContain('{ key: "description", label: "Summary / pay details" }');
  });

  it("includes requirements for requirement text", () => {
    expect(EDGE_CODE).toContain('{ key: "requirements", label: "Requirements" }');
  });

  it("does not use non-existent field names weekly_pay_min or weekly_pay_max", () => {
    expect(EDGE_CODE).not.toContain('weekly_pay_min');
    expect(EDGE_CODE).not.toContain('weekly_pay_max');
  });
});

// ─────────────────── 12. no secrets / raw text in logs ───────────────────

describe("RB-3B-A 12 — no secrets or raw content in log lines", () => {
  it("the orchestrator never logs source text, tokens, or extracted content", () => {
    expect(ORCHESTRATOR_CODE).not.toMatch(
      /log\([^)]*(token|serviceRoleKey|SERVICE_ROLE|text|actorUserId|draftId|extracted)/i,
    );
  });

  it("the processing feedback does not expose raw source text", () => {
    expect(QUICK_POST_PROCESSING_TEXT).not.toMatch(/@|http|\+1|[0-9a-f]{8}-/i);
  });

  it("the guidance text does not expose raw source text or links", () => {
    const guidance = EDGE_CODE.match(/QUICK_POST_GUIDANCE_TEXT[\s\S]*?";/);
    expect(guidance).toBeTruthy();
    expect(guidance![0]).not.toMatch(/@|http|\+1|[0-9a-f]{8}-/i);
  });
});
