/**
 * Phase TG-2E3-A — Telegram account-linking UI candidate.
 *
 * Source-contract assertions (established low-cost pattern in this project).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isValidTelegramLinkToken,
  buildTelegramDeepLink,
  TELEGRAM_BOT_USERNAME,
  TELEGRAM_DEEP_LINK_PREFIX,
} from '@/hooks/useTelegramLink';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const HOOK_PATH = 'src/hooks/useTelegramLink.ts';
const SECTION_PATH = 'src/components/TelegramConnectionSection.tsx';
const DRIVER_SETTINGS_PATH = 'src/components/SettingsView.tsx';
const RECRUITER_SETTINGS_PATH = 'src/components/opportunities/recruiter/RecruiterSettingsView.tsx';

const hook = read(HOOK_PATH);
const section = read(SECTION_PATH);
const driverSettings = read(DRIVER_SETTINGS_PATH);
const recruiterSettings = read(RECRUITER_SETTINGS_PATH);
const both = `${hook}\n${section}`;

describe('TG-2E3-A — RPC surface', () => {
  it('uses only the two existing live TG-2B RPCs', () => {
    expect(hook).toContain("'issue_telegram_link_token'");
    expect(hook).toContain("'revoke_my_telegram_link'");
    const rpcNames = [...both.matchAll(/callTelegramRpc\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(rpcNames)).toEqual(new Set(['issue_telegram_link_token', 'revoke_my_telegram_link']));
  });

  it('introduces no new backend, migration, Edge Function or Telegram API logic', () => {
    for (const forbidden of [
      'functions.invoke',
      'sendMessage',
      'setWebhook',
      'getUpdates',
      'connector-gateway',
      'LOVABLE_API_KEY',
      'create table',
      'CREATE TABLE',
    ]) {
      expect(both).not.toContain(forbidden);
    }
  });
});

describe('TG-2E3-A — own-link query safety', () => {
  it('is user-scoped and never selects telegram_user_id', () => {
    expect(hook).toContain("from('telegram_user_links')");
    expect(hook).toContain("select('status, linked_at, revoked_at')");
    expect(hook).toContain("eq('user_id', user!.id)");
    expect(hook).toContain('maybeSingle()');
    expect(hook).toContain("order('linked_at', { ascending: false })");
    expect(both).not.toMatch(/select\([^)]*telegram_user_id/);
    expect(section).not.toContain('telegram_user_id');
  });
});

describe('TG-2E3-A — bot identity and token validation', () => {
  it('pins the exact public bot username and deep-link prefix', () => {
    expect(TELEGRAM_BOT_USERNAME).toBe('HaulTrackerProDispatchBot');
    expect(TELEGRAM_DEEP_LINK_PREFIX).toBe('https://t.me/HaulTrackerProDispatchBot?start=');
    expect(buildTelegramDeepLink('a'.repeat(64))).toBe(
      `https://t.me/HaulTrackerProDispatchBot?start=${'a'.repeat(64)}`,
    );
  });

  it('requires exactly 64 lowercase hex characters', () => {
    expect(isValidTelegramLinkToken('a1b2'.repeat(16))).toBe(true);
    expect(isValidTelegramLinkToken('A'.repeat(64))).toBe(false);
    expect(isValidTelegramLinkToken('a'.repeat(63))).toBe(false);
    expect(isValidTelegramLinkToken('a'.repeat(65))).toBe(false);
    expect(isValidTelegramLinkToken('')).toBe(false);
    expect(isValidTelegramLinkToken(null)).toBe(false);
    expect(isValidTelegramLinkToken(undefined)).toBe(false);
  });

  it('never navigates on a malformed token', () => {
    expect(hook).toMatch(/if \(!isValidTelegramLinkToken\(rpcData\)\)[\s\S]{0,160}return \{ ok: false/);
  });
});

describe('TG-2E3-A — token confinement', () => {
  it('never persists or logs the raw token', () => {
    for (const forbidden of ['localStorage', 'sessionStorage', 'console.log', 'gtag', 'dataLayer']) {
      expect(both).not.toContain(forbidden);
    }
    expect(both).not.toMatch(/useState[^\n]*token/i);
    expect(both).not.toMatch(/setToken/);
  });
});

describe('TG-2E3-A — popup strategy', () => {
  it('opens a blank window synchronously and falls back to same-tab', () => {
    const openIdx = section.indexOf("window.open('', '_blank'");
    const connectIdx = section.indexOf('await connect(');
    expect(openIdx).toBeGreaterThan(-1);
    expect(connectIdx).toBeGreaterThan(openIdx);
    expect(section).toContain('popup.location.href = url');
    expect(section).toContain('window.location.href = url');
    expect(section).toContain('popup.close()');
  });
});

describe('TG-2E3-A — UI states', () => {
  it('renders connected / not-connected / reconnect states and disconnect confirmation', () => {
    expect(section).toContain('Connected</Badge>');
    expect(section).toContain('Not connected</Badge>');
    expect(section).toContain('Connect Telegram');
    expect(section).toContain('Reconnect Telegram');
    expect(section).toContain('Connected on {formattedLinkedAt}');
    expect(section).toContain('Waiting for Telegram confirmation…');
    expect(section).toContain('Refresh status');
    expect(section).toContain('AlertDialog');
    expect(section).toContain('Disconnect Telegram?');
    expect(section).toContain('does not delete any');
    expect(section).toMatch(/aria-label=/);
    expect(section).toContain('Skeleton');
  });
});

describe('TG-2E3-A — status polling lifecycle', () => {
  it('polls on an interval and stops when connected, on timeout, and on unmount', () => {
    expect(hook).toContain('const POLL_INTERVAL_MS = 3000');
    expect(hook).toContain('const POLL_TIMEOUT_MS = 120000');
    expect(hook).toContain('setTimeout(stopPolling, POLL_TIMEOUT_MS)');
    expect(hook).toContain('if (connected) stopPolling();');
    expect(hook).toContain('useEffect(() => stopPolling, [stopPolling])');
    expect(hook).toContain('clearInterval(pollTimer.current)');
    expect(hook).toContain('clearTimeout(pollDeadline.current)');
  });
});

describe('TG-2E3-A — friendly error mapping', () => {
  it('maps the known link errors', () => {
    expect(hook).toContain('telegram_not_authenticated');
    expect(hook).toContain('telegram_already_linked');
  });
});

describe('TG-2E3-A — mounting', () => {
  it('mounts the shared section exactly once in each allowed settings surface', () => {
    for (const src of [driverSettings, recruiterSettings]) {
      expect(src).toContain("import { TelegramConnectionSection } from '@/components/TelegramConnectionSection'");
      expect(src.match(/<TelegramConnectionSection \/>/g) ?? []).toHaveLength(1);
    }
  });
});
