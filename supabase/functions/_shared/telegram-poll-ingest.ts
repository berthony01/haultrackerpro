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

/** Phase RB-1A / RB-1B — private-chat read-only menu/status terminal
 *  outcomes. RB-1B adds the driver, multi-capability and linked-unsupported
 *  outcomes; the three RB-1A codes keep their exact meaning. */
export type TelegramMenuResultCode =
  | "menu_recruiter"
  | "menu_linked_no_workspace"
  | "menu_unlinked"
  | "menu_driver"
  | "menu_multi_role"
  | "menu_linked_unsupported";

export const TELEGRAM_MENU_RESULT_CODES: readonly TelegramMenuResultCode[] = [
  "menu_recruiter",
  "menu_linked_no_workspace",
  "menu_unlinked",
  "menu_driver",
  "menu_multi_role",
  "menu_linked_unsupported",
];

export function isMenuResultCode(code: TelegramResultCode): code is TelegramMenuResultCode {
  return (TELEGRAM_MENU_RESULT_CODES as readonly string[]).includes(code);
}

/** RB-1B. Which bare private command produced a menu update. Used ONLY to
 *  choose copy in the adapter — never to widen data access or authority. */
export type TelegramMenuCommand = "start" | "menu" | "status";

/** Phase RB-2B — private-chat Accept / Pass button terminal outcomes. The
 *  database owns every one of these; the orchestrator only transports them. */
export type TelegramConversationActionResultCode =
  | "conversation_accepted"
  | "conversation_passed"
  | "conversation_already_handled"
  | "conversation_action_unavailable"
  | "conversation_action_denied"
  | "conversation_action_invalid";

export const TELEGRAM_CONVERSATION_ACTION_RESULT_CODES:
  readonly TelegramConversationActionResultCode[] = [
    "conversation_accepted",
    "conversation_passed",
    "conversation_already_handled",
    "conversation_action_unavailable",
    "conversation_action_denied",
    "conversation_action_invalid",
  ];

export type TelegramResultCode =
  | TelegramIgnoredResultCode
  | TelegramStartResultCode
  | TelegramBindResultCode
  | TelegramMenuResultCode
  | TelegramConversationActionResultCode;

export interface TelegramPollLease {
  leaseToken: string;
  nextOffset: number;
}

export interface TelegramTerminalResult {
  isNew: boolean;
  resultCode: TelegramResultCode;
  /** RB-1A. Fully composed plain-text menu reply, supplied by the adapter for
   *  menu outcomes only. Never a template, never raw update data. */
  menuText?: string | null;
  /** RB-1B. URL-only inline buttons for menu outcomes, supplied by the
   *  adapter. Every destination is a route that already exists in the web
   *  app; there is no callback button and no callback data. */
  menuButtons?: TelegramInlineUrlButton[][] | null;
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
  /** RB-1A. Atomic: actor resolution + terminal receipt in one DB
   *  transaction. Read-only with respect to recruiter data.
   *
   *  Optional so a ledger built before RB-1A still satisfies the contract.
   *  When it is absent the orchestrator fails CLOSED for menu updates: no
   *  receipt, no reply, no cursor advance. */
  processMenuUpdate?(input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
    /** RB-1B. Copy selector only. Never forwarded to the database and never
     *  an authorization input. */
    command: TelegramMenuCommand;
  }): Promise<TelegramTerminalResult>;
  /** RB-2B. Atomic: actor derivation + CF-1 re-authorization + the canonical
   *  CF-1 accept/decline transition + terminal receipt, all in ONE database
   *  transaction. `action` / `threadId` are UNTRUSTED locator data parsed from
   *  the callback payload and are validated server-side.
   *
   *  Optional so a ledger built before RB-2B still satisfies the contract.
   *  When it is absent the orchestrator fails CLOSED for callback updates: no
   *  receipt, no action, no cursor advance. */
  processConversationActionUpdate?(input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
    action: TelegramConversationAction | null;
    threadId: string | null;
  }): Promise<TelegramTerminalResult>;
}

export interface TelegramGatewayResponse<T> {
  ok: boolean;
  status: number;
  errorCode?: string;
  result?: T;
}

/** RB-1B. A Telegram inline keyboard button that carries a URL ONLY. Menu
 *  keyboards remain exclusively URL buttons. */
export interface TelegramInlineUrlButton {
  text: string;
  url: string;
}

/** RB-2B. A Telegram inline keyboard button that carries compact, versioned,
 *  privacy-safe routing data. Possession is NEVER authorization: the payload
 *  is re-validated and re-authorized server-side on every tap. */
export interface TelegramInlineCallbackButton {
  text: string;
  callbackData: string;
}

export type TelegramInlineButton =
  | TelegramInlineUrlButton
  | TelegramInlineCallbackButton;

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
    /** URL-only for menus (RB-1B); RB-2B alerts may also carry callback rows.
     *  Absent for every plain-text outcome, exactly as before. */
    buttons?: TelegramInlineButton[][] | null;
  }): Promise<TelegramGatewayResponse<unknown>>;
  /** RB-2B. Resolves the Telegram spinner after a button tap. Answering is
   *  NOT a state mutation, so it is always best-effort. */
  answerCallbackQuery?(input: {
    callbackQueryId: string;
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
// RB-2B. Extended from message-only to message + callback_query so recruiter
// Accept / Pass taps arrive through the SAME single poller. Still no webhook,
// no second poller, and no other update type.
export const TELEGRAM_ALLOWED_UPDATES = ["message", "callback_query"] as const;

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
export const TELEGRAM_BOT_USERNAME = "HaulTrackerBot";
const BIND_COMMAND_PATTERN = new RegExp(
  `^\\/bind(?:@${TELEGRAM_BOT_USERNAME})? ([0-9a-f]{64})$`,
);
const BIND_CHAT_TYPES = ["group", "supergroup"];

/** RB-1A / RB-1B. Bare private-chat menu commands ONLY. Deliberately exact:
 *  any suffixed or addressed variant keeps its existing TG-2D
 *  classification. RB-1B adds `/menu` alongside the existing two. */
const MENU_COMMANDS: Record<string, TelegramMenuCommand> = {
  "/start": "start",
  "/menu": "menu",
  "/status": "status",
};

// ───────────────────── RB-2B — conversation action locator ─────────────────────
//
// Compact versioned form `c1:<a|p>:<thread uuid>` — 41 bytes, far inside
// Telegram's 64-byte callback_data limit. It carries NO driver identity, no
// recruiter id, no workspace id and no account id: only a version, an action
// letter and an opaque conversation locator that is re-authorized server-side.

export type TelegramConversationAction = "accept" | "pass";

const CONVERSATION_ACTION_PATTERN =
  /^c1:(a|p):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64;

export function composeConversationActionData(
  action: TelegramConversationAction,
  threadId: string,
): string {
  return `c1:${action === "accept" ? "a" : "p"}:${threadId}`;
}

export function parseConversationActionData(
  data: unknown,
): { action: TelegramConversationAction; threadId: string } | null {
  if (typeof data !== "string") return null;
  const match = CONVERSATION_ACTION_PATTERN.exec(data);
  if (!match) return null;
  return { action: match[1] === "a" ? "accept" : "pass", threadId: match[2] };
}

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
  /** RB-2B. Present ONLY for a `callback_query` update. */
  callbackQueryId: string | null;
  callbackData: string | null;
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

  // RB-2B. A button tap. Identity comes from `callback_query.from`, never from
  // the callback payload, and the chat is the one the alert was delivered to.
  const callback = record.callback_query as Record<string, unknown> | undefined;
  if (callback && typeof callback === "object" && !Array.isArray(callback)) {
    const cbFrom = callback.from as Record<string, unknown> | undefined;
    const cbMessage = callback.message as Record<string, unknown> | undefined;
    const cbChat = cbMessage?.chat as Record<string, unknown> | undefined;
    const cbUserId = asFiniteInteger(cbFrom?.id);
    const cbChatId = asFiniteInteger(cbChat?.id);

    return {
      updateId,
      telegramUserId: cbUserId !== null && cbUserId > 0 ? cbUserId : null,
      telegramChatId: cbChatId !== null && cbChatId !== 0 ? cbChatId : null,
      chatType: typeof cbChat?.type === "string" ? cbChat.type : null,
      text: null,
      callbackQueryId:
        typeof callback.id === "string" && callback.id.length > 0 ? callback.id : null,
      callbackData: typeof callback.data === "string" ? callback.data : null,
    };
  }

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
    callbackQueryId: null,
    callbackData: null,
  };
}

export type TelegramClassification =
  | { kind: "ignored"; resultCode: TelegramIgnoredResultCode }
  | { kind: "start"; rawToken: string }
  | { kind: "bind"; rawToken: string; chatType: string }
  | { kind: "menu"; command: TelegramMenuCommand }
  | {
      kind: "conversation_action";
      action: TelegramConversationAction | null;
      threadId: string | null;
      chatType: string;
    };

/** Pure classification. Exported so the contract can be tested directly
 *  without a gateway or a database. */
export function classifyUpdate(identity: ParsedIdentity): TelegramClassification {
  if (identity.telegramUserId === null || identity.telegramChatId === null) {
    return { kind: "ignored", resultCode: "invalid_update_shape" };
  }
  // RB-2B. A callback update is NEVER reinterpreted as a message command. A
  // malformed payload or a non-private chat is still routed to the action
  // processor so its terminal receipt is recorded as `callback_query`, and the
  // processor — not this pure function — decides the fail-closed outcome.
  if (identity.callbackQueryId !== null) {
    const parsed = parseConversationActionData(identity.callbackData);
    return {
      kind: "conversation_action",
      action: parsed?.action ?? null,
      threadId: parsed?.threadId ?? null,
      chatType: identity.chatType ?? "",
    };
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
  // RB-1A. Strictly AFTER the link-token pattern, so `/start <64hex>` keeps
  // its TG-2B/TG-2D meaning, and strictly exact, so `/start ` prefixes and
  // `/start@…` variants keep their existing `invalid_start_command` outcome.
  const menuCommand = Object.prototype.hasOwnProperty.call(MENU_COMMANDS, identity.text)
    ? MENU_COMMANDS[identity.text]
    : undefined;
  if (menuCommand) {
    return { kind: "menu", command: menuCommand };
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
        : classification.kind === "menu"
        ? await (ledger.processMenuUpdate
            ? ledger.processMenuUpdate({
                leaseToken: lease.leaseToken,
                updateId,
                payloadHash,
                telegramUserId: identity.telegramUserId as number,
                telegramChatId: identity.telegramChatId as number,
                chatType: "private",
                command: classification.command,
              })
            : Promise.reject(new Error("telegram_menu_processor_unavailable")))
        // RB-2B. The database performs actor derivation, private-chat and
        // tenant re-authorization, the canonical CF-1 transition and the
        // terminal receipt in ONE transaction. Fail CLOSED when the processor
        // is unavailable: no receipt, no action, no cursor advance.
        : classification.kind === "conversation_action"
        ? await (ledger.processConversationActionUpdate
            ? ledger.processConversationActionUpdate({
                leaseToken: lease.leaseToken,
                updateId,
                payloadHash,
                telegramUserId: identity.telegramUserId as number,
                telegramChatId: identity.telegramChatId as number,
                chatType: classification.chatType,
                action: classification.action,
                threadId: classification.threadId,
              })
            : Promise.reject(
                new Error("telegram_conversation_action_processor_unavailable"),
              ))
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
    // RB-2B. A button tap is resolved by ANSWERING the callback, never by a
    // new message. Answering is not a state mutation, so it runs even for a
    // duplicate delivery (which reports the already-recorded outcome) and a
    // failure here can never re-apply or roll back the database action.
    if (identity.callbackQueryId !== null) {
      if (gateway.answerCallbackQuery) {
        try {
          const answered = await gateway.answerCallbackQuery({
            callbackQueryId: identity.callbackQueryId,
            text: composeConversationActionAnswer(terminal.resultCode),
          });
          if (!answered.ok) {
            log("answer_callback_failed", {
              updateId,
              code: answered.errorCode ?? "telegram_gateway_error",
            });
          }
        } catch (error) {
          log("answer_callback_failed", {
            updateId,
            code: sanitizeErrorCode(error),
          });
        }
      }
    } else if (terminal.isNew && identity.telegramChatId !== null) {
      const feedback = terminal.resultCode === "link_success"
        ? TELEGRAM_LINK_SUCCESS_MESSAGE
        : terminal.resultCode === "link_rejected" ||
            terminal.resultCode === "invalid_start_command"
        ? TELEGRAM_LINK_FAILURE_MESSAGE
        : terminal.resultCode === "bind_success"
        ? TELEGRAM_BIND_SUCCESS_MESSAGE
        : terminal.resultCode === "bind_rejected"
        ? TELEGRAM_BIND_FAILURE_MESSAGE
        // RB-1A / RB-1B. The adapter composes the menu text (and its URL-only
        // buttons) from the bounded descriptor; the orchestrator only
        // transports them.
        : isMenuResultCode(terminal.resultCode) &&
            typeof terminal.menuText === "string" &&
            terminal.menuText.length > 0
        ? terminal.menuText
        : null;

      const feedbackButtons =
        feedback !== null && isMenuResultCode(terminal.resultCode) &&
          Array.isArray(terminal.menuButtons) && terminal.menuButtons.length > 0
          ? terminal.menuButtons
          : null;

      if (feedback !== null) {
        try {
          // `buttons` is omitted entirely when there are none, so every
          // pre-RB-1B outcome sends the exact payload it always sent.
          const sent = await gateway.sendMessage({
            chatId: identity.telegramChatId,
            text: feedback,
            ...(feedbackButtons ? { buttons: feedbackButtons } : {}),
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

// ───────────────── RB-2A — outbound conversation alert drain ─────────────────
//
// A recruiter-facing notification companion for conversations that ALREADY
// exist in HaulTracker Pro. Contract:
//   * the database owns eligibility, recruiter authorization, tenant scoping
//     and recipient resolution — this code only renders and sends;
//   * private linked recruiter chats only, URL-only button, no callback data;
//   * no driver identity, contact detail or profile data is representable
//     here: the only variable content is the opportunity title the recipient
//     can already see in their own workspace;
//   * a row is marked delivered ONLY after Telegram confirms; any failure is
//     reported back for a retry;
//   * the drain runs AFTER inbound polling and can never throw into it, so an
//     outbound failure can never stall cursor advancement.

/** One claimed outbound alert, as returned by the claim RPC. */
export interface TelegramAlertClaim {
  alertId: string;
  /** RB-2B. Conversation locator for the Accept / Pass buttons. An opaque id
   *  only — possession confers nothing; every tap is re-authorized. */
  threadId: string;
  /** Private chat id of the linked recruiter. Never a group chat. */
  telegramChatId: number;
  /** Recruiter-visible opportunity title, or null. Never driver data. */
  opportunityTitle: string | null;
}

export interface TelegramAlertOutbox {
  claimConversationAlerts(limit: number): Promise<TelegramAlertClaim[]>;
  markConversationAlertSent(alertId: string): Promise<void>;
  markConversationAlertFailed(alertId: string, errorCode: string): Promise<void>;
}

export interface TelegramAlertDrainDeps {
  outbox: TelegramAlertOutbox;
  gateway: TelegramGateway;
  /** Proven recruiter conversations inbox route. */
  conversationsUrl: string;
  log?: TelegramPollLogger;
}

export interface TelegramAlertDrainResult {
  claimed: number;
  sent: number;
  failed: number;
}

export const TELEGRAM_ALERT_DRAIN_LIMIT = 10;

export const TELEGRAM_ALERT_HEADER = "HaulTracker Pro — new driver conversation";
export const TELEGRAM_ALERT_GENERIC_BODY =
  "A driver started a conversation with your workspace. Open HaulTracker Pro to read it and reply.";
export const TELEGRAM_ALERT_BUTTON_LABEL = "Open Conversations";
export const TELEGRAM_ALERT_ACCEPT_LABEL = "✅ Accept";
export const TELEGRAM_ALERT_PASS_LABEL = "❌ Pass";

/** Privacy-safe copy. The opportunity title is the ONLY variable element. */
export function composeConversationAlertText(
  opportunityTitle: string | null,
): string {
  const title = typeof opportunityTitle === "string" ? opportunityTitle.trim() : "";
  if (title.length === 0) {
    return `${TELEGRAM_ALERT_HEADER}\n\n${TELEGRAM_ALERT_GENERIC_BODY}`;
  }
  return `${TELEGRAM_ALERT_HEADER}\n\nOpportunity: ${title.slice(0, 120)}\n\n${TELEGRAM_ALERT_GENERIC_BODY}`;
}

/** RB-2B. Accept / Pass carry compact versioned callback data; Open
 *  Conversations stays URL-only. No driver data is representable in either. */
export function composeConversationAlertButtons(
  conversationsUrl: string,
  threadId: string,
): TelegramInlineButton[][] {
  return [
    [
      {
        text: TELEGRAM_ALERT_ACCEPT_LABEL,
        callbackData: composeConversationActionData("accept", threadId),
      },
      {
        text: TELEGRAM_ALERT_PASS_LABEL,
        callbackData: composeConversationActionData("pass", threadId),
      },
    ],
    [{ text: TELEGRAM_ALERT_BUTTON_LABEL, url: conversationsUrl }],
  ];
}

// RB-2B. Bounded, privacy-safe callback answers. One fixed string per terminal
// outcome — never an error detail, a driver name or any workspace data.
export const TELEGRAM_CONVERSATION_ACTION_ANSWERS: Record<
  TelegramConversationActionResultCode,
  string
> = {
  conversation_accepted: "Accepted — conversation is now active.",
  conversation_passed: "Passed — conversation closed.",
  conversation_already_handled: "This conversation was already handled.",
  conversation_action_unavailable: "This conversation is no longer available.",
  conversation_action_denied: "You can't act on this conversation.",
  conversation_action_invalid: "This action is no longer valid.",
};

export function composeConversationActionAnswer(
  resultCode: TelegramResultCode,
): string {
  return Object.prototype.hasOwnProperty.call(
      TELEGRAM_CONVERSATION_ACTION_ANSWERS,
      resultCode,
    )
    ? TELEGRAM_CONVERSATION_ACTION_ANSWERS[
        resultCode as TelegramConversationActionResultCode
      ]
    : TELEGRAM_CONVERSATION_ACTION_ANSWERS.conversation_action_invalid;
}

/** Drains claimed outbound alerts. Never throws. */
export async function runTelegramAlertDrain(
  deps: TelegramAlertDrainDeps,
): Promise<TelegramAlertDrainResult> {
  const log: TelegramPollLogger = deps.log ?? (() => {});
  const result: TelegramAlertDrainResult = { claimed: 0, sent: 0, failed: 0 };

  let claims: TelegramAlertClaim[];
  try {
    claims = await deps.outbox.claimConversationAlerts(TELEGRAM_ALERT_DRAIN_LIMIT);
  } catch (error) {
    log("alert_claim_failed", { code: sanitizeErrorCode(error) });
    return result;
  }

  result.claimed = claims.length;
  if (claims.length === 0) return result;

  for (const claim of claims) {
    let errorCode: string | null = null;
    try {
      const sent = await deps.gateway.sendMessage({
        chatId: claim.telegramChatId,
        text: composeConversationAlertText(claim.opportunityTitle),
        buttons: composeConversationAlertButtons(
          deps.conversationsUrl,
          claim.threadId,
        ),
      });
      if (!sent.ok) errorCode = sent.errorCode ?? "telegram_gateway_error";
    } catch (error) {
      errorCode = sanitizeErrorCode(error);
    }

    try {
      if (errorCode === null) {
        await deps.outbox.markConversationAlertSent(claim.alertId);
        result.sent += 1;
      } else {
        await deps.outbox.markConversationAlertFailed(claim.alertId, errorCode);
        result.failed += 1;
        log("alert_send_failed", { code: errorCode });
      }
    } catch (error) {
      // The row stays 'claimed' and is reconciled by its own attempt bound;
      // delivery is never falsely recorded.
      log("alert_mark_unresolved", { alertId: claim.alertId });
      log("alert_mark_failed", { code: sanitizeErrorCode(error) });
    }
  }

  log("alert_drain_complete", {
    claimed: result.claimed,
    sent: result.sent,
    failed: result.failed,
  });
  return result;
}

