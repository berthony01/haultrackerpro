// Phase TG-2D — Telegram polling intake orchestration.
//
// Runtime-neutral (no Deno globals, no HTTP, no URL imports). The real Edge
// Function and the Vitest suite drive the SAME orchestration through this
// file — tests must not fork a separate flow.
//
// Correctness contract (see the TG-2D candidate migration for the DB half):
//   * exactly one poller runs at a time, serialised by a database lease;
//   * an update's cursor position advances ONLY after that update holds a
//     terminal receipt, so nothing is ever silently skipped;
//   * user-facing Telegram feedback is best-effort and can never influence
//     cursor correctness;
//   * no raw update JSON, message text, or link token is ever logged or
//     returned.

export type TelegramIgnoredResultCode =
  | "non_private_message"
  | "non_start_message"
  | "invalid_start_command"
  | "invalid_update_shape";

export type TelegramStartResultCode = "link_success" | "link_rejected";

/** Phase TG-2F-C — dispatch group `/bind` terminal outcomes. */
export type TelegramBindResultCode = "bind_success" | "bind_rejected";

export type TelegramResultCode =
  | TelegramIgnoredResultCode
  | TelegramStartResultCode
  | TelegramBindResultCode;

export interface TelegramPollLease {
  leaseToken: string;
  nextOffset: number;
}

export interface TelegramTerminalResult {
  isNew: boolean;
  resultCode: TelegramResultCode;
}

/** Database side. Implemented by the Edge Function over the TG-2D RPCs, and
 *  by the test suite over an in-memory model that mirrors those semantics. */
export interface TelegramPollLedger {
  claimLease(): Promise<TelegramPollLease | null>;
  releaseLease(leaseToken: string): Promise<boolean>;
  advanceCursor(leaseToken: string, lastUpdateId: number): Promise<number>;
  recordIgnoredUpdate(input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number | null;
    telegramChatId: number | null;
    resultCode: TelegramIgnoredResultCode;
  }): Promise<TelegramTerminalResult>;
  processStartUpdate(input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
    rawToken: string;
  }): Promise<TelegramTerminalResult>;
  /** TG-2F-C. Atomic: consume + terminal receipt in one DB transaction. */
  processBindUpdate(input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
    rawToken: string;
  }): Promise<TelegramTerminalResult>;
}

export interface TelegramGatewayResponse<T> {
  ok: boolean;
  status: number;
  errorCode?: string;
  result?: T;
}

/** Lovable connector gateway side. The implementation never receives, holds,
 *  or exposes a Telegram bot token — the gateway injects it. */
export interface TelegramGateway {
  getUpdates(options: {
    offset: number;
    limit: number;
    timeout: number;
    allowed_updates: string[];
  }): Promise<TelegramGatewayResponse<unknown[]>>;
  sendMessage(input: {
    chatId: number;
    text: string;
  }): Promise<TelegramGatewayResponse<unknown>>;
}

export type TelegramSha256 = (input: string) => Promise<string>;

export type TelegramPollLogger = (
  event: string,
  details?: Record<string, string | number | boolean>,
) => void;

export interface TelegramPollDeps {
  ledger: TelegramPollLedger;
  gateway: TelegramGateway;
  sha256: TelegramSha256;
  log?: TelegramPollLogger;
}

export type TelegramPollRunResult =
  | { kind: "busy" }
  | {
      kind: "ok";
      processed: number;
      advancedTo: number | null;
      resultCodes: TelegramResultCode[];
    }
  | {
      kind: "failed";
      errorCode: string;
      processed: number;
      advancedTo: number | null;
    };

export const TELEGRAM_GET_UPDATES_LIMIT = 25;
export const TELEGRAM_GET_UPDATES_TIMEOUT_SECONDS = 20;
export const TELEGRAM_ALLOWED_UPDATES = ["message"] as const;

export const TELEGRAM_LINK_SUCCESS_MESSAGE =
  "Your Telegram account is now linked to HaulTracker Pro.";
export const TELEGRAM_LINK_FAILURE_MESSAGE =
  "That link is invalid or expired. Generate a new Telegram link in HaulTracker Pro and try again.";

// TG-2F-C. Deliberately generic: no workspace name, no recruiter id, no
// reason, no username, no echo of the submitted command.
export const TELEGRAM_BIND_SUCCESS_MESSAGE =
  "This Telegram group is now connected to your HaulTracker Pro recruiter workspace.";
export const TELEGRAM_BIND_FAILURE_MESSAGE =
  "That connection code could not be accepted. Generate a new code in HaulTracker Pro and check that your Telegram account is connected there.";

const START_COMMAND_PATTERN = /^\/start ([0-9a-f]{64})$/;

/** TG-2F-C. `/bind <64 lowercase hex>`, optionally addressed to the bot. The
 *  bot username is a public, non-secret constant. */
export const TELEGRAM_BOT_USERNAME = "HaulTrackerProDispatchBot";
const BIND_COMMAND_PATTERN = new RegExp(
  `^\\/bind(?:@${TELEGRAM_BOT_USERNAME})? ([0-9a-f]{64})$`,
);
const BIND_CHAT_TYPES = ["group", "supergroup"];

/** Deterministic JSON serialisation: object keys sorted at every depth so the
 *  same logical update always hashes to the same digest regardless of the key
 *  order Telegram happened to emit. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

interface ParsedIdentity {
  updateId: number;
  telegramUserId: number | null;
  telegramChatId: number | null;
  chatType: string | null;
  text: string | null;
}

function asFiniteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

export function readUpdateId(update: unknown): number | null {
  if (!update || typeof update !== "object") return null;
  const id = asFiniteInteger((update as Record<string, unknown>).update_id);
  return id !== null && id > 0 ? id : null;
}

function parseIdentity(update: unknown, updateId: number): ParsedIdentity {
  const record = update as Record<string, unknown>;
  const message = record.message as Record<string, unknown> | undefined;
  const from = message?.from as Record<string, unknown> | undefined;
  const chat = message?.chat as Record<string, unknown> | undefined;

  const rawUserId = asFiniteInteger(from?.id);
  const rawChatId = asFiniteInteger(chat?.id);

  return {
    updateId,
    telegramUserId: rawUserId !== null && rawUserId > 0 ? rawUserId : null,
    telegramChatId: rawChatId !== null && rawChatId !== 0 ? rawChatId : null,
    chatType: typeof chat?.type === "string" ? chat.type : null,
    text: typeof message?.text === "string" ? message.text : null,
  };
}

export type TelegramClassification =
  | { kind: "ignored"; resultCode: TelegramIgnoredResultCode }
  | { kind: "start"; rawToken: string }
  | { kind: "bind"; rawToken: string; chatType: string };

/** Pure classification. Exported so the contract can be tested directly
 *  without a gateway or a database. */
export function classifyUpdate(identity: ParsedIdentity): TelegramClassification {
  if (identity.telegramUserId === null || identity.telegramChatId === null) {
    return { kind: "ignored", resultCode: "invalid_update_shape" };
  }
  // TG-2F-C. Checked BEFORE the private-chat gate because a dispatch bind is
  // by definition a group action. Everything that is not an exactly-formed
  // bind command in an exactly-allowed group chat falls straight through to
  // the untouched TG-2D classification below, so `/start` in a group still
  // resolves to `non_private_message`.
  if (
    identity.text !== null &&
    identity.chatType !== null &&
    BIND_CHAT_TYPES.includes(identity.chatType)
  ) {
    const bindMatch = BIND_COMMAND_PATTERN.exec(identity.text);
    if (bindMatch) {
      return { kind: "bind", rawToken: bindMatch[1], chatType: identity.chatType };
    }
  }
  if (identity.chatType !== "private") {
    return { kind: "ignored", resultCode: "non_private_message" };
  }
  if (identity.text === null) {
    return { kind: "ignored", resultCode: "non_start_message" };
  }
  const match = START_COMMAND_PATTERN.exec(identity.text);
  if (match) {
    return { kind: "start", rawToken: match[1] };
  }
  if (identity.text === "/start" || identity.text.startsWith("/start ") || identity.text.startsWith("/start@")) {
    return { kind: "ignored", resultCode: "invalid_start_command" };
  }
  return { kind: "ignored", resultCode: "non_start_message" };
}

/** Errors are reduced to a short opaque code. Raw error text can echo a
 *  message body or a link token, so it never reaches a log or a response. */
export function sanitizeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const match = /^[a-z0-9_]{3,64}$/.exec(raw.trim());
  return match ? match[0] : "telegram_poll_unexpected_error";
}

export async function runTelegramPoll(
  deps: TelegramPollDeps,
): Promise<TelegramPollRunResult> {
  const { ledger, gateway, sha256 } = deps;
  const log: TelegramPollLogger = deps.log ?? (() => {});

  const lease = await ledger.claimLease();
  if (!lease) {
    log("poll_busy");
    return { kind: "busy" };
  }

  let processed = 0;
  let advancedTo: number | null = null;

  const release = async () => {
    try {
      await ledger.releaseLease(lease.leaseToken);
    } catch (error) {
      log("lease_release_failed", { code: sanitizeErrorCode(error) });
    }
  };

  const batch = await gateway.getUpdates({
    offset: lease.nextOffset,
    limit: TELEGRAM_GET_UPDATES_LIMIT,
    timeout: TELEGRAM_GET_UPDATES_TIMEOUT_SECONDS,
    allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
  });

  if (!batch.ok || batch.status < 200 || batch.status >= 300) {
    const errorCode = batch.errorCode ?? "telegram_gateway_error";
    log("get_updates_failed", { status: batch.status, code: errorCode });
    await release();
    return { kind: "failed", errorCode, processed, advancedTo };
  }

  const updates = Array.isArray(batch.result) ? [...batch.result] : [];
  const ordered = updates
    .map((update) => ({ update, updateId: readUpdateId(update) }))
    .sort((a, b) => (a.updateId ?? 0) - (b.updateId ?? 0));

  const resultCodes: TelegramResultCode[] = [];

  for (const { update, updateId } of ordered) {
    if (updateId === null) {
      // Without a usable update_id there is no ledger key and no cursor
      // position, so the batch cannot safely continue past it.
      log("update_id_invalid");
      await release();
      return {
        kind: "failed",
        errorCode: "telegram_update_id_invalid",
        processed,
        advancedTo,
      };
    }

    const identity = parseIdentity(update, updateId);
    const classification = classifyUpdate(identity);

    let terminal: TelegramTerminalResult;
    try {
      const payloadHash = await sha256(stableStringify(update));

      terminal = classification.kind === "start"
        ? await ledger.processStartUpdate({
            leaseToken: lease.leaseToken,
            updateId,
            payloadHash,
            telegramUserId: identity.telegramUserId as number,
            telegramChatId: identity.telegramChatId as number,
            chatType: "private",
            rawToken: classification.rawToken,
          })
        : classification.kind === "bind"
        ? await ledger.processBindUpdate({
            leaseToken: lease.leaseToken,
            updateId,
            payloadHash,
            telegramUserId: identity.telegramUserId as number,
            telegramChatId: identity.telegramChatId as number,
            chatType: classification.chatType,
            rawToken: classification.rawToken,
          })
        : await ledger.recordIgnoredUpdate({
            leaseToken: lease.leaseToken,
            updateId,
            payloadHash,
            telegramUserId: identity.telegramUserId,
            telegramChatId: identity.telegramChatId,
            resultCode: classification.resultCode,
          });
    } catch (error) {
      // No terminal receipt exists for this update, so the cursor must NOT
      // move past it and the rest of the batch must not be processed out of
      // order. The next tick re-reads this exact update.
      const errorCode = sanitizeErrorCode(error);
      log("update_terminal_failed", { updateId, code: errorCode });
      await release();
      return { kind: "failed", errorCode, processed, advancedTo };
    }

    processed += 1;
    resultCodes.push(terminal.resultCode);
    log("update_terminal", {
      updateId,
      resultCode: terminal.resultCode,
      isNew: terminal.isNew,
    });

    // Best-effort user feedback. Deliberately AFTER the terminal receipt and
    // deliberately outside cursor correctness: a failed send must never make
    // the update look unprocessed.
    if (terminal.isNew && identity.telegramChatId !== null) {
      const feedback = terminal.resultCode === "link_success"
        ? TELEGRAM_LINK_SUCCESS_MESSAGE
        : terminal.resultCode === "link_rejected" ||
            terminal.resultCode === "invalid_start_command"
        ? TELEGRAM_LINK_FAILURE_MESSAGE
        : terminal.resultCode === "bind_success"
        ? TELEGRAM_BIND_SUCCESS_MESSAGE
        : terminal.resultCode === "bind_rejected"
        ? TELEGRAM_BIND_FAILURE_MESSAGE
        : null;

      if (feedback !== null) {
        try {
          const sent = await gateway.sendMessage({
            chatId: identity.telegramChatId,
            text: feedback,
          });
          if (!sent.ok) {
            log("send_message_failed", {
              updateId,
              code: sent.errorCode ?? "telegram_gateway_error",
            });
          }
        } catch (error) {
          log("send_message_failed", {
            updateId,
            code: sanitizeErrorCode(error),
          });
        }
      }
    }

    try {
      advancedTo = await ledger.advanceCursor(lease.leaseToken, updateId);
    } catch (error) {
      const errorCode = sanitizeErrorCode(error);
      log("cursor_advance_failed", { updateId, code: errorCode });
      await release();
      return { kind: "failed", errorCode, processed, advancedTo };
    }
  }

  await release();
  log("poll_complete", { processed, advancedTo: advancedTo ?? -1 });
  return { kind: "ok", processed, advancedTo, resultCodes };
}
