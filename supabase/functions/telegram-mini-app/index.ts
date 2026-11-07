import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { createTelegramMiniAppHandler, verifyTelegramMiniAppIdentity, type MiniAppLink } from "../_shared/telegram-mini-app-auth.ts";

// Normal HaulTracker sign-in remains required. This endpoint never mints a
// session, changes an account's role, or reads/writes recruiter business data.
const url = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const asUser = (authorization: string) => createClient(url, anon, { ...options, global: { headers: { Authorization: authorization } } });
const asService = () => createClient(url, service, options);

Deno.serve(createTelegramMiniAppHandler({
  verifyIdentity: verifyTelegramMiniAppIdentity,
  async authenticate(authorization) {
    if (!url || !anon || !service) throw new Error("configuration_missing");
    const { data, error } = await asUser(authorization).auth.getUser();
    const user = data.user;
    return !error && user ? { id: user.id, emailConfirmed: !!user.email_confirmed_at, anonymous: user.is_anonymous === true } : null;
  },
  async readLinks(userId, telegramUserId) {
    const client = asService();
    const [account, telegram] = await Promise.all([
      client.from("telegram_user_links").select("user_id,telegram_user_id").eq("user_id", userId).eq("status", "active").maybeSingle(),
      client.from("telegram_user_links").select("user_id,telegram_user_id").eq("telegram_user_id", telegramUserId).eq("status", "active").maybeSingle(),
    ]);
    if (account.error || telegram.error) throw new Error("connection_unavailable");
    const link = (row: { user_id: string; telegram_user_id: number } | null): MiniAppLink | null =>
      row ? { userId: row.user_id, telegramUserId: Number(row.telegram_user_id) } : null;
    return { account: link(account.data), telegram: link(telegram.data) };
  },
  async issueToken(authorization) {
    const { data, error } = await asUser(authorization).rpc("issue_telegram_link_token");
    if (error || typeof data !== "string") throw new Error("connection_unavailable");
    return data;
  },
  async consumeToken(token, telegramUserId, userId) {
    const { data, error } = await asService().rpc("consume_telegram_link_token", { _raw_token: token, _telegram_user_id: telegramUserId });
    if (error) throw new Error("connection_unavailable");
    const row = Array.isArray(data) ? data[0] : data;
    return row?.user_id === userId && Number(row?.telegram_user_id) === telegramUserId && row?.status === "active";
  },
}));
