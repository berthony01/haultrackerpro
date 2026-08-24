/**
 * Phase TG-2E — Telegram runtime & source-of-truth reconciliation.
 *
 * Static source contract only. This suite never calls Telegram, never reads a
 * secret value, and never asserts on any decrypted credential. It proves that:
 *   1. `supabase/config.toml` declares `telegram-poll` with verify_jwt = false
 *      (the function authenticates with its own internal-secret gate).
 *   2. Exactly one source-controlled migration codifies the live
 *      `telegram-poll-every-minute` cron job, by Vault secret NAME only.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONFIG_PATH = join(process.cwd(), "supabase", "config.toml");
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const config = readFileSync(CONFIG_PATH, "utf8");

const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
const schedulerMigrations = migrationFiles.filter((file) =>
  readFileSync(join(MIGRATIONS_DIR, file), "utf8").includes("telegram-poll-every-minute"),
);
const schedulerSql =
  schedulerMigrations.length === 1
    ? readFileSync(join(MIGRATIONS_DIR, schedulerMigrations[0]), "utf8")
    : "";

describe("TG-2E — telegram-poll function config contract", () => {
  it("declares a telegram-poll function block", () => {
    expect(config).toContain("[functions.telegram-poll]");
  });

  it("sets verify_jwt = false for telegram-poll", () => {
    const block = config.slice(config.indexOf("[functions.telegram-poll]"));
    const firstSetting = block.split("\n").slice(1, 2).join("\n");
    expect(firstSetting.trim()).toBe("verify_jwt = false");
  });

  it("does not disturb the stripe-webhook contract", () => {
    expect(config).toContain("[functions.stripe-webhook]");
  });

  it("keeps process-email-queue JWT verification enabled", () => {
    const block = config.slice(config.indexOf("[functions.process-email-queue]"));
    expect(block.split("\n").slice(1, 2).join("\n").trim()).toBe("verify_jwt = true");
  });
});

describe("TG-2E — source-controlled cron scheduler contract", () => {
  it("has exactly one migration codifying the telegram poll schedule", () => {
    expect(schedulerMigrations).toHaveLength(1);
  });

  it("schedules the canonical job name on a one-minute cadence", () => {
    expect(schedulerSql).toContain("cron.schedule(");
    expect(schedulerSql).toContain("'telegram-poll-every-minute'");
    expect(schedulerSql).toContain("'* * * * *'");
  });

  it("unschedules any same-named job before scheduling, preventing duplicates", () => {
    expect(schedulerSql).toContain("cron.unschedule(");
    expect(schedulerSql.indexOf("cron.unschedule(")).toBeLessThan(
      schedulerSql.indexOf("cron.schedule("),
    );
    expect(schedulerSql).toMatch(/FROM cron\.job\s+WHERE jobname = 'telegram-poll-every-minute'/);
  });

  it("targets the live telegram-poll endpoint with the documented request shape", () => {
    expect(schedulerSql).toContain("/functions/v1/telegram-poll");
    expect(schedulerSql).toContain("net.http_post(");
    expect(schedulerSql).toContain("'Content-Type', 'application/json'");
    expect(schedulerSql).toContain("'X-HTP-Internal-Secret'");
    expect(schedulerSql).toContain("'{}'::jsonb");
    expect(schedulerSql).toContain("timeout_milliseconds := 25000");
  });

  it("resolves the internal secret at runtime by Vault name only", () => {
    expect(schedulerSql).toContain("vault.decrypted_secrets");
    expect(schedulerSql).toContain("name = 'telegram_poll_internal_secret'");
  });

  it("never embeds a literal secret or bot token", () => {
    expect(schedulerSql).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{30,}/);
    expect(schedulerSql).not.toMatch(/'X-HTP-Internal-Secret',\s*'[^']+'/);
    expect(schedulerSql).not.toContain("api.telegram.org");
  });

  it("does not create new database objects, policies, or queues", () => {
    for (const forbidden of [
      "CREATE TABLE",
      "CREATE POLICY",
      "CREATE EXTENSION",
      "CREATE TRIGGER",
      "CREATE OR REPLACE FUNCTION",
      "pgmq",
    ]) {
      expect(schedulerSql.toUpperCase()).not.toContain(forbidden.toUpperCase());
    }
  });

  it("does not mutate Telegram link, receipt, cursor, or lease state", () => {
    for (const forbidden of [
      "telegram_user_links",
      "telegram_link_tokens",
      "DELETE FROM",
      "UPDATE public.",
      "INSERT INTO",
    ]) {
      expect(schedulerSql).not.toContain(forbidden);
    }
  });
});
