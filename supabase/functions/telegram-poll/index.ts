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
  runTelegramPoll,
  sanitizeErrorCode,
  type TelegramGateway,
  type TelegramGatewayResponse,
  type TelegramIgnoredResultCode,
  type TelegramPollLease,
  type TelegramPollLedger,
  type TelegramResultCode,
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
 *  service-role bearer value byte by byte. */
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

  return {
    getUpdates: (options) => call<unknown[]>("getUpdates", { ...options }),
    sendMessage: ({ chatId, text }) =>
      call<unknown>("sendMessage", { chat_id: chatId, text }),
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
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "telegram_poll_not_configured" }, 503);
  }

  // Internal service invocation only. The header value is compared and then
  // dropped; it is never logged.
  const authorization = req.headers.get("Authorization") ?? "";
  if (!safeEqual(authorization, `Bearer ${serviceRoleKey}`)) {
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

  try {
    const result = await runTelegramPoll({
      ledger: buildLedger(supabase),
      gateway: buildGateway(lovableApiKey, telegramConnectionKey),
      sha256: sha256Hex,
      log,
    });

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
