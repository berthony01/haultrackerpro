// Phase RB-1B — role-aware Telegram bot home (/start, /menu, /status).
//
// Four parts:
//   A. SQL source contract over the RB-1B candidate (never live);
//   B. pure command classification;
//   C. orchestration behaviour through the SHARED orchestrator, driven by
//      injected fakes — the Edge Function runs this exact code path;
//   D. adapter source contract: URL-only buttons to routes that really exist,
//      no callback surface, no PII.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  TELEGRAM_ALLOWED_UPDATES,
  TELEGRAM_MENU_RESULT_CODES,
  classifyUpdate,
  isMenuResultCode,
  runTelegramPoll,
  type TelegramClassification,
  type TelegramGateway,
  type TelegramInlineButton,
  type TelegramMenuCommand,
  type TelegramPollLedger,
  type TelegramResultCode,
  type TelegramTerminalResult,
} from "../../supabase/functions/_shared/telegram-poll-ingest.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const RB1B_SQL = read(
  "supabase/migration-candidates/20260918040000_phase_rb1b_telegram_account_role_home.sql",
);
const ORCHESTRATOR_SOURCE = read(
  "supabase/functions/_shared/telegram-poll-ingest.ts",
);
const EDGE_SOURCE = read("supabase/functions/telegram-poll/index.ts");
const APP_ROUTER_SOURCE = read("src/App.tsx");

/** Executable text only — prose that merely NAMES a construct must never
 *  decide a contract assertion. */
const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RB1B_CODE = stripSqlComments(RB1B_SQL);
const ORCHESTRATOR_CODE = stripTsComments(ORCHESTRATOR_SOURCE);
const EDGE_CODE = stripTsComments(EDGE_SOURCE);

/** Exactly the eleven codes live in the constraint at the RB-1B start gate. */
const PRE_RB1B_RESULT_CODES = [
  "link_success",
  "link_rejected",
  "non_private_message",
  "non_start_message",
  "invalid_start_command",
  "invalid_update_shape",
  "bind_success",
  "bind_rejected",
  "menu_recruiter",
  "menu_linked_no_workspace",
  "menu_unlinked",
];

const RB1B_NEW_RESULT_CODES = [
  "menu_driver",
  "menu_multi_role",
  "menu_linked_unsupported",
];

// ─────────────────────────── A. SQL source contract ───────────────────────────

describe("RB-1B A — candidate is one narrow, additive migration", () => {
  it("1) is a single transaction", () => {
    const lines = RB1B_CODE.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines.filter((l) => l === "BEGIN;")).toHaveLength(1);
    expect(lines.filter((l) => l === "COMMIT;")).toHaveLength(1);
    expect(lines[0]).toBe("BEGIN;");
    expect(lines[lines.length - 1]).toBe("COMMIT;");
  });

  it("2) creates no table, policy, RLS change, enum, trigger or index", () => {
    const upper = RB1B_CODE.toUpperCase();
    for (const forbidden of [
      "CREATE TABLE",
      "DROP TABLE",
      "CREATE POLICY",
      "DROP POLICY",
      "ALTER POLICY",
      "ROW LEVEL SECURITY",
      "CREATE TYPE",
      "ALTER TYPE",
      "CREATE TRIGGER",
      "DROP TRIGGER",
      "CREATE INDEX",
      "DROP INDEX",
      "INSERT INTO PUBLIC.PROFILES",
      "DELETE FROM",
      "TRUNCATE",
    ]) {
      expect(upper).not.toContain(forbidden);
    }
  });

  it("3) touches exactly two functions: the new resolver and the menu processor", () => {
    const created = [
      ...RB1B_CODE.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(public\.[a-z_]+)/gi),
    ].map((m) => m[1]);
    expect(created.sort()).toEqual([
      "public.telegram_process_menu_update",
      "public.telegram_resolve_account_role",
    ]);
  });

  it("4) extends the result-code constraint additively, retaining all prior codes", () => {
    expect(
      (RB1B_CODE.match(/DROP CONSTRAINT telegram_update_receipts_result_code_check/g) ?? [])
        .length,
    ).toBe(1);
    for (const code of [...PRE_RB1B_RESULT_CODES, ...RB1B_NEW_RESULT_CODES]) {
      expect(RB1B_CODE).toContain(`'${code}'`);
    }
  });

  it("5) the resolver is STABLE, SECURITY DEFINER and pins search_path", () => {
    const fn = /CREATE FUNCTION public\.telegram_resolve_account_role[\s\S]*?\$\$;/.exec(
      RB1B_CODE,
    )![0];
    expect(fn).toContain("STABLE");
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toMatch(/SET search_path TO 'pg_catalog', 'public', 'auth'/);
  });

  it("6) the resolver returns a role signal only — never identity or contact data", () => {
    const fn = /CREATE FUNCTION public\.telegram_resolve_account_role[\s\S]*?\$\$;/.exec(
      RB1B_CODE,
    )![0];
    expect(fn).toMatch(/RETURNS text/);
    for (const forbidden of ["email", "phone", "stripe", "subscription", "billing"]) {
      expect(fn.toLowerCase()).not.toContain(forbidden);
    }
    // The auth user id is resolved internally but must never be returned.
    expect(fn).not.toMatch(/RETURN\s+_actor_user_id/);
  });

  it("7) both functions are service_role-only: PUBLIC, anon and authenticated revoked", () => {
    for (const sig of [
      "public.telegram_resolve_account_role(bigint)",
      "public.telegram_process_menu_update(uuid, bigint, text, bigint, bigint, text)",
    ]) {
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(RB1B_CODE).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`);
      }
      expect(RB1B_CODE).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
      expect(RB1B_CODE).not.toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`);
      expect(RB1B_CODE).not.toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO anon;`);
    }
  });

  it("8) the menu processor keeps its exact RB-1A signature and return shape", () => {
    expect(RB1B_CODE).toContain(
      "CREATE OR REPLACE FUNCTION public.telegram_process_menu_update(",
    );
    expect(RB1B_CODE).toContain(
      "RETURNS TABLE(is_new boolean, result_code text, workspaces jsonb)",
    );
    // The bare command is presentation-only and must NOT become a database
    // input, or it would become an authorization surface.
    expect(RB1B_CODE).not.toMatch(/_command\s+text/);
  });

  it("9) preserves the lease, receipt-lock and single-insert idempotency semantics", () => {
    const fn = /CREATE OR REPLACE FUNCTION public\.telegram_process_menu_update[\s\S]*?\$\$;/
      .exec(RB1B_CODE)![0];
    expect(fn).toContain("telegram_poll_lease_invalid");
    expect(fn).toContain("telegram_update_invalid");
    expect(fn).toContain("telegram_update_conflict");
    expect(fn).toContain("FOR UPDATE");
    expect((fn.match(/INSERT INTO public\.telegram_update_receipts/g) ?? [])).toHaveLength(1);
    expect(fn).toMatch(/_chat_type IS DISTINCT FROM 'private'/);
    // Every menu outcome must be replay-recognised, or a duplicate update
    // would raise a conflict and stall the cursor.
    for (const code of ["menu_driver", "menu_multi_role", "menu_linked_unsupported"]) {
      const replayBlock = /IF FOUND THEN[\s\S]*?RAISE EXCEPTION 'telegram_update_conflict'/.exec(fn)![0];
      expect(replayBlock).toContain(`'${code}'`);
    }
  });

  it("10) recruiter workspace capability outranks declared intent", () => {
    const fn = /CREATE OR REPLACE FUNCTION public\.telegram_process_menu_update[\s\S]*?\$\$;/
      .exec(RB1B_CODE)![0];
    // With workspaces: driver intent => multi-role, everything else recruiter.
    expect(fn).toMatch(
      /jsonb_array_length\(_workspaces\) > 0 THEN[\s\S]*?WHEN _account_role = 'driver' THEN 'menu_multi_role'[\s\S]*?ELSE 'menu_recruiter'/,
    );
    // Without workspaces: a declared recruiter NEVER gets a recruiter menu.
    expect(fn).toMatch(/WHEN _account_role = 'recruiter' THEN 'menu_linked_no_workspace'/);
    expect(fn).toMatch(/WHEN _account_role = 'driver' THEN 'menu_driver'/);
    expect(fn).toMatch(/ELSE 'menu_linked_unsupported'/);
  });

  it("11) reuses the existing recruiter resolver and invents no parallel role store", () => {
    expect(RB1B_CODE).toContain("public.telegram_resolve_recruiter_actor(_telegram_user_id)");
    expect(RB1B_CODE).toContain("public.telegram_resolve_account_role(_telegram_user_id)");
    for (const forbidden of ["bot_role", "bot_roles", "telegram_roles", "bot_entitlement"]) {
      expect(RB1B_CODE).not.toContain(forbidden);
    }
  });

  it("12) never returns workspace data for a non-recruiter outcome", () => {
    expect(RB1B_CODE).toContain(
      "IF _outcome NOT IN ('menu_recruiter', 'menu_multi_role') THEN",
    );
  });
});

// ───────────────────────── B. Command classification ─────────────────────────

const identity = (over: Record<string, unknown>) =>
  ({
    updateId: 1,
    telegramUserId: 555,
    telegramChatId: 777,
    chatType: "private",
    text: null,
    ...over,
    // deno-lint-ignore no-explicit-any
  }) as any;

const HEX = "b".repeat(64);

describe("RB-1B B — the three bare private commands are distinguished", () => {
  const cases: Array<[string, Record<string, unknown>, TelegramClassification]> = [
    ["/start", { text: "/start" }, { kind: "menu", command: "start" }],
    ["/menu", { text: "/menu" }, { kind: "menu", command: "menu" }],
    ["/status", { text: "/status" }, { kind: "menu", command: "status" }],
  ];
  for (const [name, over, expected] of cases) {
    it(`classifies bare ${name} in private`, () => {
      expect(classifyUpdate(identity(over))).toEqual(expected);
    });
  }

  it("leaves /start <64hex> on the untouched linking path", () => {
    expect(classifyUpdate(identity({ text: `/start ${HEX}` }))).toEqual({
      kind: "start",
      rawToken: HEX,
    });
  });

  it("leaves group /bind <64hex> on the untouched bind path", () => {
    expect(
      classifyUpdate(identity({ chatType: "supergroup", text: `/bind ${HEX}` })),
    ).toEqual({ kind: "bind", rawToken: HEX, chatType: "supergroup" });
  });

  it("never exposes a menu in a group chat", () => {
    for (const text of ["/start", "/menu", "/status"]) {
      for (const chatType of ["group", "supergroup", "channel"]) {
        expect(classifyUpdate(identity({ chatType, text }))).toEqual({
          kind: "ignored",
          resultCode: "non_private_message",
        });
      }
    }
  });

  it("ignores unknown text and addressed variants rather than answering them", () => {
    expect(classifyUpdate(identity({ text: "hello" }))).toEqual({
      kind: "ignored",
      resultCode: "non_start_message",
    });
    expect(classifyUpdate(identity({ text: "/menu@HaulTrackerBot" }))).toEqual({
      kind: "ignored",
      resultCode: "non_start_message",
    });
    expect(classifyUpdate(identity({ text: "/menu extra" }))).toEqual({
      kind: "ignored",
      resultCode: "non_start_message",
    });
  });

  it("keeps allowed_updates at message only and grows no callback surface", () => {
    expect([...TELEGRAM_ALLOWED_UPDATES]).toEqual(["message"]);
    for (const source of [ORCHESTRATOR_CODE, EDGE_CODE]) {
      expect(source).not.toContain("callback_query");
      expect(source).not.toContain("callback_data");
      expect(source).not.toMatch(/setWebhook|deleteWebhook/i);
    }
  });

  it("recognises exactly the six menu result codes", () => {
    expect([...TELEGRAM_MENU_RESULT_CODES].sort()).toEqual(
      [...PRE_RB1B_RESULT_CODES.filter((c) => c.startsWith("menu_")), ...RB1B_NEW_RESULT_CODES]
        .sort(),
    );
    for (const code of TELEGRAM_MENU_RESULT_CODES) {
      expect(isMenuResultCode(code)).toBe(true);
    }
    for (const code of ["link_success", "bind_success", "non_private_message"]) {
      expect(isMenuResultCode(code as TelegramResultCode)).toBe(false);
    }
  });
});

// ─────────────────────────── C. Orchestration ───────────────────────────

const update = (id: number, text: string, chatType = "private") => ({
  update_id: id,
  message: { text, from: { id: 555 }, chat: { id: 777, type: chatType } },
});

function buildDeps(options: {
  updates: unknown[];
  menu?: (command: TelegramMenuCommand) => TelegramTerminalResult;
}) {
  const calls: string[] = [];
  const commands: TelegramMenuCommand[] = [];
  const sent: Array<{
    chatId: number;
    text: string;
    // RB-2B. The gateway signature widened to allow callback rows. RB-1B menu
    // keyboards are still asserted to be URL-only below; this only lets the
    // fake accept the same input the real gateway does.
    buttons?: TelegramInlineButton[][] | null;
  }> = [];

  const ledger: TelegramPollLedger = {
    claimLease: async () => ({ leaseToken: "lease-1", nextOffset: 1 }),
    releaseLease: async () => true,
    advanceCursor: async (_t, id) => {
      calls.push(`advance:${id}`);
      return id + 1;
    },
    recordIgnoredUpdate: async ({ resultCode }) => {
      calls.push(`ignored:${resultCode}`);
      return { isNew: true, resultCode };
    },
    processStartUpdate: async () => {
      calls.push("start");
      return { isNew: true, resultCode: "link_success" };
    },
    processBindUpdate: async () => {
      calls.push("bind");
      return { isNew: true, resultCode: "bind_success" };
    },
    processMenuUpdate: async ({ command }) => {
      calls.push("menu");
      commands.push(command);
      return (
        options.menu?.(command) ?? {
          isNew: true,
          resultCode: "menu_driver",
          menuText: "HaulTracker Pro — menu",
          menuButtons: [[{ text: "🔎 Find Work", url: "https://haultrackerpro.com/find-work" }]],
        }
      );
    },
  };

  const gateway: TelegramGateway = {
    getUpdates: async () => ({ ok: true, status: 200, result: options.updates }),
    sendMessage: async (input) => {
      sent.push(input);
      calls.push("send");
      return { ok: true, status: 200 };
    },
  };

  return { ledger, gateway, calls, commands, sent };
}

const sha256 = async (input: string) =>
  [...input]
    .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(64, "0")
    .slice(0, 64);

describe("RB-1B C — orchestration carries the command and the buttons", () => {
  it("forwards each bare command to the menu processor unchanged", async () => {
    const deps = buildDeps({
      updates: [update(1, "/start"), update(2, "/menu"), update(3, "/status")],
    });
    const result = await runTelegramPoll({ ...deps, sha256 });
    expect(result).toMatchObject({ kind: "ok", processed: 3 });
    expect(deps.commands).toEqual(["start", "menu", "status"]);
  });

  it("writes the terminal receipt before advancing the cursor", async () => {
    const deps = buildDeps({ updates: [update(4, "/menu")] });
    await runTelegramPoll({ ...deps, sha256 });
    expect(deps.calls).toEqual(["menu", "send", "advance:4"]);
  });

  it("sends the adapter's URL-only buttons through to the gateway", async () => {
    const deps = buildDeps({
      updates: [update(5, "/menu")],
      menu: () => ({
        isNew: true,
        resultCode: "menu_multi_role",
        menuText: "HaulTracker Pro — menu",
        menuButtons: [
          [{ text: "🔎 Find Work", url: "https://haultrackerpro.com/find-work" }],
          [{ text: "📋 My Opportunities", url: "https://haultrackerpro.com/dashboard" }],
        ],
      }),
    });
    await runTelegramPoll({ ...deps, sha256 });
    expect(deps.sent).toHaveLength(1);
    expect(deps.sent[0].buttons).toHaveLength(2);
    for (const row of deps.sent[0].buttons!) {
      for (const button of row) {
        expect(button.url).toMatch(/^https:\/\//);
        expect(Object.keys(button).sort()).toEqual(["text", "url"]);
      }
    }
  });

  it("sends no buttons when the adapter supplies none", async () => {
    const deps = buildDeps({
      updates: [update(6, "/status")],
      menu: () => ({
        isNew: true,
        resultCode: "menu_linked_unsupported",
        menuText: "Your HaulTracker Pro account is connected.",
        menuButtons: null,
      }),
    });
    await runTelegramPoll({ ...deps, sha256 });
    expect(deps.sent[0].buttons).toBeUndefined();
  });

  it("is idempotent: a replayed update replies once and still advances", async () => {
    const deps = buildDeps({
      updates: [update(7, "/menu")],
      menu: () => ({
        isNew: false,
        resultCode: "menu_driver",
        menuText: "HaulTracker Pro — menu",
        menuButtons: [[{ text: "🔎 Find Work", url: "https://haultrackerpro.com/find-work" }]],
      }),
    });
    await runTelegramPoll({ ...deps, sha256 });
    expect(deps.sent).toHaveLength(0);
    expect(deps.calls).toEqual(["menu", "advance:7"]);
  });

  it("keeps /start <64hex> linking and group /bind off the menu path", async () => {
    const deps = buildDeps({
      updates: [update(8, `/start ${HEX}`), update(9, `/bind ${HEX}`, "supergroup")],
    });
    await runTelegramPoll({ ...deps, sha256 });
    expect(deps.calls.filter((c) => c === "menu")).toHaveLength(0);
    expect(deps.calls).toContain("start");
    expect(deps.calls).toContain("bind");
  });

  it("never replies to a group menu attempt", async () => {
    const deps = buildDeps({ updates: [update(10, "/status", "group")] });
    await runTelegramPoll({ ...deps, sha256 });
    expect(deps.calls).toEqual(["ignored:non_private_message", "advance:10"]);
    expect(deps.sent).toHaveLength(0);
  });

  it("a failed reply never makes a processed update look unprocessed", async () => {
    const deps = buildDeps({ updates: [update(11, "/menu")] });
    deps.gateway.sendMessage = async () => ({
      ok: false,
      status: 400,
      errorCode: "telegram_bot_api_error",
    });
    const result = await runTelegramPoll({ ...deps, sha256 });
    expect(result).toMatchObject({ kind: "ok", processed: 1, advancedTo: 12 });
  });
});

// ─────────────────── D. Adapter: real routes, no callbacks, no PII ───────────────────

describe("RB-1B D — every button points at a route that already exists", () => {
  const buttonUrls = [...EDGE_CODE.matchAll(/url:\s*(URL_[A-Z_]+)/g)].map((m) => m[1]);
  const urlConstants = Object.fromEntries(
    [...EDGE_CODE.matchAll(/const (URL_[A-Z_]+) = `\$\{APP_BASE_URL\}([^`]*)`/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );

  it("defines at least one button and resolves every one to a constant", () => {
    expect(buttonUrls.length).toBeGreaterThan(0);
    for (const name of buttonUrls) {
      expect(urlConstants[name]).toBeDefined();
    }
  });

  it("uses the production base URL and no hardcoded second host", () => {
    expect(EDGE_CODE).toContain('const APP_BASE_URL = "https://haultrackerpro.com"');
    expect(EDGE_CODE).not.toMatch(/https:\/\/(?!haultrackerpro\.com|connector-gateway)/);
  });

  it("every destination path is declared in the app router", () => {
    for (const name of new Set(buttonUrls)) {
      const basePath = urlConstants[name].split("?")[0];
      expect(APP_ROUTER_SOURCE).toContain(`path="${basePath}"`);
    }
  });

  it("promises no button whose route does not exist", () => {
    // These labels were considered and deliberately dropped because no
    // matching route exists. Re-adding one as a BUTTON is a regression. The
    // words may still appear in prose (for example telling a user where to
    // find the connection link), which is why only labels are inspected.
    const labels = [...EDGE_CODE.matchAll(/\{\s*text:\s*"([^"]+)",\s*url:/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(0);
    for (const absent of ["Post Opportunity", "Settings", "Recruiter Chats"]) {
      expect(labels.some((l) => l.includes(absent))).toBe(false);
    }
  });

  it("gives each capability group its own menu copy", () => {
    expect(EDGE_CODE).toContain("RECRUITER_MENU_TEXT");
    expect(EDGE_CODE).toContain("COMBINED_MENU_TEXT");
    // A recruiter-only account must never be shown the work-seeking menu.
    expect(EDGE_CODE).toMatch(
      /resultCode === "menu_recruiter"[\s\S]*?command === "menu"\) return RECRUITER_MENU_TEXT/,
    );
    expect(EDGE_CODE).toMatch(
      /resultCode === "menu_multi_role"[\s\S]*?command === "menu"\) return COMBINED_MENU_TEXT/,
    );
  });

  it("calls only the menu RPC and never the resolvers directly", () => {
    const rpcs = [...EDGE_CODE.matchAll(/supabase\.rpc\("(\w+)"/g)].map((m) => m[1]);
    expect(rpcs).toContain("telegram_process_menu_update");
    expect(rpcs).not.toContain("telegram_resolve_recruiter_actor");
    expect(rpcs).not.toContain("telegram_resolve_account_role");
  });

  it("leaks no identifier or contact data into a composed reply", () => {
    const block = /const APP_BASE_URL[\s\S]*?^}\n/m.exec(EDGE_CODE)?.[0] ?? EDGE_CODE;
    for (const forbidden of [
      "telegram_user_id",
      "user_id",
      "candidate",
      "applicant",
      "email",
      "phone",
      "auth.uid",
    ]) {
      expect(block.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("keeps the connector-gateway credential boundary intact", () => {
    expect(EDGE_CODE).toContain("https://connector-gateway.lovable.dev/telegram");
    expect(EDGE_CODE).not.toMatch(/api\.telegram\.org/);
    expect(EDGE_CODE).not.toMatch(/bot_token|TELEGRAM_BOT_TOKEN/);
  });
});
