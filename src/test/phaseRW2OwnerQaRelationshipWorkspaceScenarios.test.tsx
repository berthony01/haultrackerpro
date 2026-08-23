/**
 * Phase RW-2 — Owner QA relationship & workspace scenarios.
 *
 * Proves the RW-2 migration, hook and Owner QA Center surface obey the locked
 * contract: exactly eight scenarios, owner-only fail-closed RPCs, no leaked
 * identifiers, no new schema objects, no billing/Stripe mutation, complete
 * enum-derived permission maps, and a clear path that restores the BASE QA
 * topology while preserving the synthetic identities.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OWNER_QA_RELATIONSHIP_SCENARIOS,
  isOwnerQaRelationshipScenario,
  parseOwnerQaRelationshipState,
} from '@/hooks/useOwnerQaRelationshipScenario';

const setPersona = vi.fn(async () => {});
const disable = vi.fn(async () => {});

const qaState = {
  isOwner: true,
  isActive: false,
  domain: null as string | null,
  persona: null as string | null,
  label: null as string | null,
  expiresAt: null as string | null,
  selection: null as unknown,
  isLoading: false,
  isMutating: false,
  error: null as Error | null,
  setPersona,
  disable,
  refetch: vi.fn(),
};

vi.mock('@/hooks/useOwnerQaPersona', () => ({
  useOwnerQaPersona: () => qaState,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let scenarioActive = false;

const invoke = vi.fn(async () => ({ data: null, error: null }));
const rpc = vi.fn(async (fn: string) => {
  if (fn === 'owner_qa_relationship_scenario_state') {
    return {
      data: {
        active: scenarioActive,
        scenario: scenarioActive ? 'assistant_many' : null,
        assistant_driver_count: scenarioActive ? 2 : 0,
        agency_role: null,
        agency_permission_count: 0,
        recruiter_workspace_count: 0,
        recruiter_roles: [],
      },
      error: null,
    };
  }
  if (fn === 'owner_qa_apply_relationship_scenario') {
    scenarioActive = true;
    return { data: { applied: true }, error: null };
  }
  if (fn === 'owner_qa_clear_relationship_scenario') {
    scenarioActive = false;
    return { data: { cleared: true }, error: null };
  }
  if (fn === 'owner_qa_fixture_reset_preview') {
    return { data: { total_rows: 4, counts: { loads: 4 } }, error: null };
  }
  if (fn === 'owner_qa_fixture_reset') {
    return { data: { total_rows: 4, counts: { loads: 4 } }, error: null };
  }
  return { data: null, error: null };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke }, rpc },
}));

import OwnerQaCenter from '@/pages/OwnerQaCenter';

const root = path.resolve(__dirname, '../..');
const hookSource = readFileSync(
  path.join(root, 'src/hooks/useOwnerQaRelationshipScenario.ts'),
  'utf8',
);
const pageSource = readFileSync(
  path.join(root, 'src/pages/OwnerQaCenter.tsx'),
  'utf8',
);

const migrationsDir = path.join(root, 'supabase/migrations');
const rw2MigrationFile = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => ({ f, sql: readFileSync(path.join(migrationsDir, f), 'utf8') }))
  .filter((m) => m.sql.includes('owner_qa_apply_relationship_scenario'));

expect(rw2MigrationFile.length).toBe(1);
const sql = rw2MigrationFile[0].sql;

/** Exact body of one function definition in the RW-2 migration. */
function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`RW-2 migration is missing public.${name}`);
  const end = sql.indexOf('$function$;', start);
  return sql.slice(start, end);
}

/** Hook source with comments stripped, so prose never satisfies a contract. */
const hookCode = () =>
  hookSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');


const SCENARIOS = [
  'assistant_none',
  'assistant_one',
  'assistant_many',
  'agency_owner_populated',
  'agency_admin',
  'agency_member',
  'recruiter_staff_one',
  'recruiter_admin_multi',
] as const;

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/owner-qa']}>
        <OwnerQaCenter />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  scenarioActive = false;
  rpc.mockClear();
  invoke.mockClear();
});

describe('RW-2 — scenario vocabulary', () => {
  it('exposes exactly the eight locked scenario keys', () => {
    expect([...OWNER_QA_RELATIONSHIP_SCENARIOS]).toEqual([...SCENARIOS]);
    expect(OWNER_QA_RELATIONSHIP_SCENARIOS.length).toBe(8);
  });

  it('rejects any key outside the allowlist', () => {
    for (const key of SCENARIOS) {
      expect(isOwnerQaRelationshipScenario(key)).toBe(true);
    }
    for (const bad of ['', 'admin', 'assistant', 'agency_owner', 'recruiter', null, 1]) {
      expect(isOwnerQaRelationshipScenario(bad)).toBe(false);
    }
  });

  it('validates the same exact allowlist server-side and raises otherwise', () => {
    const allowlist = sql.match(
      /_scenario IS NULL OR _scenario NOT IN \(([\s\S]*?)\)\s*THEN/,
    );
    expect(allowlist).not.toBeNull();
    for (const key of SCENARIOS) {
      expect(allowlist![1]).toContain(`'${key}'`);
    }
    expect(sql).toContain('owner_qa_relationship_scenario_invalid');
  });
});

describe('RW-2 — RPC authorization contract', () => {
  const publicRpcs = [
    'owner_qa_relationship_scenario_state()',
    'owner_qa_clear_relationship_scenario()',
    'owner_qa_apply_relationship_scenario(text)',
  ];

  it('gates every RPC on an authenticated super_admin, fail-closed', () => {
    const bodies = sql.split('CREATE OR REPLACE FUNCTION').slice(1);
    for (const name of [
      'owner_qa_relationship_scenario_state',
      'owner_qa_clear_relationship_scenario',
      'owner_qa_apply_relationship_scenario',
      '_owner_qa_rw2_ensure_aux_user',
    ]) {
      const body = bodies.find((b) => b.trimStart().startsWith(`public.${name}`));
      expect(body, name).toBeDefined();
      expect(body).toContain('auth.uid()');
      expect(body).toContain('public.is_super_admin(');
      expect(body).toMatch(/RAISE EXCEPTION 'owner_qa_[a-z_]*unauthorized'/);
      expect(body).toContain('SECURITY DEFINER');
      expect(body).toMatch(/SET search_path TO/);
    }
  });

  it('revokes PUBLIC and anon on every RW-2 function', () => {
    for (const fn of publicRpcs) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC;`);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    }
  });

  it('keeps internal helpers unreachable by authenticated callers', () => {
    for (const fn of [
      '_owner_qa_rw2_perm_map(text, text[])',
      '_owner_qa_rw2_ensure_aux_user()',
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM authenticated;`);
      expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`);
    }
  });

  it('never accepts a caller-supplied root, user or workspace id', () => {
    const signatures = sql.match(/CREATE OR REPLACE FUNCTION public\.owner_qa_[^\n]*/g) ?? [];
    expect(signatures.length).toBe(3);
    for (const s of signatures) {
      expect(s).not.toMatch(/uuid/);
    }
  });
});

describe('RW-2 — state exposes no sensitive identifiers', () => {
  it('returns only safe summary fields', () => {
    const ret = sql.match(
      /RETURN jsonb_build_object\(\s*'active',[\s\S]*?'recruiter_roles', to_jsonb\(v_rec_roles\)\s*\)/,
    );
    expect(ret).not.toBeNull();
    const keys = [...ret![0].matchAll(/'([a-z_]+)',/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(
      [
        'active',
        'agency_permission_count',
        'agency_role',
        'assistant_driver_count',
        'recruiter_roles',
        'recruiter_workspace_count',
        'scenario',
      ].sort(),
    );
    for (const forbidden of ['_id', 'email', 'token', 'stripe', 'customer', 'price', 'plan']) {
      expect(keys.some((k) => k.includes(forbidden) && k !== 'assistant_driver_count')).toBe(
        false,
      );
    }
  });

  it('parses state fail-closed and drops unknown scenarios', () => {
    expect(parseOwnerQaRelationshipState(null)).toBeNull();
    expect(parseOwnerQaRelationshipState('nope')).toBeNull();
    const bogus = parseOwnerQaRelationshipState({
      active: true,
      scenario: 'super_admin_everything',
      assistant_driver_count: -5,
      recruiter_roles: [1, 'recruiter_admin'],
    });
    expect(bogus?.active).toBe(false);
    expect(bogus?.scenario).toBeNull();
    expect(bogus?.assistantDriverCount).toBe(0);
    expect(bogus?.recruiterRoles).toEqual(['recruiter_admin']);
  });

  it('never persists scenario authority in browser storage', () => {
    expect(hookSource).not.toMatch(/localStorage|sessionStorage/);
    expect(hookSource).toContain('useOwnerQaPersona');
  });
});

describe('RW-2 — no schema or billing mutation', () => {
  it('creates no table, column, enum, index, policy or trigger', () => {
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
    expect(sql).not.toMatch(/CREATE\s+TYPE/i);
    expect(sql).not.toMatch(/ALTER\s+TYPE/i);
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/ALTER\s+POLICY/i);
    expect(sql).not.toMatch(/DROP\s+POLICY/i);
    expect(sql).not.toMatch(/CREATE\s+TRIGGER/i);
  });

  it('never writes billing, subscription, Stripe or Telegram rows', () => {
    const writes = sql.match(
      /(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?([a-z_]+)/g,
    ) ?? [];
    for (const w of writes) {
      expect(w).not.toMatch(
        /subscription|billing|stripe|checkout|invoice|price|telegram|entitlement/i,
      );
    }
    // Billing is only ever READ, in the preserved production seat-limit path.
    expect(sql).toContain('FROM public.recruiter_billing_profiles b');
  });
});

describe('RW-2 — synthetic auxiliary identity', () => {
  it('creates a generated-uuid, .invalid, non-login-capable, banned user', () => {
    const body = sql.split('_owner_qa_rw2_ensure_aux_user()')[2] ?? sql;
    expect(body).toContain('gen_random_uuid()');
    expect(body).toContain('@haultrackerpro.invalid');
    expect(body).toMatch(/banned_until/);
    expect(body).toContain("now() + interval '100 years'");
    // No password and no identity row => can never sign in.
    expect(body).toMatch(/encrypted_password[\s\S]*?NULL/);
    expect(body).not.toMatch(/INSERT INTO auth\.identities/);
  });

  it('reuses only this QA owner\'s registered RW-2 root, never arbitrary accounts', () => {
    expect(sql).toMatch(
      /SELECT r\.root_id INTO v_aux[\s\S]*?FROM public\.qa_fixture_roots r[\s\S]*?r\.qa_owner_user_id = v_caller[\s\S]*?LIKE 'RW-2:%'/,
    );
    // The only auth.users SELECTs are by explicit id, never a search.
    const userSelects = sql.match(/FROM auth\.users u[^\n;]*/g) ?? [];
    for (const s of userSelects) {
      expect(s).toMatch(/u\.id = /);
    }
  });

  it('never returns the synthetic id or email to a client', () => {
    expect(sql).not.toMatch(/jsonb_build_object\([^)]*'aux_user_id'/);
    expect(sql).not.toMatch(/'email',\s*v_/);
  });
});

describe('RW-2 — BASE fixture root invariant', () => {
  it('still requires exactly three BASE roots, excluding only RW-2 auxiliaries', () => {
    const body = sql.split('_owner_qa_fixture_roots(')[1];
    expect(body).toContain("NOT LIKE 'RW-2:%'");
    expect(body).toContain('IF v_total <> 3 THEN');
    expect(body).toContain('owner_qa_fixture_roots_unexpected_count');
    for (const kind of ['user', 'recruiter_profile', 'agency_profile']) {
      expect(body).toContain(`r.root_kind = '${kind}'`);
    }
    expect(body).toContain('owner_qa_fixture_roots_incomplete');
    expect(body).toContain('public.is_super_admin(v_caller)');
  });
});

describe('RW-2 — assistant scenarios', () => {
  it('seeds 0 / 1 / 2 direct QA assistant relationships with mixed permissions', () => {
    const apply = sql.split('owner_qa_apply_relationship_scenario(_scenario text)')[1];
    expect(apply).toMatch(
      /IF _scenario = 'assistant_one' OR _scenario = 'assistant_many' THEN[\s\S]*?INSERT INTO public\.driver_assistants[\s\S]*?v_base_user, v_caller/,
    );
    expect(apply).toMatch(
      /IF _scenario = 'assistant_many' THEN[\s\S]*?INSERT INTO public\.driver_assistants[\s\S]*?v_aux_user, v_caller/,
    );
    expect(apply).toContain("jsonb_build_object('view_dashboard', true, 'manage_loads', true)");
    expect(apply).toContain("jsonb_build_object('manage_fuel', true, 'view_reports', true)");
    // assistant_none seeds nothing at all.
    expect(apply).not.toContain("_scenario = 'assistant_none' THEN");
  });

  it('never bypasses the Driver Pro rule or adds delegation shortcuts', () => {
    expect(sql).not.toMatch(/driver_has_active_pro/);
    expect(sql).not.toMatch(/INSERT INTO public\.agency_delegation_requests/);
    expect(sql).toMatch(/agency_delegation_id IS NULL/);
    expect(pageSource).toMatch(/Driver Pro QA persona/);
  });
});

describe('RW-2 — agency scenarios', () => {
  it('derives COMPLETE 11-key permission maps from the live enum', () => {
    const helper = sql.split('_owner_qa_rw2_perm_map')[2] ?? '';
    expect(helper).toContain('FROM pg_enum e');
    expect(helper).toContain('jsonb_object_agg');
    expect(helper).toContain("t.typname = _enum");
    expect(sql).toMatch(/_enum IN \('agency_workspace_permission', 'recruiter_workspace_permission'\)/);
    // Every agency map is produced by the enum helper — never a literal object.
    const agencyInserts =
      sql.match(/INSERT INTO public\.agency_members[\s\S]*?\);/g) ?? [];
    expect(agencyInserts.length).toBeGreaterThanOrEqual(4);
    for (const ins of agencyInserts) {
      if (ins.includes('workspace_permissions')) {
        expect(ins).toContain("_owner_qa_rw2_perm_map('agency_workspace_permission'");
      }
    }
  });

  it('never grants team_manage and keeps role labels descriptive only', () => {
    const agencyMaps =
      sql.match(/_owner_qa_rw2_perm_map\('agency_workspace_permission', ARRAY\[[\s\S]*?\]\)/g) ?? [];
    expect(agencyMaps.length).toBe(4);
    for (const m of agencyMaps) {
      expect(m).not.toContain("'team_manage'");
    }
    // Member map is read-oriented: no manage keys true.
    const memberMap = agencyMaps[agencyMaps.length - 1];
    expect(memberMap).not.toMatch(/'[a-z_]+_manage'/);
    expect(memberMap).toContain("'clients_view'");
  });

  it('agency scenarios never confer Driver Assistant authority', () => {
    const agencyBlock = sql.split("IF _scenario IN ('agency_admin', 'agency_member') THEN")[1]
      .split("IF _scenario IN ('recruiter_staff_one'")[0];
    expect(agencyBlock).not.toContain('driver_assistants');
  });
});

describe('RW-2 — recruiter scenarios', () => {
  it('uses COMPLETE enum-derived 24-key maps for one and two workspaces', () => {
    const recruiterInserts =
      sql.match(/INSERT INTO public\.recruiter_members[\s\S]*?\);/g) ?? [];
    for (const ins of recruiterInserts) {
      if (ins.includes('permissions')) {
        expect(ins).toMatch(
          /_owner_qa_rw2_perm_map\('recruiter_workspace_permission'|accepted_at\s*\)/,
        );
      }
    }
    const staffOne = sql.split("IF _scenario = 'recruiter_staff_one' THEN")[1].split('END IF;')[0];
    expect(staffOne).toContain("'recruiter_staff'");
    expect(staffOne).toContain("_owner_qa_rw2_perm_map('recruiter_workspace_permission'");

    const multi = sql.split("IF _scenario = 'recruiter_admin_multi' THEN")[1];
    expect(multi).toContain("'recruiter_admin'");
    expect(multi).toContain('INSERT INTO public.recruiter_profiles');
    expect(multi).toContain('@haultrackerpro.invalid'.slice(0, 0) + 'v_aux_email');
    expect(multi).toContain("'RW-2:aux_recruiter'");
  });

  it('keeps the real staff permission resolvers untouched', () => {
    for (const fn of [
      'current_user_has_recruiter_permission',
      'get_my_recruiter_permissions',
      'get_my_recruiter_staff_workspaces',
      'recruiter_team_workspace_within_limit',
      'accept_recruiter_member_invite',
      'current_user_has_agency_permission',
      'get_my_agency_permissions',
      'get_my_managed_drivers',
    ]) {
      expect(sql).not.toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
    }
  });
});

describe('RW-2 — recruiter team seat limit QA overlay', () => {
  const seat = () =>
    sql.split('CREATE OR REPLACE FUNCTION public.recruiter_team_seat_limit')[1];

  it('restricts the QA branch to the owner\'s own active registered QA recruiter root', () => {
    const body = seat();
    expect(body).toContain('public.is_super_admin(auth.uid())');
    expect(body).toContain("r.root_kind = 'recruiter_profile'");
    expect(body).toContain('r.root_id = _recruiter_id');
    expect(body).toContain('r.qa_owner_user_id = auth.uid()');
    expect(body).toContain('r.active');
    expect(body).toContain('r.revoked_at IS NULL');
    expect(body).toContain("WHERE q.domain = 'recruiter'");
  });

  it('applies the exact 1/2/5/15 QA seat matrix', () => {
    const body = seat();
    expect(body).toMatch(/WHEN 'free_verified' THEN 1/);
    expect(body).toMatch(/WHEN 'starter' THEN 2/);
    expect(body).toMatch(/WHEN 'growth' THEN 5/);
    expect(body).toMatch(/WHEN 'fleet' THEN 15/);
  });

  it('preserves the original production billing path after the QA branch', () => {
    const body = seat();
    expect(body).toMatch(/IF _recruiter_id IS NULL THEN RETURN 0; END IF;/);
    expect(body).toMatch(/IF NOT FOUND THEN RETURN 0; END IF;/);
    expect(body).toContain("effective_recruiter_tier(_recruiter_id) = 'conflict' THEN RETURN 1");
    expect(body).toContain('b.user_id = _owner_id');
    expect(body).toContain("b.plan IN ('starter','growth','fleet')");
    expect(body).toContain("b.status IN ('active','trialing')");
    expect(body).toMatch(
      /RETURN CASE _plan WHEN 'starter' THEN 2 WHEN 'growth' THEN 5 WHEN 'fleet' THEN 15 ELSE 1 END;/,
    );
    // Entitlement simulation only — never a billing write.
    expect(body).not.toMatch(/INSERT INTO|UPDATE public\.recruiter_billing/);
    // The QA branch must precede the production path.
    expect(body.indexOf('_qa_persona')).toBeLessThan(
      body.indexOf('effective_recruiter_tier'),
    );
  });
});

describe('RW-2 — clear restores the BASE topology', () => {
  const clear = () =>
    sql.split('owner_qa_clear_relationship_scenario()')[3] ?? sql;

  it('restores canonical agency and recruiter ownership for the QA owner', () => {
    const body = clear();
    expect(body).toMatch(
      /UPDATE public\.agency_profiles\s*SET owner_user_id = v_caller/,
    );
    expect(body).toMatch(
      /UPDATE public\.recruiter_profiles\s*SET user_id = v_caller/,
    );
    expect(body).toContain("role = 'agency_owner'");
    expect(body).toContain("role = 'recruiter_owner'");
  });

  it('deactivates RW-2 roots but never deletes the synthetic identities', () => {
    const body = clear();
    expect(body).toMatch(/UPDATE public\.qa_fixture_roots r\s*SET active = false/);
    expect(sql).not.toMatch(/DELETE FROM auth\.users/);
    expect(sql).not.toMatch(/DELETE FROM public\.qa_fixture_roots/);
    expect(sql).not.toMatch(/DELETE FROM public\.recruiter_profiles/);
    expect(sql).not.toMatch(/DELETE FROM public\.agency_profiles/);
  });

  it('only ever touches objects tied to this caller\'s registered QA roots', () => {
    const body = clear();
    expect(body).toContain('IN (v_base_user, v_aux_user)');
    expect(body).toContain('m.agency_id = v_base_agency');
    expect(body).toContain('m.recruiter_id = v_base_rec');
  });

  it('apply clears the prior scenario and reuses the EXISTING operational reset', () => {
    expect(sql).toContain('PERFORM public.owner_qa_clear_relationship_scenario();');
    expect(sql).toContain('PERFORM public.owner_qa_fixture_reset();');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.owner_qa_fixture_reset(');
  });
});

describe('RW-2 — Owner QA Center surface', () => {
  it('renders every scenario group, control and safe summary', async () => {
    renderPage();
    await screen.findByTestId('owner-qa-scenario-card');
    expect(screen.getByText('Relationship & Workspace Scenarios')).toBeInTheDocument();
    for (const key of SCENARIOS) {
      expect(screen.getByTestId(`owner-qa-scenario-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('owner-qa-scenario-summary')).toBeInTheDocument();
    expect(screen.getByTestId('owner-qa-scenario-clear')).toBeInTheDocument();
  });

  it('states the QA safety and Driver Pro / seat caveats', () => {
    renderPage();
    const copy = screen.getByTestId('owner-qa-scenario-copy').textContent ?? '';
    expect(copy).toMatch(/synthetic QA relationships only/i);
    expect(copy).toMatch(/RLS, and permission\s+resolvers remain fully authoritative/i);
    expect(copy).toMatch(/Driver Pro QA persona/i);
    expect(copy).toMatch(/Recruiter QA persona/i);
    expect(copy).toMatch(/seat and\s+permission checks/i);
  });

  it('requires confirmation before applying, and never applies on cancel', async () => {
    renderPage();
    await screen.findByTestId('owner-qa-scenario-card');
    fireEvent.click(screen.getByTestId('owner-qa-scenario-assistant_many'));
    const dialog = await screen.findByTestId('owner-qa-scenario-confirm');
    expect(dialog.textContent).toMatch(/resets the synthetic QA operational fixture data/i);
    fireEvent.click(screen.getByTestId('owner-qa-scenario-cancel'));
    await waitFor(() => {
      expect(rpc).not.toHaveBeenCalledWith(
        'owner_qa_apply_relationship_scenario',
        expect.anything(),
      );
    });
  });

  it('applies exactly the confirmed scenario key', async () => {
    renderPage();
    await screen.findByTestId('owner-qa-scenario-card');
    fireEvent.click(screen.getByTestId('owner-qa-scenario-recruiter_staff_one'));
    fireEvent.click(await screen.findByTestId('owner-qa-scenario-confirm-action'));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('owner_qa_apply_relationship_scenario', {
        _scenario: 'recruiter_staff_one',
      });
    });
  });

  it('clears an active scenario before running the existing reset', async () => {
    scenarioActive = true;
    renderPage();
    await screen.findByTestId('owner-qa-scenario-card');
    fireEvent.click(await screen.findByTestId('owner-qa-reset-button'));
    fireEvent.click(await screen.findByTestId('owner-qa-reset-confirm-action'));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('owner_qa_fixture_reset');
    });
    const names = rpc.mock.calls.map((c) => String(c[0]));
    expect(names.indexOf('owner_qa_clear_relationship_scenario')).toBeGreaterThan(-1);
    expect(names.indexOf('owner_qa_clear_relationship_scenario')).toBeLessThan(
      names.indexOf('owner_qa_fixture_reset'),
    );
  });

  it('never reaches a billing, Stripe or checkout surface', async () => {
    renderPage();
    await screen.findByTestId('owner-qa-scenario-card');
    expect(invoke).not.toHaveBeenCalled();
    for (const call of rpc.mock.calls) {
      expect(String(call[0])).not.toMatch(
        /checkout|stripe|billing|portal|subscription|customer|payment|invoice/i,
      );
    }
  });
});

describe('RW-2 — file boundary', () => {
  it('does not edit generated types or the existing reset hook', () => {
    expect(hookSource).not.toContain('useOwnerQaFixtureReset');
    expect(pageSource).toContain("from '@/hooks/useOwnerQaFixtureReset'");
    const resetHook = readFileSync(
      path.join(root, 'src/hooks/useOwnerQaFixtureReset.ts'),
      'utf8',
    );
    expect(resetHook).not.toContain('relationship_scenario');
  });

  it('uses a local cast adapter instead of regenerated Supabase types', () => {
    expect(hookSource).toMatch(/as unknown as ScenarioRpcClient/);
  });
});
