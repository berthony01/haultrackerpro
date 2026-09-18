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

/** Phase RB-2C — private-chat recruiter reply terminal outcomes. The database
 *  owns every one of these; the orchestrator only transports them. */
export type TelegramConversationReplyResultCode =
  | "conversation_reply_sent"
  | "conversation_reply_denied"
  | "conversation_reply_unavailable"
  | "conversation_reply_invalid"
  | "conversation_reply_unroutable";

export const TELEGRAM_CONVERSATION_REPLY_RESULT_CODES:
  readonly TelegramConversationReplyResultCode[] = [
    "conversation_reply_sent",
    "conversation_reply_denied",
    "conversation_reply_unavailable",
    "conversation_reply_invalid",
    "conversation_reply_unroutable",
  ];

export function isConversationReplyResultCode(
  code: TelegramResultCode,
): code is TelegramConversationReplyResultCode {
  return (TELEGRAM_CONVERSATION_REPLY_RESULT_CODES as readonly string[]).includes(code);
}

/** RB-2C. Bounded, privacy-safe acknowledgements. One fixed string per
 *  terminal outcome — never an error detail, a driver name, a thread id or any
 *  workspace data. */
export const TELEGRAM_CONVERSATION_REPLY_ANSWERS: Record<
  TelegramConversationReplyResultCode,
  string
> = {
  conversation_reply_sent: "Sent to the driver in HaulTracker Pro.",
  conversation_reply_denied: "You can't message this conversation.",
  conversation_reply_unavailable:
    "This conversation isn't open for messages. Accept it in HaulTracker Pro first.",
  conversation_reply_invalid: "That message couldn't be sent. Keep it to plain text under 4000 characters.",
  conversation_reply_unroutable:
    "To message a driver, reply directly to that conversation alert.",
};

/** Phase RB-3A — recruiter text Quick Post terminal outcomes. The database
 *  owns every one of these; the orchestrator only transports them. */
export type TelegramQuickPostResultCode =
  | "quick_post_started"
  | "quick_post_denied"
  | "quick_post_unavailable"
  | "quick_post_source_reserved"
  | "quick_post_source_rejected"
  | "quick_post_created"
  | "quick_post_already_completed"
  | "quick_post_create_blocked"
  | "quick_post_cancelled"
  | "quick_post_restarted"
  | "quick_post_action_invalid"
  | "quick_post_action_denied"
  | "quick_post_action_unavailable";

export const TELEGRAM_QUICK_POST_RESULT_CODES:
  readonly TelegramQuickPostResultCode[] = [
    "quick_post_started",
    "quick_post_denied",
    "quick_post_unavailable",
    "quick_post_source_reserved",
    "quick_post_source_rejected",
    "quick_post_created",
    "quick_post_already_completed",
    "quick_post_create_blocked",
    "quick_post_cancelled",
    "quick_post_restarted",
    "quick_post_action_invalid",
    "quick_post_action_denied",
    "quick_post_action_unavailable",
  ];

export function isQuickPostResultCode(
  code: TelegramResultCode,
): code is TelegramQuickPostResultCode {
  return (TELEGRAM_QUICK_POST_RESULT_CODES as readonly string[]).includes(code);
}

/** RB-3A. Bounded, privacy-safe replies. One fixed string per terminal
 *  outcome — never an error detail, a provider message, a workspace name or
 *  any extracted content. */
export const TELEGRAM_QUICK_POST_ANSWERS: Record<
  TelegramQuickPostResultCode,
  string
> = {
  quick_post_started:
    "Paste the full job post as one plain-text message and I'll turn it into a draft opportunity for your review.",
  quick_post_denied: "Quick Post isn't available for this chat.",
  quick_post_unavailable:
    "No single recruiter workspace with posting access was found for your account. Post from HaulTracker Pro instead.",
  quick_post_source_reserved: "Reading that job post…",
  quick_post_source_rejected:
    "That couldn't be used. Send the full job post as one plain-text message between 30 and 8000 characters.",
  quick_post_created: "Draft opportunity created in HaulTracker Pro.",
  quick_post_already_completed: "That draft was already posted.",
  quick_post_create_blocked:
    "That couldn't be created. Open HaulTracker Pro to finish this opportunity.",
  quick_post_cancelled: "Quick Post cancelled. Nothing was created.",
  quick_post_restarted: "Starting over. Paste the job post as one plain-text message.",
  quick_post_action_invalid: "That button is no longer valid.",
  quick_post_action_denied: "You can't use that button.",
  quick_post_action_unavailable: "That draft isn't ready to post.",
};

export type TelegramResultCode =
  | TelegramIgnoredResultCode
  | TelegramStartResultCode
  | TelegramBindResultCode
  | TelegramMenuResultCode
  | TelegramConversationActionResultCode
  | TelegramConversationReplyResultCode
  | TelegramQuickPostResultCode;

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
  /** RB-1B. Inline buttons for menu outcomes, supplied by the adapter. Every
   *  URL destination is a route that already exists in the web app. RB-3A adds
   *  at most ONE recruiter callback button, whose payload is an untrusted
   *  locator re-authorized server-side. */
  menuButtons?: TelegramInlineButton[][] | null;
  /** RB-3A. Draft locator returned by a Quick Post processor. Opaque; never
   *  authorization. */
  draftId?: string | null;
  /** RB-3A. The delegated actor for the reserved extraction call. Internal
   *  only: never rendered, never logged. */
  actorUserId?: string | null;
  /** RB-3A. Adapter-composed bounded chat reply for a Quick Post outcome. */
  followUpText?: string | null;
  /** RB-3A. Adapter-composed buttons that accompany `followUpText`. */
  followUpButtons?: TelegramInlineButton[][] | null;
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
  /** RB-2C. Atomic: actor derivation + alert-mapped thread resolution + CF-1
   *  re-authorization + the canonical CF-1 message write + terminal receipt,
   *  all in ONE database transaction. `replyToMessageId` is an UNTRUSTED
   *  locator and `text` is untrusted external input; both are validated
   *  server-side.
   *
   *  Optional so a ledger built before RB-2C still satisfies the contract.
   *  When it is absent the orchestrator fails CLOSED for reply updates: no
   *  receipt, no message, no cursor advance. */
  processConversationReplyUpdate?(input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
    replyToMessageId: number | null;
    text: string;
  }): Promise<TelegramTerminalResult>;
  /** RB-3A. `/post`. Atomic: actor derivation + recruiter capability + draft
   *  creation + terminal receipt in ONE transaction.
   *
   *  Optional so a ledger built before RB-3A still satisfies the contract.
   *  When it is absent `/post` keeps its exact pre-RB-3A `non_start_message`
   *  outcome — no draft, no extraction, no creation. */
  processQuickPostCommandUpdate?(input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
  }): Promise<TelegramTerminalResult>;
  /** RB-3A. Ordinary private non-reply text. The DATABASE decides whether the
   *  acting account holds a live awaiting-input draft; when it does not, the
   *  pre-existing `non_start_message` outcome is recorded unchanged and
   *  nothing is extracted. Reserving the source update is atomic, so a
   *  duplicate delivery can never spend a second model call.
   *
   *  Optional so a ledger built before RB-3A still satisfies the contract. */
  processQuickPostSourceUpdate?(input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
    text: string;
  }): Promise<TelegramTerminalResult>;
  /** RB-3A. Persist the canonical extractor outcome for a reserved draft and
   *  compose the bounded review. Never a receipt: the source update already
   *  holds its terminal receipt. */
  completeQuickPostExtraction?(input: {
    draftId: string;
    extracted: unknown | null;
    errorCode: string | null;
  }): Promise<TelegramTerminalResult | null>;
  /** RB-3A. Quick Post button taps. Atomic: actor derivation + draft ownership
   *  + recruiter capability re-check + canonical delegated creation + terminal
   *  receipt in ONE transaction.
   *
   *  Optional so a ledger built before RB-3A still satisfies the contract.
   *  When it is absent the orchestrator fails CLOSED for q1 callbacks. */
  processQuickPostActionUpdate?(input: {
    leaseToken: string;
    updateId: number;
    payloadHash: string;
    telegramUserId: number;
    telegramChatId: number;
    chatType: string;
    action: TelegramQuickPostAction | null;
    draftId: string | null;
  }): Promise<TelegramTerminalResult>;
}

/** RB-3A. The canonical extractor, reached through the ai-insight delegated
 *  mode. Injected so the orchestrator never holds a prompt, a model id, a
 *  provider, or a credential. */
export interface TelegramQuickPostExtractor {
  extract(input: {
    actorUserId: string;
    text: string;
  }): Promise<
    | { ok: true; extracted: unknown }
    | { ok: false; errorCode: string }
  >;
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

/** RB-2C. The only part of Telegram's sendMessage result this runtime reads:
 *  the transport id of the message it just sent. No chat, user, or content
 *  field is consumed. */
export interface TelegramSentMessage {
  message_id?: number;
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
    /** URL-only for menus (RB-1B); RB-2B alerts may also carry callback rows.
     *  Absent for every plain-text outcome, exactly as before. */
    buttons?: TelegramInlineButton[][] | null;
  }): Promise<TelegramGatewayResponse<TelegramSentMessage>>;
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
  /** RB-3A. Absent = Quick Post extraction is unavailable and a reserved draft
   *  is marked failed rather than retried, so no model call is ever implied. */
  quickPostExtractor?: TelegramQuickPostExtractor;
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
  /** RB-2B. Present ONLY for a `callback_query` update. Optional so an
   *  absent field is indistinguishable from an explicit null: a message
   *  update can never be mistaken for a button tap. */
  callbackQueryId?: string | null;
  callbackData?: string | null;
  /** RB-2C. `message.reply_to_message.message_id`. An UNTRUSTED transport
   *  locator: possession confers nothing and it is resolved server-side only
   *  against an alert actually delivered to the acting account. */
  replyToMessageId?: number | null;
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
      replyToMessageId: null,
    };
  }

  const message = record.message as Record<string, unknown> | undefined;
  const from = message?.from as Record<string, unknown> | undefined;
  const chat = message?.chat as Record<string, unknown> | undefined;

  const rawUserId = asFiniteInteger(from?.id);
  const rawChatId = asFiniteInteger(chat?.id);

  // RB-2C. Transport locator only.
  const replyTo = message?.reply_to_message as Record<string, unknown> | undefined;
  const replyToId = replyTo && typeof replyTo === "object" && !Array.isArray(replyTo)
    ? asFiniteInteger(replyTo.message_id)
    : null;

  return {
    updateId,
    telegramUserId: rawUserId !== null && rawUserId > 0 ? rawUserId : null,
    telegramChatId: rawChatId !== null && rawChatId !== 0 ? rawChatId : null,
    chatType: typeof chat?.type === "string" ? chat.type : null,
    text: typeof message?.text === "string" ? message.text : null,
    callbackQueryId: null,
    callbackData: null,
    replyToMessageId: replyToId !== null && replyToId > 0 ? replyToId : null,
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
    }
  | {
      kind: "conversation_reply";
      replyToMessageId: number;
      text: string;
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
  if (identity.callbackQueryId != null) {
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
  // RB-2C. Strictly LAST among the command branches, so every existing command
  // classification is unchanged. Ordinary private text becomes a conversation
  // reply ONLY when Telegram says it is a reply to a specific bot message; a
  // slash command is never routed as conversation text, and a non-reply
  // message keeps its exact existing `non_start_message` outcome.
  if (
    identity.replyToMessageId != null &&
    identity.replyToMessageId > 0 &&
    !identity.text.startsWith("/")
  ) {
    return {
      kind: "conversation_reply",
      replyToMessageId: identity.replyToMessageId,
      text: identity.text,
    };
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
        // RB-2C. The database resolves the thread from an alert delivered to
        // the acting account, re-authorizes it against CF-1, writes the
        // Driver-visible message through the canonical CF-1 function and
        // records the terminal receipt in ONE transaction. Fail CLOSED when
        // the processor is unavailable: no receipt, no message, no cursor
        // advance.
        : classification.kind === "conversation_reply"
        ? await (ledger.processConversationReplyUpdate
            ? ledger.processConversationReplyUpdate({
                leaseToken: lease.leaseToken,
                updateId,
                payloadHash,
                telegramUserId: identity.telegramUserId as number,
                telegramChatId: identity.telegramChatId as number,
                chatType: "private",
                replyToMessageId: classification.replyToMessageId,
                text: classification.text,
              })
            : Promise.reject(
                new Error("telegram_conversation_reply_processor_unavailable"),
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
    if (identity.callbackQueryId != null) {
      const callbackQueryId = identity.callbackQueryId;
      if (gateway.answerCallbackQuery) {
        try {
          const answered = await gateway.answerCallbackQuery({
            callbackQueryId,
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
        // RB-2C. One fixed, bounded acknowledgement per reply outcome. Sent
        // AFTER the committed transaction and strictly best-effort, so a send
        // failure can never re-write or undo the conversation message.
        : isConversationReplyResultCode(terminal.resultCode)
        ? TELEGRAM_CONVERSATION_REPLY_ANSWERS[terminal.resultCode]
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
//   * private linked recruiter chats only; RB-2B adds Accept / Pass callback
//     buttons whose payload is an untrusted locator re-authorized server-side;
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
  /** RB-2C. The delivered Telegram message id (and its chat) are persisted so
   *  a later recruiter REPLY to that exact message can be resolved back to
   *  this conversation. Transport identifiers only — never driver data. */
  markConversationAlertSent(
    alertId: string,
    telegramMessageId: number | null,
    telegramChatId: number | null,
  ): Promise<void>;
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
/** RB-2C. Explains the ONLY supported routing: an explicit Telegram reply to
 *  this exact alert. Makes no availability or employment promise. */
export const TELEGRAM_ALERT_REPLY_HINT =
  "Accept the conversation, then reply to this alert to message the driver.";
export const TELEGRAM_ALERT_BUTTON_LABEL = "Open Conversations";
export const TELEGRAM_ALERT_ACCEPT_LABEL = "✅ Accept";
export const TELEGRAM_ALERT_PASS_LABEL = "❌ Pass";

/** Privacy-safe copy. The opportunity title is the ONLY variable element. */
export function composeConversationAlertText(
  opportunityTitle: string | null,
): string {
  const title = typeof opportunityTitle === "string" ? opportunityTitle.trim() : "";
  if (title.length === 0) {
    return `${TELEGRAM_ALERT_HEADER}\n\n${TELEGRAM_ALERT_GENERIC_BODY}\n\n${TELEGRAM_ALERT_REPLY_HINT}`;
  }
  return `${TELEGRAM_ALERT_HEADER}\n\nOpportunity: ${title.slice(0, 120)}\n\n${TELEGRAM_ALERT_GENERIC_BODY}\n\n${TELEGRAM_ALERT_REPLY_HINT}`;
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
    // RB-2C. Captured ONLY on a confirmed send, and used ONLY as the reply
    // locator for this alert.
    let sentMessageId: number | null = null;
    try {
      const sent = await deps.gateway.sendMessage({
        chatId: claim.telegramChatId,
        text: composeConversationAlertText(claim.opportunityTitle),
        buttons: composeConversationAlertButtons(
          deps.conversationsUrl,
          claim.threadId,
        ),
      });
      if (!sent.ok) {
        errorCode = sent.errorCode ?? "telegram_gateway_error";
      } else {
        const id = sent.result?.message_id;
        sentMessageId =
          typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
      }
    } catch (error) {
      errorCode = sanitizeErrorCode(error);
    }

    try {
      if (errorCode === null) {
        await deps.outbox.markConversationAlertSent(
          claim.alertId,
          sentMessageId,
          claim.telegramChatId,
        );
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


// ────────── RB-2D — outbound driver-message delivery drain (one way) ──────────
//
// Delivers a canonical CF-1 DRIVER message into the recruiter's private
// @HaulTrackerBot chat. Contract:
//   * the database owns eligibility, echo prevention, the post-acceptance
//     cutoff, recipient resolution and re-authorization — this code only
//     renders and sends;
//   * the ONLY variable content is the driver's own conversation message body,
//     which the driver deliberately sent to this recruiter in an accepted
//     conversation. No profile, contact, load, financial or inferred data is
//     representable here;
//   * plain text only — no parse_mode, no HTML, no Markdown, no buttons — so
//     message content can never be interpreted as formatting or injection;
//   * the body is NEVER truncated or otherwise mutated;
//   * a row is marked delivered ONLY after Telegram confirms, and the
//     confirmed message id is persisted so the recruiter can reply to it;
//   * the drain runs AFTER inbound polling and after the alert drain, in its
//     own isolated scope, and can never throw into them.

/** One claimed outbound driver message, as returned by the claim RPC. */
export interface TelegramMessageDeliveryClaim {
  deliveryId: string;
  /** Private chat id of the linked recruiter. Never a group chat. */
  telegramChatId: number;
  /** Canonical CF-1 driver message body, read at claim time. */
  messageBody: string;
}

export interface TelegramMessageDeliveryOutbox {
  claimConversationMessageDeliveries(
    limit: number,
  ): Promise<TelegramMessageDeliveryClaim[]>;
  /** The delivered Telegram message id (and its chat) are persisted so a later
   *  recruiter REPLY to that exact message resolves back to this conversation
   *  through the RB-2C bridge. Transport identifiers only. */
  markConversationMessageDeliverySent(
    deliveryId: string,
    telegramMessageId: number | null,
    telegramChatId: number | null,
  ): Promise<void>;
  markConversationMessageDeliveryFailed(
    deliveryId: string,
    errorCode: string,
  ): Promise<void>;
}

export interface TelegramMessageDeliveryDrainDeps {
  outbox: TelegramMessageDeliveryOutbox;
  gateway: TelegramGateway;
  log?: TelegramPollLogger;
}

export interface TelegramMessageDeliveryDrainResult {
  claimed: number;
  sent: number;
  failed: number;
}

export const TELEGRAM_MESSAGE_DELIVERY_DRAIN_LIMIT = 10;

/** Fixed, privacy-safe prefix. Names nobody and reveals nothing the recipient
 *  does not already have in their own workspace. */
export const TELEGRAM_MESSAGE_DELIVERY_PREFIX = "Driver message:\n\n";

/** Telegram's hard sendMessage limit. The canonical CF-1 body limit is 4000,
 *  so prefix + body stays inside it; the guard below exists so that contract
 *  can never be violated silently. */
export const TELEGRAM_SEND_MESSAGE_MAX_CHARS = 4096;

/** Composes the outbound text. The driver's body is never truncated: if the
 *  prefix would push it past Telegram's limit the body is sent alone, and a
 *  body that cannot fit at all is refused rather than mutated. */
export function composeDriverMessageText(body: string): string | null {
  const text = `${TELEGRAM_MESSAGE_DELIVERY_PREFIX}${body}`;
  if (text.length <= TELEGRAM_SEND_MESSAGE_MAX_CHARS) return text;
  if (body.length <= TELEGRAM_SEND_MESSAGE_MAX_CHARS) return body;
  return null;
}

/** Drains claimed outbound driver messages. Never throws. */
export async function runTelegramMessageDeliveryDrain(
  deps: TelegramMessageDeliveryDrainDeps,
): Promise<TelegramMessageDeliveryDrainResult> {
  const log: TelegramPollLogger = deps.log ?? (() => {});
  const result: TelegramMessageDeliveryDrainResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
  };

  let claims: TelegramMessageDeliveryClaim[];
  try {
    claims = await deps.outbox.claimConversationMessageDeliveries(
      TELEGRAM_MESSAGE_DELIVERY_DRAIN_LIMIT,
    );
  } catch (error) {
    log("message_delivery_claim_failed", { code: sanitizeErrorCode(error) });
    return result;
  }

  result.claimed = claims.length;
  if (claims.length === 0) return result;

  for (const claim of claims) {
    const text = composeDriverMessageText(claim.messageBody);
    if (text === null) {
      try {
        await deps.outbox.markConversationMessageDeliveryFailed(
          claim.deliveryId,
          "message_too_long_for_telegram",
        );
      } catch (error) {
        log("message_delivery_mark_failed", { code: sanitizeErrorCode(error) });
      }
      result.failed += 1;
      continue;
    }

    let errorCode: string | null = null;
    let sentMessageId: number | null = null;
    try {
      // Plain text ONLY: no buttons, no parse_mode, nothing that could turn
      // driver content into markup.
      const sent = await deps.gateway.sendMessage({
        chatId: claim.telegramChatId,
        text,
      });
      if (!sent.ok) {
        errorCode = sent.errorCode ?? "telegram_gateway_error";
      } else {
        const id = sent.result?.message_id;
        sentMessageId =
          typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
      }
    } catch (error) {
      errorCode = sanitizeErrorCode(error);
    }

    try {
      if (errorCode === null) {
        await deps.outbox.markConversationMessageDeliverySent(
          claim.deliveryId,
          sentMessageId,
          claim.telegramChatId,
        );
        result.sent += 1;
      } else {
        await deps.outbox.markConversationMessageDeliveryFailed(
          claim.deliveryId,
          errorCode,
        );
        result.failed += 1;
        log("message_delivery_send_failed", { code: errorCode });
      }
    } catch (error) {
      // Telegram may already have delivered this message, so the row stays
      // 'claimed' and is NEVER auto-reclaimed. Delivery is never falsely
      // recorded and never duplicated.
      log("message_delivery_mark_unresolved", { deliveryId: claim.deliveryId });
      log("message_delivery_mark_failed", { code: sanitizeErrorCode(error) });
    }
  }

  log("message_delivery_drain_complete", {
    claimed: result.claimed,
    sent: result.sent,
    failed: result.failed,
  });
  return result;
}
