// Phase TG-2D — Telegram polling intake Edge Function shell.
//
// NOT DEPLOYED in TG-2D. This file exists so the server adapter is reviewable
// alongside its orchestrator and its database candidate; deployment, config,
// scheduling, and connector linking are all later, separately authorised work.
//
// Receive path: Lovable's Telegram app+chat connector does NOT support
// incoming webhooks, so this adapter POLLS Bot API `getUpdates` through the
// Lovable connector gateway. There is deliberately no webhook route, no
// registration call, and no direct Telegram host anywhere in this file. The
// gateway injects the bot token; this process never sees one.
//
// Invocation: internal service only (a scheduled service-role call). There is
// no browser workflow, therefore no CORS handling.

import { createClient } from "npm:@supabase/supabase-js@2.57.2";

import {
  boundedRpcErrorCode,
  composeQuickPostActionData,
  composeQuickPostNewData,
  runTelegramAlertDrain,
  runTelegramMessageDeliveryDrain,
  runTelegramPoll,
  sanitizeErrorCode,
  type TelegramAlertClaim,
  type TelegramAlertOutbox,
  type TelegramGateway,
  type TelegramGatewayResponse,
  type TelegramConversationAction,
  type TelegramIgnoredResultCode,
  type TelegramInlineButton,
  type TelegramInlineUrlButton,
  type TelegramMenuCommand,
  type TelegramMessageDeliveryClaim,
  type TelegramMessageDeliveryOutbox,
  type TelegramPollLease,
  type TelegramPollLedger,
  type TelegramQuickPostExtractor,
  type TelegramResultCode,
  type TelegramSentMessage,
  type TelegramTerminalResult,
} from "../_shared/telegram-poll-ingest.ts";


const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

// Logs carry update ids, counts, and fixed result codes ONLY. No message
// text, no link token, no names, no raw JSON, no gateway body, no credentials.
const log = (step: string, details?: Record<string, string | number | boolean>) =>
  console.log(`[TELEGRAM-POLL] ${step}${details ? ` — ${JSON.stringify(details)}` : ""}`);

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish comparison so an attacker cannot probe the expected
 *  purpose-scoped invocation secret byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function buildGateway(lovableApiKey: string, connectionKey: string): TelegramGateway {
  const call = async <T>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<TelegramGatewayResponse<T>> => {
    let response: Response;
    try {
      response = await fetch(`${GATEWAY_URL}/${method}`, {
        method: "POST",
        headers: {
          // Managed Lovable credentials. `TELEGRAM_API_KEY` is the Lovable
          // CONNECTION key for the gateway, never a Telegram bot token.
          Authorization: `Bearer ${lovableApiKey}`,
          "X-Connection-Api-Key": connectionKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      return { ok: false, status: 0, errorCode: sanitizeErrorCode(error) };
    }

    if (!response.ok) {
      // The provider body can echo user content, so it is consumed and
      // discarded rather than logged or returned.
      await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        errorCode: "telegram_gateway_http_error",
      };
    }

    let body: { ok?: boolean; result?: T };
    try {
      body = await response.json();
    } catch {
      return {
        ok: false,
        status: response.status,
        errorCode: "telegram_gateway_bad_body",
      };
    }

    // Telegram reports many failures inside a 2xx body, so the `ok` field is
    // checked in addition to the HTTP status.
    if (body?.ok !== true) {
      return {
        ok: false,
        status: response.status,
        errorCode: "telegram_bot_api_error",
      };
    }

    return { ok: true, status: response.status, result: body.result };
  };

  // RB-2B. URL rows keep their exact previous wire shape; callback rows emit
  // Telegram's `callback_data`. The payload carries no other new field.
  const toInlineKeyboard = (rows: TelegramInlineButton[][]) =>
    rows.map((row) =>
      row.map((button) =>
        "url" in button
          ? { text: button.text, url: button.url }
          : { text: button.text, callback_data: button.callbackData }
      )
    );

  return {
    getUpdates: (options) => call<unknown[]>("getUpdates", { ...options }),
    // RB-1B. `buttons` carries inline rows. When absent the payload is
    // byte-identical to the RB-1A one.
    // RB-2C. The typed result exposes ONLY `message_id`, which the alert drain
    // persists as the reply locator for that alert.
    sendMessage: ({ chatId, text, buttons }) =>
      call<TelegramSentMessage>("sendMessage", {
        chat_id: chatId,
        text,
        ...(buttons && buttons.length > 0
          ? { reply_markup: { inline_keyboard: toInlineKeyboard(buttons) } }
          : {}),
      }),
    // RB-2B. Resolves the tap spinner. Non-mutating and best-effort: the
    // orchestrator never lets a failure here repeat or undo a database action.
    answerCallbackQuery: ({ callbackQueryId, text }) =>
      call<unknown>("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text,
      }),
  };
}

type RpcClient = ReturnType<typeof createClient>;

function buildLedger(supabase: RpcClient): TelegramPollLedger {
  const unwrapTerminal = (rows: unknown): TelegramTerminalResult => {
    const row = Array.isArray(rows) ? rows[0] : rows;
    const record = (row ?? {}) as { is_new?: boolean; result_code?: string };
    return {
      isNew: record.is_new === true,
      resultCode: record.result_code as TelegramResultCode,
    };
  };

  return {
    async claimLease(): Promise<TelegramPollLease | null> {
      const { data, error } = await supabase.rpc("telegram_claim_poll_lease");
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      const record = row as { lease_token?: string; next_offset?: number | string };
      if (!record.lease_token) return null;
      return {
        leaseToken: record.lease_token,
        nextOffset: Number(record.next_offset ?? 1),
      };
    },
    async releaseLease(leaseToken: string): Promise<boolean> {
      const { data, error } = await supabase.rpc("telegram_release_poll_lease", {
        _lease_token: leaseToken,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async advanceCursor(leaseToken: string, lastUpdateId: number): Promise<number> {
      const { data, error } = await supabase.rpc("telegram_advance_poll_cursor", {
        _lease_token: leaseToken,
        _last_update_id: lastUpdateId,
      });
      if (error) throw new Error(error.message);
      return Number(data);
    },
    async recordIgnoredUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number | null;
      telegramChatId: number | null;
      resultCode: TelegramIgnoredResultCode;
    }): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc("telegram_record_ignored_update", {
        _lease_token: input.leaseToken,
        _update_id: input.updateId,
        _payload_hash: input.payloadHash,
        _telegram_user_id: input.telegramUserId,
        _telegram_chat_id: input.telegramChatId,
        _result_code: input.resultCode,
      });
      if (error) throw new Error(error.message);
      return unwrapTerminal(data);
    },
    async processStartUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number;
      telegramChatId: number;
      chatType: string;
      rawToken: string;
    }): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc("telegram_process_start_update", {
        _lease_token: input.leaseToken,
        _update_id: input.updateId,
        _payload_hash: input.payloadHash,
        _telegram_user_id: input.telegramUserId,
        _telegram_chat_id: input.telegramChatId,
        _chat_type: input.chatType,
        _raw_token: input.rawToken,
      });
      if (error) throw new Error(error.message);
      return unwrapTerminal(data);
    },
    // TG-2F-C. Consumption and its terminal receipt are owned by the single
    // database transaction behind this RPC. This adapter deliberately never
    // calls the consume function itself.
    async processBindUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number;
      telegramChatId: number;
      chatType: string;
      rawToken: string;
    }): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc("telegram_process_bind_update", {
        _lease_token: input.leaseToken,
        _update_id: input.updateId,
        _payload_hash: input.payloadHash,
        _telegram_user_id: input.telegramUserId,
        _telegram_chat_id: input.telegramChatId,
        _chat_type: input.chatType,
        _raw_token: input.rawToken,
      });
      if (error) throw new Error(error.message);
      return unwrapTerminal(data);
    },
    // RB-1A / RB-1B. Read-only role-aware menu/status. The database owns actor
    // resolution, authorization and the terminal receipt in one transaction;
    // this adapter only renders the bounded descriptor it returns.
    async processMenuUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number;
      telegramChatId: number;
      chatType: string;
      command: TelegramMenuCommand;
    }): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc("telegram_process_menu_update", {
        _lease_token: input.leaseToken,
        _update_id: input.updateId,
        _payload_hash: input.payloadHash,
        _telegram_user_id: input.telegramUserId,
        _telegram_chat_id: input.telegramChatId,
        _chat_type: input.chatType,
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as
        | { is_new?: boolean; result_code?: string; workspaces?: unknown }
        | null;
      const resultCode = (row?.result_code ?? "") as TelegramResultCode;
      return {
        isNew: row?.is_new === true,
        resultCode,
        menuText: composeMenuText(resultCode, row?.workspaces, input.command),
        menuButtons: composeMenuButtons(resultCode),
      };
    },
    // RB-2B. Private-chat Accept / Pass. The database derives the acting
    // account from the active Telegram link, re-authorizes it against CF-1 for
    // THAT conversation, performs the canonical CF-1 transition and writes the
    // terminal receipt in one transaction. This adapter transports the untrusted
    // locator and the fixed outcome code only — never an actor, workspace or
    // driver identity.
    async processConversationActionUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number;
      telegramChatId: number;
      chatType: string;
      action: TelegramConversationAction | null;
      threadId: string | null;
    }): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc(
        "telegram_process_conversation_action_update",
        {
          _lease_token: input.leaseToken,
          _update_id: input.updateId,
          _payload_hash: input.payloadHash,
          _telegram_user_id: input.telegramUserId,
          _telegram_chat_id: input.telegramChatId,
          _chat_type: input.chatType,
          _action: input.action,
          _thread_id: input.threadId,
        },
      );
      // RB-3A.1. Callback RPC failures surface as a BOUNDED code only.
      if (error) throw new Error(boundedRpcErrorCode(error));
      return unwrapTerminal(data);
    },
    // RB-2C. Private-chat recruiter reply. The database resolves the thread
    // from an alert actually delivered to the acting linked account,
    // re-authorizes it against CF-1, writes the Driver-visible message through
    // the canonical CF-1 function and records the terminal receipt in one
    // transaction. This adapter transports the untrusted locator, the raw text
    // and the fixed outcome code only — never an actor, workspace or driver
    // identity, and it never logs the text.
    async processConversationReplyUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number;
      telegramChatId: number;
      chatType: string;
      replyToMessageId: number | null;
      text: string;
    }): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc(
        "telegram_process_conversation_reply_update",
        {
          _lease_token: input.leaseToken,
          _update_id: input.updateId,
          _payload_hash: input.payloadHash,
          _telegram_user_id: input.telegramUserId,
          _telegram_chat_id: input.telegramChatId,
          _chat_type: input.chatType,
          _reply_to_message_id: input.replyToMessageId,
          _text: input.text,
        },
      );
      if (error) throw new Error(error.message);
      return unwrapTerminal(data);
    },
    // RB-3A. `/post`. The database derives the acting account, resolves the ONE
    // recruiter workspace it may post into, re-checks posting capability, opens
    // the draft and records the terminal receipt in one transaction. This
    // adapter transports the fixed outcome code and the opaque draft locator
    // only, and never logs any of it.
    async processQuickPostCommandUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number;
      telegramChatId: number;
      chatType: string;
    }): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc(
        "telegram_process_quick_post_command_update",
        {
          _lease_token: input.leaseToken,
          _update_id: input.updateId,
          _payload_hash: input.payloadHash,
          _telegram_user_id: input.telegramUserId,
          _telegram_chat_id: input.telegramChatId,
          _chat_type: input.chatType,
        },
      );
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as
        | { is_new?: boolean; result_code?: string; draft_id?: unknown }
        | null;
      return {
        isNew: row?.is_new === true,
        resultCode: (row?.result_code ?? "") as TelegramResultCode,
        draftId: typeof row?.draft_id === "string" ? row.draft_id : null,
      };
    },
    // RB-3A. Ordinary private text. The DATABASE alone decides whether the
    // acting account holds a live awaiting-input draft; without one it records
    // the unchanged `non_start_message` outcome. Reserving the source is atomic,
    // so a duplicate delivery can never spend a second extraction. The raw text
    // is transported and never logged.
    async processQuickPostSourceUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number;
      telegramChatId: number;
      chatType: string;
      text: string;
    }): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc(
        "telegram_process_quick_post_source_update",
        {
          _lease_token: input.leaseToken,
          _update_id: input.updateId,
          _payload_hash: input.payloadHash,
          _telegram_user_id: input.telegramUserId,
          _telegram_chat_id: input.telegramChatId,
          _chat_type: input.chatType,
          _text: input.text,
        },
      );
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
          is_new?: boolean;
          result_code?: string;
          draft_id?: unknown;
          actor_user_id?: unknown;
        }
        | null;
      return {
        isNew: row?.is_new === true,
        resultCode: (row?.result_code ?? "") as TelegramResultCode,
        draftId: typeof row?.draft_id === "string" ? row.draft_id : null,
        // Internal only: the delegated actor for the ONE extraction call. Never
        // rendered to a chat and never logged.
        actorUserId: typeof row?.actor_user_id === "string" ? row.actor_user_id : null,
      };
    },
    // RB-3A. Persist the canonical extractor outcome for a reserved draft. The
    // database filters the payload down to the approved field whitelist, so the
    // review below can only ever render approved fields.
    async completeQuickPostExtraction(input: {
      draftId: string;
      extracted: unknown | null;
      errorCode: string | null;
    }): Promise<TelegramTerminalResult | null> {
      const { data, error } = await supabase.rpc(
        "telegram_complete_quick_post_extraction",
        {
          _draft_id: input.draftId,
          _extracted: input.extracted ?? null,
          _error_code: input.errorCode,
        },
      );
      if (error) throw new Error(error.message);
      const row = (data ?? null) as
        | { state?: unknown; draft_id?: unknown; payload?: unknown }
        | null;
      const state = typeof row?.state === "string" ? row.state : "unavailable";
      const draftId = typeof row?.draft_id === "string" ? row.draft_id : null;

      if (state === "review" && draftId !== null) {
        return {
          isNew: true,
          resultCode: "quick_post_source_reserved",
          draftId,
          followUpText: composeQuickPostReview(row?.payload),
          followUpButtons: composeQuickPostReviewButtons(draftId),
        };
      }
      if (state === "failed") {
        return {
          isNew: true,
          resultCode: "quick_post_source_rejected",
          draftId,
          followUpText: QUICK_POST_EXTRACTION_FAILED_TEXT,
        };
      }
      return null;
    },
    // RB-3A. Quick Post button taps. Ownership of the draft, private-chat
    // identity, recruiter capability re-check and the CANONICAL delegated
    // creation all happen inside the one database transaction that writes the
    // terminal receipt — so a duplicate tap can never create twice, and this
    // adapter contains no creation logic of its own.
    async processQuickPostActionUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number;
      telegramChatId: number;
      chatType: string;
      action: "new" | "confirm" | "restart" | "cancel" | null;
      draftId: string | null;
    }): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc(
        "telegram_process_quick_post_action_update",
        {
          _lease_token: input.leaseToken,
          _update_id: input.updateId,
          _payload_hash: input.payloadHash,
          _telegram_user_id: input.telegramUserId,
          _telegram_chat_id: input.telegramChatId,
          _chat_type: input.chatType,
          _action: input.action,
          _draft_id: input.draftId,
        },
      );
      // RB-3A.1. Callback RPC failures surface as a BOUNDED code only.
      if (error) throw new Error(boundedRpcErrorCode(error));
      const row = (Array.isArray(data) ? data[0] : data) as
        | { is_new?: boolean; result_code?: string; draft_id?: unknown }
        | null;
      const resultCode = (row?.result_code ?? "") as TelegramResultCode;
      return {
        isNew: row?.is_new === true,
        resultCode,
        draftId: typeof row?.draft_id === "string" ? row.draft_id : null,
        followUpText: composeQuickPostActionFollowUp(resultCode),
        followUpButtons: resultCode === "quick_post_created"
          ? OPPORTUNITIES_BUTTONS
          : null,
      };
    },
  };
}

// ────────────────────── RB-3A — Quick Post presentation ──────────────────────
//
// The review is composed ONLY from the approved field whitelist the database
// already filtered the extractor output down to. A field the extractor did not
// return is rendered as `Not provided` — never guessed, never inferred, never
// defaulted. No raw source text is echoed back.

const QUICK_POST_EXTRACTION_FAILED_TEXT =
  "That job post couldn't be read. Send /post to try again with the full text, or create the opportunity in HaulTracker Pro.";

const QUICK_POST_NOT_PROVIDED = "Not provided";

const QUICK_POST_REVIEW_FIELDS: readonly { key: string; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "company_name", label: "Company" },
  { key: "hiring_city", label: "City" },
  { key: "hiring_state", label: "State" },
  { key: "hiring_states", label: "States" },
  { key: "driver_type", label: "Driver type" },
  { key: "route_type", label: "Route type" },
  { key: "trailer_type", label: "Trailer" },
  { key: "pay_model", label: "Pay model" },
  { key: "cpm", label: "Rate per mile" },
  { key: "percentage_pay", label: "Percentage" },
  { key: "flat_weekly_pay", label: "Flat weekly pay" },
  { key: "estimated_weekly_gross", label: "Weekly gross" },
  { key: "estimated_weekly_miles", label: "Weekly miles" },
  { key: "home_time", label: "Home time" },
  { key: "min_years_experience", label: "Experience required" },
  { key: "required_cdl_class", label: "CDL class" },
  { key: "required_endorsements", label: "Endorsements" },
  { key: "description", label: "Summary / pay details" },
  { key: "requirements", label: "Requirements" },
];

function formatQuickPostValue(value: unknown): string {
  if (value === null || value === undefined) return QUICK_POST_NOT_PROVIDED;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? QUICK_POST_NOT_PROVIDED : trimmed.slice(0, 120);
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    const parts = value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
      .map((entry) => entry.trim());
    return parts.length === 0 ? QUICK_POST_NOT_PROVIDED : parts.join(", ").slice(0, 120);
  }
  return QUICK_POST_NOT_PROVIDED;
}

function composeQuickPostReview(payload: unknown): string {
  const record = (payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {}) as Record<string, unknown>;
  const lines = QUICK_POST_REVIEW_FIELDS.map(
    (field) => `${field.label}: ${formatQuickPostValue(record[field.key])}`,
  );
  return [
    "Review this draft opportunity",
    "",
    ...lines,
    "",
    "Nothing has been created yet. Confirm to create it as a draft in HaulTracker Pro.",
  ].join("\n");
}

function composeQuickPostReviewButtons(draftId: string): TelegramInlineButton[][] {
  return [
    [{ text: "✅ Confirm", callbackData: composeQuickPostActionData("confirm", draftId) }],
    [{ text: "🔄 Start Over", callbackData: composeQuickPostActionData("restart", draftId) }],
    [{ text: "✖️ Cancel", callbackData: composeQuickPostActionData("cancel", draftId) }],
  ];
}

// RB-3A. The CANONICAL extractor, reached through the existing `ai-insight`
// delegated mode. There is no prompt, no model id, no provider and no schema
// here — only a delegated actor and the untrusted source text.
//
// TG-SEC-1. The internal call is issued through the ALREADY-CONSTRUCTED
// internal Supabase client, so the service-role credential stays bound to that
// client and never appears in an outbound fetch header, a log line or a
// response body here. Neither the source text nor the extracted payload is
// ever logged.
function buildQuickPostExtractor(
  supabase: ReturnType<typeof createClient>,
): TelegramQuickPostExtractor {
  return {
    async extract(input: { actorUserId: string; text: string }) {
      let data: unknown;
      try {
        const invoked = await supabase.functions.invoke("ai-insight", {
          body: {
            type: "parse_opportunity",
            delegated_actor_user_id: input.actorUserId,
            context: { text: input.text },
          },
        });
        // The error body can echo user content or a provider message, so it is
        // discarded rather than logged or surfaced.
        if (invoked.error) {
          return { ok: false as const, errorCode: "extraction_failed" };
        }
        data = invoked.data;
      } catch (error) {
        return { ok: false as const, errorCode: sanitizeErrorCode(error) };
      }

      const parsed = (data as { parsed?: unknown } | null)?.parsed;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false as const, errorCode: "extraction_empty" };
      }
      return { ok: true as const, extracted: parsed };
    },
  };
}



const QUICK_POST_GUIDANCE_TEXT =
  "Ready to post an opportunity.\n\nPaste the full job post here as one message. I'll extract the details and show you a review before anything is created.\n\nNothing is posted until you confirm.";

function composeQuickPostActionFollowUp(
  resultCode: TelegramResultCode,
): string | null {
  if (resultCode === "quick_post_started") {
    return QUICK_POST_GUIDANCE_TEXT;
  }
  if (resultCode === "quick_post_created") {
    return "Draft opportunity created in HaulTracker Pro. Open it to review the details and publish when you're ready.";
  }
  if (resultCode === "quick_post_create_blocked") {
    return "That couldn't be created from here. Open HaulTracker Pro to finish this opportunity.";
  }
  return null;
}

// RB-2A. Outbound conversation alert outbox adapter. Every eligibility,
// authorization, tenant-scoping and recipient decision belongs to the RPCs;
// this adapter transports ids and delivery outcomes only.
function buildAlertOutbox(supabase: RpcClient): TelegramAlertOutbox {
  return {
    async claimConversationAlerts(limit: number): Promise<TelegramAlertClaim[]> {
      const { data, error } = await supabase.rpc("telegram_claim_conversation_alerts", {
        _limit: limit,
      });
      if (error) throw new Error(error.message);
      const rows = (Array.isArray(data) ? data : []) as {
        alert_id?: unknown;
        thread_id?: unknown;
        telegram_chat_id?: unknown;
        opportunity_title?: unknown;
      }[];
      return rows
        .filter((row) =>
          typeof row?.alert_id === "string" &&
          // RB-2B. Without a usable conversation locator the Accept / Pass
          // buttons cannot be addressed, so the row is skipped rather than
          // sent with a broken or guessable action.
          typeof row?.thread_id === "string" &&
          typeof row?.telegram_chat_id === "number"
        )
        .map((row) => ({
          alertId: row.alert_id as string,
          threadId: row.thread_id as string,
          telegramChatId: row.telegram_chat_id as number,
          opportunityTitle:
            typeof row.opportunity_title === "string" ? row.opportunity_title : null,
        }));
    },
    // RB-2C. The delivered Telegram message id is persisted alongside the
    // confirmed send so a later reply to that exact alert resolves back to its
    // conversation. Transport identifiers only.
    async markConversationAlertSent(
      alertId: string,
      telegramMessageId: number | null,
      telegramChatId: number | null,
    ): Promise<void> {
      const { error } = await supabase.rpc("telegram_mark_conversation_alert_sent", {
        _alert_id: alertId,
        _telegram_message_id: telegramMessageId,
        _telegram_chat_id: telegramChatId,
      });
      if (error) throw new Error(error.message);
    },
    async markConversationAlertFailed(alertId: string, errorCode: string): Promise<void> {
      const { error } = await supabase.rpc("telegram_mark_conversation_alert_failed", {
        _alert_id: alertId,
        _error_code: errorCode,
      });
      if (error) throw new Error(error.message);
    },
  };
}

// RB-2D. Outbound driver-message delivery adapter. Eligibility, echo
// prevention, the post-acceptance cutoff, recipient resolution and
// re-authorization all belong to the RPCs; this adapter transports ids, the
// canonical body and delivery outcomes only — and never logs the body.
function buildMessageDeliveryOutbox(
  supabase: RpcClient,
): TelegramMessageDeliveryOutbox {
  return {
    async claimConversationMessageDeliveries(
      limit: number,
    ): Promise<TelegramMessageDeliveryClaim[]> {
      const { data, error } = await supabase.rpc(
        "telegram_claim_conversation_message_deliveries",
        { _limit: limit },
      );
      if (error) throw new Error(error.message);
      const rows = (Array.isArray(data) ? data : []) as {
        delivery_id?: unknown;
        telegram_chat_id?: unknown;
        message_body?: unknown;
      }[];
      return rows
        .filter((row) =>
          typeof row?.delivery_id === "string" &&
          typeof row?.telegram_chat_id === "number" &&
          typeof row?.message_body === "string" &&
          row.message_body.length > 0
        )
        .map((row) => ({
          deliveryId: row.delivery_id as string,
          telegramChatId: row.telegram_chat_id as number,
          messageBody: row.message_body as string,
        }));
    },
    async markConversationMessageDeliverySent(
      deliveryId: string,
      telegramMessageId: number | null,
      telegramChatId: number | null,
    ): Promise<void> {
      const { error } = await supabase.rpc(
        "telegram_mark_conversation_message_delivery_sent",
        {
          _delivery_id: deliveryId,
          _telegram_message_id: telegramMessageId,
          _telegram_chat_id: telegramChatId,
        },
      );
      if (error) throw new Error(error.message);
    },
    async markConversationMessageDeliveryFailed(
      deliveryId: string,
      errorCode: string,
    ): Promise<void> {
      const { error } = await supabase.rpc(
        "telegram_mark_conversation_message_delivery_failed",
        { _delivery_id: deliveryId, _error_code: errorCode },
      );
      if (error) throw new Error(error.message);
    },
  };
}





// ────────────────────── RB-1A / RB-1B menu presentation ──────────────────────
//
// Fixed labels plus ONLY the bounded, authorized workspace summary the
// database returned. No candidate data, no contact details, no billing data,
// no Telegram identifiers, no reason for a denial. Buttons are URL-only and
// every destination is a route that already exists in the web app.

const APP_BASE_URL = "https://haultrackerpro.com";

const URL_OPEN_APP = `${APP_BASE_URL}/dashboard`;
const URL_FIND_WORK = `${APP_BASE_URL}/find-work`;
const URL_WORK_PROFILE = `${APP_BASE_URL}/professional-profile`;
const URL_OPPORTUNITIES = `${APP_BASE_URL}/dashboard?page=recruiter-access:manager`;
const URL_CONVERSATIONS = `${APP_BASE_URL}/dashboard?page=recruiter-access:applications`;
const URL_RESULTS = `${APP_BASE_URL}/dashboard?page=recruiter-access:reports`;

const OPEN_APP_BUTTONS: TelegramInlineUrlButton[][] = [
  [{ text: "Open HaulTracker Pro", url: URL_OPEN_APP }],
];
const WORK_BUTTONS: TelegramInlineUrlButton[][] = [
  [{ text: "🔎 Find Work", url: URL_FIND_WORK }],
  [{ text: "👤 Work Profile", url: URL_WORK_PROFILE }],
];
// RB-3A. The ONE Quick Post entry button, shown only on a recruiter menu. It
// carries a versioned `q1` callback rather than a URL because no draft exists
// yet; the payload is an intent, never authorization — the database re-derives
// the actor and re-checks posting capability on every tap.
const RECRUITER_BUTTONS: TelegramInlineButton[][] = [
  [{ text: "➕ Post Opportunity", callbackData: composeQuickPostNewData() }],
  [{ text: "📋 My Opportunities", url: URL_OPPORTUNITIES }],
  [{ text: "💬 Conversations", url: URL_CONVERSATIONS }],
  [{ text: "📊 Results", url: URL_RESULTS }],
];
// RB-3A. Reuses the existing recruiter opportunities route for the bounded
// success confirmation. No opportunity id is ever placed in a chat.
const OPPORTUNITIES_BUTTONS: TelegramInlineButton[][] = [
  [{ text: "📋 My Opportunities", url: URL_OPPORTUNITIES }],
];

const MENU_UNLINKED_TEXT =
  "Your Telegram account is not connected to HaulTracker Pro. Open HaulTracker Pro and generate a connection link in Settings to get started.";
const MENU_NO_WORKSPACE_TEXT =
  "Your HaulTracker Pro account is connected. There is no recruiter workspace available for you yet — finish recruiter setup in HaulTracker Pro to unlock recruiter tools here.";
const MENU_UNSUPPORTED_TEXT =
  "Your HaulTracker Pro account is connected. There are no bot features available for this account yet.";
const MENU_HEADER_TEXT = "HaulTracker Pro — recruiter status";

const WORK_WELCOME_TEXT =
  "HaulTracker Pro — welcome\n\nYour account is connected. Use HaulTracker Pro to find work that matches your preferences, keep your Work Profile current, and manage your recruiter conversations in one place.\n\nThis bot is your companion for quick navigation and notifications as those features arrive.\n\nSend /menu for options or /status for your account status.";
const RECRUITER_WELCOME_TEXT =
  "HaulTracker Pro — welcome\n\nYour account is connected. Use HaulTracker Pro to post and manage opportunities, work through qualified conversations, and review your results.\n\nThis bot is your fast companion for navigation and status checks.\n\nSend /menu for options or /status for your workspace status.";
const COMBINED_WELCOME_TEXT =
  "HaulTracker Pro — welcome\n\nYour account is connected with both work-seeking and recruiter access.\n\nWork: find work that matches your preferences and keep your Work Profile current.\nRecruiter: post and manage opportunities, work qualified conversations, and review results.\n\nThis bot is your fast companion for navigation and status checks.\n\nSend /menu for options or /status for your account status.";

// RB-1B. Each capability group gets its OWN menu copy. A recruiter must never
// be shown work-seeking wording, and a multi-capability account must see both
// groups named explicitly.
const WORK_MENU_TEXT =
  "HaulTracker Pro — menu\n\nWork:\nFind work that matches your preferences, or keep your Work Profile current.";
const RECRUITER_MENU_TEXT =
  "HaulTracker Pro — menu\n\nRecruiter:\nManage your opportunities, work through conversations, or review your results.";
const COMBINED_MENU_TEXT =
  "HaulTracker Pro — menu\n\nWork:\nFind work that matches your preferences, or keep your Work Profile current.\n\nRecruiter:\nManage your opportunities, work through conversations, or review your results.";

const WORK_STATUS_TEXT = "HaulTracker Pro — account status\n\nWork account connected.";

interface MenuWorkspaceDescriptor {
  workspace_name?: unknown;
  role?: unknown;
  can_manage_opportunities?: unknown;
  active_opportunity_count?: unknown;
}

function composeWorkspaceSummary(workspaces: unknown): string | null {
  const rows = Array.isArray(workspaces) ? (workspaces as MenuWorkspaceDescriptor[]) : [];
  const lines = rows.map((row) => {
    const name = typeof row?.workspace_name === "string" ? row.workspace_name : "Workspace";
    const role = typeof row?.role === "string" ? row.role : "member";
    const count = typeof row?.active_opportunity_count === "number"
      ? row.active_opportunity_count
      : 0;
    const manage = row?.can_manage_opportunities === true
      ? "Opportunity management: available"
      : "Opportunity management: not available";
    return `${name}\nRole: ${role}\nActive opportunities: ${count}\n${manage}`;
  });
  if (lines.length === 0) return null;
  return `${MENU_HEADER_TEXT}\n\n${lines.join("\n\n")}`;
}

function composeMenuButtons(
  resultCode: TelegramResultCode,
  // RB-3A. Widened from URL-only so the recruiter menu can carry its single
  // Quick Post callback. Every Driver/work button remains URL-only.
): TelegramInlineButton[][] | null {
  switch (resultCode) {
    case "menu_driver":
      return WORK_BUTTONS;
    case "menu_recruiter":
      return RECRUITER_BUTTONS;
    case "menu_multi_role":
      return [...WORK_BUTTONS, ...RECRUITER_BUTTONS];
    case "menu_unlinked":
    case "menu_linked_no_workspace":
    case "menu_linked_unsupported":
      return OPEN_APP_BUTTONS;
    default:
      return null;
  }
}

function composeMenuText(
  resultCode: TelegramResultCode,
  workspaces: unknown,
  command: TelegramMenuCommand,
): string | null {
  if (resultCode === "menu_unlinked") return MENU_UNLINKED_TEXT;
  if (resultCode === "menu_linked_no_workspace") return MENU_NO_WORKSPACE_TEXT;
  if (resultCode === "menu_linked_unsupported") return MENU_UNSUPPORTED_TEXT;

  if (resultCode === "menu_driver") {
    if (command === "start") return WORK_WELCOME_TEXT;
    if (command === "menu") return WORK_MENU_TEXT;
    return WORK_STATUS_TEXT;
  }

  if (resultCode === "menu_recruiter") {
    const summary = composeWorkspaceSummary(workspaces);
    if (summary === null) return MENU_NO_WORKSPACE_TEXT;
    if (command === "start") return RECRUITER_WELCOME_TEXT;
    if (command === "menu") return RECRUITER_MENU_TEXT;
    return summary;
  }

  if (resultCode === "menu_multi_role") {
    const summary = composeWorkspaceSummary(workspaces);
    if (command === "start") return COMBINED_WELCOME_TEXT;
    if (command === "menu") return COMBINED_MENU_TEXT;
    return summary === null
      ? WORK_STATUS_TEXT
      : `${WORK_STATUS_TEXT}\n\n${summary}`;
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  // Platform-injected; used ONLY to build the internal Supabase client below.
  // It is never accepted from, nor sent to, any external caller.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const internalSecret = Deno.env.get("TELEGRAM_POLL_INTERNAL_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !internalSecret) {
    return json({ error: "telegram_poll_not_configured" }, 503);
  }

  // Internal service invocation only, authenticated with a purpose-scoped
  // secret held by the scheduler. The header value is compared and then
  // dropped; it is never logged.
  const presentedSecret = req.headers.get("X-HTP-Internal-Secret") ?? "";
  if (!safeEqual(presentedSecret, internalSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  const telegramConnectionKey = Deno.env.get("TELEGRAM_API_KEY");
  if (!lovableApiKey || !telegramConnectionKey) {
    // Fail closed with zero network activity until a dedicated HaulTracker Pro
    // Telegram connection is linked to this project.
    log("connection_not_configured");
    return json({ error: "telegram_connection_not_configured" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const gateway = buildGateway(lovableApiKey, telegramConnectionKey);

  // RB-2A. Outbound alerts are drained AFTER inbound polling has finished and
  // released its lease, in its own isolated scope. It cannot throw, cannot
  // change the inbound outcome, and therefore cannot stall the cursor.
  const drainAlerts = async (): Promise<void> => {
    try {
      await runTelegramAlertDrain({
        outbox: buildAlertOutbox(supabase),
        gateway,
        conversationsUrl: URL_CONVERSATIONS,
        log,
      });
    } catch (error) {
      log("alert_drain_unhandled_error", { code: sanitizeErrorCode(error) });
    }
  };

  // RB-2D. Outbound driver messages are drained AFTER inbound polling and
  // after the alert drain, in their own isolated scope. A delivery failure can
  // never throw into inbound processing and therefore can never stall the
  // cursor, the lease, or any command / callback / reply handling.
  const drainMessageDeliveries = async (): Promise<void> => {
    try {
      await runTelegramMessageDeliveryDrain({
        outbox: buildMessageDeliveryOutbox(supabase),
        gateway,
        log,
      });
    } catch (error) {
      log("message_delivery_drain_unhandled_error", {
        code: sanitizeErrorCode(error),
      });
    }
  };

  try {
    const result = await runTelegramPoll({
      ledger: buildLedger(supabase),
      gateway,
      sha256: sha256Hex,
      log,
      quickPostExtractor: buildQuickPostExtractor(supabase),
    });

    await drainAlerts();
    await drainMessageDeliveries();





    if (result.kind === "busy") {
      return json({ status: "busy" }, 200);
    }
    if (result.kind === "failed") {
      return json(
        {
          status: "failed",
          error: result.errorCode,
          processed: result.processed,
        },
        500,
      );
    }
    return json(
      {
        status: "ok",
        processed: result.processed,
        advancedTo: result.advancedTo,
      },
      200,
    );
  } catch (error) {
    const code = sanitizeErrorCode(error);
    log("poll_unhandled_error", { code });
    return json({ status: "failed", error: code }, 500);
  }
});
