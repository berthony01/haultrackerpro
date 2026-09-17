// Phase RB-1A — recruiter-aware private menu/status, plus the TG-2F-C bind
// drift-repair candidate compatibility contract.
//
// Three halves:
//   1. SQL source-contract assertions over BOTH candidates (never live);
//   2. pure classification assertions;
//   3. behavioural assertions over the SHARED orchestrator the Edge Function
//      itself runs, driven through injected fakes.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  TELEGRAM_ALLOWED_UPDATES,
  classifyUpdate,
  runTelegramPoll,
  type TelegramClassification,
  type TelegramGateway,
  type TelegramPollLedger,
  type TelegramTerminalResult,
} from "../../supabase/functions/_shared/telegram-poll-ingest.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const TG2FC_SQL = read(
  "supabase/migration-candidates/20260824114000_phase_tg2fc_dispatch_group_bind_routing.sql",
);
const RB1A_SQL = read(
  "supabase/migration-candidates/20260917050000_phase_rb1a_telegram_recruiter_actor_menu.sql",
);
const ORCHESTRATOR_SOURCE = read(
  "supabase/functions/_shared/telegram-poll-ingest.ts",
);
const EDGE_SOURCE = read("supabase/functions/telegram-poll/index.ts");

/** Executable text only — prose that merely NAMES a forbidden construct must
 *  not decide a contract assertion. */
const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TG2FC_CODE = stripSqlComments(TG2FC_SQL);
const RB1A_CODE = stripSqlComments(RB1A_SQL);
const ORCHESTRATOR_CODE = stripTsComments(ORCHESTRATOR_SOURCE);
const EDGE_CODE = stripTsComments(EDGE_SOURCE);

/** The six result codes present in the LIVE check constraint at the RB-1A
 *  start gate. Verified read-only against the live database. */
const LIVE_RESULT_CODES = [
  "link_success",
  "link_rejected",
  "non_private_message",
  "non_start_message",
  "invalid_start_command",
  "invalid_update_shape",
];

const MENU_RESULT_CODES = [
  "menu_recruiter",
  "menu_linked_no_workspace",
  "menu_unlinked",
];

// ─────────────────── A. TG-2F-C drift-repair compatibility ───────────────────

describe("TG-2F-C candidate — still compatible with the live schema", () => {
  it("is candidate-only and transactional", () => {
    expect(TG2FC_SQL).toContain("CANDIDATE ONLY — NOT APPLIED LIVE");
    expect(TG2FC_SQL).toContain("BEGIN;");
    expect(TG2FC_SQL.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("preserves every live result code and adds exactly the two bind codes", () => {
    const check = /ADD CONSTRAINT telegram_update_receipts_result_code_check[\s\S]*?\]\)\);/.exec(
      TG2FC_CODE,
    );
    expect(check).not.toBeNull();
    const values = [...check![0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...LIVE_RESULT_CODES, "bind_success", "bind_rejected"]);
  });

  it("drops only that one constraint and no table, policy or grant", () => {
    const drops = [...TG2FC_CODE.matchAll(/DROP\s+(\w+)/gi)].map((m) => m[1].toUpperCase());
    expect(drops).toEqual(["CONSTRAINT"]);
    expect(TG2FC_CODE).not.toMatch(/CREATE TABLE|CREATE POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY/i);
    expect(TG2FC_CODE).not.toMatch(/GRANT [^;]*ON TABLE/i);
  });

  it("creates exactly the one missing function the poller already calls", () => {
    const fns = [...TG2FC_CODE.matchAll(/CREATE FUNCTION public\.(\w+)/g)].map((m) => m[1]);
    expect(fns).toEqual(["telegram_process_bind_update"]);
    expect(TG2FC_CODE).not.toMatch(/CREATE OR REPLACE/i);
    expect(ORCHESTRATOR_CODE).toContain("processBindUpdate");
    expect(EDGE_CODE).toContain('supabase.rpc("telegram_process_bind_update"');
  });

  it("matches the live poller argument contract exactly", () => {
    for (const arg of [
      "_lease_token uuid",
      "_update_id bigint",
      "_payload_hash text",
      "_telegram_user_id bigint",
      "_telegram_chat_id bigint",
      "_chat_type text",
      "_raw_token text",
    ]) {
      expect(TG2FC_CODE).toContain(arg);
    }
    expect(TG2FC_CODE).toContain("SECURITY DEFINER");
    expect(TG2FC_CODE).toContain("SET search_path TO 'pg_catalog', 'public'");
    expect(TG2FC_CODE).toContain(
      "GRANT EXECUTE ON FUNCTION public.telegram_process_bind_update(uuid, bigint, text, bigint, bigint, text, text) TO service_role",
    );
  });
});

// ─────────────────────── B. RB-1A candidate SQL contract ───────────────────────

describe("RB-1A candidate SQL — bounded additive surface", () => {
  it("is candidate-only and transactional", () => {
    expect(RB1A_SQL).toContain("CANDIDATE ONLY — NOT APPLIED LIVE");
    expect(RB1A_SQL).toContain("BEGIN;");
    expect(RB1A_SQL.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("creates exactly the two authorised functions and replaces nothing", () => {
    const fns = [...RB1A_CODE.matchAll(/CREATE FUNCTION public\.(\w+)/g)].map((m) => m[1]);
    expect(fns.sort()).toEqual([
      "telegram_process_menu_update",
      "telegram_resolve_recruiter_actor",
    ]);
    expect(RB1A_CODE).not.toMatch(/CREATE OR REPLACE/i);
  });

  it("creates no table, column, index, trigger, type, view, policy or RLS change", () => {
    expect(RB1A_CODE).not.toMatch(
      /CREATE (TABLE|INDEX|UNIQUE INDEX|TRIGGER|TYPE|VIEW|SCHEMA|EXTENSION|POLICY)/i,
    );
    expect(RB1A_CODE).not.toMatch(/ADD COLUMN|DROP COLUMN|ALTER TYPE|ROW LEVEL SECURITY/i);
    expect(RB1A_CODE).not.toMatch(/GRANT [^;]*ON TABLE/i);
  });

  it("drops only the receipt result-code check and preserves every earlier code", () => {
    const drops = [...RB1A_CODE.matchAll(/DROP\s+(\w+)/gi)].map((m) => m[1].toUpperCase());
    expect(drops).toEqual(["CONSTRAINT"]);
    const check = /ADD CONSTRAINT telegram_update_receipts_result_code_check[\s\S]*?\]\)\);/.exec(
      RB1A_CODE,
    );
    const values = [...check![0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([
      ...LIVE_RESULT_CODES,
      "bind_success",
      "bind_rejected",
      ...MENU_RESULT_CODES,
    ]);
  });

  it("locks the resolver down: SECURITY DEFINER, STABLE, pinned search_path, service_role only", () => {
    expect(RB1A_CODE).toMatch(/LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER/);
    expect(RB1A_CODE).toContain("SET search_path TO 'pg_catalog', 'public', 'auth'");
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(RB1A_CODE).toContain(
        `REVOKE ALL ON FUNCTION public.telegram_resolve_recruiter_actor(bigint) FROM ${role};`,
      );
    }
    expect(RB1A_CODE).toContain(
      "GRANT EXECUTE ON FUNCTION public.telegram_resolve_recruiter_actor(bigint) TO service_role;",
    );
  });

  it("locks the menu processor down the same way", () => {
    const sig = "public.telegram_process_menu_update(uuid, bigint, text, bigint, bigint, text)";
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(RB1A_CODE).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`);
    }
    expect(RB1A_CODE).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
  });

  it("resolves the actor only through an active telegram_user_links row", () => {
    expect(RB1A_CODE).toContain("FROM public.telegram_user_links l");
    expect(RB1A_CODE).toContain("AND l.status = 'active'");
    expect(RB1A_CODE).not.toMatch(/_actor_user_id\s+uuid\s*(DEFAULT|,)?\s*\)/);
    // No caller-supplied actor override parameter anywhere.
    expect(RB1A_CODE).not.toMatch(/_actor_user_id uuid[,)]/);
  });

  it("reuses the live recruiter permission and seat-limit model rather than a role label", () => {
    expect(RB1A_CODE).toContain(
      "public.current_user_has_recruiter_permission(rp.id, 'opportunities_view')",
    );
    expect(RB1A_CODE).toContain(
      "public.current_user_has_recruiter_permission(rp.id, 'opportunities_create')",
    );
    expect(RB1A_CODE).toContain("public.recruiter_profile_can_manage_opportunities(rp.id)");
    expect(RB1A_CODE).toContain("set_config('request.jwt.claim.sub'");
    expect(RB1A_CODE).toContain(", true)");
  });

  it("is read-only with respect to recruiter, opportunity and driver data", () => {
    const writes = RB1A_CODE.match(/\b(INSERT INTO|UPDATE|DELETE FROM)\b\s+public\.(\w+)/g) ?? [];
    expect(writes).toEqual(["INSERT INTO public.telegram_update_receipts"]);
    expect(RB1A_CODE).not.toMatch(/public\.(opportunities|opportunity_applications|conversation_threads|driver_\w+|profiles)\b[\s\S]{0,40}(INSERT|UPDATE|DELETE)/i);
  });

  it("returns no contact, billing, driver or candidate field", () => {
    for (const forbidden of [
      "recruiter_email",
      "recruiter_phone",
      "company_phone",
      "company_address",
      "admin_notes",
      "stripe",
      "billing",
      "driver_",
      "candidate",
      "applications",
    ]) {
      expect(RB1A_CODE.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("stores no message text, username, chat title or raw JSON on the receipt", () => {
    const insert = /INSERT INTO public\.telegram_update_receipts[\s\S]*?\);/.exec(RB1A_CODE)![0];
    expect(insert).toContain("update_id, payload_hash, update_type");
    for (const forbidden of ["text", "username", "chat_title", "raw", "payload_json"]) {
      expect(insert).not.toContain(forbidden);
    }
  });

  it("has no catch-all handler, so infrastructure failure rolls the whole thing back", () => {
    const menuFn = /CREATE FUNCTION public\.telegram_process_menu_update[\s\S]*?\$\$;/.exec(
      RB1A_CODE,
    )![0];
    expect(menuFn).not.toMatch(/WHEN OTHERS/i);
    expect(menuFn).toContain("_chat_type IS DISTINCT FROM 'private'");
    expect(menuFn).toContain("telegram_poll_lease_invalid");
    expect(menuFn).toContain("telegram_update_conflict");
    expect(menuFn).toContain("_payload_hash !~ '^[0-9a-f]{64}$'");
  });
});

// ──────────────────────────── C. Classification ────────────────────────────

const identity = (over: Partial<{
  chatType: string | null;
  text: string | null;
  telegramUserId: number | null;
  telegramChatId: number | null;
}> = {}) =>
  ({
    updateId: 10,
    telegramUserId: 555,
    telegramChatId: 777,
    chatType: "private",
    text: null,
    ...over,
    // deno-lint-ignore no-explicit-any
  } as any);

const HEX = "a".repeat(64);

describe("RB-1A classification — menu only where authorised", () => {
  const cases: Array<[string, Parameters<typeof identity>[0], TelegramClassification]> = [
    // RB-1B re-pin: the menu classification now carries the copy selector.
    // The safety purpose is unchanged — menu ONLY in private chats, and only
    // for exactly these bare commands.
    ["bare /start in private", { text: "/start" }, { kind: "menu", command: "start" }],
    ["/status in private", { text: "/status" }, { kind: "menu", command: "status" }],
    ["/menu in private", { text: "/menu" }, { kind: "menu", command: "menu" }],
    [
      "group /menu stays non_private_message",
      { chatType: "group", text: "/menu" },
      { kind: "ignored", resultCode: "non_private_message" },
    ],
    [
      "/start <64hex> in private stays the link-token path",
      { text: `/start ${HEX}` },
      { kind: "start", rawToken: HEX },
    ],
    [
      "group /bind <64hex> stays the bind path",
      { chatType: "supergroup", text: `/bind ${HEX}` },
      { kind: "bind", rawToken: HEX, chatType: "supergroup" },
    ],
    [
      "group /start stays non_private_message",
      { chatType: "group", text: "/start" },
      { kind: "ignored", resultCode: "non_private_message" },
    ],
    [
      "group /status stays non_private_message",
      { chatType: "group", text: "/status" },
      { kind: "ignored", resultCode: "non_private_message" },
    ],
    [
      "unknown private text stays non_start_message",
      { text: "hello there" },
      { kind: "ignored", resultCode: "non_start_message" },
    ],
    [
      "/start@Bot in private keeps invalid_start_command",
      { text: "/start@HaulTrackerBot" },
      { kind: "ignored", resultCode: "invalid_start_command" },
    ],
    [
      "/start with a bad token keeps invalid_start_command",
      { text: "/start not-a-token" },
      { kind: "ignored", resultCode: "invalid_start_command" },
    ],
    [
      "missing identity stays invalid_update_shape",
      { telegramUserId: null, text: "/start" },
      { kind: "ignored", resultCode: "invalid_update_shape" },
    ],
    [
      "no text in private stays non_start_message",
      { text: null },
      { kind: "ignored", resultCode: "non_start_message" },
    ],
  ];

  for (const [name, over, expected] of cases) {
    it(name, () => {
      expect(classifyUpdate(identity(over))).toEqual(expected);
    });
  }

  it("does not expand allowed_updates and adds no callback_query handling", () => {
    expect([...TELEGRAM_ALLOWED_UPDATES]).toEqual(["message"]);
    expect(ORCHESTRATOR_CODE).not.toContain("callback_query");
    expect(EDGE_CODE).not.toContain("callback_query");
    expect(EDGE_CODE).not.toMatch(/setWebhook/i);
    // RB-1B re-pin. RB-1A forbade `reply_markup`/`inline_keyboard` outright
    // because it shipped no buttons at all. RB-1B ships URL-ONLY inline
    // buttons, so the assertion is re-pinned to the actual safety property it
    // was protecting: no callback surface, therefore no `callback_query`
    // update type and no widening of allowed_updates.
    expect(EDGE_CODE).not.toMatch(/callback_data/i);
  });
});

// ───────────────────────────── D. Orchestration ─────────────────────────────

const update = (id: number, text: string, chatType = "private") => ({
  update_id: id,
  message: {
    text,
    from: { id: 555 },
    chat: { id: 777, type: chatType },
  },
});

interface Recorder {
  calls: string[];
  advanced: number[];
}

function buildDeps(options: {
  updates: unknown[];
  menu?: () => Promise<TelegramTerminalResult>;
}) {
  const recorder: Recorder = { calls: [], advanced: [] };
  const sent: Array<{ chatId: number; text: string }> = [];

  const ledger: TelegramPollLedger = {
    claimLease: async () => ({ leaseToken: "lease-1", nextOffset: 1 }),
    releaseLease: async () => true,
    advanceCursor: async (_t, id) => {
      recorder.calls.push(`advance:${id}`);
      recorder.advanced.push(id);
      return id + 1;
    },
    recordIgnoredUpdate: async ({ resultCode }) => {
      recorder.calls.push(`ignored:${resultCode}`);
      return { isNew: true, resultCode };
    },
    processStartUpdate: async () => {
      recorder.calls.push("start");
      return { isNew: true, resultCode: "link_success" };
    },
    processBindUpdate: async () => {
      recorder.calls.push("bind");
      return { isNew: true, resultCode: "bind_success" };
    },
    processMenuUpdate: async () => {
      recorder.calls.push("menu");
      if (options.menu) return options.menu();
      return {
        isNew: true,
        resultCode: "menu_recruiter",
        menuText: "HaulTracker Pro — recruiter status\n\nAcme Freight\nRole: owner",
      };
    },
  };

  const gateway: TelegramGateway = {
    getUpdates: async () => ({ ok: true, status: 200, result: options.updates }),
    sendMessage: async (input) => {
      sent.push(input);
      recorder.calls.push("send");
      return { ok: true, status: 200 };
    },
  };

  return { ledger, gateway, recorder, sent };
}

const sha256 = async (input: string) =>
  [...input].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(64, "0")
    .slice(0, 64);

describe("RB-1A orchestration — receipt before cursor, bounded reply", () => {
  it("routes bare /start in private to the menu processor", async () => {
    const deps = buildDeps({ updates: [update(1, "/start")] });
    const result = await runTelegramPoll({ ...deps, sha256 });
    expect(result).toMatchObject({ kind: "ok", processed: 1 });
    expect(deps.recorder.calls).toEqual(["menu", "send", "advance:1"]);
  });

  it("routes /status in private to the menu processor", async () => {
    const deps = buildDeps({ updates: [update(2, "/status")] });
    await runTelegramPoll({ ...deps, sha256 });
    expect(deps.recorder.calls[0]).toBe("menu");
  });

  it("writes the terminal receipt before advancing the cursor", async () => {
    const deps = buildDeps({ updates: [update(3, "/status")] });
    await runTelegramPoll({ ...deps, sha256 });
    expect(deps.recorder.calls.indexOf("menu")).toBeLessThan(
      deps.recorder.calls.indexOf("advance:3"),
    );
  });

  it("does not advance the cursor when menu processing fails", async () => {
    const deps = buildDeps({
      updates: [update(4, "/start"), update(5, "/status")],
      menu: async () => {
        throw new Error("telegram_poll_lease_invalid");
      },
    });
    const result = await runTelegramPoll({ ...deps, sha256 });
    expect(result).toMatchObject({
      kind: "failed",
      errorCode: "telegram_poll_lease_invalid",
      processed: 0,
      advancedTo: null,
    });
    expect(deps.recorder.advanced).toEqual([]);
  });

  it("sends exactly the adapter-composed text and nothing else", async () => {
    const deps = buildDeps({
      updates: [update(6, "/start")],
      menu: async () => ({
        isNew: true,
        resultCode: "menu_unlinked",
        menuText: "Your Telegram account is not connected to HaulTracker Pro.",
      }),
    });
    await runTelegramPoll({ ...deps, sha256 });
    expect(deps.sent).toEqual([
      {
        chatId: 777,
        text: "Your Telegram account is not connected to HaulTracker Pro.",
      },
    ]);
  });

  it("sends nothing on an idempotent replay", async () => {
    const deps = buildDeps({
      updates: [update(7, "/status")],
      menu: async () => ({
        isNew: false,
        resultCode: "menu_recruiter",
        menuText: "whatever",
      }),
    });
    await runTelegramPoll({ ...deps, sha256 });
    expect(deps.sent).toEqual([]);
    expect(deps.recorder.advanced).toEqual([7]);
  });

  it("leaves the start and bind paths byte-for-byte behaviourally intact", async () => {
    const deps = buildDeps({
      updates: [update(8, `/start ${HEX}`), update(9, `/bind ${HEX}`, "group")],
    });
    await runTelegramPoll({ ...deps, sha256 });
    expect(deps.recorder.calls).toEqual([
      "start",
      "send",
      "advance:8",
      "bind",
      "send",
      "advance:9",
    ]);
  });
});

// ─────────────────────────── E. Adapter privacy shape ───────────────────────────

describe("RB-1A adapter — privacy and transport shape", () => {
  it("adds exactly one ledger RPC for the menu", () => {
    expect(EDGE_CODE).toContain('supabase.rpc("telegram_process_menu_update"');
    const rpcs = [...EDGE_CODE.matchAll(/supabase\.rpc\("(\w+)"/g)].map((m) => m[1]);
    expect(rpcs.filter((r) => r === "telegram_process_menu_update")).toHaveLength(1);
    expect(rpcs).toContain("telegram_process_start_update");
    expect(rpcs).toContain("telegram_process_bind_update");
    expect(rpcs).not.toContain("telegram_resolve_recruiter_actor");
  });

  it("composes text with no callback surface and no candidate or contact data", () => {
    expect(EDGE_CODE).toContain("composeMenuText");
    expect(EDGE_CODE).not.toMatch(/parse_mode|callback_data|callback_query/i);
    // RB-1B re-pin. The original list included the literal word "driver",
    // which RB-1B legitimately uses as a RESULT-CODE name (`menu_driver`).
    // The protected property was never the word — it was that no candidate,
    // applicant or contact data reaches the composed reply. That is what is
    // asserted here, and it is asserted more strictly than before.
    const menuBlock = /function composeMenuText[\s\S]*?\n}/.exec(EDGE_CODE)![0];
    for (const forbidden of [
      "candidate",
      "applicant",
      "email",
      "phone",
      "driver_name",
      "user_id",
      "telegram_user_id",
    ]) {
      expect(menuBlock.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("logs fixed codes, ids and counts only — never text, names or counts of records", () => {
    const logCalls = [...EDGE_CODE.matchAll(/\blog\(([^)]*)\)/g)].map((m) => m[1]);
    for (const call of logCalls) {
      expect(call).not.toMatch(/menuText|workspace_name|username|rawToken|text:/);
    }
    expect(EDGE_CODE).not.toMatch(/console\.log\([^)]*menuText/);
  });

  it("keeps the connector-gateway credential boundary untouched", () => {
    expect(EDGE_CODE).toContain("https://connector-gateway.lovable.dev/telegram");
    expect(EDGE_CODE).not.toMatch(/api\.telegram\.org/);
    expect(EDGE_CODE).not.toMatch(/setWebhook/);
  });
});
