// @vitest-environment node
/**
 * Reproducible HJ-1C native boundary. Requires the two checksum-verified official
 * archives/executables under /tmp/hj1c/bin. Never connects to a hosted backend.
 * Run with an external Vitest config (see final report); owns and tears down
 * PostgreSQL, Auth, PostgREST, routing-only proxy, Vite, and browser contexts.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from 'pg';
import type { Browser, Page } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import { createConnection, createServer as createNetServer } from 'node:net';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = '/dev-server';
const HJ1C_ROOT = '/tmp/hj1c';
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
const childEnv = { PATH: '/usr/local/bin:/bin:/usr/bin', HOME: HJ1C_ROOT, LANG: 'C.UTF-8', TZ: 'UTC' };
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
const droppedIds = new Set<string>();
let delayNextPublish = false;
let heldRequest: (() => void) | undefined;
let holdNextPublish = false;
let forbiddenNetwork = 0;
let selfHealCalls = 0;
let selfHealAnonAllowed = 0;
const selfHealActors = new Set<string>();
let originalInventory: Record<string, unknown[]>;
let preCandidateInventory: Record<string, unknown[]>;
let originalSentinels: unknown;
let workspace = randomUUID();

function jwt(role: string, sub?: string, exp = Math.floor(Date.now() / 1000) + 3600) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, sub, exp, aud: 'authenticated' })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
function safeFile(file: string, text: string) {
  if (!file.startsWith(HJ1C_ROOT + '/')) throw new Error('Nonlocal temporary file');
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600);
}
function run(binary: string, args: string[], extra: Record<string, string> = {}) {
  const child = spawn(binary, args, {
    cwd: HJ1C_ROOT + '/runtime', env: { ...childEnv, ...extra }, stdio: 'ignore',
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
    'CREATE (?:OR REPLACE )?FUNCTION public\\.' + name + '\\([\\s\\S]*?AS (\\$\\w*\\$)[\\s\\S]*?\\1;', 'i',
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
  const response = await fetch(url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
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
  // Expanded catalog: schema/table ACLs, RLS/force-RLS flags, constraints,
  // triggers (internal cross-schema FK triggers excluded), policies, columns,
  // and function definitions/ACLs. Column-level privileges are not used by the
  // candidate or fixture and are out of scope.
  return (await db.query(`SELECT jsonb_build_object(
    'schemas', (SELECT jsonb_agg(jsonb_build_object('name',n.nspname,'acl',n.nspacl::text) ORDER BY n.nspname)
      FROM pg_namespace n WHERE n.nspname IN ('public','job_search_private')),
    'tables', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'acl',c.relacl::text,
        'rls',c.relrowsecurity,'force',c.relforcerowsecurity) ORDER BY n.nspname,c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','job_search_private') AND c.relkind='r'),
    'columns', (SELECT jsonb_agg(to_jsonb(x) ORDER BY table_name,ordinal_position)
      FROM information_schema.columns x WHERE table_schema IN ('public','job_search_private')),
    'constraints', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',con.conname,
        'definition',pg_get_constraintdef(con.oid)) ORDER BY n.nspname,c.relname,con.conname)
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','job_search_private')),
    'policies', (SELECT jsonb_agg(to_jsonb(x) ORDER BY schemaname,tablename,policyname)
      FROM pg_policies x WHERE schemaname IN ('public','job_search_private')),
    'triggers', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,
        'definition',pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','job_search_private') AND NOT t.tgisinternal),
    'functions', (SELECT jsonb_agg(jsonb_build_object('def',pg_get_functiondef(p.oid),'acl',p.proacl::text)
      ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','job_search_private') AND p.prokind='f')
  ) AS x`)).rows[0].x;
}
function assertCatalogPreserved(before: Record<string, unknown[]>, after: Record<string, unknown[]>) {
  // Every preexisting catalog object must be byte-identical after the candidate
  // and after the full runtime; additions (the new card objects) are allowed.
  for (const key of Object.keys(before)) {
    const afterEntries = new Set((after[key] ?? []).map(entry => JSON.stringify(entry)));
    for (const entry of before[key] ?? []) {
      expect(afterEntries.has(JSON.stringify(entry)),
        `${key} preexisting entry preserved: ${JSON.stringify(entry).slice(0, 200)}`).toBe(true);
    }
  }
}

beforeAll(async () => {
  for (const [archive, expected] of [
    ['postgrest', '4153f81ccc40e7b735edc89cd84b49da25ba27eb37d57c7f6a82c9005a0b762b'],
    ['auth', '6f8065fcd708df7c09c83e1fb96b0c9507f6e2600e6a78a540153b92a49cd1f9'],
  ]) {
    expect(createHash('sha256').update(readFileSync(`${HJ1C_ROOT}/bin/${archive}.tar.xz`)).digest('hex')).toBe(expected);
  }
  for (const port of Object.values(ports)) await portFree(port);
  rmSync(HJ1C_ROOT + '/cluster', { recursive: true, force: true });
  rmSync(HJ1C_ROOT + '/vite-cache', { recursive: true, force: true });
  for (const dir of ['runtime', 'cluster', 'socket', 'screenshots']) mkdirSync(`${HJ1C_ROOT}/${dir}`, { recursive: true });
  // PostgreSQL cannot run as root. Only its disposable directories belong to lovable.
  chmodSync(HJ1C_ROOT, 0o711);
  execFileSync('/bin/chown', ['-R', 'lovable:lovable', HJ1C_ROOT + '/cluster', SOCKET]);
  execFileSync('/bin/initdb', ['-D', HJ1C_ROOT + '/cluster',
    '--username=lovable', '--auth-local=trust', '--auth-host=reject', '--no-locale'],
  { env: childEnv, uid: 1000, gid: 1000 });
  execFileSync('/bin/pg_ctl', ['-D', HJ1C_ROOT + '/cluster',
    '-l', HJ1C_ROOT + '/cluster/server.log', '-o', `-k ${SOCKET} -p 55441 -c listen_addresses=''`, '-w', 'start'],
  { env: childEnv, uid: 1000, gid: 1000 });
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
    ALTER ROLE supabase_auth_admin SET search_path TO auth;
    ALTER SCHEMA public OWNER TO postgres;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role,postgres;
    GRANT CREATE ON SCHEMA public TO postgres;
    GRANT CREATE ON DATABASE postgres TO postgres;
    CREATE EXTENSION citext WITH SCHEMA public;`);
  const authEnv = {
    GOTRUE_API_HOST: '127.0.0.1', PORT: '55443',
    API_EXTERNAL_URL: endpoint + '/auth/v1', GOTRUE_SITE_URL: origin,
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_NAMESPACE: 'auth',
    DATABASE_URL: `postgresql://supabase_auth_admin:${dbPassword}@/postgres?host=${SOCKET}&port=55441&sslmode=disable`,
    GOTRUE_DB_MIGRATIONS_PATH: HJ1C_ROOT + '/bin/auth/migrations',
    GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_EXP: '3600',
    GOTRUE_DISABLE_SIGNUP: 'true', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_SMTP_HOST: '127.0.0.1', GOTRUE_SMTP_PORT: '55446',
    GOTRUE_TRACING_ENABLED: 'false', GOTRUE_METRICS_ENABLED: 'false', LOG_LEVEL: 'error',
  };
  try {
    execFileSync(HJ1C_ROOT + '/bin/auth/auth', ['migrate'], {
      cwd: HJ1C_ROOT + '/runtime', env: { ...childEnv, ...authEnv }, stdio: 'pipe',
    });
  } catch (failure) {
    const error = failure as { stdout?: Buffer; stderr?: Buffer };
    const redacted = Buffer.concat([error.stdout ?? Buffer.alloc(0), error.stderr ?? Buffer.alloc(0)])
      .toString().replaceAll(secret, '[redacted]').replaceAll(dbPassword, '[redacted]');
    throw new Error('Local Auth migration failed: ' + redacted);
  }
  run(HJ1C_ROOT + '/bin/auth/auth', ['serve'], authEnv);
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
      public.get_my_recruiter_staff_workspaces(),public.is_recruiter_workspace_owner(uuid),
      public.ensure_my_recruiter_setup_state() TO authenticated;
    CREATE POLICY admin_self_read ON public.admin_users FOR SELECT TO authenticated
      USING (public.is_admin(auth.uid()));`);
  // Baseline catalog of preexisting objects BEFORE the candidates apply.
  preCandidateInventory = await inventory();
  for (const file of sqlPaths) await db.query(source(file));
  await db.query('RESET ROLE');
  safeFile(HJ1C_ROOT + '/runtime/postgrest.conf', `db-uri = "postgresql://authenticator:${dbPassword}@/postgres?host=${SOCKET}&port=55441&sslmode=disable"
    db-schemas = "public"
    db-anon-role = "anon"
    jwt-secret = "${secret}"
    server-host = "127.0.0.1"
    server-port = 55442
    db-config = false
    log-level = "crit"
  `);
  run(HJ1C_ROOT + '/bin/postgrest/postgrest', [HJ1C_ROOT + '/runtime/postgrest.conf']);
  await waitFor(async () => (await fetch('http://127.0.0.1:55442/')).ok, 'real PostgREST health');
  proxy = createServer((req, res) => {
    const auth = req.url?.startsWith('/auth/v1/');
    const rest = req.url?.startsWith('/rest/v1/');
    if (!auth && !rest) { res.writeHead(404).end(); return; }
    // Classify the caller by exact in-memory session token match. Tokens are
    // never logged; only the synthetic actor name and request line are.
    const bearer = String(req.headers.authorization ?? '');
    // Classify by JWT subject claim only; the token itself is never logged.
    const sub = (() => {
      try {
        return String(JSON.parse(Buffer.from(bearer.split(' ')[1].split('.')[1], 'base64url').toString()).sub ?? '');
      } catch { return ''; }
    })();
    const actor = Object.entries(ids).find(([, id]) => id === sub)?.[0] ?? 'anon/other';
    const isSelfHeal = req.url?.includes('ensure_my_recruiter_setup_state');
    if (isSelfHeal) { selfHealCalls++; selfHealActors.add(actor); }
    const arrived = Date.now();
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
        console.log('[proxy-arrive]', arrived, actor, `action=${action}`, `cmd=${String(commandId).slice(0, 8)}`, `reqport=${req.socket.remotePort}`);
      }
      const forward = () => {
        const target = request({
          hostname: '127.0.0.1', port: auth ? 55443 : 55442,
          path: req.url?.replace(auth ? '/auth/v1' : '/rest/v1', ''),
          method: req.method, headers: { ...req.headers, host: '127.0.0.1' },
        }, upstream => {
          console.log('[proxy]', Date.now(), actor, req.method, req.url?.split('?')[0], '->', upstream.statusCode,
            action ? `action=${action}` : '', commandId ? `cmd=${commandId.slice(0, 8)}` : '',
            `reqport=${req.socket.remotePort}`);
          // Traced: the browser transport transparently replays the in-memory
          // POST on a fresh socket ~6ms after a destroyed response (identical
          // _client_command_id, no application resubmit). The unknown-outcome
          // simulation must therefore poison the original response AND every
          // transport replay of the same command; the server still executes
          // each one, and the canonical RPC's client_command_id idempotency
          // (asserted below: exactly one event) absorbs the duplicate.
          if (action === 'publish' && commandId && (delayNextPublish || droppedIds.has(commandId))) {
            delayNextPublish = false;
            droppedCommand = commandId;
            droppedIds.add(commandId);
            upstream.resume();
            upstream.on('end', () => {
              res.writeHead(200, { 'content-type': 'application/json', 'content-length': '1048576' });
              res.write('{"truncated"');
              res.destroy();
            });
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
  safeFile(HJ1C_ROOT + '/runtime/index.html', '<div id="root"></div><script type="module" src="/entry.tsx"></script>');
  // Serve the real stylesheet minus its external font @import: the isolated
  // browser must never attempt external egress, and index.css is frozen.
  safeFile(HJ1C_ROOT + '/runtime/sanitized.css', readFileSync(ROOT + '/src/index.css', 'utf8')
    .split('\n').filter(line => !line.includes('@import')).join('\n'));
  safeFile(HJ1C_ROOT + '/runtime/entry.tsx', `import React from 'react';
    import {createRoot} from 'react-dom/client';
    import Shell from '/dev-server/tests/integration/fixtures/phaseHJ1CConnectedCards.tsx';
    import './sanitized.css';
    createRoot(document.getElementById('root')).render(<Shell/>);`);
  safeFile(HJ1C_ROOT + '/runtime/vite.config.mjs', `import {defineConfig} from '/dev-server/node_modules/vite/dist/node/index.js';
    import react from '/dev-server/node_modules/@vitejs/plugin-react-swc/index.js';
    export default defineConfig({root:'${HJ1C_ROOT}/runtime',envDir:false,cacheDir:'${HJ1C_ROOT}/vite-cache',
      plugins:[react()],resolve:{alias:{'@':'/dev-server/src',
        'react/jsx-dev-runtime':'/dev-server/node_modules/react/jsx-dev-runtime.js',
        'react/jsx-runtime':'/dev-server/node_modules/react/jsx-runtime.js',
        'react-dom/client':'/dev-server/node_modules/react-dom/client.js',
        'react-dom':'/dev-server/node_modules/react-dom',
        'react':'/dev-server/node_modules/react'},dedupe:['react','react-dom']},
      server:{host:'127.0.0.1',port:55445,strictPort:true,fs:{allow:['/dev-server','${HJ1C_ROOT}']}}});`);
  // Synthetic local endpoint/key arrive via the child process environment:
  // Vite serializes VITE_* process env into import.meta.env correctly, while
  // `define` values for import.meta.env.* are inlined unquoted in dev.
  run('/bin/node', [ROOT + '/node_modules/vite/bin/vite.js', '--config', HJ1C_ROOT + '/runtime/vite.config.mjs'],
    { VITE_SUPABASE_URL: endpoint, VITE_SUPABASE_PUBLISHABLE_KEY: jwt('anon') });
  await waitFor(async () => (await fetch(origin)).ok, 'isolated Vite health');
  console.log('Native boundary ready: PG17.9 Unix-only; PostgREST13.0.7/Auth2.195.0/proxy/Vite loopback-only');
}, 60000);

async function preservation() {
  const names = ['profiles','admin_users','subscriptions','recruiter_profiles','opportunities',
    'driver_opportunity_profiles','driver_assistants','recruiter_members','agency_profiles',
    'agency_members','agency_entitlements','agency_client_requests','agency_delegation_requests',
    'owner_qa_sessions','qa_fixture_roots','marketplace_user_restrictions','user_capabilities',
    'hj1c_preservation_sentinels'];
  const result: Record<string, unknown> = {};
  for (const name of names) {
    result[name] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') AS x
      FROM public.${name} t`)).rows[0].x;
  }
  return result;
}
async function localPage(width = 1280, height = 1800) {
  if (!browser) {
    let existingDriver: string | undefined;
    // Bounded discovery: standard locations, then the exact observed Nix store
    // Python of this sandbox (validated with existsSync before use; a portability
    // limit reported in the final evidence, never a global symlink/alias).
    const pythonCandidates = ['/usr/local/bin/python3', '/usr/bin/python3', '/bin/python3',
      '/nix/store/a3czxrfpqrw5zrcbl7lw573qyaygxv0s-sandbox-python-env/bin/python3'];
    for (const python of pythonCandidates) {
      if (!existsSync(python)) continue;
      try {
        existingDriver = execFileSync(python, ['-c',
          'import pathlib,playwright; print(pathlib.Path(playwright.__file__).parent/"driver"/"package"/"index.mjs")'],
        { cwd: HJ1C_ROOT + '/runtime', env: childEnv }).toString().trim();
        if (existingDriver && existsSync(existingDriver)) break;
        existingDriver = undefined;
      } catch {
        existingDriver = undefined;
      }
    }
    if (!existingDriver) throw new Error('An installed Python Playwright runtime is required');
    const { chromium } = await import(existingDriver);
    browser = await chromium.launch({ headless: true });
  }
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
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning')
      console.log(`[browser:${message.type()}]`, message.text().slice(0, 300));
  });
  page.on('pageerror', error => console.log('[browser:pageerror]', String(error).slice(0, 300)));
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
async function dumpReviewDiagnostics(page: Page, step: string) {
  // Sanitized harness state only: hook flags, mount transitions, element
  // counts. Never tokens, emails, passwords or capability constants.
  const diag = await page.getByTestId('hj1c-diag').textContent().catch(() => '<absent>');
  const mounts = await page.evaluate(() => (window as unknown as { __hj1cMounts?: string[] }).__hj1cMounts ?? []).catch(() => []);
  const authEvents = await page.evaluate(() => (window as unknown as { __hj1cAuthEvents?: string[] }).__hj1cAuthEvents ?? []).catch(() => []);
  console.log('[review-diag] auth-events=', JSON.stringify(authEvents));
  const counts = {
    reviewButton: await page.getByRole('button', { name: 'Review my job-search card', exact: true }).count(),
    heading: await page.getByRole('heading', { name: 'My job-search card', exact: true }).count(),
    reviewExact: await page.getByRole('button', { name: 'Review exact card' }).count(),
    reviewExactEnabled: await page.getByRole('button', { name: 'Review exact card' }).isEnabled().catch(() => false),
    loading: await page.getByText('Loading…', { exact: true }).count(),
    unavailable: await page.getByText('Job-search card management is unavailable in this account context.').count(),
  };
  const statuses = await page.locator('strong[role="status"]').allTextContents().catch(() => []);
  console.log(`[review-diag] step=${step} diag=${diag} mounts=${JSON.stringify(mounts)} counts=${JSON.stringify(counts)} statuses=${JSON.stringify(statuses)}`);
}
async function settledAuthority(page: Page, requireRole = true) {
  // Legitimate observable precondition: the real intake flow only offers the
  // handoff after sign-in authority has settled. Clicking earlier mounts the
  // card while personal=false, and the fail-closed handoff clear wipes the
  // one-shot seed before ConnectedDriverCard can consume it (traced cause of
  // the intermittent review-settle failure). Wait on existing hook values
  // exposed by the test-only shell; no sleeps, retries or reseeding.
  await waitFor(async () => {
    const text = await page.getByTestId('hj1c-diag').textContent().catch(() => null);
    if (!text) return false;
    const diag = JSON.parse(text);
    return diag.authLoading === false && diag.sessionMatch === true
      && diag.actingLoading === false && diag.viewLoading === false
      && diag.viewError === false && (!requireRole || diag.effectiveRole !== null);
  }, 'settled sign-in authority');
}
async function review(page: Page) {
  try {
    await settledAuthority(page);
    await page.getByRole('button', { name: 'Review my job-search card', exact: true }).click();
    await page.getByRole('heading', { name: 'My job-search card', exact: true }).waitFor();
    await waitFor(async () => await page.getByRole('button', { name: 'Review exact card' }).isEnabled(), 'settled owner status');
  } catch (failure) {
    await dumpReviewDiagnostics(page, 'settle');
    throw failure;
  }
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
  // Live catalog parity proof for the canonical setup RPC: authenticated may
  // execute, anon may not, and a real driver caller gets capability_missing
  // with no mutation (mutation-freedom proven by the final inventory check).
  const acl = (await db.query(`SELECT p.proacl::text AS acl FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='ensure_my_recruiter_setup_state'`)).rows[0].acl;
  expect(acl).toContain('authenticated=X');
  expect(acl).not.toContain('anon=X');
  const heal = await rpc('ensure_my_recruiter_setup_state', {}, sessions.driver.access_token);
  expect(heal.status).toBe(200);
  expect(heal.data[0].eligibility_state).toBe('capability_missing');
  expect((await rpc('ensure_my_recruiter_setup_state', {}, jwt('anon'))).status).toBeGreaterThanOrEqual(400);
});

it('actual lifecycle HTTP receipts: validation, TTL, isolation, idempotency and current-state replay', async () => {
  expect((await rpc('manage_my_job_search_card', command('withdraw'), sessions.other.access_token)).data.code).toBe('22023');
  const invalid = command('publish');
  expect((await rpc('manage_my_job_search_card', { ...invalid, _payload: { ...payload, phone:'not allowed' } }, sessions.driver.access_token)).data.code).toBe('22023');
  const publish = command('publish');
  console.log('Lifecycle: validation complete');
  const first = await rpc('manage_my_job_search_card', publish, sessions.driver.access_token);
  expect(first.status).toBe(200);
  expect(Date.parse(first.data.expires_at) - Date.parse(first.data.published_at)).toBe(14 * 86400000);
  expect(await own('other')).toBe(null);
  console.log('Lifecycle: publication and isolation complete');
  const staleStarted = performance.now();
  const stale = await jsonRequest('http://127.0.0.1:55444/rest/v1/rpc/manage_my_job_search_card',
    sessions.driver.access_token, command('pause',0));
  expect(stale.status).toBe(409);
  expect(stale.data.code).toBe('PT409');
  expect(performance.now() - staleStarted).toBeLessThan(3000);
  await rpc('manage_my_job_search_card', command('withdraw',first.data.revision), sessions.driver.access_token);
  console.log('Lifecycle: withdrawal complete');
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
    await driver.page.screenshot({ path:`${HJ1C_ROOT}/screenshots/${width}-driver.png` });
    const recruiter = await localPage(width,height);
    await login(recruiter.page,'recruiter');
    await recruiter.page.getByRole('button',{ name:'Open available drivers' }).click();
    await recruiter.page.getByRole('button',{ name:'Find available drivers',exact:true }).click();
    await recruiter.page.getByText(/^Card reference /).waitFor();
    expect(await recruiter.page.getByRole('button',{ name:/offer|message|contact/i }).count()).toBe(0);
    expect(await recruiter.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await recruiter.page.screenshot({ path:`${HJ1C_ROOT}/screenshots/${width}-recruiter.png` });
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
  // Test-only timeline sampler: pinpoints exactly which UI state transition
  // clears the uncertain publication (remount vs auth reset vs refresh).
  const timeline: string[] = [];
  let sampling = true;
  const sampler = (async () => {
    let last = '';
    while (sampling) {
      const status = await page.locator('strong[role="status"]').first().textContent().catch(() => '<gone>');
      const retry = await page.getByRole('button',{name:'Retry same request',exact:true}).count().catch(() => -1);
      const diag = await page.getByTestId('hj1c-diag').textContent().catch(() => '<absent>');
      const mounts = await page.evaluate(() => ((window as unknown as { __hj1cMounts?: string[] }).__hj1cMounts ?? []).length).catch(() => -1);
      const snap = `status=${status} retry=${retry} mounts=${mounts} diag=${diag}`;
      if (snap !== last) { timeline.push(`${Date.now()}: ${snap}`); last = snap; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  })();
  try {
    await login(page,'driver');
    await review(page);
    delayNextPublish = true;
    await page.getByRole('button',{name:'Make me available to approved recruiters'}).click();
    await page.getByText('Outcome not confirmed',{exact:true}).waitFor();
    // The uncertain state appears at dispatch time; wait until the proxy has
    // actually dropped the real upstream publish response before asserting.
    await waitFor(async () => droppedCommand !== null, 'dropped real publish response');
    const card = await own('driver');
    expect(card.status).toBe('published');
    await rpc('manage_my_job_search_card',command('withdraw',card.revision),sessions.driver.access_token);
    // The explicit user replay is legitimate: Retry enabled proves the
    // original fetch fully settled (busy cleared). Disarm ONLY this command's
    // fault so the real replay reaches the backend untouched.
    const retryButton = page.getByRole('button',{name:'Retry same request',exact:true});
    await waitFor(async () => await retryButton.isEnabled(), 'settled unknown publication');
    droppedIds.delete(droppedCommand!);
    await retryButton.click();
    await page.locator('strong[role="status"]').filter({hasText:/^withdrawn$/}).waitFor();
    expect((await db.query('SELECT count(*)::int AS n FROM job_search_private.job_search_card_events WHERE client_command_id=$1',
      [droppedCommand])).rows[0].n).toBe(1);
  } catch (failure) {
    console.log('[unknown-timeline]', JSON.stringify(timeline, null, 1));
    await dumpReviewDiagnostics(page, 'unknown-flow');
    throw failure;
  } finally {
    sampling = false;
    await sampler;
    // Clear owned fault state so later cases are never contaminated.
    delayNextPublish = false;
    droppedIds.clear();
    droppedCommand = null;
    await context.close();
  }
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

it('held first-account publication during real sign-out/sign-in swap never confirms or leaks under the second account', async () => {
  const {page,context} = await localPage();
  try {
    await login(page,'driver');
    await review(page);
    holdNextPublish = true;
    await page.getByRole('button',{name:'Make me available to approved recruiters'}).click();
    await waitFor(async () => !!heldRequest,'held real publication');
    // Real sign-out of A while its publish is still held, then real sign-in as B.
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
    await login(page,'other');
    // B must never see A's card, A's pending acknowledgment, or A's card status.
    // B may own a withdrawn card from earlier cases; it must never be published.
    expect(await page.getByRole('heading',{name:'My job-search card'}).count()).toBe(0);
    expect(await page.getByText('Outcome not confirmed',{exact:true}).count()).toBe(0);
    const otherBefore = await own('other');
    expect(otherBefore === null || otherBefore.status !== 'published').toBe(true);
    // Release A's held request: it finishes for A only, under A's identity.
    heldRequest?.(); heldRequest = undefined;
    await waitFor(async () => (await own('driver'))?.status === 'published', 'held publication completes for A');
    const otherAfter = await own('other');
    expect(otherAfter === null || otherAfter.status !== 'published').toBe(true);
    expect(await page.getByText('Outcome not confirmed',{exact:true}).count()).toBe(0);
    expect(await page.locator('strong[role="status"]').filter({hasText:/^published$/}).count()).toBe(0);
    const card = await own('driver');
    await rpc('manage_my_job_search_card',command('withdraw',card.revision),sessions.driver.access_token);
  } finally {
    holdNextPublish = false;
    if (heldRequest) { heldRequest(); heldRequest = undefined; }
    await context.close();
  }
});

it('revoked driver capability keeps real read/withdraw but denies fresh publish over HTTP and in the connected UI', async () => {
  const current = await own('driver');
  const first = await rpc('manage_my_job_search_card', command('publish', current?.revision ?? 0), sessions.driver.access_token);
  expect(first.status).toBe(200);
  await db.query("UPDATE public.user_capabilities SET status='revoked' WHERE user_id=$1 AND capability='driver'", [ids.driver]);
  try {
    // Read and withdraw remain available to the owner (canonical behavior).
    const card = await own('driver');
    expect(card.status).toBe('published');
    const withdrawn = await rpc('manage_my_job_search_card', command('withdraw', card.revision), sessions.driver.access_token);
    expect(withdrawn.data.status).toBe('withdrawn');
    // Fresh publish is denied by the canonical RPC over real HTTP.
    const denied = await rpc('manage_my_job_search_card', command('publish'), sessions.driver.access_token);
    expect(denied.data.code).toBe('42501');
    // Connected UI: publish control disabled, read/withdraw still presented.
    const {page,context} = await localPage();
    try {
      await login(page,'driver');
      // Revoked capability legitimately yields effectiveRole null; wait for
      // settled loading flags without requiring a workspace role.
      await settledAuthority(page, false);
      await page.getByRole('button',{name:'Review my job-search card',exact:true}).click();
      await page.getByRole('heading',{name:'My job-search card',exact:true}).waitFor();
      await page.locator('strong[role="status"]').filter({hasText:/^withdrawn$/}).waitFor();
      expect(await page.getByRole('button',{name:'Edit / review renewal'}).isDisabled()).toBe(true);
      expect(await page.getByText('You can still read and withdraw your own card.').count()).toBe(1);
    } finally { await context.close(); }
  } finally {
    // Restore the temporary local capability edit before preservation comparison.
    await db.query("UPDATE public.user_capabilities SET status='active' WHERE user_id=$1 AND capability='driver'", [ids.driver]);
  }
});

it('actual missing RPC is classified unavailable through the real SDK path and recovers after restore', async () => {
  await db.query('DROP FUNCTION public.manage_my_job_search_card(text,jsonb,integer,uuid,text)');
  await db.query("NOTIFY pgrst,'reload schema'");
  try {
    // Real PostgREST: function absent from the schema cache -> 404 PGRST202.
    await waitFor(async () => (await rpc('manage_my_job_search_card', { _action: 'get' }, sessions.driver.access_token)).status === 404, 'schema cache drop');
    const missing = await rpc('manage_my_job_search_card', { _action: 'get' }, sessions.driver.access_token);
    expect(missing.status).toBe(404);
    // PostgREST reports the absent function as PGRST202 or SQLSTATE 42883;
    // the real SDK failure() mapping classifies both as 'unavailable'.
    expect(['PGRST202', '42883']).toContain(missing.data.code);
    // Connected UI through the real SDK classifies it as unavailable.
    const {page,context} = await localPage();
    try {
      await login(page,'driver');
      await settledAuthority(page);
      await page.getByRole('button',{name:'Review my job-search card',exact:true}).click();
      await page.getByText('Job-search cards are not available right now.',{exact:true}).waitFor();
    } finally { await context.close(); }
  } finally {
    // Restore the exact canonical function and its candidate ACL, then reload.
    await db.query('SET ROLE postgres');
    await db.query(helper(sqlPaths[0], 'manage_my_job_search_card'));
    await db.query(`REVOKE ALL ON FUNCTION public.manage_my_job_search_card(text,jsonb,integer,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION public.manage_my_job_search_card(text,jsonb,integer,uuid,text) TO authenticated;`);
    await db.query('RESET ROLE');
    await db.query("NOTIFY pgrst,'reload schema'");
    await waitFor(async () => (await rpc('manage_my_job_search_card', { _action: 'get' }, sessions.driver.access_token)).status === 200, 'schema cache restore');
  }
});

it('final fixture inventory and unrelated synthetic state unchanged; no external requests or self-heal calls', async () => {
  const finalInventory = await inventory();
  expect(finalInventory).toEqual(originalInventory);
  // The candidates and the full runtime must not alter any preexisting
  // catalog object (schemas, table ACLs/RLS, columns, constraints, policies,
  // triggers, function definitions/ACLs); only new card objects may appear.
  assertCatalogPreserved(preCandidateInventory, originalInventory);
  assertCatalogPreserved(preCandidateInventory, finalInventory);
  expect(await preservation()).toEqual(originalSentinels);
  expect(forbiddenNetwork).toBe(0);
  // The preseeded approved recruiter must never trigger the self-heal RPC.
  // Non-recruiter shell logins do call it (the real hook self-heals any
  // signed-in user without a profile); the inventory check above proves
  // those caller-only calls mutated nothing.
  console.log('Self-heal calls by actor:', [...selfHealActors].join(',') || 'none', `(total ${selfHealCalls})`);
  expect(selfHealActors.has('recruiter')).toBe(false);
  // Only the synthetic accounts that actually signed into the shell without a
  // recruiter profile may appear (driver/assistant/other); no unknown actors,
  // and the preseeded approved recruiter must never trigger the RPC.
  expect([...selfHealActors].every(actor => ['driver', 'assistant', 'other'].includes(actor))).toBe(true);
});

afterAll(async () => {
  heldRequest = undefined;
  await browser?.close();
  if (proxy) {
    proxy.closeAllConnections();
    await new Promise<void>(resolve => proxy?.close(() => resolve()));
  }
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
    execFileSync('/bin/pg_ctl',['-D',HJ1C_ROOT+'/cluster','-m','immediate','-w','stop'],
      {env:childEnv,uid:1000,gid:1000});
  }
  for (const port of Object.values(ports)) await portFree(port);
  console.log('Owned native processes stopped; all five reserved ports free');
},15000);
