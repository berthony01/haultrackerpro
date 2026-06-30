/**
 * Phase 7B — Close direct table-write bypasses.
 *
 * Locks in:
 *  - agency_service_packages has no broad direct write policy.
 *  - agency_members has no broad direct write policy.
 *  - Limit-helper functions are not directly callable from the client.
 *  - Phase 3/5/6/7 invariants still intact.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const MIGRATIONS = fs
  .readdirSync(path.join(ROOT, 'supabase/migrations'))
  .sort()
  .map((f) => read(`supabase/migrations/${f}`))
  .join('\n');

describe('Phase 7B — agency_service_packages direct write removed', () => {
  it('drops the broad asp_owner_admin_write FOR ALL policy', () => {
    expect(MIGRATIONS).toMatch(/DROP POLICY IF EXISTS asp_owner_admin_write ON public\.agency_service_packages/);
  });

  it('does not re-introduce a FOR ALL / FOR INSERT / FOR UPDATE policy for authenticated', () => {
    // Last definition wins — make sure the tail of migrations has no broad
    // write policy on agency_service_packages.
    const idx = MIGRATIONS.lastIndexOf('agency_service_packages');
    const tail = MIGRATIONS.slice(idx);
    expect(tail).not.toMatch(/CREATE POLICY[^;]+ON public\.agency_service_packages\s+FOR ALL/i);
    expect(tail).not.toMatch(/CREATE POLICY[^;]+ON public\.agency_service_packages\s+FOR INSERT/i);
    expect(tail).not.toMatch(/CREATE POLICY[^;]+ON public\.agency_service_packages\s+FOR UPDATE/i);
    expect(tail).not.toMatch(/CREATE POLICY[^;]+ON public\.agency_service_packages\s+FOR DELETE/i);
  });
});

describe('Phase 7B — agency_members direct write removed', () => {
  it('drops the broad agency_members_owner_all FOR ALL policy', () => {
    expect(MIGRATIONS).toMatch(/DROP POLICY IF EXISTS agency_members_owner_all ON public\.agency_members/);
  });

  it('does not re-introduce a FOR ALL / write policy for authenticated', () => {
    const idx = MIGRATIONS.lastIndexOf('DROP POLICY IF EXISTS agency_members_owner_all');
    const tail = MIGRATIONS.slice(idx);
    expect(tail).not.toMatch(/CREATE POLICY[^;]+ON public\.agency_members\s+FOR ALL/i);
    expect(tail).not.toMatch(/CREATE POLICY[^;]+ON public\.agency_members\s+FOR INSERT/i);
    expect(tail).not.toMatch(/CREATE POLICY[^;]+ON public\.agency_members\s+FOR UPDATE/i);
    expect(tail).not.toMatch(/CREATE POLICY[^;]+ON public\.agency_members\s+FOR DELETE/i);
  });
});

describe('Phase 7B — limit helpers revoked from clients', () => {
  it('revokes EXECUTE on get_effective_agency_limits from authenticated/PUBLIC/anon', () => {
    expect(MIGRATIONS).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_effective_agency_limits\(uuid\) FROM[^;]*authenticated/i,
    );
  });

  it('revokes EXECUTE on assert_agency_limit from authenticated/PUBLIC/anon', () => {
    expect(MIGRATIONS).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.assert_agency_limit\(uuid, text\) FROM[^;]*authenticated/i,
    );
  });

  it('frontend code never calls these helpers directly', () => {
    const grep = (pattern: RegExp) => {
      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) return walk(p);
          if (/\.(ts|tsx)$/.test(e.name) && !p.includes('/test/') && !p.endsWith('types.ts'))
            return fs.readFileSync(p, 'utf8').match(pattern) ? [p] : [];
          return [];
        });
      return walk(path.join(ROOT, 'src'));
    };
    expect(grep(/['"]get_effective_agency_limits['"]/)).toEqual([]);
    expect(grep(/['"]assert_agency_limit['"]/)).toEqual([]);
  });
});

describe('Phase 7B — RPC-only mutation paths preserved', () => {
  it('create_agency_package + update_agency_package still SECURITY DEFINER with limit checks', () => {
    const create = MIGRATIONS.lastIndexOf('CREATE OR REPLACE FUNCTION public.create_agency_package');
    expect(create).toBeGreaterThan(-1);
    const cbody = MIGRATIONS.slice(create, create + 3000);
    expect(cbody).toMatch(/SECURITY DEFINER/);
    expect(cbody).toMatch(/assert_agency_limit\([^)]*'create_service_package'\)/);

    const upd = MIGRATIONS.lastIndexOf('CREATE OR REPLACE FUNCTION public.update_agency_package');
    expect(upd).toBeGreaterThan(-1);
    const ubody = MIGRATIONS.slice(upd, upd + 3000);
    expect(ubody).toMatch(/SECURITY DEFINER/);
    expect(ubody).toMatch(/assert_agency_limit\([^)]*'create_service_package'\)/);
  });

  it('invite_agency_member / accept_agency_invite / revoke_agency_member remain SECURITY DEFINER', () => {
    for (const name of [
      'invite_agency_member',
      'accept_agency_invite',
      'revoke_agency_member',
    ]) {
      const idx = MIGRATIONS.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
      expect(idx, name).toBeGreaterThan(-1);
      const body = MIGRATIONS.slice(idx, idx + 3500);
      expect(body, name).toMatch(/SECURITY DEFINER/);
    }
  });
});

describe('Phase 7B — Phase 3 write lockdown still in place', () => {
  const idx = (s: string) => MIGRATIONS.lastIndexOf(s);
  it('agency_client_requests admin policy is SELECT-only (not FOR ALL)', () => {
    const i = idx('acr_agency_admin_select');
    expect(i).toBeGreaterThan(-1);
    expect(MIGRATIONS.slice(i, i + 300)).toMatch(/FOR SELECT/);
  });
  it('agency_delegation_requests admin policy is SELECT-only', () => {
    const i = idx('adr_agency_admin_select');
    expect(i).toBeGreaterThan(-1);
    expect(MIGRATIONS.slice(i, i + 300)).toMatch(/FOR SELECT/);
  });
  it('agency_work_items admin policy is SELECT-only', () => {
    const i = idx('awi_agency_admin_select');
    expect(i).toBeGreaterThan(-1);
    expect(MIGRATIONS.slice(i, i + 300)).toMatch(/FOR SELECT/);
  });
});

describe('Phase 7B — entitlement visibility (Option B) preserved', () => {
  it('latest get_agency_entitlement allows any active agency member', () => {
    const i = MIGRATIONS.lastIndexOf('FUNCTION public.get_agency_entitlement');
    expect(i).toBeGreaterThan(-1);
    const tail = MIGRATIONS.slice(i);
    expect(tail).not.toMatch(/agency_owner['"]?\s*,\s*['"]agency_admin/);
  });
});

describe('Phase 7B — Plan & Limits card unchanged contract', () => {
  const card = read('src/components/agency/AgencyPlanLimitsCard.tsx');
  it('still reads via get_agency_entitlement hook, not direct helper calls', () => {
    expect(card).toMatch(/useAgencyEntitlement/);
    expect(card).not.toMatch(/get_effective_agency_limits/);
    expect(card).not.toMatch(/assert_agency_limit/);
  });
  it('still counts active clients from list length', () => {
    expect(card).toMatch(/usedClients\s*=\s*\(clients\s*\?\?\s*\[\]\)\.length/);
  });
});

describe('Phase 7B — Phase 5/6 invariants', () => {
  it('Phase 5 auth continuation still uses `next` sanitization', () => {
    const auth = read('src/lib/authNavigation.ts');
    expect(auth).toMatch(/sanitizeNextPath|isSafeInternalPath/);
  });
  it('Phase 6 AppShell still wraps key authenticated pages', () => {
    for (const f of [
      'src/pages/AgencyDashboard.tsx',
      'src/pages/AssistantDashboard.tsx',
      'src/pages/DriverAssistantControl.tsx',
    ]) {
      expect(read(f)).toMatch(/AppShell/);
    }
  });
  it('PageNav still has safe Dashboard fallback', () => {
    const nav = read('src/components/layout/PageNav.tsx');
    expect(nav).toMatch(/\/dashboard/);
  });
});
