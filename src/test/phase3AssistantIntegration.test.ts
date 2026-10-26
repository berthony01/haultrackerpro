// @vitest-environment node
// Phase3B: ACTUAL handler + ACTUAL candidate SQL + exact canonical helpers under
// genuine SET ROLE. Only external token verification (auth.getUser) and the
// model transport are stubbed. Database scope decisions are never mocked.
// PGlite is a single serial connection: this is NOT concurrency proof.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootstrapPhase3, runAs, uid, sid } from './fixtures/phase3AssistantBootstrap';
import { handleAssistantRequest, buildContextText, LIMITS, MODEL_ID, type HandlerDeps } from '../../supabase/function-candidates/assistant-chat/handler';

let db: PGlite;
const A = uid(1), B = uid(2), STAFF = uid(3), AGENCY_STAFF = uid(4), FREE = uid(5), OTHER = uid(6);
const RECRUITER = uid(101), OTHER_RECRUITER = uid(102), AGENCY = uid(201), OTHER_AGENCY = uid(202), DELEGATION = uid(301);
const SECRET = 'SENTINEL_FORBIDDEN';

const ARG_TYPES: Record<string, string> = {
  _thread_id: 'uuid', _before: 'timestamptz', _before_id: 'uuid', _limit: 'integer', _offset: 'integer', _scope_kind: 'text',
  _target_id: 'uuid', _request_id: 'uuid', _content: 'text', _reservation_id: 'uuid', _message_id: 'uuid', _lease_id: 'uuid', _success: 'boolean', _sources: 'text[]',
};
const SCALAR = new Set(['assistant_delete_thread', 'assistant_clear_my_history', 'assistant_thread_live', 'assistant_thread_context']);
async function callRpc(actor: string | null, session: string | null, fn: string, args: Record<string, unknown>, role: 'authenticated' | 'service_role' = 'authenticated') {
  const keys = Object.keys(args);
  const sql = `SELECT * FROM public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}::${ARG_TYPES[k]}`).join(',')})`;
  try {
    const rows = await runAs<Record<string, unknown>>(db, actor, session, sql, keys.map((k) => args[k]), role);
    return { data: SCALAR.has(fn) ? rows[0]?.[fn] ?? null : rows, error: null };
  } catch (e) { return { data: null, error: { code: (e as { code?: string }).code ?? 'XX000' } }; }
}

// token -> verified identity (simulates auth.getUser). session_id is the JWT claim.
const tokens = new Map<string, { actor: string; session: string | null }>();
const tok = (actor: string, session: string | null = sid(Number(actor.slice(-12)))) => { const t = `tok-${actor}-${session}`; tokens.set(t, { actor, session }); return t; };
let modelCalls = 0;
let gatewayBodies: string[] = [];
let gateway: (body: string, signal: AbortSignal) => Promise<Response>;
const okReply = (text = 'Here is a grounded summary.') => async () => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
let enabled = true;

const deps: HandlerDeps = {
  config: { get enabled() { return enabled; } },
  verifyToken: async (t) => tokens.get(t)?.actor ?? null,
  userRpc: (t, fn, args) => { const id = tokens.get(t); return callRpc(id?.actor ?? null, id?.session ?? null, fn, args); },
  serviceFinalize: (a) => callRpc(null, null, 'assistant_finalize_turn', { _reservation_id: a.reservationId, _lease_id: a.leaseId, _success: a.success, _content: a.content, _sources: a.sources }, 'service_role'),
  gatewayFetch: async (body, signal) => { modelCalls++; gatewayBodies.push(body); return gateway(body, signal); },
};
async function call(token: string | null, body: unknown, raw?: string, d: HandlerDeps = deps) {
  const res = await handleAssistantRequest(new Request('http://local/assistant-chat', {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: raw ?? JSON.stringify(body),
  }), d);
  return { status: res.status, body: await res.json() as any };
}
let reqN = 1000;
const rid = () => uid(++reqN);
const send = (token: string, extra: Record<string, unknown>, content = 'What happened recently?') => call(token, { action: 'send', requestId: rid(), content, ...extra });
const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);

beforeAll(async () => { db = await bootstrapPhase3(); }, 60000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  modelCalls = 0; gatewayBodies = []; gateway = okReply(); enabled = true; tokens.clear();
  await db.exec(`TRUNCATE public.profiles,auth.users,public.subscriptions,public.admin_users,public.recruiter_profiles,public.agency_profiles,public.driver_assistants,public.user_capabilities,public.owner_qa_sessions,public.qa_fixture_roots,public.loads,public.expenses CASCADE`);
  for (let n = 1; n <= 10; n++) {
    await db.query('INSERT INTO auth.users(id) VALUES($1)', [uid(n)]);
    await db.query('INSERT INTO public.profiles(user_id,display_name) VALUES($1,$2)', [uid(n), `Driver ${n}`]);
    await db.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)', [sid(n), uid(n)]);
  }
  await db.exec(`
  INSERT INTO public.user_capabilities(user_id,capability,status) VALUES('${A}','driver','active'),('${A}','recruiter','active'),('${B}','driver','active'),('${B}','recruiter','active'),('${FREE}','driver','active');
  INSERT INTO public.subscriptions VALUES('${A}','pro_monthly','active'),('${B}','pro_yearly','active');
  INSERT INTO public.recruiter_profiles(id,user_id,recruiter_name,company_name,recruiter_email,company_type,posting_terms_accepted_at) VALUES('${RECRUITER}','${A}','Owner','Local Company','l@example.invalid','independent_recruiter',now()),('${OTHER_RECRUITER}','${B}','Other','Other Company','o@example.invalid','carrier',now());
  UPDATE public.recruiter_profiles SET dot_number='x' WHERE id='${OTHER_RECRUITER}';
  INSERT INTO public.recruiter_billing_profiles VALUES('${RECRUITER}','${A}','starter','active'),('${OTHER_RECRUITER}','${B}','growth','active');
  INSERT INTO public.recruiter_members(recruiter_id,member_user_id,role,status,permissions) VALUES('${RECRUITER}','${A}','recruiter_owner','active','{}'),('${RECRUITER}','${STAFF}','recruiter_staff','active','{"opportunities_view":true}');
  INSERT INTO public.agency_profiles(id,owner_user_id,name) VALUES('${AGENCY}','${B}','Local Agency'),('${OTHER_AGENCY}','${OTHER}','Other Agency');
  INSERT INTO public.agency_entitlements(agency_id,plan_key,status,source) VALUES('${AGENCY}','agency_starter','active','stripe'),('${OTHER_AGENCY}','agency_team','active','stripe');
  INSERT INTO public.agency_members(agency_id,member_user_id,role,status,workspace_permissions) VALUES('${AGENCY}','${B}','agency_owner','active','{}'),('${AGENCY}','${AGENCY_STAFF}','agency_member','active','{"packages_view":true}'),('${OTHER_AGENCY}','${OTHER}','agency_owner','active','{}');
  INSERT INTO public.agency_delegation_requests(id,agency_id,driver_user_id,member_user_id,status,requested_permissions) VALUES('${DELEGATION}','${AGENCY}','${FREE}','${AGENCY_STAFF}','approved','{"manage_loads":true,"view_reports":true}');
  INSERT INTO public.driver_assistants(driver_user_id,assistant_user_id,status,permissions,agency_delegation_id) VALUES('${FREE}','${AGENCY_STAFF}','active','{"manage_loads":true,"view_reports":true}','${DELEGATION}'),('${A}','${STAFF}','active','{"manage_loads":true}',NULL);
  INSERT INTO public.loads(user_id,load_date,estimated_pay,notes,broker_name_raw,load_reference) SELECT '${A}',date '2026-01-01'+g,1000+g,'${SECRET}','${SECRET}','${SECRET}' FROM generate_series(1,25) g;
  INSERT INTO public.loads(user_id,load_date,estimated_pay,notes) VALUES('${B}','2026-02-01',7777,'${SECRET}'),('${FREE}','2026-03-01',4242,'${SECRET}');
  INSERT INTO public.expenses(user_id,expense_date,category,amount,notes) VALUES('${A}','2026-01-05','fuel',321,'${SECRET}'),('${B}','2026-01-05','fuel',999,'${SECRET}');
  INSERT INTO public.opportunities(id,recruiter_id,title,status,description) VALUES('${uid(401)}','${RECRUITER}','Regional CDL-A','published','${SECRET}'),('${uid(402)}','${OTHER_RECRUITER}','Other tenant job','published','${SECRET}');
  INSERT INTO public.opportunity_applications(opportunity_id,recruiter_id,driver_user_id,status,driver_email_snapshot,driver_phone_snapshot,message) VALUES('${uid(401)}','${RECRUITER}','${FREE}','submitted','${SECRET}','${SECRET}','${SECRET}'),('${uid(402)}','${OTHER_RECRUITER}','${FREE}','hired','${SECRET}',NULL,NULL);
  INSERT INTO public.conversation_threads(recruiter_id,driver_user_id,initiated_by_user_id,status) VALUES('${RECRUITER}','${FREE}','${A}','active'),('${OTHER_RECRUITER}','${FREE}','${B}','closed');
  INSERT INTO public.agency_service_packages(agency_id,name,description,price_display_text) VALUES('${AGENCY}','Bookkeeping','${SECRET}','$99'),('${OTHER_AGENCY}','Other pkg','${SECRET}','$1');
  INSERT INTO public.agency_work_items(agency_id,driver_user_id,description,status) VALUES('${AGENCY}','${FREE}','${SECRET}','open'),('${OTHER_AGENCY}','${FREE}','${SECRET}','completed');
  INSERT INTO public.agency_client_requests(agency_id,driver_user_id,phone,message,status) VALUES('${AGENCY}','${FREE}','${SECRET}','${SECRET}','pending');
  `);
});

describe('Phase3B assistant-chat handler against actual candidate SQL', () => {
  it('bootstrap lists only server-authorized contexts with exact per-context tools', async () => {
    const a = await call(tok(A), { action: 'bootstrap' });
    expect(a.status).toBe(200); expect(a.body.retentionDays).toBe(30);
    expect(a.body.contexts.map((c: any) => [c.scope, c.label, c.tools])).toEqual([
      ['driver_self', 'My driver workspace', ['loads', 'expenses']],
      ['recruiter', 'Local Company', ['opportunities', 'applications', 'conversations']],
    ]);
    const staff = await call(tok(STAFF), { action: 'bootstrap' });
    expect(staff.body.contexts.map((c: any) => [c.scope, c.targetId, c.label, c.tools])).toEqual([
      ['driver_delegate', A, 'Driver 1', ['loads']], ['recruiter', RECRUITER, 'Local Company', ['opportunities']],
    ]);
    const b = await call(tok(B), { action: 'bootstrap' });
    expect(b.body.contexts.map((c: any) => c.scope)).toEqual(['driver_self', 'agency']); // canonical dual-paid recruiter conflict excluded
    const ag = await call(tok(AGENCY_STAFF), { action: 'bootstrap' });
    expect(ag.body.contexts.map((c: any) => [c.scope, c.targetId, c.tools])).toEqual([['driver_delegate', FREE, ['loads', 'expenses']], ['agency', AGENCY, ['packages']]]); // view_reports covers expenses
    expect((await call(tok(FREE), { action: 'bootstrap' })).body.contexts).toEqual([]);
  });

  it('driver self send: one model call, explicit-target projection, persisted reply with server source cards', async () => {
    const r = await send(tok(A), { scope: 'driver_self', targetId: A });
    expect(r.status).toBe(200); expect(modelCalls).toBe(1);
    const sent = JSON.parse(gatewayBodies[0]);
    expect(sent.model).toBe(MODEL_ID); expect(sent.max_tokens).toBe(768); expect(sent.stream).toBe(false);
    const ctx = gatewayBodies[0];
    expect(ctx).not.toContain(SECRET); expect(ctx).not.toContain('7777'); expect(ctx).not.toContain('4242'); expect(ctx).toMatch(/has_more\\\\?":true/);
    expect((ctx.match(/load_date/g) ?? []).length).toBe(20);
    expect(r.body.reply.sources).toEqual([{ key: 'expenses', label: 'Your expenses (most recent)', href: '/dashboard?page=expenses' }, { key: 'loads', label: 'Your loads (most recent)', href: '/dashboard?page=loads' }]);
    const m = await call(tok(A), { action: 'messages', threadId: r.body.threadId });
    expect(m.body.messages.map((x: any) => x.role)).toEqual(['assistant', 'user']);
  });

  it('direct delegate sees only the exact target and granted domain', async () => {
    const r = await send(tok(STAFF), { scope: 'driver_delegate', targetId: A });
    expect(r.status).toBe(200);
    const body = gatewayBodies[0];
    expect(body).toContain('load_date'); expect(body).not.toContain('expense_date'); expect(body).not.toContain(SECRET);
  });

  it('agency delegate reads only the approved managed driver loads', async () => {
    const r = await send(tok(AGENCY_STAFF), { scope: 'driver_delegate', targetId: FREE });
    expect(r.status).toBe(200); expect(gatewayBodies[0]).toContain('4242'); expect(gatewayBodies[0]).not.toContain('1001');
  });

  it('recruiter projection: own tenant only, counts only, no driver identity/contact', async () => {
    const r = await send(tok(A), { scope: 'recruiter', targetId: RECRUITER });
    expect(r.status).toBe(200); const b = gatewayBodies[0];
    expect(b).toContain('Regional CDL-A'); expect(b).not.toContain('Other tenant job'); expect(b).not.toContain(SECRET); expect(b).not.toContain(FREE); expect(b).not.toContain('hired');
    expect(b).toContain('submitted'); expect(b).toContain('active');
  });

  it('agency projection: packages without description; tenant-bound counts', async () => {
    const r = await send(tok(B), { scope: 'agency', targetId: AGENCY });
    expect(r.status).toBe(200); const b = gatewayBodies[0];
    expect(b).toContain('Bookkeeping'); expect(b).not.toContain('Other pkg'); expect(b).not.toContain(SECRET); expect(b).not.toContain('completed');
  });

  it.each([
    ['free driver', () => tok(FREE), { scope: 'driver_self', targetId: FREE }],
    ['wrong target', () => tok(A), { scope: 'driver_self', targetId: B }],
    ['foreign tenant', () => tok(STAFF), { scope: 'recruiter', targetId: OTHER_RECRUITER }],
    ['missing session_id', () => tok(A, null), { scope: 'driver_self', targetId: A }],
    ['mismatched session', () => tok(A, sid(2)), { scope: 'driver_self', targetId: A }],
  ])('%s: denied with zero model spend and no rows', async (_l, t, extra) => {
    const r = await send(t(), extra); expect(r.status).toBe(403); expect(modelCalls).toBe(0);
    expect(await count('SELECT count(*)::int n FROM public.assistant_messages')).toBe(0);
    expect(await count('SELECT count(*)::int n FROM public.assistant_usage')).toBe(0);
  });

  it('signed-out session (row deleted) denies send and history', async () => {
    const t = tok(A); const first = await send(t, { scope: 'driver_self', targetId: A });
    await db.query('DELETE FROM auth.sessions WHERE user_id=$1', [A]);
    expect((await send(t, { threadId: first.body.threadId })).status).toBe(403);
    expect((await call(t, { action: 'threads' })).body.threads).toEqual([]);
    expect(modelCalls).toBe(1);
  });

  it.each([
    ['no auth', null, { action: 'bootstrap' }, 401],
    ['unknown token', 'nope', { action: 'bootstrap' }, 401],
    ['unknown action', 'A', { action: 'sql' }, 400],
    ['bad request id', 'A', { action: 'send', requestId: 'x', content: 'hi', scope: 'driver_self', targetId: A }, 400],
    ['too long', 'A', { action: 'send', requestId: uid(990), content: 'x'.repeat(2001), scope: 'driver_self', targetId: A }, 400],
    ['bad scope', 'A', { action: 'send', requestId: uid(990), content: 'hi', scope: 'admin', targetId: A }, 400],
    ['clear without confirm', 'A', { action: 'clear' }, 400],
  ])('invalid request %s rejected with no spend', async (_l, who, body, status) => {
    const r = await call(who === 'A' ? tok(A) : who, body); expect(r.status).toBe(status); expect(modelCalls).toBe(0);
  });
  it('oversize body rejected before parsing', async () => {
    const r = await call(tok(A), null, JSON.stringify({ action: 'bootstrap', pad: 'x'.repeat(17000) })); expect(r.status).toBe(413);
  });

  it('disabled generation: send 503 without reservation, privacy controls still work', async () => {
    const t = tok(A); const first = await send(t, { scope: 'driver_self', targetId: A }); enabled = false;
    const r = await send(t, { threadId: first.body.threadId }); expect(r.status).toBe(503); expect(r.body.error).toBe('disabled');
    expect(await count('SELECT count(*)::int n FROM public.assistant_usage')).toBe(1);
    expect((await call(t, { action: 'delete', threadId: first.body.threadId })).body).toEqual({ deleted: true });
    expect((await call(t, { action: 'clear', confirm: true })).status).toBe(200);
  });

  it('per-minute limit 5, one live pending lease, daily 20 — denied attempts never call the model', async () => {
    const t = tok(A); const first = await send(t, { scope: 'driver_self', targetId: A });
    for (let i = 0; i < 4; i++) expect((await send(t, { threadId: first.body.threadId })).status).toBe(200);
    const sixth = await send(t, { threadId: first.body.threadId }); expect(sixth.status).toBe(429); expect(sixth.body.reason).toBe('limit_minute');
    expect(modelCalls).toBe(5);
    // Backdate admitted attempts past the minute window, then fill to 20/day.
    await db.exec(`ALTER TABLE public.assistant_usage DISABLE TRIGGER assistant_usage_guard; UPDATE public.assistant_usage SET created_at=now()-interval '2 hours';
      INSERT INTO public.assistant_usage(actor_user_id,request_id,session_id,state,created_at,lease_expires_at) SELECT '${A}',gen_random_uuid(),'${sid(1)}','completed',now()-interval '3 hours',now() FROM generate_series(1,15);
      ALTER TABLE public.assistant_usage ENABLE TRIGGER assistant_usage_guard`);
    const daily = await send(t, { threadId: first.body.threadId }); expect(daily.body.reason).toBe('limit_daily');
    await db.exec(`DELETE FROM public.assistant_usage WHERE thread_id IS NULL; ALTER TABLE public.assistant_usage DISABLE TRIGGER assistant_usage_guard; UPDATE public.assistant_usage SET state='pending',lease_expires_at=now()+interval '1 minute' WHERE id=(SELECT id FROM public.assistant_usage LIMIT 1); ALTER TABLE public.assistant_usage ENABLE TRIGGER assistant_usage_guard`);
    const busy = await send(t, { threadId: first.body.threadId }); expect(busy.body.reason).toBe('busy'); expect(modelCalls).toBe(5);
  });

  it('idempotent replay returns stored reply with zero second model call; changed body conflicts', async () => {
    const t = tok(A); const requestId = rid();
    const one = await call(t, { action: 'send', requestId, content: 'Same', scope: 'driver_self', targetId: A });
    const two = await call(t, { action: 'send', requestId, content: 'Same', scope: 'driver_self', targetId: A });
    expect(two.status).toBe(200); expect(two.body.idempotent).toBe(true); expect(two.body.reply.id).toBe(one.body.reply.id); expect(modelCalls).toBe(1);
    expect((await call(t, { action: 'send', requestId, content: 'Changed', scope: 'driver_self', targetId: A })).status).toBe(409);
    expect((await call(t, { action: 'send', requestId, content: 'Same', scope: 'recruiter', targetId: RECRUITER })).status).toBe(409);
  });

  it('duplicate while pending returns pending and never makes a second model call', async () => {
    const t = tok(A); const requestId = rid(); let inner: any;
    gateway = async () => { inner = await call(t, { action: 'send', requestId, content: 'Dup', scope: 'driver_self', targetId: A }); return okReply()(); };
    const outer = await call(t, { action: 'send', requestId, content: 'Dup', scope: 'driver_self', targetId: A });
    expect(inner.status).toBe(202); expect(outer.status).toBe(200); expect(modelCalls).toBe(1);
  });

  it.each([
    ['target Pro lost', `DELETE FROM public.subscriptions WHERE user_id='${A}'`],
    ['session signed out', `DELETE FROM auth.sessions WHERE user_id='${A}'`],
    ['session expired', `UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE user_id='${A}'`],
    ['thread deleted', `DELETE FROM public.assistant_threads`],
    ['capability revoked', `UPDATE public.user_capabilities SET status='revoked' WHERE user_id='${A}'`],
  ])('%s while response in flight: reply suppressed, attempt still counted', async (_l, sql) => {
    gateway = async () => { await db.exec(sql); return okReply('LEAKED_REPLY')(); };
    const r = await send(tok(A), { scope: 'driver_self', targetId: A });
    expect(r.status).toBe(403); expect(JSON.stringify(r.body)).not.toContain('LEAKED_REPLY');
    expect(await count(`SELECT count(*)::int n FROM public.assistant_messages WHERE role='assistant'`)).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM public.assistant_usage WHERE state='failed'`)).toBe(1);
  });

  it('delegate permission revoked in flight is suppressed', async () => {
    gateway = async () => { await db.exec(`UPDATE public.driver_assistants SET permissions='{}' WHERE assistant_user_id='${STAFF}'`); return okReply('LEAKED')(); };
    const r = await send(tok(STAFF), { scope: 'driver_delegate', targetId: A }); expect(r.status).toBe(403);
    expect(await count(`SELECT count(*)::int n FROM public.assistant_messages WHERE role='assistant'`)).toBe(0);
  });

  it('deleted thread never resurrects on retry of the same request', async () => {
    const t = tok(A); const requestId = rid();
    const one = await call(t, { action: 'send', requestId, content: 'Q', scope: 'driver_self', targetId: A });
    await call(t, { action: 'delete', threadId: one.body.threadId });
    expect((await call(t, { action: 'send', requestId, content: 'Q', scope: 'driver_self', targetId: A })).status).toBe(409);
    expect((await call(t, { action: 'send', requestId, content: 'Q', threadId: one.body.threadId })).status).toBe(409);
    expect(await count('SELECT count(*)::int n FROM public.assistant_threads')).toBe(0); expect(modelCalls).toBe(1);
  });

  it.each([
    ['provider 500', async () => new Response('{"error":"x"}', { status: 500 })],
    ['malformed JSON', async () => new Response('not json', { status: 200 })],
    ['empty content', async () => new Response(JSON.stringify({ choices: [{ message: { content: '  ' } }] }), { status: 200 })],
    ['oversize content', async () => new Response(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(8001) } }] }), { status: 200 })],
    ['abort/timeout', async () => { throw new DOMException('aborted', 'AbortError'); }],
  ])('%s: safe 503, no reply row, budget kept, no automatic retry', async (_l, g) => {
    gateway = g as typeof gateway;
    const r = await send(tok(A), { scope: 'driver_self', targetId: A });
    expect(r.status).toBe(503); expect(r.body).toEqual({ error: 'failed' }); expect(modelCalls).toBe(1);
    expect(await count(`SELECT count(*)::int n FROM public.assistant_usage WHERE state='failed'`)).toBe(1);
    expect(await count(`SELECT count(*)::int n FROM public.assistant_messages WHERE role='assistant'`)).toBe(0);
  });

  it('quota survives transcript clear; account deletion cascades usage', async () => {
    const t = tok(A); const f = await send(t, { scope: 'driver_self', targetId: A });
    for (let i = 0; i < 4; i++) await send(t, { threadId: f.body.threadId });
    await call(t, { action: 'clear', confirm: true });
    expect(await count('SELECT count(*)::int n FROM public.assistant_messages')).toBe(0);
    expect(await count('SELECT count(*)::int n FROM public.assistant_usage WHERE thread_id IS NULL')).toBe(5);
    expect((await send(t, { scope: 'driver_self', targetId: A })).body.reason).toBe('limit_minute');
    await db.exec(`DELETE FROM auth.users WHERE id='${A}'`); expect(await count('SELECT count(*)::int n FROM public.assistant_usage')).toBe(0);
  });

  it('service-only finalize: authenticated forgery denied, wrong lease denied, duplicate completion prevented, claims restored', async () => {
    const t = tok(A); let reservation: any;
    gateway = async () => { reservation = (await db.query<any>(`SELECT id,lease_id FROM public.assistant_usage`)).rows[0]; return okReply()(); };
    await send(t, { scope: 'driver_self', targetId: A });
    const forged = await callRpc(A, sid(1), 'assistant_finalize_turn', { _reservation_id: reservation.id, _lease_id: reservation.lease_id, _success: true, _content: 'Forged', _sources: [] });
    expect(forged.error?.code).toBe('42501');
    const wrong = await callRpc(null, null, 'assistant_finalize_turn', { _reservation_id: reservation.id, _lease_id: uid(999), _success: true, _content: 'x', _sources: [] }, 'service_role');
    expect(wrong.error?.code).toBe('42501');
    const dup = await callRpc(null, null, 'assistant_finalize_turn', { _reservation_id: reservation.id, _lease_id: reservation.lease_id, _success: true, _content: 'x', _sources: [] }, 'service_role');
    expect((dup.data as any[])[0].status).toBe('already_completed');
    await expect(callRpc(A, sid(1), 'assistant_reserve_turn', { _thread_id: null, _scope_kind: 'driver_self', _target_id: A, _request_id: uid(998), _content: 'y' })).resolves.toBeTruthy();
    // Claims restoration inside one transaction after the service definer path.
    const res = await db.transaction(async (tx) => {
      await tx.query(`SELECT set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{"role":"service_role"}',true)`);
      await tx.exec('SET LOCAL ROLE service_role');
      const pending = (await tx.query<any>(`SELECT id,lease_id FROM public.assistant_usage WHERE state='pending'`)).rows[0];
      await tx.query('SELECT * FROM public.assistant_finalize_turn($1,$2,true,$3,ARRAY[]::text[])', [pending.id, pending.lease_id, 'Okay']);
      return (await tx.query<any>(`SELECT current_setting('request.jwt.claim.sub',true) sub, current_setting('request.jwt.claims',true) claims`)).rows[0];
    });
    expect(res).toEqual({ sub: '', claims: '{"role":"service_role"}' });
  });

  it('source keys outside the thread domains are rejected by finalize', async () => {
    const t = tok(STAFF); let reservation: any;
    gateway = async () => { reservation = (await db.query<any>(`SELECT id,lease_id FROM public.assistant_usage`)).rows[0]; return new Response('bad', { status: 500 }); };
    await send(t, { scope: 'driver_delegate', targetId: A });
    // reservation now failed; new one to test registry/domain validation
    gateway = async () => { reservation = (await db.query<any>(`SELECT id,lease_id FROM public.assistant_usage WHERE state='pending'`)).rows[0];
      const r = await callRpc(null, null, 'assistant_finalize_turn', { _reservation_id: reservation.id, _lease_id: reservation.lease_id, _success: true, _content: 'x', _sources: ['expenses'] }, 'service_role');
      expect((r.data as any[])[0].status).toBe('invalid'); return okReply()(); };
    const r = await send(t, { scope: 'driver_delegate', targetId: A }); expect(r.status).toBe(403);
  });

  it('history pagination and actor isolation (A→B→A)', async () => {
    const t = tok(A); const f = await send(t, { scope: 'driver_self', targetId: A });
    await db.exec(`ALTER TABLE public.assistant_threads DISABLE TRIGGER assistant_thread_guard;
      INSERT INTO public.assistant_threads(actor_user_id,scope_kind,scope_target_id,required_permissions,created_at,expires_at)
      SELECT '${A}','driver_self','${A}',ARRAY['manage_loads'],now()-g*interval '1 minute',now()-g*interval '1 minute'+interval '720 hours' FROM generate_series(1,24) g;
      ALTER TABLE public.assistant_threads ENABLE TRIGGER assistant_thread_guard`);
    const p1 = await call(t, { action: 'threads' }); expect(p1.body.threads).toHaveLength(20); expect(p1.body.nextCursor).not.toBeNull();
    const p2 = await call(t, { action: 'threads', cursor: p1.body.nextCursor }); expect(p2.body.threads).toHaveLength(5); expect(p2.body.nextCursor).toBeNull();
    expect(new Set([...p1.body.threads, ...p2.body.threads].map((x: any) => x.id)).size).toBe(25);
    const tb = tok(B);
    expect((await call(tb, { action: 'threads' })).body.threads).toEqual([]);
    expect((await call(tb, { action: 'messages', threadId: f.body.threadId })).body.messages).toEqual([]);
    expect((await call(tb, { action: 'delete', threadId: f.body.threadId })).body).toEqual({ deleted: false });
    expect((await call(t, { action: 'messages', threadId: f.body.threadId })).body.messages).toHaveLength(2);
  });

  it('service purge removes expired history and bodyless usage older than 24h only', async () => {
    const t = tok(A); await send(t, { scope: 'driver_self', targetId: A }); await send(t, { scope: 'driver_self', targetId: A });
    await db.exec(`ALTER TABLE public.assistant_usage DISABLE TRIGGER assistant_usage_guard; UPDATE public.assistant_usage SET created_at=now()-interval '25 hours' WHERE id=(SELECT id FROM public.assistant_usage ORDER BY created_at LIMIT 1); ALTER TABLE public.assistant_usage ENABLE TRIGGER assistant_usage_guard`);
    await callRpc(null, null, 'assistant_purge_expired', {}, 'service_role');
    expect(await count('SELECT count(*)::int n FROM public.assistant_usage')).toBe(1);
    expect(await count('SELECT count(*)::int n FROM public.assistant_threads')).toBe(2);
    expect((await callRpc(A, sid(1), 'assistant_purge_expired', {})).error?.code).toBe('42501');
  });

  it('authenticated has no direct ledger access', async () => {
    await expect(runAs(db, A, sid(1), 'SELECT * FROM public.assistant_usage')).rejects.toMatchObject({ code: '42501' });
    await expect(runAs(db, A, sid(1), `INSERT INTO public.assistant_usage(actor_user_id,request_id,session_id) VALUES('${A}',gen_random_uuid(),'${sid(1)}')`)).rejects.toMatchObject({ code: '42501' });
  });
});

const disableUsageGuard = (sql: string) => db.exec(`ALTER TABLE public.assistant_usage DISABLE TRIGGER assistant_usage_guard; ${sql}; ALTER TABLE public.assistant_usage ENABLE TRIGGER assistant_usage_guard`);
const purge = () => callRpc(null, null, 'assistant_purge_expired', {}, 'service_role');

describe('Phase3B independent-review corrections', () => {
  it('#1 replay after 24h ledger purge returns the retained reply with zero second model call (thread and new-thread forms)', async () => {
    const t = tok(A); const requestId = rid();
    const one = await call(t, { action: 'send', requestId, content: 'Purge me', scope: 'driver_self', targetId: A });
    expect(one.status).toBe(200);
    await disableUsageGuard(`UPDATE public.assistant_usage SET created_at=now()-interval '25 hours'`);
    await purge(); expect(await count('SELECT count(*)::int n FROM public.assistant_usage')).toBe(0);
    const byThread = await call(t, { action: 'send', requestId, content: 'Purge me', threadId: one.body.threadId });
    expect(byThread.status).toBe(200); expect(byThread.body.reply.id).toBe(one.body.reply.id); expect(byThread.body.idempotent).toBe(true);
    const byScope = await call(t, { action: 'send', requestId, content: 'Purge me', scope: 'driver_self', targetId: A });
    expect(byScope.status).toBe(200); expect(byScope.body.reply.id).toBe(one.body.reply.id);
    expect(modelCalls).toBe(1);
    expect(await count('SELECT count(*)::int n FROM public.assistant_usage')).toBe(0);
    expect(await count('SELECT count(*)::int n FROM public.assistant_threads')).toBe(1);
    expect((await call(t, { action: 'send', requestId, content: 'Changed', threadId: one.body.threadId })).status).toBe(409);
    expect((await call(t, { action: 'send', requestId, content: 'Purge me', scope: 'recruiter', targetId: RECRUITER })).status).toBe(409);
    // Another actor reusing the request id never sees A's reply.
    const other = await call(tok(B), { action: 'send', requestId, content: 'Purge me', threadId: one.body.threadId });
    expect(other.status).toBe(403); expect(JSON.stringify(other.body)).not.toContain('grounded');
    expect(modelCalls).toBe(1);
  });

  it('#1b retained user message without reply and without ledger fails safely and is never re-admitted', async () => {
    const t = tok(A); const requestId = rid();
    gateway = async () => new Response('x', { status: 500 });
    const one = await call(t, { action: 'send', requestId, content: 'No answer', scope: 'driver_self', targetId: A });
    expect(one.status).toBe(503);
    await disableUsageGuard(`UPDATE public.assistant_usage SET created_at=now()-interval '25 hours'`); await purge();
    gateway = okReply();
    for (let i = 0; i < 2; i++) {
      const r = await call(t, { action: 'send', requestId, content: 'No answer', scope: 'driver_self', targetId: A });
      expect(r.status).toBe(503); expect(r.body).toEqual({ error: 'failed' });
    }
    expect(modelCalls).toBe(1); expect(await count('SELECT count(*)::int n FROM public.assistant_usage')).toBe(0);
  });

  it('#1c replay of a retained request on an expired or revoked thread is denied, never revived', async () => {
    const t = tok(A); const requestId = rid();
    const one = await call(t, { action: 'send', requestId, content: 'Old', scope: 'driver_self', targetId: A });
    await disableUsageGuard(`UPDATE public.assistant_usage SET created_at=now()-interval '25 hours'`); await purge();
    await db.exec(`DELETE FROM public.subscriptions WHERE user_id='${A}'`);
    expect((await call(t, { action: 'send', requestId, content: 'Old', threadId: one.body.threadId })).status).toBe(403);
    expect(modelCalls).toBe(1);
  });

  it('#2 exact reply lookup: replay after 60 later messages returns the saved reply (no newest-51 scan)', async () => {
    const t = tok(A); const requestId = rid();
    const one = await call(t, { action: 'send', requestId, content: 'Early question', scope: 'driver_self', targetId: A });
    await db.query(`INSERT INTO public.assistant_messages(thread_id,role,content,request_id,created_at)
      SELECT $1,'user','later '||g,gen_random_uuid(),now()+g*interval '1 second' FROM generate_series(1,60) g`, [one.body.threadId]);
    const again = await call(t, { action: 'send', requestId, content: 'Early question', threadId: one.body.threadId });
    expect(again.status).toBe(200); expect(again.body.reply.id).toBe(one.body.reply.id); expect(modelCalls).toBe(1);
  });

  it('#2b assistant_get_reply denies other actors, wrong thread and non-assistant rows', async () => {
    const one = await send(tok(A), { scope: 'driver_self', targetId: A });
    const th = one.body.threadId; const reply = one.body.reply.id;
    const userMsg = (await db.query<any>(`SELECT id FROM public.assistant_messages WHERE role='user'`)).rows[0].id;
    expect(((await callRpc(A, sid(1), 'assistant_get_reply', { _thread_id: th, _message_id: reply })).data as any[])).toHaveLength(1);
    expect(((await callRpc(B, sid(2), 'assistant_get_reply', { _thread_id: th, _message_id: reply })).data as any[])).toEqual([]);
    expect(((await callRpc(A, sid(1), 'assistant_get_reply', { _thread_id: th, _message_id: userMsg })).data as any[])).toEqual([]);
    expect(((await callRpc(A, sid(1), 'assistant_get_reply', { _thread_id: uid(777), _message_id: reply })).data as any[])).toEqual([]);
    expect(((await callRpc(A, sid(2), 'assistant_get_reply', { _thread_id: th, _message_id: reply })).data as any[])).toEqual([]);
    await expect(runAs(db, null, null, `SELECT * FROM public.assistant_get_reply('${th}','${reply}')`, [], 'anon' as any)).rejects.toBeTruthy();
  });

  it('#3 expired pending lease is terminal: replay returns failed 503, model 0, never 202 forever', async () => {
    const t = tok(A); const requestId = rid();
    const res = await callRpc(A, sid(1), 'assistant_reserve_turn', { _thread_id: null, _scope_kind: 'driver_self', _target_id: A, _request_id: requestId, _content: 'Stuck' });
    expect((res.data as any[])[0].status).toBe('reserved');
    expect((await call(t, { action: 'send', requestId, content: 'Stuck', scope: 'driver_self', targetId: A })).status).toBe(202);
    await disableUsageGuard(`UPDATE public.assistant_usage SET lease_expires_at=now()-interval '1 second'`);
    for (let i = 0; i < 2; i++) {
      const r = await call(t, { action: 'send', requestId, content: 'Stuck', scope: 'driver_self', targetId: A });
      expect(r.status).toBe(503); expect(r.body).toEqual({ error: 'failed' });
    }
    expect(modelCalls).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM public.assistant_usage WHERE state='failed'`)).toBe(1);
    // Late finalize with the old lease cannot complete it.
    const u = (await db.query<any>('SELECT id,lease_id FROM public.assistant_usage')).rows[0];
    const late = await callRpc(null, null, 'assistant_finalize_turn', { _reservation_id: u.id, _lease_id: u.lease_id, _success: true, _content: 'late', _sources: [] }, 'service_role');
    expect((late.data as any[])[0].status).toBe('already_failed');
  });

  it('#4 streamed oversize request is cancelled early (bounded reader), 413', async () => {
    let pulls = 0; let cancelled = false;
    const chunk = new TextEncoder().encode('x'.repeat(2000));
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { pulls++; if (pulls > 100) c.close(); else c.enqueue(chunk); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const req = new Request('http://local/assistant-chat', { method: 'POST', headers: { Authorization: `Bearer ${tok(A)}` }, body: stream, duplex: 'half' } as RequestInit);
    const res = await handleAssistantRequest(req, deps);
    expect(res.status).toBe(413); expect(pulls).toBeLessThanOrEqual(12); expect(cancelled).toBe(true); expect(modelCalls).toBe(0);
  });

  it('#4b invalid UTF-8 and non-object JSON rejected safely', async () => {
    const bad = new Request('http://local/assistant-chat', { method: 'POST', headers: { Authorization: `Bearer ${tok(A)}` }, body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) });
    expect((await handleAssistantRequest(bad, deps)).status).toBe(400);
    expect((await call(tok(A), null, '[1,2]')).status).toBe(400);
  });

  it('#4c provider response stream is bounded at 200k bytes and cancelled on overflow', async () => {
    let pulls = 0; let cancelled = false;
    const chunk = new TextEncoder().encode('y'.repeat(50_000));
    gateway = async () => new Response(new ReadableStream<Uint8Array>({
      pull(c) { pulls++; if (pulls > 100) c.close(); else c.enqueue(chunk); }, cancel() { cancelled = true; },
    }, { highWaterMark: 0 }), { status: 200 });
    const r = await send(tok(A), { scope: 'driver_self', targetId: A });
    expect(r.status).toBe(503); expect(r.body).toEqual({ error: 'failed' }); expect(pulls).toBeLessThanOrEqual(6); expect(cancelled).toBe(true);
    expect(await count(`SELECT count(*)::int n FROM public.assistant_usage WHERE state='failed'`)).toBe(1);
  });

  it('#5 verifyToken throwing yields generic 503, no leak, model 0', async () => {
    const d: HandlerDeps = { ...deps, verifyToken: async () => { throw new Error('PRIVATE_AUTH_ERROR'); } };
    const r = await call(tok(A), { action: 'send', requestId: rid(), content: 'hi', scope: 'driver_self', targetId: A }, undefined, d);
    expect(r.status).toBe(503); expect(r.body).toEqual({ error: 'unavailable' }); expect(JSON.stringify(r.body)).not.toContain('PRIVATE');
    expect(modelCalls).toBe(0);
  });

  it('#5b userRpc throwing after admission: generic 503, admitted turn failed, model 0', async () => {
    const d: HandlerDeps = { ...deps, userRpc: (t, fn, args) => fn === 'assistant_thread_context' ? Promise.reject(new Error('PRIVATE_DB')) : deps.userRpc(t, fn, args) };
    const r = await call(tok(A), { action: 'send', requestId: rid(), content: 'hi', scope: 'driver_self', targetId: A }, undefined, d);
    expect(r.status).toBe(503); expect(JSON.stringify(r.body)).not.toContain('PRIVATE'); expect(modelCalls).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM public.assistant_usage WHERE state='failed'`)).toBe(1);
    const thrown: HandlerDeps = { ...deps, userRpc: () => Promise.reject(new Error('PRIVATE_DB')) };
    const b = await call(tok(A), { action: 'bootstrap' }, undefined, thrown);
    expect(b.status).toBe(503); expect(JSON.stringify(b.body)).not.toContain('PRIVATE');
  });

  it('#5c serviceFinalize throwing (success and cleanup) never escapes and never duplicates the model call', async () => {
    const d: HandlerDeps = { ...deps, serviceFinalize: () => Promise.reject(new Error('PRIVATE_FINALIZE')) };
    const r = await call(tok(A), { action: 'send', requestId: rid(), content: 'hi', scope: 'driver_self', targetId: A }, undefined, d);
    expect(r.status).toBe(503); expect(JSON.stringify(r.body)).not.toContain('PRIVATE'); expect(modelCalls).toBe(1);
    expect(await count(`SELECT count(*)::int n FROM public.assistant_messages WHERE role='assistant'`)).toBe(0);
    gateway = async () => new Response('x', { status: 500 });
    const f = await call(tok(A), { action: 'send', requestId: rid(), content: 'hi', scope: 'driver_self', targetId: A }, undefined, d);
    // The unfinalized lease stays live (busy) until it expires; no second model call.
    expect(f.status).toBe(429); expect(f.body.reason).toBe('busy'); expect(modelCalls).toBe(1);
  });

  it.each([
    ['actor key', { action: 'bootstrap', actor: 'x' }],
    ['isPro key', { action: 'threads', isPro: true }],
    ['cursor extra key', { action: 'threads', cursor: { before: '2026-01-01T00:00:00Z', beforeId: uid(1), x: 1 } }],
    ['cursor array', { action: 'threads', cursor: [] }],
    ['thread and scope together', { action: 'send', requestId: uid(990), content: 'hi', threadId: uid(1), scope: 'driver_self', targetId: uid(1) }],
    ['scope without target', { action: 'send', requestId: uid(990), content: 'hi', scope: 'driver_self' }],
    ['content array', { action: 'send', requestId: uid(990), content: ['hi'], scope: 'driver_self', targetId: uid(1) }],
    ['negative offset', { action: 'bootstrap', offset: -1 }],
    ['fractional offset', { action: 'bootstrap', offset: 1.5 }],
    ['string offset', { action: 'bootstrap', offset: '0' }],
    ['huge offset', { action: 'bootstrap', offset: 10_001 }],
    ['delete extra key', { action: 'delete', threadId: uid(1), all: true }],
  ])('exact field allowlist: %s rejected, no spend', async (_l, body) => {
    const r = await call(tok(A), body); expect(r.status).toBe(400); expect(modelCalls).toBe(0);
    expect(await count('SELECT count(*)::int n FROM public.assistant_usage')).toBe(0);
  });

  it('newest-20 ordering is consistent: 21 same-date loads with opposing id and created_at order', async () => {
    await db.exec(`DELETE FROM public.loads WHERE user_id='${A}';
      INSERT INTO public.loads(id,user_id,load_date,estimated_pay,created_at)
      SELECT ('00000000-0000-4000-8000-'||lpad((500+g)::text,12,'0'))::uuid,'${A}',date '2026-05-01',5000+g,now()-g*interval '1 minute' FROM generate_series(1,21) g;
      DELETE FROM public.expenses WHERE user_id='${A}';
      INSERT INTO public.expenses(id,user_id,expense_date,category,amount,created_at)
      SELECT ('00000000-0000-4000-8000-'||lpad((700+g)::text,12,'0'))::uuid,'${A}',date '2026-05-01','fuel',7000+g,now()-g*interval '1 minute' FROM generate_series(1,21) g;`);
    const th = (await callRpc(A, sid(1), 'assistant_start_thread', { _scope_kind: 'driver_self', _target_id: A }).then((r) => (r.data as any[])[0].thread_id));
    const ctx = (await callRpc(A, sid(1), 'assistant_thread_context', { _thread_id: th })).data as any;
    const loads = ctx.sections.find((s: any) => s.key === 'loads'); const exp = ctx.sections.find((s: any) => s.key === 'expenses');
    expect(loads.rows.map((r: any) => Number(r.estimated_pay))).toEqual(Array.from({ length: 20 }, (_, i) => 5001 + i));
    expect(exp.rows.map((r: any) => Number(r.amount))).toEqual(Array.from({ length: 20 }, (_, i) => 7001 + i));
    expect(loads.has_more).toBe(true);
    for (const row of [...loads.rows, ...exp.rows]) { expect(row).not.toHaveProperty('created_at'); expect(row).not.toHaveProperty('rn'); }
    expect(Object.keys(loads.rows[0]).sort()).toEqual(['actual_pay_received', 'estimated_pay', 'id', 'load_date', 'payment_status', 'status']);
  });

  it('context text bound includes envelope, newlines and omission markers (exact bound)', () => {
    const asOf = '2026-10-26T00:00:00Z'; const header = `as_of=${asOf}`;
    const mk = (key: string, n: number) => { const base = { key, kind: 'recent', pad: '' }; const len = JSON.stringify(base).length; return { ...base, pad: 'z'.repeat(n - len) }; };
    const exact = mk('loads', LIMITS.contextChars - header.length - 1);
    const fit = buildContextText({ as_of: asOf, sections: [exact] });
    expect(fit.text.length).toBe(LIMITS.contextChars); expect(fit.keys).toEqual(['loads']);
    const over = buildContextText({ as_of: asOf, sections: [mk('loads', LIMITS.contextChars - header.length)] });
    expect(over.keys).toEqual([]); expect(over.text).toContain('[section loads omitted: size limit]');
    const many = buildContextText({ as_of: 'x'.repeat(5000), sections: Array.from({ length: 400 }, (_, i) => mk(i % 2 ? 'loads' : 'expenses', 200)) });
    expect(many.text.length).toBeLessThanOrEqual(LIMITS.contextChars);
    const markersOnly = buildContextText({ as_of: asOf, sections: Array.from({ length: 1000 }, () => mk('loads', 20_000)) });
    expect(markersOnly.text.length).toBeLessThanOrEqual(LIMITS.contextChars); expect(markersOnly.keys).toEqual([]);
  });

  it('history excludes only the just-appended user message by id, not earlier identical text', async () => {
    const t = tok(A); const first = await send(t, { scope: 'driver_self', targetId: A }, 'Repeat question');
    await send(t, { threadId: first.body.threadId }, 'Repeat question');
    const second = JSON.parse(gatewayBodies[1]);
    const hist = second.messages.filter((m: any) => m.content === '<untrusted_history>Repeat question</untrusted_history>');
    expect(hist).toHaveLength(1);
    expect(second.messages.filter((m: any) => m.content === '<untrusted_user_message>Repeat question</untrusted_user_message>')).toHaveLength(1);
  });

  it('bootstrap context pagination: offset pages with nextOffset, never claims complete when more remain', async () => {
    for (let g = 0; g < 55; g++) {
      const d = uid(600 + g);
      await db.query('INSERT INTO auth.users(id) VALUES($1)', [d]);
      await db.query('INSERT INTO public.profiles(user_id,display_name) VALUES($1,$2)', [d, `Managed ${String(g).padStart(2, '0')}`]);
      await db.query(`INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'driver','active')`, [d]);
      await db.query(`INSERT INTO public.subscriptions VALUES($1,'pro_monthly','active')`, [d]);
      await db.query(`INSERT INTO public.driver_assistants(driver_user_id,assistant_user_id,status,permissions) VALUES($1,$2,'active','{"manage_loads":true}')`, [d, STAFF]);
    }
    const p1 = await call(tok(STAFF), { action: 'bootstrap' });
    expect(p1.body.contexts).toHaveLength(50); expect(p1.body.contextsTruncated).toBe(true); expect(p1.body.nextOffset).toBe(50);
    const p2 = await call(tok(STAFF), { action: 'bootstrap', offset: p1.body.nextOffset });
    expect(p2.body.contextsTruncated).toBe(false); expect(p2.body.nextOffset).toBeNull();
    const all = [...p1.body.contexts, ...p2.body.contexts];
    expect(all).toHaveLength(57); expect(new Set(all.map((c: any) => `${c.scope}:${c.targetId}`)).size).toBe(57);
    expect(all.some((c: any) => c.targetId === uid(654))).toBe(true);
  });
});
