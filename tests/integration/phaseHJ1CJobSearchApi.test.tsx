// @vitest-environment node
/**
 * Reproducible HJ-1C native boundary. Requires the two checksum-verified official
 * archives/executables under /tmp/hj1c/bin. Never connects to a hosted backend.
 * Run with an external Vitest config (see final report); owns and tears down
 * PostgreSQL, Auth, PostgREST, routing-only proxy, Vite, and browser contexts.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from 'pg';
import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import { createConnection, createServer as createNetServer } from 'node:net';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = '/dev-server';
const HOME = '/tmp/hj1c';
const SOCKET = '/tmp/hj1c/socket';
const ports = { pg: 55441, rest: 55442, auth: 55443, proxy: 55444, vite: 55445 };
const endpoint = 'http://127.0.0.1:55444';
const origin = 'http://127.0.0.1:55445';
if (process.env.HJ1C_NATIVE_ONLY !== '1' || process.cwd() !== ROOT) {
  throw new Error('HJ1C requires explicit native-only opt-in and exact project root');
}
const sqlPaths = [
  'supabase/migration-candidates/20261024041952_phase_hj1a_job_search_card_foundation.sql',
  'supabase/migration-candidates/20261024045239_phase_hj1b_job_search_discovery.sql',
];
const secret = randomBytes(48).toString('hex');
const dbPassword = randomBytes(24).toString('hex');
const password = randomBytes(24).toString('hex');
const childEnv = { PATH: '/bin:/usr/bin', HOME, LANG: 'C.UTF-8', TZ: 'UTC' };
const children: ChildProcess[] = [];
const ids: Record<string, string> = {};
const sessions: Record<string, { access_token: string; refresh_token: string }> = {};
const payload = {
  state: 'TX', cdl_class: 'A', years_experience: 5,
  experience_qualifier: 'at_least', preferred_route_type: 'Regional',
  preferred_home_time: 'Weekly',
};
let db: Client;
let proxy: Server | undefined;
let browser: Browser | undefined;
let clusterStarted = false;
let droppedCommand: string | null = null;
let delayNextPublish = false;
let heldRequest: (() => void) | undefined;
let holdNextPublish = false;
let forbiddenNetwork = 0;
let selfHealCalls = 0;
let originalInventory: unknown;
let originalSentinels: unknown;
let workspace = randomUUID();

function jwt(role: string, sub?: string, exp = Math.floor(Date.now() / 1000) + 3600) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, sub, exp, aud: 'authenticated' })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
function safeFile(file: string, text: string) {
  if (!file.startsWith(HOME + '/')) throw new Error('Nonlocal temporary file');
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600);
}
function run(binary: string, args: string[], extra: Record<string, string> = {}) {
  const child = spawn(binary, args, {
    cwd: HOME + '/runtime', env: { ...childEnv, ...extra }, stdio: 'ignore',
  });
  children.push(child);
  return child;
}
async function waitFor(check: () => Promise<boolean>, label: string, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Local prerequisite failed: ${label}`);
}
async function portFree(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createNetServer();
    server.once('error', () => reject(new Error(`Port ${port} unavailable; never reuse existing services`)));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
  });
}
function source(file: string) { return readFileSync(path.join(ROOT, file), 'utf8'); }
function helper(file: string, name: string) {
  const match = source(file).match(new RegExp(
    'CREATE OR REPLACE FUNCTION public\\.' + name + '\\([\\s\\S]*?AS (\\$\\w*\\$)[\\s\\S]*?\\1;', 'i',
  ));
  if (!match) throw new Error(`Canonical helper missing: ${name}`);
  return match[0];
}
async function jsonRequest(url: string, token: string | null, body?: unknown, method = 'POST') {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || ![55443, 55444].includes(Number(parsed.port))) {
    throw new Error('Nonlocal API rejected');
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}
const rpc = (name: string, args: unknown, token: string | null) =>
  jsonRequest(`${endpoint}/rest/v1/rpc/${name}`, token, args);
const command = (action: string, revision = 0, commandId = randomUUID()) => ({
  _action: action, _expected_revision: revision, _client_command_id: commandId,
  ...(action === 'publish' ? { _payload: payload, _consent_version: 'job_search_card_v1' } : {}),
});
async function own(actor: string) {
  return (await rpc('manage_my_job_search_card', { _action: 'get' }, sessions[actor].access_token)).data;
}
async function seedAccount(name: string) {
  const result = await jsonRequest('http://127.0.0.1:55443/admin/users', jwt('service_role'), {
    email: `${name}@hj1c.invalid`, password, email_confirm: true,
    user_metadata: { role: 'super_admin', driverCapabilityStatus: 'active' },
  });
  if (result.status !== 200 || !result.data?.id) throw new Error('Local synthetic account creation failed');
  ids[name] = result.data.id;
  const signed = await jsonRequest('http://127.0.0.1:55443/token?grant_type=password', null, {
    email: `${name}@hj1c.invalid`, password,
  });
  if (signed.status !== 200) throw new Error('Local synthetic sign-in failed');
  sessions[name] = signed.data;
}
async function inventory() {
  return (await db.query(`SELECT jsonb_build_object(
    'columns', (SELECT jsonb_agg(to_jsonb(x) ORDER BY table_name,ordinal_position)
      FROM information_schema.columns x WHERE table_schema IN ('public','job_search_private')),
    'policies', (SELECT jsonb_agg(to_jsonb(x) ORDER BY schemaname,tablename,policyname)
      FROM pg_policies x WHERE schemaname IN ('public','job_search_private')),
    'functions', (SELECT jsonb_agg(jsonb_build_object('def',pg_get_functiondef(p.oid),'acl',p.proacl::text)
      ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','job_search_private'))
  ) AS x`)).rows[0].x;
}

beforeAll(async () => {
  for (const [archive, expected] of [
    ['postgrest', '4153f81ccc40e7b735edc89cd84b49da25ba27eb37d57c7f6a82c9005a0b762b'],
    ['auth', '6f8065fcd708df7c09c83e1fb96b0c9507f6e2600e6a78a540153b92a49cd1f9'],
  ]) {
    expect(createHash('sha256').update(readFileSync(`${HOME}/bin/${archive}.tar.xz`)).digest('hex')).toBe(expected);
  }
  for (const port of Object.values(ports)) await portFree(port);
  for (const dir of ['runtime', 'cluster', 'socket', 'screenshots']) mkdirSync(`${HOME}/${dir}`, { recursive: true });
  // PostgreSQL cannot run as root. Only its disposable directories belong to lovable.
  chmodSync(HOME, 0o711);
  execFileSync('/bin/chown', ['-R', 'lovable:lovable', HOME + '/cluster', SOCKET]);
  execFileSync('/bin/runuser', ['-u', 'lovable', '--', '/bin/initdb', '-D', HOME + '/cluster',
    '--username=lovable', '--auth-local=trust', '--auth-host=reject', '--no-locale'], { env: childEnv });
  execFileSync('/bin/runuser', ['-u', 'lovable', '--', '/bin/pg_ctl', '-D', HOME + '/cluster',
    '-l', HOME + '/cluster/server.log', '-o', `-k ${SOCKET} -p 55441 -c listen_addresses=''`, '-w', 'start'],
  { env: childEnv });
  clusterStarted = true;
  db = new Client({ host: SOCKET, port: 55441, user: 'lovable', database: 'postgres', password: '', ssl: false });
  await db.connect();
  await db.query(`CREATE ROLE postgres NOLOGIN NOSUPERUSER BYPASSRLS;
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS;
    CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${dbPassword}';
    GRANT anon,authenticated,service_role TO authenticator WITH INHERIT FALSE, SET TRUE;
    CREATE ROLE supabase_auth_admin LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${dbPassword}';
    CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
    ALTER SCHEMA public OWNER TO postgres;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role,postgres;
    GRANT CREATE ON SCHEMA public TO postgres;
    CREATE EXTENSION citext WITH SCHEMA public;`);
  run(HOME + '/bin/auth/auth', ['serve'], {
    GOTRUE_API_HOST: '127.0.0.1', PORT: '55443',
    API_EXTERNAL_URL: endpoint + '/auth/v1', GOTRUE_SITE_URL: origin,
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_NAMESPACE: 'auth',
    DATABASE_URL: `postgresql://supabase_auth_admin:${dbPassword}@/postgres?host=${SOCKET}&port=55441&sslmode=disable`,
    GOTRUE_DB_MIGRATIONS_PATH: HOME + '/bin/auth/migrations',
    GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_EXP: '3600',
    GOTRUE_DISABLE_SIGNUP: 'true', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_SMTP_HOST: '127.0.0.1', GOTRUE_SMTP_PORT: '55446',
    GOTRUE_TRACING_ENABLED: 'false', GOTRUE_METRICS_ENABLED: 'false', LOG_LEVEL: 'error',
  });
  await waitFor(async () => (await fetch('http://127.0.0.1:55443/health')).ok, 'real Auth health');
  await db.query(`GRANT SELECT,REFERENCES ON auth.users TO postgres;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO postgres;
    SET ROLE postgres;`);
  const claims = `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
      nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claim',true),''),
      nullif(current_setting('request.jwt.claims',true),''))::jsonb $$;`;
  await db.query('RESET ROLE');
  await db.query(claims);
  await db.query('SET ROLE postgres');
  await db.query(source('tests/integration/fixtures/phaseHJ1CLocalSchema.sql'));
  const helpers: Array<[string, string[]]> = [
    ['supabase/migrations/20260228060534_e148b76a-288a-4273-a42b-f9d95f9bfb0e.sql', ['is_admin','is_super_admin']],
    ['supabase/migrations/20260821003749_bfa5a325-8fcb-4a8b-b4e5-e6109e459fcb.sql', ['_owner_qa_persona_for']],
    ['supabase/migrations/20260630002954_a8c350ea-94e2-4f9b-8107-58a921dbe35b.sql', ['_agency_plan_defaults']],
    ['supabase/migrations/20260821062449_7c014ba4-370b-4eb8-afe0-f71de5785e43.sql', ['is_qa_fixture_root']],
    ['supabase/migrations/20260821062812_14e13b55-7f8b-4dac-8b3b-a9a5b68f761b.sql',
      ['driver_has_active_pro','get_effective_agency_limits','_agency_member_paid_operational_authority']],
    ['supabase/migrations/20260816220000_phase_am1a_agency_member_identity_seat_delegation_lifecycle_hardening.sql',
      ['agency_team_occupied_seats','agency_team_workspace_within_limit','_agency_delegation_operationally_active','get_my_managed_drivers']],
    ['supabase/migrations/20260720110000_phase1j_additive_user_capabilities.sql', ['get_my_user_capabilities']],
    ['supabase/migration-candidates/20260815020500_phase_rc1a_recruiter_workspace_membership_foundation.sql',
      ['is_recruiter_workspace_owner']],
    ['supabase/migration-candidates/20260725190000_phase1p_a1_recruiter_readiness_company_type.sql',
      ['recruiter_profile_can_manage_opportunities']],
    ['supabase/migrations/20260916050500_phase_cf1a_conversation_foundation.sql',
      ['user_has_blocking_messaging_restriction']],
    ['supabase/migrations/20260528225151_398fdccd-8b75-4596-a7a9-b56e790d7020.sql', ['get_my_recruiter_profile_safe']],
    ['supabase/migrations/20260528233935_fc9124d0-fc57-432d-80b0-48dc071ee384.sql', ['is_current_user_recruiter']],
    ['supabase/migrations/20260815031000_phase_rc1c_recruiter_staff_workspace_resolution.sql',
      ['get_my_recruiter_staff_workspaces']],
  ];
  for (const [file, names] of helpers) for (const name of names) await db.query(helper(file, name));
  await db.query(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
    GRANT EXECUTE ON FUNCTION public.is_admin(uuid),public.is_super_admin(uuid),
      public.get_my_user_capabilities(),public.get_my_managed_drivers(),
      public.get_my_recruiter_profile_safe(),public.is_current_user_recruiter(),
      public.get_my_recruiter_staff_workspaces(),public.is_recruiter_workspace_owner(uuid) TO authenticated;
    CREATE POLICY admin_self_read ON public.admin_users FOR SELECT TO authenticated
      USING (public.is_admin(auth.uid()));`);
  for (const file of sqlPaths) await db.query(source(file));
  await db.query('RESET ROLE');
  safeFile(HOME + '/runtime/postgrest.conf', `db-uri = "postgresql://authenticator:${dbPassword}@/postgres?host=${SOCKET}&port=55441&sslmode=disable"
    db-schemas = "public"
    db-anon-role = "anon"
    jwt-secret = "${secret}"
    server-host = "127.0.0.1"
    server-port = 55442
    db-config = false
    log-level = "crit"
  `);
  run(HOME + '/bin/postgrest/postgrest', [HOME + '/runtime/postgrest.conf']);
  await waitFor(async () => (await fetch('http://127.0.0.1:55442/')).ok, 'real PostgREST health');
  proxy = createServer((req, res) => {
    const auth = req.url?.startsWith('/auth/v1/');
    const rest = req.url?.startsWith('/rest/v1/');
    if (!auth && !rest) { res.writeHead(404).end(); return; }
    if (req.url?.includes('ensure_my_recruiter_setup_state')) selfHealCalls++;
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      let action: string | undefined;
      let commandId: string | undefined;
      if (req.url?.includes('/rpc/manage_my_job_search_card')) {
        const parsed = JSON.parse(body.toString() || '{}');
        action = parsed._action;
        commandId = parsed._client_command_id;
      }
      const forward = () => {
        const target = request({
          hostname: '127.0.0.1', port: auth ? 55443 : 55442,
          path: req.url?.replace(auth ? '/auth/v1' : '/rest/v1', ''),
          method: req.method, headers: { ...req.headers, host: '127.0.0.1' },
        }, upstream => {
          if (delayNextPublish && action === 'publish') {
            delayNextPublish = false;
            droppedCommand = commandId ?? null;
            upstream.resume();
            upstream.on('end', () => res.destroy());
            return;
          }
          res.writeHead(upstream.statusCode ?? 502, upstream.headers);
          upstream.pipe(res);
        });
        target.on('error', () => res.destroy());
        target.end(body);
      };
      if (holdNextPublish && action === 'publish') {
        holdNextPublish = false;
        heldRequest = forward;
      } else forward();
    });
  });
  await new Promise<void>(resolve => proxy?.listen(55444, '127.0.0.1', resolve));
  for (const actor of ['driver','other','recruiter','staff','admin','pro','assistant']) await seedAccount(actor);
  for (const [actor, id] of Object.entries(ids)) {
    await db.query('INSERT INTO public.profiles(user_id,display_name,intended_role) VALUES($1,$2,$3)',
      [id, `Synthetic ${actor}`, actor === 'recruiter' ? 'recruiter' : 'driver']);
    if (['driver','other','assistant'].includes(actor)) {
      await db.query("INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'driver','active')", [id]);
    }
  }
  await db.query("INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'recruiter','active')", [ids.recruiter]);
  await db.query(`INSERT INTO public.recruiter_profiles
    (id,user_id,recruiter_name,recruiter_email,company_name,company_type,dot_number,
      verification_status,posting_terms_accepted_at)
    VALUES($1,$2,'Synthetic recruiter','recruiter@hj1c.invalid','Synthetic carrier','carrier','123','approved',now())`,
  [workspace, ids.recruiter]);
  await db.query(`INSERT INTO public.opportunities(recruiter_id,title,company_name,status,admin_review_status)
    VALUES($1,'Synthetic opening','Synthetic carrier','active','approved')`, [workspace]);
  await db.query("INSERT INTO public.admin_users(user_id,email) VALUES($1,'admin@hj1c.invalid')", [ids.admin]);
  for (const id of [ids.pro, ids.driver]) {
    await db.query("INSERT INTO public.subscriptions(user_id,plan_key,status) VALUES($1,'pro_monthly','active')", [id]);
  }
  await db.query(`INSERT INTO public.driver_assistants(driver_user_id,assistant_user_id,invite_email,status,accepted_at)
    VALUES($1,$2,'assistant@hj1c.invalid','active',now())`, [ids.driver, ids.assistant]);
  await db.query(`INSERT INTO public.recruiter_members(recruiter_id,member_user_id,invite_email,role,status)
    VALUES($1,$2,'staff@hj1c.invalid','recruiter_staff','active')`, [workspace, ids.staff]);
  originalInventory = await inventory();
  originalSentinels = await preservation();
  safeFile(HOME + '/runtime/index.html', '<div id="root"></div><script type="module" src="/entry.tsx"></script>');
  safeFile(HOME + '/runtime/entry.tsx', `import React from '/dev-server/node_modules/react';
    import {createRoot} from '/dev-server/node_modules/react-dom/client';
    import Shell from '/dev-server/tests/integration/fixtures/phaseHJ1CConnectedCards.tsx';
    import '/dev-server/src/index.css';
    createRoot(document.getElementById('root')).render(<Shell/>);`);
  safeFile(HOME + '/runtime/vite.config.mjs', `import {defineConfig} from '/dev-server/node_modules/vite/dist/node/index.js';
    import react from '/dev-server/node_modules/@vitejs/plugin-react-swc/index.mjs';
    export default defineConfig({root:'${HOME}/runtime',envDir:false,cacheDir:'${HOME}/vite-cache',
      plugins:[react()],resolve:{alias:{'@':'/dev-server/src'},dedupe:['react','react-dom']},
      define:{'import.meta.env.VITE_SUPABASE_URL':${JSON.stringify(endpoint)},
        'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':${JSON.stringify(jwt('anon'))}},
      server:{host:'127.0.0.1',port:55445,strictPort:true,fs:{allow:['/dev-server','${HOME}']}}});`);
  run('/bin/node', [ROOT + '/node_modules/vite/bin/vite.js', '--config', HOME + '/runtime/vite.config.mjs']);
  await waitFor(async () => (await fetch(origin)).ok, 'isolated Vite health');
  browser = await chromium.launch({ headless: true });
  console.log('Native boundary ready: PG17.9 Unix-only; PostgREST13.0.7/Auth2.195.0/proxy/Vite loopback-only');
}, 60000);

async function preservation() {
  const names = ['profiles','admin_users','subscriptions','recruiter_profiles','opportunities',
    'driver_opportunity_profiles','driver_assistants','recruiter_members','agency_profiles',
    'agency_members','agency_entitlements','agency_client_requests','agency_delegation_requests',
    'owner_qa_sessions','qa_fixture_roots','marketplace_user_restrictions','hj1c_preservation_sentinels'];
  const result: Record<string, unknown> = {};
  for (const name of names) {
    result[name] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') AS x
      FROM public.${name} t`)).rows[0].x;
  }
  return result;
}
async function localPage(width = 1280, height = 1800) {
  if (!browser) throw new Error('Real browser absent');
  const context = await browser.newContext({ viewport: { width, height } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && [55444,55445].includes(Number(url.port))) return route.continue();
    forbiddenNetwork++;
    return route.abort();
  });
  await context.routeWebSocket('**/*', route => {
    if (route.url().includes('/realtime/')) { route.close(); return; }
    if (new URL(route.url()).hostname !== '127.0.0.1') { forbiddenNetwork++; route.close(); return; }
    route.connectToServer();
  });
  const page = await context.newPage();
  await page.goto(origin);
  return { page, context };
}
async function login(page: Page, actor: string) {
  await page.getByLabel('Email', { exact: true }).fill(`${actor}@hj1c.invalid`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
}
async function select(page: Page, label: string, value: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}
async function review(page: Page) {
  await page.getByRole('button', { name: 'Review my job-search card', exact: true }).click();
  await page.getByRole('heading', { name: 'My job-search card', exact: true }).waitFor();
  await waitFor(async () => await page.getByRole('button', { name: 'Review exact card' }).isEnabled(), 'settled owner status');
  await select(page, 'Experience qualifier', 'At least');
  await page.getByRole('button', { name: 'Review exact card', exact: true }).click();
  expect(await page.getByRole('heading', { name: 'Review before sharing' }).evaluate(el => el === document.activeElement)).toBe(true);
  expect(await page.getByRole('button', { name: 'Make me available to approved recruiters' }).isEnabled()).toBe(false);
  await page.getByRole('checkbox', { name: /I choose to share this exact/ }).check();
}

it('real wrong password fails; password sign-in, JWT actor, refresh and logout follow actual semantics', async () => {
  const wrong = await jsonRequest('http://127.0.0.1:55443/token?grant_type=password', null,
    { email: 'driver@hj1c.invalid', password: randomBytes(20).toString('hex') });
  expect(wrong.status).toBe(400);
  const claims = await jsonRequest(`${endpoint}/rest/v1/rpc/hj1c_actor`, sessions.driver.access_token, {});
  // The dedicated claims probe is created below only for this test, then removed.
  expect(claims.status).toBe(404);
  await db.query(`SET ROLE postgres; CREATE FUNCTION public.hj1c_actor() RETURNS uuid
    LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
    GRANT EXECUTE ON FUNCTION public.hj1c_actor() TO authenticated; RESET ROLE;
    NOTIFY pgrst,'reload schema';`);
  await waitFor(async () => (await rpc('hj1c_actor', {}, sessions.driver.access_token)).status === 200, 'claims probe');
  expect((await rpc('hj1c_actor', {}, sessions.driver.access_token)).data).toBe(ids.driver);
  const refreshed = await jsonRequest('http://127.0.0.1:55443/token?grant_type=refresh_token', null,
    { refresh_token: sessions.driver.refresh_token });
  expect(refreshed.status).toBe(200);
  expect(refreshed.data.refresh_token).not.toBe(sessions.driver.refresh_token);
  const logout = await jsonRequest('http://127.0.0.1:55443/logout', refreshed.data.access_token, {});
  expect(logout.status).toBe(204);
  const invalid = await jsonRequest('http://127.0.0.1:55443/token?grant_type=refresh_token', null,
    { refresh_token: refreshed.data.refresh_token });
  expect(invalid.status).toBe(400);
  // JWT verification is stateless: unexpired access JWT still identifies its actor.
  expect((await rpc('hj1c_actor', {}, refreshed.data.access_token)).data).toBe(ids.driver);
  await db.query("DROP FUNCTION public.hj1c_actor(); NOTIFY pgrst,'reload schema'");
  await seedFreshSession('driver');
});
async function seedFreshSession(actor: string) {
  const result = await jsonRequest('http://127.0.0.1:55443/token?grant_type=password', null,
    { email: `${actor}@hj1c.invalid`, password });
  expect(result.status).toBe(200);
  sessions[actor] = result.data;
}

it('roles, owner scope, canonical recruiter gates, and metadata forgery are denied over real HTTP', async () => {
  for (const token of [null, jwt('anon'), jwt('service_role')]) {
    expect((await rpc('manage_my_job_search_card', { _action: 'get' }, token)).status).toBeGreaterThanOrEqual(400);
  }
  expect((await rpc('manage_my_job_search_card', { _action: 'get' }, jwt('authenticated',ids.driver,1))).status).toBe(401);
  const bad = jwt('authenticated',ids.driver).split('.');
  bad[2] = randomBytes(32).toString('base64url');
  expect((await rpc('manage_my_job_search_card', { _action: 'get' }, bad.join('.'))).status).toBe(401);
  for (const actor of ['driver','staff','admin','pro']) {
    const result = await rpc('list_recruiter_job_search_cards', { _recruiter_id: workspace }, sessions[actor].access_token);
    expect(result.data.code).toBe('42501');
  }
  expect((await rpc('list_recruiter_job_search_cards', { _recruiter_id: randomUUID() }, sessions.recruiter.access_token)).data.code).toBe('42501');
  await db.query("UPDATE public.user_capabilities SET status='revoked' WHERE user_id=$1", [ids.recruiter]);
  expect((await rpc('list_recruiter_job_search_cards', { _recruiter_id: workspace }, sessions.recruiter.access_token)).data.code).toBe('42501');
  await db.query("UPDATE public.user_capabilities SET status='active' WHERE user_id=$1", [ids.recruiter]);
  await db.query("UPDATE public.recruiter_profiles SET verification_status='pending' WHERE id=$1", [workspace]);
  expect((await rpc('list_recruiter_job_search_cards', { _recruiter_id: workspace }, sessions.recruiter.access_token)).data.code).toBe('42501');
  await db.query("UPDATE public.recruiter_profiles SET verification_status='approved' WHERE id=$1", [workspace]);
  expect((await own('other'))).toBe(null);
});

it('actual lifecycle HTTP receipts: validation, TTL, isolation, idempotency and current-state replay', async () => {
  expect((await rpc('manage_my_job_search_card', command('withdraw'), sessions.other.access_token)).data.code).toBe('22023');
  const invalid = command('publish');
  expect((await rpc('manage_my_job_search_card', { ...invalid, _payload: { ...payload, phone:'not allowed' } }, sessions.driver.access_token)).data.code).toBe('22023');
  const publish = command('publish');
  const first = await rpc('manage_my_job_search_card', publish, sessions.driver.access_token);
  expect(first.status).toBe(200);
  expect(Date.parse(first.data.expires_at) - Date.parse(first.data.published_at)).toBe(14 * 86400000);
  expect(await own('other')).toBe(null);
  expect((await rpc('manage_my_job_search_card', command('pause',0), sessions.driver.access_token)).data.code).toBe('40001');
  await rpc('manage_my_job_search_card', command('withdraw',first.data.revision), sessions.driver.access_token);
  const replay = await rpc('manage_my_job_search_card', publish, sessions.driver.access_token);
  expect(replay.data.status).toBe('withdrawn');
  expect((await db.query('SELECT count(*)::int AS n FROM job_search_private.job_search_card_events WHERE client_command_id=$1',
    [publish._client_command_id])).rows[0].n).toBe(1);
});

it('private schema and table access are blocked; runtime database role has no bypass', async () => {
  const roles = (await db.query(`SELECT rolname,rolsuper,rolbypassrls,rolinherit FROM pg_roles
    WHERE rolname IN ('postgres','authenticator') ORDER BY rolname`)).rows;
  expect(roles).toEqual([
    { rolname:'authenticator',rolsuper:false,rolbypassrls:false,rolinherit:false },
    { rolname:'postgres',rolsuper:false,rolbypassrls:true,rolinherit:true },
  ]);
  expect((await db.query('SHOW listen_addresses')).rows[0].listen_addresses).toBe('');
  const runtime = new Client({ host:SOCKET,port:55441,user:'authenticator',database:'postgres',password:dbPassword,ssl:false });
  await runtime.connect();
  try {
    await expect(runtime.query('SELECT * FROM job_search_private.driver_job_search_cards')).rejects.toMatchObject({ code:'42501' });
  } finally { await runtime.end(); }
  const response = await fetch(`${endpoint}/rest/v1/driver_job_search_cards`, {
    headers:{ Authorization:`Bearer ${sessions.driver.access_token}`,'Accept-Profile':'job_search_private' },
  });
  expect(response.status).toBe(406);
  expect((await jsonRequest(`${endpoint}/rest/v1/driver_job_search_cards`, sessions.driver.access_token, {})).status).toBe(404);
});

it('real PostgREST microsecond keyset round trips bounded pages and employment-only projection', async () => {
  const current = await own('driver');
  await rpc('manage_my_job_search_card',command('publish',current.revision),sessions.driver.access_token);
  await rpc('manage_my_job_search_card',command('publish'),sessions.other.access_token);
  await db.query(`UPDATE job_search_private.driver_job_search_cards SET published_at =
    CASE WHEN owner_user_id=$1 THEN '2026-10-24T00:00:00.000002Z'::timestamptz
    ELSE '2026-10-24T00:00:00.000001Z'::timestamptz END`,[ids.driver]);
  const first = await rpc('list_recruiter_job_search_cards',{ _recruiter_id:workspace,_limit:1 },sessions.recruiter.access_token);
  expect(first.data).toHaveLength(1);
  const cursor = first.data[0];
  const second = await rpc('list_recruiter_job_search_cards',{
    _recruiter_id:workspace,_limit:1,_after_published_at:cursor.published_at,_after_card_id:cursor.id,
  },sessions.recruiter.access_token);
  expect(second.data).toHaveLength(1);
  expect(second.data[0].id).not.toBe(cursor.id);
  expect(cursor.published_at).toContain('000002');
  expect(second.data[0].published_at).toContain('000001');
  for (const card of [...first.data,...second.data]) {
    expect(Object.keys(card).sort()).toEqual(['expires_at','id','payload','published_at','revision']);
    expect(card.payload).toEqual(payload);
    expect(JSON.stringify(card)).not.toContain(ids.driver);
  }
  for (const actor of ['driver','other']) {
    const card = await own(actor);
    await rpc('manage_my_job_search_card',command('withdraw',card.revision),sessions[actor].access_token);
  }
  expect((await rpc('list_recruiter_job_search_cards',{ _recruiter_id:workspace },sessions.recruiter.access_token)).data).toEqual([]);
});

it('desktop and mobile real UI sign-in, exact review, publish, pause/withdraw and recruiter discovery', async () => {
  for (const [width,height] of [[1280,1800],[390,844]]) {
    const driver = await localPage(width,height);
    await login(driver.page,'driver');
    await review(driver.page);
    await driver.page.getByRole('button',{ name:'Make me available to approved recruiters' }).click();
    await driver.page.locator('strong[role="status"]').filter({ hasText:/^published$/ }).waitFor();
    expect(await driver.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await driver.page.getByRole('button',{ name:'Refresh session',exact:true }).click();
    await driver.page.getByText('Session refreshed',{ exact:true }).waitFor();
    await driver.page.screenshot({ path:`${HOME}/screenshots/${width}-driver.png` });
    const recruiter = await localPage(width,height);
    await login(recruiter.page,'recruiter');
    await recruiter.page.getByRole('button',{ name:'Open available drivers' }).click();
    await recruiter.page.getByRole('button',{ name:'Find available drivers',exact:true }).click();
    await recruiter.page.getByText(/^Card reference /).waitFor();
    expect(await recruiter.page.getByRole('button',{ name:/offer|message|contact/i }).count()).toBe(0);
    expect(await recruiter.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await recruiter.page.screenshot({ path:`${HOME}/screenshots/${width}-recruiter.png` });
    await driver.page.getByRole('button',{ name:'Pause',exact:true }).click();
    await driver.page.locator('strong[role="status"]').filter({ hasText:/^paused$/ }).waitFor();
    await recruiter.page.getByRole('button',{ name:'Refresh cards',exact:true }).click();
    await recruiter.page.getByText('No eligible available-driver cards on this page.').waitFor();
    await driver.page.getByRole('button',{ name:'Withdraw',exact:true }).click();
    await driver.page.locator('strong[role="status"]').filter({ hasText:/^withdrawn$/ }).waitFor();
    await driver.page.getByRole('button',{ name:'Sign out',exact:true }).click();
    await driver.page.getByRole('button',{ name:'Sign in',exact:true }).waitFor();
    expect(await driver.page.getByRole('heading',{ name:'My job-search card' }).count()).toBe(0);
    await driver.context.close();
    await recruiter.context.close();
  }
},60000);

it('connected unknown publication retains exact command after real response loss and current-state withdrawal', async () => {
  const {page,context} = await localPage();
  await login(page,'driver');
  await review(page);
  delayNextPublish = true;
  await page.getByRole('button',{name:'Make me available to approved recruiters'}).click();
  await page.getByText('Outcome not confirmed',{exact:true}).waitFor();
  expect(droppedCommand).not.toBe(null);
  const card = await own('driver');
  expect(card.status).toBe('published');
  await rpc('manage_my_job_search_card',command('withdraw',card.revision),sessions.driver.access_token);
  await page.getByRole('button',{name:'Retry same request',exact:true}).click();
  await page.locator('strong[role="status"]').filter({hasText:/^withdrawn$/}).waitFor();
  expect((await db.query('SELECT count(*)::int AS n FROM job_search_private.job_search_card_events WHERE client_command_id=$1',
    [droppedCommand])).rows[0].n).toBe(1);
  await context.close();
});

it('same-owner workspace switch with real held first-publication/get-null never falsely confirms privacy', async () => {
  await db.query('DELETE FROM job_search_private.job_search_card_events WHERE owner_user_id=$1',[ids.driver]);
  await db.query('DELETE FROM job_search_private.driver_job_search_cards WHERE owner_user_id=$1',[ids.driver]);
  await db.query("INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'recruiter','active')",[ids.driver]);
  const {page,context} = await localPage();
  await login(page,'driver');
  await review(page);
  holdNextPublish = true;
  await page.getByRole('button',{name:'Make me available to approved recruiters'}).click();
  await waitFor(async () => !!heldRequest,'held real publication');
  await page.getByRole('button',{name:'Switch workspace'}).click();
  expect(await own('driver')).toBe(null);
  expect(await page.getByText('Outcome not confirmed',{exact:true}).count()).toBe(1);
  expect(await page.getByText('No published card',{exact:true}).count()).toBe(0);
  heldRequest?.(); heldRequest = undefined;
  await page.locator('strong[role="status"]').filter({hasText:/^published$/}).waitFor();
  await page.getByRole('button',{name:'Withdraw',exact:true}).click();
  await page.locator('strong[role="status"]').filter({hasText:/^withdrawn$/}).waitFor();
  await context.close();
  await db.query("DELETE FROM public.user_capabilities WHERE user_id=$1 AND capability='recruiter'",[ids.driver]);
});

it('actual assistant delegation denies connected personal card while preserving canonical managed-driver lookup', async () => {
  const managed = await rpc('get_my_managed_drivers',{},sessions.assistant.access_token);
  expect(managed.data).toHaveLength(1);
  const {page,context} = await localPage();
  await login(page,'assistant');
  await page.getByRole('button',{name:'Act for synthetic driver'}).click();
  await page.getByRole('button',{name:'Review my job-search card',exact:true}).click();
  expect(await page.getByRole('heading',{name:'My job-search card'}).count()).toBe(0);
  expect(await own('assistant')).toBe(null);
  await context.close();
});

it('final fixture inventory and unrelated synthetic state unchanged; no external requests or self-heal calls', async () => {
  expect(await inventory()).toEqual(originalInventory);
  expect(await preservation()).toEqual(originalSentinels);
  expect(forbiddenNetwork).toBe(0);
  expect(selfHealCalls).toBe(0);
});

afterAll(async () => {
  heldRequest = undefined;
  await browser?.close();
  if (proxy) await new Promise<void>(resolve => proxy?.close(() => resolve()));
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => child.once('exit',resolve)),
        new Promise(resolve => setTimeout(resolve,2000)),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
  await db?.end().catch(() => {});
  if (clusterStarted) {
    execFileSync('/bin/runuser',['-u','lovable','--','/bin/pg_ctl','-D',HOME+'/cluster','-m','immediate','-w','stop'],
      {env:childEnv});
  }
  for (const port of Object.values(ports)) await portFree(port);
  console.log('Owned native processes stopped; all five reserved ports free');
},15000);
