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
  runDispatchReviewDeliveryDrain,
  runTelegramPoll,
  TELEGRAM_DISPATCH_GUIDANCE_ENABLED,
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
  type TelegramPollDeps,
  type TelegramQuickPostExtractor,
  type TelegramResultCode,
  type TelegramSentMessage,
  type TelegramTerminalResult,
} from "../_shared/telegram-poll-ingest.ts";
import { TGG1B_DISPATCH_GROUP_REVIEW_ENABLED, TELEGRAM_SINGLE_LOAD_QA_RPCS, TELEGRAM_GENQA_RPCS, buildGenQaDeliveryLedger, parseDispatchReviewData } from "../_shared/telegram-dispatch-group-review.ts";
import { telegramMiniAppKeyboard } from '../_shared/telegram-mini-app-buttons.ts';
import type {
  DispatchDeliveryClaim,
  DispatchDeliveryFailure,
  DispatchDeliveryLedger,
  DispatchReviewAction,
} from "../_shared/telegram-dispatch-group-review.ts";
import type { DispatchTargetStatus } from "../_shared/telegram-dispatch-group-proposals.ts";


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

  // Private recruiter entry points launch the Mini App. Group review and
  // existing chat draft callbacks retain their original wire shape.
  const toInlineKeyboard = telegramMiniAppKeyboard;

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
          ? { reply_markup: { inline_keyboard: toInlineKeyboard(buttons, chatId) } }
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

// Staged, short-lived GENERAL-adapter pilot. Remove this block and its pilotOnly
// wiring to revert; never selected when the global general flag is enabled.
const GENERAL_PILOT = {
  chatId: -5335739793,
  cutoff: Date.parse("2026-11-06T14:00:00Z"),
  targets: [
    { reference: "HTP-QA-GEN2", loadId: "cdbdbf47-410b-4197-80d1-da3f5cab9a4c", status: "cancelled" },
    { reference: "HTP-QA-GEN3", loadId: "3833cb3a-e12a-43be-bc2a-2fdc778ae897", status: "completed" },
  ],
} as const;

const generalPilotActive = () => Date.now() < GENERAL_PILOT.cutoff;
const generalPilotTarget = (reference: string | null, status: string | null) =>
  GENERAL_PILOT.targets.find(target => target.reference === reference && target.status === status);
const generalPilotTransport = (chatId: number | null, chatType: string | null) =>
  generalPilotActive() && chatId === GENERAL_PILOT.chatId &&
  (chatType === "group" || chatType === "supergroup");

const generalPilotScope: NonNullable<TelegramPollDeps["dispatchReviewScope"]> = (identity) =>
  generalPilotTransport(identity.telegramChatId, identity.chatType) &&
  (identity.callbackQueryId
    ? parseDispatchReviewData(identity.callbackData) !== null
    : GENERAL_PILOT.targets.some(target => identity.text ===
      `/${target.status === "completed" ? "delivered" : "cancelled"}@HaulTrackerBot ${target.reference}`));

function generalPilotOptions(pilotOnly: boolean) {
  // Keep both older QA routes disabled even after pilot expiry. Do not drain
  // general once expired; builds with general globally ON use existing modes.
  return pilotOnly ? {
    dispatchReviewEnabled: generalPilotActive(),
    dispatchReviewScope: generalPilotScope,
    singleLoadQaEnabled: false,
    genQaEnabled: false,
  } : {};
}

async function generalPilotProposalMatches(supabase: RpcClient, proposalId: string | null): Promise<boolean> {
  if (!generalPilotActive() || proposalId === null) return false;
  const { data, error } = await supabase.from("telegram_dispatch_review_proposals")
    .select("id,load_id,load_reference,proposed_status").eq("id", proposalId)
    .eq("telegram_chat_id", GENERAL_PILOT.chatId).maybeSingle();
  const target = generalPilotTarget(data?.load_reference ?? null, data?.proposed_status ?? null);
  return !error && data?.id === proposalId && target !== undefined &&
    data?.load_id === target.loadId && generalPilotActive();
}

async function generalPilotLoadMatches(supabase: RpcClient, reference: string | null, status: string | null): Promise<boolean> {
  const target = generalPilotTarget(reference, status);
  if (!generalPilotActive() || !target) return false;
  const { data, error } = await supabase.from("loads").select("id")
    .eq("load_reference", target.reference).limit(2);
  return !error && data?.length === 1 && data[0]?.id === target.loadId && generalPilotActive();
}

// Guard again immediately before sending, including after a slow claim/read.
// Existing delivery code owns failure/ack/lease handling and bounded logs.
function generalPilotDeliveryGateway(supabase: RpcClient, gateway: TelegramGateway): TelegramGateway {
  return {
    ...gateway,
    async sendMessage(input) {
      const review = parseDispatchReviewData(input.buttons?.[0]?.[0] &&
        "callbackData" in input.buttons[0][0] ? input.buttons[0][0].callbackData : null);
      if (input.chatId !== GENERAL_PILOT.chatId || !review ||
          !await generalPilotProposalMatches(supabase, review.proposalId)) {
        log("general_pilot_delivery_denied");
        return { ok: false, status: 0, errorCode: "general_pilot_scope_denied" };
      }
      return gateway.sendMessage(input);
    },
  };
}

// TG-G1C (gated). Durable dispatch review outbox over the TG-G1B candidate
// RPCs. Constructing it performs no I/O; the drain never calls it while the
// compile-time gate is false.
function buildDispatchDeliveryLedger(supabase: RpcClient, qaOnly = false, pilotOnly = false): DispatchDeliveryLedger {
  return {
    async claim(): Promise<DispatchDeliveryClaim | null> {
      if (pilotOnly && !generalPilotActive()) return null;
      const { data, error } = qaOnly
        ? await supabase.rpc(TELEGRAM_SINGLE_LOAD_QA_RPCS.claim)
        : await supabase.rpc("telegram_claim_dispatch_review_delivery");
      if (error) throw new Error(boundedRpcErrorCode(error));
      const row = (Array.isArray(data) ? data[0] : data) as
        | { outbox_id?: string; claim_token?: string; proposal_id?: string; telegram_chat_id?: number | string; load_reference?: string; proposed_status?: string; expires_at?: string }
        | null;
      if (!row?.outbox_id || !row.claim_token || !row.proposal_id) return null;
      if (pilotOnly && (Number(row.telegram_chat_id) !== GENERAL_PILOT.chatId ||
          !generalPilotTarget(row.load_reference ?? null, row.proposed_status ?? null) ||
          !await generalPilotProposalMatches(supabase, row.proposal_id))) {
        log("general_pilot_claim_denied");
        return null; // No send/ack of an unrelated claim; its canonical lease recovers.
      }
      return {
        outboxId: row.outbox_id,
        claimToken: row.claim_token,
        proposalId: row.proposal_id,
        telegramChatId: Number(row.telegram_chat_id),
        loadReference: String(row.load_reference ?? ""),
        proposedStatus: row.proposed_status as DispatchTargetStatus,
        expiresAt: row.expires_at,
      };
    },
    async ack(outboxId: string, claimToken: string, messageId: number): Promise<boolean> {
      const { data, error } = await supabase.rpc("telegram_ack_dispatch_review_delivery", {
        _outbox_id: outboxId,
        _claim_token: claimToken,
        _message_id: messageId,
      });
      if (error) throw new Error(boundedRpcErrorCode(error));
      return data === true;
    },
    async fail(outboxId: string, claimToken: string, code: DispatchDeliveryFailure): Promise<boolean> {
      const { data, error } = await supabase.rpc("telegram_fail_dispatch_review_delivery", {
        _outbox_id: outboxId,
        _claim_token: claimToken,
        _failure_code: code,
      });
      if (error) throw new Error(boundedRpcErrorCode(error));
      return data === true;
    },
  };
}

function buildLedger(supabase: RpcClient, pilotOnly = false): TelegramPollLedger {
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
        menuButtons: composeMenuButtons(resultCode, row?.workspaces),
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
    // TG-G1C (gated; unreachable while TGG1B_DISPATCH_GROUP_REVIEW_ENABLED is
    // false). Intake: receipt + proposal + outbox atomically; never a load
    // change. Transports parser-normalized reference/status only — no text.
    async processGenQaDispatchGroupUpdate(input): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc(TELEGRAM_GENQA_RPCS.intake, {
        _lease_token: input.leaseToken,
        _update_id: input.updateId,
        _payload_hash: input.payloadHash,
        _telegram_user_id: input.telegramUserId,
        _telegram_chat_id: input.telegramChatId,
        _chat_type: input.chatType,
        _reference: input.reference,
        _proposed_status: input.proposedStatus,
      });
      if (error) throw new Error(boundedRpcErrorCode(error));
      return unwrapTerminal(data);
    },
    async processGenQaDispatchReviewActionUpdate(input): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc(TELEGRAM_GENQA_RPCS.review, {
        _lease_token: input.leaseToken,
        _update_id: input.updateId,
        _payload_hash: input.payloadHash,
        _telegram_user_id: input.telegramUserId,
        _telegram_chat_id: input.telegramChatId,
        _chat_type: input.chatType,
        _action: input.action,
        _proposal_id: input.proposalId,
      });
      if (error) throw new Error(boundedRpcErrorCode(error));
      return unwrapTerminal(data);
    },
    async processQaDispatchGroupUpdate(input): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc(TELEGRAM_SINGLE_LOAD_QA_RPCS.intake, {
        _lease_token: input.leaseToken,
        _update_id: input.updateId,
        _payload_hash: input.payloadHash,
        _telegram_user_id: input.telegramUserId,
        _telegram_chat_id: input.telegramChatId,
        _chat_type: input.chatType,
        _reference: input.reference,
        _proposed_status: input.proposedStatus,
      });
      if (error) throw new Error(boundedRpcErrorCode(error));
      return unwrapTerminal(data);
    },
    async processQaDispatchReviewActionUpdate(input): Promise<TelegramTerminalResult> {
      const { data, error } = await supabase.rpc(TELEGRAM_SINGLE_LOAD_QA_RPCS.review, {
        _lease_token: input.leaseToken,
        _update_id: input.updateId,
        _payload_hash: input.payloadHash,
        _telegram_user_id: input.telegramUserId,
        _telegram_chat_id: input.telegramChatId,
        _chat_type: input.chatType,
        _action: input.action,
        _proposal_id: input.proposalId,
      });
      if (error) throw new Error(boundedRpcErrorCode(error));
      return unwrapTerminal(data);
    },
    async processDispatchGroupUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number;
      telegramChatId: number;
      chatType: string;
      reference: string | null;
      proposedStatus: DispatchTargetStatus | null;
    }): Promise<TelegramTerminalResult> {
      const pilotAllowed = !pilotOnly || (generalPilotTransport(input.telegramChatId, input.chatType) &&
        await generalPilotLoadMatches(supabase, input.reference, input.proposedStatus));
      const { data, error } = await supabase.rpc("telegram_process_dispatch_group_update", {
        _lease_token: input.leaseToken,
        _update_id: input.updateId,
        _payload_hash: input.payloadHash,
        _telegram_user_id: input.telegramUserId,
        _telegram_chat_id: input.telegramChatId,
        _chat_type: input.chatType,
        _reference: pilotAllowed ? input.reference : null,
        _proposed_status: pilotAllowed ? input.proposedStatus : null,
      });
      if (error) throw new Error(boundedRpcErrorCode(error));
      return unwrapTerminal(data);
    },
    // TG-G1C (gated). Review tap; reviewer = callback_query.from.id. The DB
    // re-checks binding, linked reviewer, permission, relationship, status.
    async processDispatchReviewActionUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number;
      telegramChatId: number;
      chatType: string;
      action: DispatchReviewAction | null;
      proposalId: string | null;
    }): Promise<TelegramTerminalResult> {
      const pilotAllowed = !pilotOnly || (generalPilotTransport(input.telegramChatId, input.chatType) &&
        await generalPilotProposalMatches(supabase, input.proposalId));
      const { data, error } = await supabase.rpc("telegram_process_dispatch_review_action", {
        _lease_token: input.leaseToken,
        _update_id: input.updateId,
        _payload_hash: input.payloadHash,
        _telegram_user_id: input.telegramUserId,
        _telegram_chat_id: input.telegramChatId,
        _chat_type: input.chatType,
        _action: pilotAllowed ? input.action : null,
        _proposal_id: pilotAllowed ? input.proposalId : null,
      });
      if (error) throw new Error(boundedRpcErrorCode(error));
      return unwrapTerminal(data);
    },
    async processQuickPostActionUpdate(input: {
      leaseToken: string;
      updateId: number;
      payloadHash: string;
      telegramUserId: number;
      telegramChatId: number;
      chatType: string;
      action: "new" | "confirm" | "restart" | "cancel" | "refresh" | null;
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
      const actionDraftId = typeof row?.draft_id === "string" ? row.draft_id : null;

      // RB-3B-B. Refresh Review re-renders the CURRENT payload after a web
      // edit. It is a read-only snapshot: no extractor call, no draft mutation,
      // no opportunity mutation. Sent exactly once, because the orchestrator
      // only transports follow-ups for a NEW terminal receipt.
      if (
        resultCode === "quick_post_review_refreshed" &&
        row?.is_new === true &&
        actionDraftId !== null
      ) {
        const snapshot = await supabase.rpc(
          "telegram_quick_post_review_snapshot",
          {
            _draft_id: actionDraftId,
            _telegram_user_id: input.telegramUserId,
            _telegram_chat_id: input.telegramChatId,
          },
        );
        if (snapshot.error) throw new Error(boundedRpcErrorCode(snapshot.error));
        if (snapshot.data && typeof snapshot.data === "object") {
          return {
            isNew: true,
            resultCode,
            draftId: actionDraftId,
            followUpText: composeQuickPostReview(snapshot.data),
            followUpButtons: composeQuickPostReviewButtons(actionDraftId),
          };
        }
        return {
          isNew: true,
          resultCode,
          draftId: actionDraftId,
          followUpText: null,
          followUpButtons: null,
        };
      }

      return {
        isNew: row?.is_new === true,
        resultCode,
        draftId: actionDraftId,
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
    "Check pay, route, home time, equipment and qualifications above. Save Draft stores it in HaulTracker Pro. Review and publish it on the website.",
  ].join("\n");
}

// RB-3B-B. The Edit Details link carries the draft id as an OPAQUE locator in
// an ordinary internal app URL. Possession grants nothing: the web read/save
// RPCs re-derive the acting account and the recruiter capability server-side.
function composeQuickPostEditUrl(draftId: string): string {
  return `${APP_BASE_URL}/dashboard?page=recruiter-access:manager&telegramDraft=${draftId}`;
}

function composeQuickPostReviewButtons(draftId: string): TelegramInlineButton[][] {
  return [
    [{ text: "✅ Save Draft", callbackData: composeQuickPostActionData("confirm", draftId) }],
    [{ text: "✏️ Edit Details", url: composeQuickPostEditUrl(draftId) }],
    [{ text: "🔁 Refresh Review", callbackData: composeQuickPostActionData("refresh", draftId) }],
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
  "Ready to draft an opportunity.\n\nPaste the full job description as one message. I'll show you the details to review. Use Save Draft to keep it, then open HaulTracker Pro to publish.";

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
const URL_DISPATCH_WORKSPACE = `${APP_BASE_URL}/dashboard?page=recruiter-access`;
const URL_OPPORTUNITIES = `${APP_BASE_URL}/dashboard?page=recruiter-access:manager`;
const URL_CONVERSATIONS = `${APP_BASE_URL}/conversations?workspace=recruiter`;
const URL_RESULTS = `${APP_BASE_URL}/dashboard?page=recruiter-access:reports`;

const OPEN_APP_BUTTONS: TelegramInlineUrlButton[][] = [
  [{ text: "Open HaulTracker Pro", url: URL_OPEN_APP }],
];
const ONBOARDING_BUTTONS: TelegramInlineUrlButton[][] = [
  [{ text: "Create account / Sign in", url: APP_BASE_URL }],
];
const RECRUITER_BUTTONS: TelegramInlineUrlButton[][] = [
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
  "Welcome to HaulTracker Pro.\n\nTap Create account / Sign in to open HaulTracker Pro inside Telegram. Sign in with your existing account or create a recruiter account. Follow the account setup steps, then tap Connect this Telegram account. Tools follow your company and team permissions.\n\nYou can also connect from haultrackerpro.com: Settings > Connect Telegram. After connecting, send /menu here.";
const MENU_NO_WORKSPACE_TEXT =
  "Your HaulTracker Pro account is connected. Available bot tools follow your workspace permissions. Open HaulTracker Pro to manage your account or check your workspace access.";
const MENU_HEADER_TEXT = "HaulTracker Pro recruiter status";

interface MenuWorkspaceDescriptor {
  workspace_name?: unknown;
  role?: unknown;
  can_manage_opportunities?: unknown;
  active_opportunity_count?: unknown;
}

function menuWorkspaces(workspaces: unknown): MenuWorkspaceDescriptor[] {
  return Array.isArray(workspaces) ? workspaces : [];
}

// Same exactly-one-eligible-workspace rule as the Quick Post RPC. The RPC
// still re-checks this permission when a command or callback is received.
function canQuickPost(workspaces: unknown): boolean {
  return menuWorkspaces(workspaces).filter((row) => row?.can_manage_opportunities === true).length === 1;
}

function composeWorkspaceSummary(workspaces: unknown): string | null {
  const rows = menuWorkspaces(workspaces);
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
  workspaces: unknown,
): TelegramInlineButton[][] | null {
  switch (resultCode) {
    case "menu_recruiter":
    case "menu_multi_role":
      if (menuWorkspaces(workspaces).length === 0) return OPEN_APP_BUTTONS;
      return canQuickPost(workspaces)
        ? [[{ text: "➕ Post Opportunity", callbackData: composeQuickPostNewData() }], ...RECRUITER_BUTTONS]
        : RECRUITER_BUTTONS;
    case "menu_unlinked":
      return ONBOARDING_BUTTONS;
    case "menu_driver":
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
  if (resultCode === "menu_driver" || resultCode === "menu_linked_no_workspace" ||
      resultCode === "menu_linked_unsupported") return MENU_NO_WORKSPACE_TEXT;
  if (resultCode !== "menu_recruiter" && resultCode !== "menu_multi_role") return null;
  if (menuWorkspaces(workspaces).length === 0) return MENU_NO_WORKSPACE_TEXT;
  if (command === "status") return composeWorkspaceSummary(workspaces);

  const heading = command === "start" ? "Welcome to HaulTracker Pro" : "HaulTracker Pro";
  const posting = canQuickPost(workspaces)
    ? "\nPost Opportunity opens a form inside Telegram. Review the details, then save a draft or publish. Use /post for the chat-based draft workflow."
    : "";
  return `${heading}\n\nPrivate recruiter tools\nMy Opportunities and Conversations open your HaulTracker Mini App inside Telegram. Results opens the full website.${posting}\n\nSign in with your existing HaulTracker account, or create one in the Mini App. Use /menu for your tools, /status for your workspace access or /help for guidance.`;
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
  const pilotOnly = !TGG1B_DISPATCH_GROUP_REVIEW_ENABLED;

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
      ...generalPilotOptions(pilotOnly),
      ledger: buildLedger(supabase, pilotOnly),
      gateway,
      sha256: sha256Hex,
      log,
      quickPostExtractor: buildQuickPostExtractor(supabase),
      getDispatchGroupConnection: async (chatId, chatType) => {
        const { data, error } = await supabase.rpc("telegram_dispatch_group_is_connected", {
          _telegram_chat_id: chatId,
          _chat_type: chatType,
        });
        return !error && typeof data === "boolean" ? data : null;
      },
      dispatchGuidanceButtons: {
        private: [[{ text: "Open Dispatch Workspace", url: URL_DISPATCH_WORKSPACE }]],
        group: [
          [{ text: "Open Bot Privately", url: "https://t.me/HaulTrackerBot" }],
          [{ text: "Open HaulTracker Pro", url: URL_OPEN_APP }],
        ],
      },
      // Independent read-only UX gate. Missing candidate RPC is a silent
      // denial; no raw database error or identifier reaches a chat or log.
      authorizeDispatchGuidance: TELEGRAM_DISPATCH_GUIDANCE_ENABLED
        ? async (input) => {
            const { data, error } = await supabase.rpc("telegram_get_dispatch_guidance", {
              _telegram_user_id: input.telegramUserId,
              _telegram_chat_id: input.telegramChatId,
              _chat_type: input.chatType,
            });
            return !error && data === true;
          }
        : undefined,
    });

    await drainAlerts();
    await drainMessageDeliveries();
    // TG-G1C. Isolated, AFTER inbound poll + lease release. Returns
    // "disabled" before any RPC/send while the compile-time gate is false.
    try {
      const pilotOptions = generalPilotOptions(pilotOnly);
      await runDispatchReviewDeliveryDrain({
        enabled: pilotOptions.dispatchReviewEnabled,
        singleLoadQaEnabled: pilotOptions.singleLoadQaEnabled,
        genQaEnabled: pilotOptions.genQaEnabled,
        ledger: buildDispatchDeliveryLedger(supabase, false, pilotOnly),
        qaLedger: buildDispatchDeliveryLedger(supabase, true),
        genQaLedger: buildGenQaDeliveryLedger(async (name, args) => {
          const { data, error } = await supabase.rpc(name, args);
          return { data, error };
        }),
        gateway: pilotOnly ? generalPilotDeliveryGateway(supabase, gateway) : gateway,
        log,
      });
    } catch (error) {
      log("dispatch_review_drain_unhandled_error", { code: sanitizeErrorCode(error) });
    }





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
