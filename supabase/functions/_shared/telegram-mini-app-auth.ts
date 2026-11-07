// Verify Telegram's public-key signature without obtaining the bot token.
// https://core.telegram.org/bots/webapps#validating-data-for-third-party-use
export const TELEGRAM_MINI_APP_BOT_ID = "8810994124";
export const TELEGRAM_MINI_APP_PUBLIC_KEY = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";
export const TELEGRAM_MINI_APP_MAX_AGE_SECONDS = 86400;

export type VerifiedMiniAppIdentity = { telegramUserId: number; authDate: number };

export async function verifyTelegramMiniAppIdentity(
  raw: unknown,
  options: { botId?: string; nowSeconds?: number; publicKey?: string } = {},
): Promise<VerifiedMiniAppIdentity | null> {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 8192) return null;
  const botId = options.botId ?? TELEGRAM_MINI_APP_BOT_ID;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!/^[1-9][0-9]{0,15}$/.test(botId) || !Number.isSafeInteger(now)) return null;
  const params = new URLSearchParams(raw);
  const fields = new Map<string, string>();
  for (const [key, value] of params) {
    if (!/^[a-z_]+$/.test(key) || fields.has(key)) return null;
    fields.set(key, value);
  }
  const signature = fields.get("signature") ?? "";
  const date = fields.get("auth_date") ?? "";
  if (!/^[A-Za-z0-9_-]{86}(?:==)?$/.test(signature) || !/^[0-9]{1,12}$/.test(date)) return null;
  const authDate = Number(date);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > now + 30 || now - authDate > TELEGRAM_MINI_APP_MAX_AGE_SECONDS) return null;
  try {
    const user = JSON.parse(fields.get("user") ?? "null");
    if (!user || typeof user !== "object" || Array.isArray(user) ||
        !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot === true) return null;
    const keyHex = options.publicKey ?? TELEGRAM_MINI_APP_PUBLIC_KEY;
    if (!/^[0-9a-f]{64}$/.test(keyHex)) return null;
    const keyBytes = Uint8Array.from(keyHex.match(/../g)!, hex => parseInt(hex, 16));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "Ed25519" }, false, ["verify"]);
    const normalized = signature.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const bytes = Uint8Array.from(atob(normalized + "=="), char => char.charCodeAt(0));
    const check = `${botId}:WebAppData\n` + [...fields.keys()]
      .filter(key => key !== "hash" && key !== "signature").sort()
      .map(key => `${key}=${fields.get(key)}`).join("\n");
    const valid = await crypto.subtle.verify("Ed25519", key, bytes, new TextEncoder().encode(check));
    return valid ? { telegramUserId: user.id, authDate } : null;
  } catch {
    return null;
  }
}

export type MiniAppAccount = { id: string; emailConfirmed: boolean; anonymous: boolean };
export type MiniAppLink = { userId: string; telegramUserId: number };
export interface MiniAppAuthPorts {
  verifyIdentity: (raw: unknown) => Promise<VerifiedMiniAppIdentity | null>;
  authenticate: (authorization: string) => Promise<MiniAppAccount | null>;
  readLinks: (userId: string, telegramUserId: number) => Promise<{ account: MiniAppLink | null; telegram: MiniAppLink | null }>;
  issueToken: (authorization: string) => Promise<string>;
  consumeToken: (token: string, telegramUserId: number, userId: string) => Promise<boolean>;
  nowSeconds?: () => number;
}

const APP_ORIGINS = new Set([
  "https://haultrackerpro.com", "https://www.haultrackerpro.com",
  "https://haultrackerpro.lovable.app",
  "https://id-preview--6d28fa14-57dc-418b-9196-19e144f0e8df.lovable.app",
]);

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get("content-length");
  if (length && (!/^[0-9]+$/.test(length) || Number(length) > 16384)) throw new Error("body_limit");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body_invalid");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 16384) { await reader.cancel(); throw new Error("body_limit"); }
    chunks.push(part.value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body_invalid");
  return value;
}

function linkState(links: Awaited<ReturnType<MiniAppAuthPorts["readLinks"]>>, userId: string, telegramUserId: number) {
  if (!links.account && !links.telegram) return "not_linked";
  return links.account?.userId === userId && links.telegram?.userId === userId &&
    links.account.telegramUserId === telegramUserId && links.telegram.telegramUserId === telegramUserId
    ? "linked" : "conflict";
}

export function createTelegramMiniAppHandler(ports: MiniAppAuthPorts) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin") ?? "";
    const allowed = APP_ORIGINS.has(origin);
    const headers: Record<string, string> = {
      "Content-Type": "application/json", "Cache-Control": "no-store", "Pragma": "no-cache", "Vary": "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    };
    if (allowed) headers["Access-Control-Allow-Origin"] = origin;
    const reply = (value: Record<string, unknown>, status = 200) => new Response(JSON.stringify(value), { status, headers });
    if (!allowed) return reply({ code: "origin_denied" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply({ code: "method_not_allowed" }, 405);
    const authorization = request.headers.get("authorization") ?? "";
    if (!/^Bearer [^\s]+$/i.test(authorization)) return reply({ code: "sign_in_required" }, 401);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return reply({ code: "invalid_request" }, 415);
    let body: Record<string, unknown>;
    try { body = await boundedJson(request); } catch { return reply({ code: "invalid_request" }, 400); }
    if (Object.keys(body).some(key => key !== "action" && key !== "initData") ||
        (body.action !== "status" && body.action !== "connect")) return reply({ code: "invalid_request" }, 400);
    try {
      const identity = await ports.verifyIdentity(body.initData);
      if (!identity) return reply({ code: "telegram_session_expired" }, 401);
      const user = await ports.authenticate(authorization);
      if (!user || user.anonymous || !user.emailConfirmed || !/^[0-9a-f-]{36}$/i.test(user.id)) return reply({ code: "sign_in_required" }, 401);
      const current = linkState(await ports.readLinks(user.id, identity.telegramUserId), user.id, identity.telegramUserId);
      if (current === "conflict") return reply({ code: "telegram_connection_conflict" }, 409);
      if (body.action === "status" || current === "linked") return reply({ status: current });
      // Connecting identities is a fresh, explicit action. Existing linked
      // sessions can work all day without discarding an unfinished form.
      const now = ports.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
      if (now - identity.authDate > 300) return reply({ code: "telegram_session_expired" }, 401);
      const token = await ports.issueToken(authorization);
      if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("unavailable");
      if (!await ports.consumeToken(token, identity.telegramUserId, user.id)) throw new Error("unavailable");
      const connected = linkState(await ports.readLinks(user.id, identity.telegramUserId), user.id, identity.telegramUserId);
      if (connected !== "linked") return reply({ code: "telegram_connection_conflict" }, 409);
      return reply({ status: "linked" });
    } catch {
      return reply({ code: "mini_app_unavailable" }, 503);
    }
  };
}
