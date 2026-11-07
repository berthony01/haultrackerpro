// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { createTelegramMiniAppHandler, type MiniAppAuthPorts } from '../../supabase/functions/_shared/telegram-mini-app-auth';

// Execute the actual Deno entry point with synthetic Supabase transports.
// The shared verifier has separate real-signature tests; this checks that the
// deployed adapter forwards the verified identities and authenticated JWT.
const source = readFileSync(resolve('supabase/functions/telegram-mini-app/index.ts'), 'utf8');
const executable = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const userId = '00000000-0000-4000-8000-000000000010';
const telegramId = 1234567;
const row = { user_id: userId, telegram_user_id: telegramId, status: 'active' };
const bearer = 'Bearer synthetic-user-jwt';

function fixture({ linked = false, consumer = row, confirmed = true, configured = true } = {}) {
  let handler!: (request: Request) => Promise<Response>;
  const calls: unknown[] = [];
  let connected = linked;
  const createClient = vi.fn((url: string, key: string, options: { global?: { headers: { Authorization: string } } }) => {
    calls.push({ client: key, url, authorization: options.global?.headers.Authorization });
    return {
      auth: { getUser: async () => {
        expect(key).toBe('synthetic-anon-key'); expect(options.global?.headers.Authorization).toBe(bearer);
        return { data: { user: { id: userId, email_confirmed_at: confirmed ? '2026-07-17' : null, is_anonymous: false } }, error: null };
      } },
      from: (table: string) => {
        expect(key).toBe('synthetic-service-key'); expect(table).toBe('telegram_user_links');
        const filters: Record<string, unknown> = {};
        const query = { select: (fields: string) => { expect(fields).toBe('user_id,telegram_user_id'); return query; },
          eq: (field: string, value: unknown) => { filters[field] = value; return query; },
          maybeSingle: async () => {
            expect(filters.status).toBe('active');
            expect(filters.user_id === userId || filters.telegram_user_id === telegramId).toBe(true);
            return { data: connected ? row : null, error: null };
          } };
        return query;
      },
      rpc: async (fn: string, args?: unknown) => {
        calls.push({ fn, args, key });
        if (fn === 'issue_telegram_link_token') {
          expect(key).toBe('synthetic-anon-key'); expect(args).toBeUndefined();
          return { data: 'a'.repeat(64), error: null };
        }
        expect(fn).toBe('consume_telegram_link_token'); expect(key).toBe('synthetic-service-key');
        connected = true;
        return { data: consumer, error: null };
      },
    };
  });
  const env: Record<string, string> = configured ? { SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_ANON_KEY: 'synthetic-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' } : {};
  const Deno = { env: { get: (name: string) => env[name] }, serve: (callback: typeof handler) => { handler = callback; } };
  const verifyIdentity: MiniAppAuthPorts['verifyIdentity'] = async () => ({ telegramUserId: telegramId, authDate: Math.floor(Date.now()/1000) });
  new Function('createClient', 'createTelegramMiniAppHandler', 'verifyTelegramMiniAppIdentity', 'Deno', executable)(createClient, createTelegramMiniAppHandler, verifyIdentity, Deno);
  const request = (action = 'connect') => handler(new Request('https://synthetic.invalid', {
    method: 'POST', headers: { origin: 'https://haultrackerpro.com', authorization: bearer, 'content-type': 'application/json' },
    body: JSON.stringify({ action, initData: 'synthetic-signed-data' }),
  }));
  return { request, calls };
}

describe('Mini App deployed Edge adapter', () => {
  it('issues the canonical token in user context and consumes it only in service context', async () => {
    const f = fixture(); expect(await (await f.request()).json()).toEqual({ status: 'linked' });
    expect(f.calls).toContainEqual({ fn: 'issue_telegram_link_token', args: undefined, key: 'synthetic-anon-key' });
    expect(f.calls).toContainEqual({ fn: 'consume_telegram_link_token', args: { _raw_token: 'a'.repeat(64), _telegram_user_id: telegramId }, key: 'synthetic-service-key' });
  });
  it('performs no token or business mutation for an existing account connection', async () => {
    const f = fixture({ linked: true }); expect(await (await f.request('status')).json()).toEqual({ status: 'linked' });
    expect(f.calls.filter(call => 'fn' in (call as object))).toEqual([]);
  });
  it('fails if the canonical consumer returns a different account', async () => {
    const f = fixture({ consumer: { ...row, user_id: '00000000-0000-4000-8000-000000000011' } });
    expect((await f.request()).status).toBe(503);
  });
  it('requires a confirmed account before any link lookup or mutation', async () => {
    const f = fixture({ confirmed: false }); expect((await f.request()).status).toBe(401);
    expect(f.calls).toHaveLength(1);
  });
  it('fails closed when deployment configuration is missing', async () => {
    const f = fixture({ configured: false }); expect((await f.request()).status).toBe(503); expect(f.calls).toEqual([]);
  });
});
