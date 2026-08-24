import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Phase TG-SEC-1 — Telegram credential boundary regression guard.
// Static source assertions only: no network, no database, no secret access.

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const POLLER_PATH = "supabase/functions/telegram-poll/index.ts";
const SCHEDULER_PATH =
  "supabase/migrations/20260824035228_d573e59f-7cd6-4251-a9fb-7c7bd7d70e52.sql";
const CONFIG_PATH = "supabase/config.toml";

const poller = read(POLLER_PATH);
const scheduler = read(SCHEDULER_PATH);
const config = read(CONFIG_PATH);

// Conservative structural shapes. Built from fragments so no scanner-triggering
// example value exists anywhere in this file.
const JWT_SHAPE = new RegExp(
  ["ey", "J[A-Za-z0-9_-]{10,}", "\\.", "[A-Za-z0-9_-]{10,}", "\\.", "[A-Za-z0-9_-]{10,}"].join(""),
);
const BOT_TOKEN_SHAPE = /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/;
const BEARER_LITERAL = /Bearer\s+(?!\$\{)[A-Za-z0-9._-]{16,}/;
const SECRET_ASSIGNMENT_LITERAL =
  /(LOVABLE_API_KEY|TELEGRAM_API_KEY|TELEGRAM_POLL_INTERNAL_SECRET)\s*[:=]\s*["'`][^"'`$\n]{8,}["'`]/;

describe("TG-SEC-1 A — poller reads credentials by environment NAME only", () => {
  const requiredNames = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TELEGRAM_POLL_INTERNAL_SECRET",
    "LOVABLE_API_KEY",
    "TELEGRAM_API_KEY",
  ];

  it.each(requiredNames)("resolves %s through Deno.env.get", (name) => {
    expect(poller).toContain(`Deno.env.get("${name}")`);
  });

  it("contains no hardcoded credential assignment", () => {
    expect(SECRET_ASSIGNMENT_LITERAL.test(poller)).toBe(false);
  });
});

describe("TG-SEC-1 B — no credential-shaped literals in poller or scheduler", () => {
  it("poller has no JWT-shaped literal", () => {
    expect(JWT_SHAPE.test(poller)).toBe(false);
  });

  it("poller has no Telegram bot-token-shaped literal", () => {
    expect(BOT_TOKEN_SHAPE.test(poller)).toBe(false);
  });

  it("scheduler migration has no JWT-shaped literal", () => {
    expect(JWT_SHAPE.test(scheduler)).toBe(false);
  });

  it("scheduler migration has no Telegram bot-token-shaped literal", () => {
    expect(BOT_TOKEN_SHAPE.test(scheduler)).toBe(false);
  });
});

describe("TG-SEC-1 C — inbound scheduler auth is the purpose-scoped internal secret", () => {
  it("reads the X-HTP-Internal-Secret request header", () => {
    expect(poller).toContain('req.headers.get("X-HTP-Internal-Secret")');
  });

  it("compares the presented secret against the internal secret", () => {
    expect(poller).toMatch(/safeEqual\(\s*presentedSecret\s*,\s*internalSecret\s*\)/);
    expect(poller).toContain('Deno.env.get("TELEGRAM_POLL_INTERNAL_SECRET")');
  });

  it("never authenticates inbound calls with an Authorization/Bearer service-role check", () => {
    expect(poller).not.toMatch(/headers\.get\(\s*["'`][Aa]uthorization["'`]\s*\)/);
    expect(poller).not.toMatch(/Bearer\s*\$\{\s*serviceRoleKey\s*\}/);
    expect(poller).not.toMatch(/Bearer\s*\$\{[^}]*SERVICE_ROLE[^}]*\}/);
  });
});

describe("TG-SEC-1 D — service-role key stays on the internal DB client", () => {
  it("is used to construct the internal Supabase client", () => {
    expect(poller).toMatch(/createClient\(\s*supabaseUrl\s*,\s*serviceRoleKey/);
  });

  it("never appears in outbound fetch headers", () => {
    const fetchBlocks = poller.match(/fetch\([\s\S]*?\}\);/g) ?? [];
    expect(fetchBlocks.length).toBeGreaterThan(0);
    for (const block of fetchBlocks) {
      expect(block).not.toContain("serviceRoleKey");
      expect(block).not.toContain("SERVICE_ROLE");
    }
  });

  it("never appears in a response body or a log call", () => {
    const emitters = poller.match(/(?:json|log|console\.log)\([\s\S]*?\);/g) ?? [];
    expect(emitters.length).toBeGreaterThan(0);
    for (const emitter of emitters) {
      expect(emitter).not.toContain("serviceRoleKey");
    }
  });
});

describe("TG-SEC-1 E — connector gateway auth is dynamic only", () => {
  it("sends the Lovable API key via template interpolation", () => {
    expect(poller).toMatch(/Authorization:\s*`Bearer \$\{lovableApiKey\}`/);
  });

  it("sends the connection key via the X-Connection-Api-Key header variable", () => {
    expect(poller).toMatch(/"X-Connection-Api-Key":\s*connectionKey/);
  });

  it("contains no static Bearer credential literal", () => {
    expect(BEARER_LITERAL.test(poller)).toBe(false);
  });
});

describe("TG-SEC-1 F — poller never touches the Telegram host or webhook surface", () => {
  it("uses only the Lovable connector gateway base URL", () => {
    expect(poller).toContain('const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram"');
  });

  it.each(["api.telegram.org", "setWebhook", "deleteWebhook", "secret_token", "bot_token"])(
    "does not reference %s",
    (needle) => {
      expect(poller).not.toContain(needle);
    },
  );
});

describe("TG-SEC-1 G — scheduler resolves the secret from Vault by name", () => {
  it("selects the decrypted secret from vault.decrypted_secrets by name", () => {
    expect(scheduler).toMatch(
      /FROM\s+vault\.decrypted_secrets\s+WHERE\s+name\s*=\s*'telegram_poll_internal_secret'/i,
    );
  });

  it("passes the Vault lookup as the X-HTP-Internal-Secret header", () => {
    expect(scheduler).toContain("'X-HTP-Internal-Secret'");
    expect(scheduler).not.toMatch(/'X-HTP-Internal-Secret'\s*,\s*'[^']+'/);
  });

  it("has no Authorization header and no direct Telegram host", () => {
    expect(scheduler).not.toMatch(/authorization/i);
    expect(scheduler).not.toContain("api.telegram.org");
  });

  it("has no literal credential assignment", () => {
    expect(SECRET_ASSIGNMENT_LITERAL.test(scheduler)).toBe(false);
    expect(BEARER_LITERAL.test(scheduler)).toBe(false);
  });

  it("targets the telegram-poll function endpoint", () => {
    expect(scheduler).toContain("/functions/v1/telegram-poll");
  });
});

describe("TG-SEC-1 H — config declares the function and source fails closed", () => {
  it("declares [functions.telegram-poll] with verify_jwt = false", () => {
    expect(config).toMatch(/\[functions\.telegram-poll\][\s\S]{0,80}?verify_jwt\s*=\s*false/);
  });

  it("returns 503 when the internal secret or platform env is missing", () => {
    expect(poller).toMatch(
      /if\s*\(!supabaseUrl\s*\|\|\s*!serviceRoleKey\s*\|\|\s*!internalSecret\)/,
    );
    expect(poller).toContain('json({ error: "telegram_poll_not_configured" }, 503)');
  });

  it("returns 401 when the presented secret does not match", () => {
    expect(poller).toContain('json({ error: "unauthorized" }, 401)');
  });

  it("fails closed with no network activity when connector credentials are absent", () => {
    expect(poller).toMatch(/if\s*\(!lovableApiKey\s*\|\|\s*!telegramConnectionKey\)/);
    expect(poller).toContain('json({ error: "telegram_connection_not_configured" }, 503)');
  });
});

describe("TG-SEC-1 I — credential variables are never logged or returned", () => {
  const credentialVariables = [
    "serviceRoleKey",
    "lovableApiKey",
    "telegramConnectionKey",
    "internalSecret",
    "presentedSecret",
  ];

  const emitters = poller.match(/(?:json|log|console\.log)\([\s\S]*?\);/g) ?? [];

  it("finds emitter call sites to inspect", () => {
    expect(emitters.length).toBeGreaterThan(0);
  });

  it.each(credentialVariables)("%s is absent from every log/response emitter", (variable) => {
    for (const emitter of emitters) {
      expect(emitter).not.toContain(variable);
    }
  });

  it("logs only fixed step codes plus a scalar details record", () => {
    expect(poller).toMatch(
      /const log = \(step: string, details\?: Record<string, string \| number \| boolean>\)/,
    );
  });

  it("discards the gateway error body instead of logging or returning it", () => {
    expect(poller).toMatch(/await response\.text\(\)\.catch\(\(\) => ""\);/);
  });
});
