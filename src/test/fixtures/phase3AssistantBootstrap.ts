// Shared Phase3 local bootstrap: canonical fixture, exact accepted helper
// bodies, canonical EXECUTE boundaries, then the actual candidate SQL.
// Negative controls substitute ONLY in-memory inputs, never files.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const ROOT = process.cwd();
export const CANDIDATE = 'supabase/migration-candidates/20261026165204_phase3_assistant_history_foundation.sql';
const MIG = 'supabase/migrations/';
// Accepted definitions matched by the architect's independent live-body comparison.
export const SOURCES: [string, string[]][] = [
  ['20260228060534_e148b76a-288a-4273-a42b-f9d95f9bfb0e.sql', ['is_admin', 'is_super_admin']],
  ['20260630002954_a8c350ea-94e2-4f9b-8107-58a921dbe35b.sql', ['_agency_plan_defaults']],
  ['20260726013000_phase1p_recruiter_company_type_readiness.sql', ['recruiter_profile_can_manage_opportunities']],
  ['20260815020500_phase_rc1a_recruiter_workspace_membership_foundation.sql', ['is_recruiter_workspace_owner']],
  ['20260821003749_bfa5a325-8fcb-4a8b-b4e5-e6109e459fcb.sql', ['_owner_qa_persona_for', 'effective_recruiter_tier']],
  ['20260821062449_7c014ba4-370b-4eb8-afe0-f71de5785e43.sql', ['is_qa_fixture_root']],
  ['20260821062812_14e13b55-7f8b-4dac-8b3b-a9a5b68f761b.sql', ['driver_has_active_pro', 'get_effective_agency_limits', '_agency_member_paid_operational_authority']],
  ['20260816140000_phase_rc1j_b_recruiter_team_seat_entitlement.sql', ['recruiter_team_occupied_seats', 'recruiter_team_workspace_within_limit', 'current_user_has_recruiter_permission']],
  ['20260823033200_c81f5635-9733-4f6b-8f7d-33eff1a08390.sql', ['recruiter_team_seat_limit']],
  ['20260816220000_phase_am1a_agency_member_identity_seat_delegation_lifecycle_hardening.sql', ['agency_team_occupied_seats', 'agency_team_workspace_within_limit', '_agency_delegation_operationally_active', 'assistant_has_permission']],
  ['20260817033000_phase_am1b_agency_workspace_permission_contract.sql', ['current_user_has_agency_permission']],
];

export const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

export function exactFunction(sql: string, name: string): string {
  const start = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(`, 'i').exec(sql);
  if (!start) throw new Error(`Missing accepted definition: ${name}`);
  const tail = sql.slice(start.index);
  const tag = /\bAS\s+(\$[a-zA-Z_0-9]*\$)/i.exec(tail);
  if (!tag || tag.index === undefined) throw new Error(`Missing body: ${name}`);
  const end = tail.indexOf(tag[1], tag.index + tag[0].length);
  if (end < 0) throw new Error(`Unterminated body: ${name}`);
  const semicolon = tail.indexOf(';', end + tag[1].length);
  return tail.slice(0, semicolon + 1);
}

/** Deterministic synthetic ids. Session ids are distinct from user ids. */
export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const sid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

function applyCandidateNegativeControl(sql: string, control: string | undefined): string {
  const swap = (from: string, to: string) => {
    if (!sql.includes(from)) throw new Error(`Negative control anchor missing: ${control}`);
    sql = sql.replace(from, to);
  };
  switch (control) {
    case 'actor': swap('actor_user_id=auth.uid() AND expires_at>statement_timestamp()', 'expires_at>statement_timestamp()'); break;
    case 'scope': swap('AND public.assistant_scope_authorized(scope_kind,scope_target_id,required_permissions)', ''); break;
    case 'session': swap(' IF NOT public._assistant_session_valid() THEN RETURN false; END IF;\n', '\n'); break;
    case 'budget': swap("interval '24 hours')>=20", "interval '24 hours')>=100000"); break;
    case 'complete': swap('IF NOT FOUND OR _lease_id IS NULL OR _u.lease_id<>_lease_id THEN', 'IF NOT FOUND THEN'); break;
    default: break;
  }
  return sql;
}

export async function bootstrapPhase3(opts: { operations?: boolean } = {}): Promise<PGlite> {
  const control = process.env.PHASE3_NEGATIVE_CONTROL;
  const db = new PGlite();
  await db.exec(read('src/test/fixtures/phase3AssistantCanonical.sql'));
  if (opts.operations !== false) await db.exec(read('src/test/fixtures/phase3AssistantOperations.sql'));
  for (const [path, names] of SOURCES) {
    const sql = read(MIG + path);
    for (const name of names) {
      const source = name === 'recruiter_team_seat_limit' && control === 'seat'
        ? read(MIG + '20260816140000_phase_rc1j_b_recruiter_team_seat_entitlement.sql') : sql;
      await db.exec(exactFunction(source, name));
    }
  }
  // Match canonical internal EXECUTE boundaries.
  const funcs = (await db.query<{ signature: string }>(`SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`)).rows;
  for (const f of funcs) await db.exec(`REVOKE ALL ON FUNCTION ${f.signature} FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION ${f.signature} TO service_role`);
  await db.exec(`GRANT EXECUTE ON FUNCTION public.assistant_has_permission(uuid,uuid,text),public.current_user_has_recruiter_permission(uuid,public.recruiter_workspace_permission),public.current_user_has_agency_permission(uuid,public.agency_workspace_permission),public.is_admin(uuid),public.is_super_admin(uuid),public.is_recruiter_workspace_owner(uuid),public._agency_plan_defaults(text) TO authenticated`);
  await db.exec(applyCandidateNegativeControl(read(CANDIDATE), control));
  return db;
}

export type DbRole = 'authenticated' | 'anon' | 'service_role';

/** Set PostgREST-equivalent claims (sub + full claims JSON) for one statement under a genuine role. */
export async function runAs<T = Record<string, unknown>>(
  db: PGlite, actor: string | null, session: string | null | undefined, sql: string, params: unknown[] = [], role: DbRole = 'authenticated',
): Promise<T[]> {
  const claims = actor ? JSON.stringify({ sub: actor, role, ...(session ? { session_id: session } : {}) }) : '';
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)`, [actor ?? '', claims]);
  await db.exec(`SET ROLE ${role}`);
  try {
    const actual = (await db.query<{ current_user: string }>('SELECT current_user')).rows;
    if (actual[0]?.current_user !== role) throw new Error('Role switch failed');
    return (await db.query<T>(sql, params)).rows;
  } finally { await db.exec('RESET ROLE'); }
}
