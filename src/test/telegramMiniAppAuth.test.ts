// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createTelegramMiniAppHandler, verifyTelegramMiniAppIdentity, TELEGRAM_MINI_APP_BOT_ID, type MiniAppAuthPorts, type MiniAppLink } from '../../supabase/functions/_shared/telegram-mini-app-auth';

const now = 1800000000;
let keys: CryptoKeyPair;
let publicKey: string;
beforeAll(async () => {
  keys = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as unknown as CryptoKeyPair;
  publicKey = Buffer.from(await webcrypto.subtle.exportKey('raw', keys.publicKey)).toString('hex');
});

async function signed(extra: Record<string, string> = {}, botId = TELEGRAM_MINI_APP_BOT_ID) {
  const values = { auth_date: String(now), user: JSON.stringify({ id: 1234567, first_name: 'Synthetic QA' }), query_id: 'qa-query', ...extra };
  const check = `${botId}:WebAppData\n` + Object.keys(values).filter(key => key !== 'hash' && key !== 'signature').sort().map(key => `${key}=${values[key]}`).join('\n');
  const signature = await webcrypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(check));
  return new URLSearchParams({ ...values, hash: '0'.repeat(64), signature: Buffer.from(signature).toString('base64url') }).toString();
}

const verify = (raw: unknown, time = now) => verifyTelegramMiniAppIdentity(raw, { publicKey, nowSeconds: time });

describe('Telegram Mini App signed identity', () => {
  it('validates an actual Ed25519 signature for the configured production bot identity', async () => {
    expect(await verify(await signed())).toEqual({ telegramUserId: 1234567, authDate: now });
  });
  it('rejects a signature belonging to another bot', async () => {
    expect(await verify(await signed({}, '999999999'))).toBeNull();
  });
  it('rejects a tampered Telegram user, auth date or launch parameter', async () => {
    for (const [key, value] of [['user', JSON.stringify({ id: 7654321 })], ['auth_date', String(now - 10)], ['start_param', 'other-workspace']]) {
      const raw = new URLSearchParams(await signed()); raw.set(key, value);
      expect(await verify(raw.toString())).toBeNull();
    }
  });
  it('validates fresh data, bounds the work session, and rejects future dates', async () => {
    expect(await verify(await signed(), now + 86400)).not.toBeNull();
    expect(await verify(await signed(), now + 86401)).toBeNull();
    expect(await verify(await signed({ auth_date: String(now + 31) }))).toBeNull();
  });
  it('rejects duplicate signed fields, missing proof and oversized input', async () => {
    const raw = await signed();
    expect(await verify(`${raw}&user=${encodeURIComponent('{"id":7654321}')}`)).toBeNull();
    const missing = new URLSearchParams(raw); missing.delete('signature');
    expect(await verify(missing.toString())).toBeNull();
    expect(await verify('x'.repeat(8193))).toBeNull();
  });
  it.each([0, -1, '1234567', 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid identity %j even with a valid signature', async id => {
    expect(await verify(await signed({ user: JSON.stringify({ id }) }))).toBeNull();
  });
  it('rejects bot identities and invalid user objects even with a valid signature', async () => {
    for (const user of [{ id: 1234567, is_bot: true }, [], null, 'name']) expect(await verify(await signed({ user: JSON.stringify(user) }))).toBeNull();
  });
  it('accepts correctly padded signatures and ignores hash only as the public-key specification requires', async () => {
    const raw = new URLSearchParams(await signed()); raw.set('signature', raw.get('signature')! + '=='); raw.set('hash', 'different-hmac');
    expect(await verify(raw.toString())).not.toBeNull();
  });
});

const userId = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const pair: MiniAppLink = { userId, telegramUserId: 1234567 };
const origin = 'https://haultrackerpro.com';
function fixture(connected = true) {
  const ports: MiniAppAuthPorts = {
    verifyIdentity: vi.fn(raw => verify(raw)),
    authenticate: vi.fn(async () => ({ id: userId, emailConfirmed: true, anonymous: false })),
    readLinks: vi.fn(async () => ({ account: connected ? pair : null, telegram: connected ? pair : null })),
    issueToken: vi.fn(async () => 'a'.repeat(64)),
    consumeToken: vi.fn(async () => true),
    nowSeconds: () => now,
  };
  const handler = createTelegramMiniAppHandler(ports);
  const request = async (body: Record<string, unknown> = {}, headers: Record<string, string> = {}) => handler(new Request(`${origin}/functions/v1/telegram-mini-app`, { method: 'POST', headers: { origin, authorization: 'Bearer qa-user-session', 'content-type': 'application/json', ...headers }, body: JSON.stringify({ action: 'status', initData: await signed(), ...body }) }));
  return { ports, handler, request };
}

describe('Mini App account connection endpoint', () => {
  it('returns linked only after both actual signed Telegram proof and account authentication', async () => {
    const f = fixture(); const response = await f.request();
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'linked' });
    expect(f.ports.authenticate).toHaveBeenCalledWith('Bearer qa-user-session');
    expect(f.ports.issueToken).not.toHaveBeenCalled(); expect(f.ports.consumeToken).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('does not read accounts or issue a token with forged launch data', async () => {
    const f = fixture(); const response = await f.request({ initData: 'user={"id":1234567}' });
    expect(response.status).toBe(401); expect(f.ports.authenticate).not.toHaveBeenCalled(); expect(f.ports.readLinks).not.toHaveBeenCalled();
  });
  it('does not read identity mappings for an invalid, anonymous or unconfirmed account', async () => {
    for (const account of [null, { id: userId, emailConfirmed: false, anonymous: false }, { id: userId, emailConfirmed: true, anonymous: true }]) {
      const f = fixture(); vi.mocked(f.ports.authenticate).mockResolvedValue(account);
      expect((await f.request()).status).toBe(401); expect(f.ports.readLinks).not.toHaveBeenCalled();
    }
  });
  it('reports an unlinked account without automatically connecting it', async () => {
    const f = fixture(false); expect(await (await f.request()).json()).toEqual({ status: 'not_linked' });
    expect(f.ports.issueToken).not.toHaveBeenCalled(); expect(f.ports.consumeToken).not.toHaveBeenCalled();
  });
  it('rejects either direction of an existing account conflict without relinking', async () => {
    for (const links of [{ account: null, telegram: { ...pair, userId: otherId } }, { account: { ...pair, telegramUserId: 999 }, telegram: null }]) {
      const f = fixture(false); vi.mocked(f.ports.readLinks).mockResolvedValue(links);
      expect((await f.request({ action: 'connect' })).status).toBe(409); expect(f.ports.issueToken).not.toHaveBeenCalled(); expect(f.ports.consumeToken).not.toHaveBeenCalled();
    }
  });
  it('connects only through the current authenticated account token and canonical consumer', async () => {
    const f = fixture(false);
    vi.mocked(f.ports.readLinks).mockResolvedValueOnce({ account: null, telegram: null }).mockResolvedValueOnce({ account: pair, telegram: pair });
    expect(await (await f.request({ action: 'connect' })).json()).toEqual({ status: 'linked' });
    expect(f.ports.issueToken).toHaveBeenCalledWith('Bearer qa-user-session');
    expect(f.ports.consumeToken).toHaveBeenCalledWith('a'.repeat(64), 1234567, userId);
  });
  it('is idempotent for an already connected account', async () => {
    const f = fixture(); expect(await (await f.request({ action: 'connect' })).json()).toEqual({ status: 'linked' });
    expect(f.ports.issueToken).not.toHaveBeenCalled(); expect(f.ports.consumeToken).not.toHaveBeenCalled();
  });
  it('requires a fresh launch to connect, while preserving a valid existing work session', async () => {
    const raw = await signed({ auth_date: String(now - 301) });
    const unlinked = fixture(false); expect((await unlinked.request({ action: 'connect', initData: raw })).status).toBe(401);
    expect(unlinked.ports.issueToken).not.toHaveBeenCalled();
    const linked = fixture(); expect((await linked.request({ initData: raw })).status).toBe(200);
  });
  it('never accepts an account ID, Telegram ID, public key or role supplied by the client', async () => {
    for (const extra of [{ userId: otherId }, { telegramUserId: 999 }, { publicKey }, { role: 'owner' }]) {
      const f = fixture(); expect((await f.request(extra)).status).toBe(400); expect(f.ports.readLinks).not.toHaveBeenCalled();
    }
  });
  it('does not expose database errors, identity mappings or issued tokens', async () => {
    const f = fixture(false); vi.mocked(f.ports.consumeToken).mockRejectedValue(new Error('secret database details'));
    const response = await f.request({ action: 'connect' });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: 'mini_app_unavailable' });
  });
  it('fails if the canonical consumer or final connection check does not confirm the same account', async () => {
    const f = fixture(false); vi.mocked(f.ports.consumeToken).mockResolvedValue(false);
    expect((await f.request({ action: 'connect' })).status).toBe(503);
    const g = fixture(false); expect((await g.request({ action: 'connect' })).status).toBe(409);
  });
  it('rejects unknown origins, missing authentication and non-JSON bodies before any identity lookup', async () => {
    const f = fixture();
    expect((await f.request({}, { origin: 'https://attacker.invalid' })).status).toBe(403);
    expect((await f.request({}, { authorization: '' })).status).toBe(401);
    expect((await f.request({}, { 'content-type': 'text/plain' })).status).toBe(415);
    expect(f.ports.verifyIdentity).not.toHaveBeenCalled();
  });
  it('handles preflight but refuses unsafe methods', async () => {
    const f = fixture();
    expect((await f.handler(new Request(origin, { method: 'OPTIONS', headers: { origin } }))).status).toBe(204);
    expect((await f.handler(new Request(origin, { method: 'GET', headers: { origin } }))).status).toBe(405);
    expect(f.ports.authenticate).not.toHaveBeenCalled();
  });
  it('bounds streaming bodies before authentication or database access', async () => {
    const f = fixture();
    const response = await f.handler(new Request(origin, { method: 'POST', headers: { origin, authorization: 'Bearer qa', 'content-type': 'application/json' }, body: 'x'.repeat(16385) }));
    expect(response.status).toBe(400); expect(f.ports.authenticate).not.toHaveBeenCalled(); expect(f.ports.readLinks).not.toHaveBeenCalled();
  });
});
