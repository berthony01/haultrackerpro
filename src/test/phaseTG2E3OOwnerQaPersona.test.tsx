/**
 * Phase TG-2E3-O2 — Owner QA Mode focused suite.
 *
 * Two layers:
 *  1. Behavioural tests of the pure persona module (`ownerQaPersona.ts`).
 *  2. Source-contract assertions proving the candidate SQL and the client
 *     injection points honour the phase's hard boundaries (super-admin only,
 *     server-resident, expiring, never touches billing rows, never bypasses
 *     RLS / permission / relationship / Telegram authorization).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OWNER_QA_ACTUAL_ACCOUNT,
  OWNER_QA_AGENCY_PERSONAS,
  OWNER_QA_DRIVER_PERSONAS,
  OWNER_QA_PERSONAS_BY_DOMAIN,
  OWNER_QA_RECRUITER_PERSONAS,
  agencyQaOverlay,
  applyBusinessQaOverlay,
  driverQaOverlay,
  isOwnerQaDomain,
  isValidOwnerQaSelection,
  ownerQaPersonaLabel,
} from '@/lib/billing/ownerQaPersona';
import { resolveEffectiveBusinessEntitlement } from '@/lib/billing/effectiveBusinessEntitlement';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SQL = read(
  '../../supabase/migration-candidates/20260820200000_phase_tg2e3_o2_owner_qa_entitlement.sql',
);
const PERSONA_MODULE = read('../lib/billing/ownerQaPersona.ts');
const HOOK = read('../hooks/useOwnerQaPersona.ts');
const PANEL = read('../components/admin/OwnerQaModePanel.tsx');
const BANNER = read('../components/admin/OwnerQaModeBanner.tsx');
const SUBSCRIPTION = read('../hooks/useSubscription.ts');
const RECRUITER_BILLING = read('../hooks/opportunities/useRecruiterBilling.ts');
const AGENCY_ENTITLEMENT = read('../hooks/useAgencyEntitlement.ts');

// ---------------------------------------------------------------------------
// 1. Persona vocabulary
// ---------------------------------------------------------------------------
describe('owner QA persona vocabulary', () => {
  it('exposes exactly the three product domains', () => {
    expect(Object.keys(OWNER_QA_PERSONAS_BY_DOMAIN).sort()).toEqual([
      'agency',
      'driver',
      'recruiter',
    ]);
    expect(isOwnerQaDomain('driver')).toBe(true);
    expect(isOwnerQaDomain('admin')).toBe(false);
  });

  it('matches the persona vocabulary enforced by the SQL CHECK constraints', () => {
    for (const p of OWNER_QA_DRIVER_PERSONAS) {
      expect(isValidOwnerQaSelection('driver', p)).toBe(true);
      expect(SQL).toContain(`'${p}'`);
    }
    for (const p of OWNER_QA_RECRUITER_PERSONAS) {
      expect(isValidOwnerQaSelection('recruiter', p)).toBe(true);
      expect(SQL).toContain(`'${p}'`);
    }
    for (const p of OWNER_QA_AGENCY_PERSONAS) {
      expect(isValidOwnerQaSelection('agency', p)).toBe(true);
      expect(SQL).toContain(`'${p}'`);
    }
  });

  it('rejects cross-domain and unknown personas', () => {
    expect(isValidOwnerQaSelection('driver', 'starter')).toBe(false);
    expect(isValidOwnerQaSelection('agency', 'pro_monthly')).toBe(false);
    expect(isValidOwnerQaSelection('recruiter', 'super_admin')).toBe(false);
    expect(isValidOwnerQaSelection('driver', null)).toBe(false);
    expect(ownerQaPersonaLabel('driver', 'nope')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Driver overlay
// ---------------------------------------------------------------------------
describe('driverQaOverlay', () => {
  it('renders Free as genuinely not Pro, defeating the admin auto-Pro override', () => {
    const overlay = driverQaOverlay('free');
    expect(overlay).not.toBeNull();
    expect(overlay!.isPro).toBe(false);
    expect(overlay!.planKey).toBe('free');
  });

  it('renders paid driver personas as Pro', () => {
    expect(driverQaOverlay('pro_monthly')!.isPro).toBe(true);
    expect(driverQaOverlay('pro_yearly')!.isPro).toBe(true);
    expect(driverQaOverlay('pro_yearly')!.planKey).toBe('pro_yearly');
  });

  it('returns null for anything outside the driver vocabulary', () => {
    expect(driverQaOverlay('starter')).toBeNull();
    expect(driverQaOverlay(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Business (recruiter / agency) overlay — single-domain semantics
// ---------------------------------------------------------------------------
const baseInput = {
  sourceState: {
    recruiterBilling: 'ready' as const,
    agencyEntitlement: 'ready' as const,
  },
  recruiterBilling: { hasRow: true, plan: 'growth', status: 'active' },
  agencyEntitlement: {
    hasRow: true,
    planKey: 'agency_team',
    status: 'active',
    source: 'stripe',
  },
  agencyMembership: { role: 'agency_owner', status: 'active' },
  recruiterProfile: { exists: true, readyToPost: true, suspended: false },
};

describe('applyBusinessQaOverlay', () => {
  it('is an identity transform with no selection', () => {
    expect(applyBusinessQaOverlay(baseInput as never, null)).toBe(
      baseInput as never,
    );
  });

  it('ignores the driver domain (handled by driverQaOverlay)', () => {
    expect(
      applyBusinessQaOverlay(baseInput as never, {
        domain: 'driver',
        persona: 'free',
      }),
    ).toBe(baseInput as never);
  });

  it('neutralizes the real agency input under a recruiter persona', () => {
    const out = applyBusinessQaOverlay(baseInput as never, {
      domain: 'recruiter',
      persona: 'starter',
    }) as typeof baseInput;
    expect(out.recruiterBilling).toEqual({
      hasRow: true,
      plan: 'starter',
      status: 'active',
    });
    expect(out.agencyEntitlement.hasRow).toBe(false);
  });

  it('renders recruiter free_verified as no paid billing row', () => {
    const out = applyBusinessQaOverlay(baseInput as never, {
      domain: 'recruiter',
      persona: 'free_verified',
    }) as typeof baseInput;
    expect(out.recruiterBilling).toEqual({
      hasRow: false,
      plan: null,
      status: null,
    });
  });

  it('neutralizes the real recruiter input under an agency persona', () => {
    const out = applyBusinessQaOverlay(baseInput as never, {
      domain: 'agency',
      persona: 'agency_growth',
    }) as typeof baseInput;
    expect(out.recruiterBilling.hasRow).toBe(false);
    expect(out.agencyEntitlement.planKey).toBe('agency_growth');
    expect(out.agencyEntitlement.status).toBe('active');
  });

  it('never produces a dual-paid conflict through the real resolver', () => {
    const conflict = resolveEffectiveBusinessEntitlement(baseInput as never);
    expect(conflict.effectiveRecruiterTier).toBe('conflict');

    for (const persona of OWNER_QA_RECRUITER_PERSONAS) {
      const resolved = resolveEffectiveBusinessEntitlement(
        applyBusinessQaOverlay(baseInput as never, {
          domain: 'recruiter',
          persona,
        }),
      );
      expect(resolved.effectiveRecruiterTier).not.toBe('conflict');
    }
    for (const persona of OWNER_QA_AGENCY_PERSONAS) {
      const resolved = resolveEffectiveBusinessEntitlement(
        applyBusinessQaOverlay(baseInput as never, {
          domain: 'agency',
          persona,
        }),
      );
      expect(resolved.effectiveRecruiterTier).not.toBe('conflict');
    }
  });

  it('leaves membership, profile and source-state inputs untouched', () => {
    const out = applyBusinessQaOverlay(baseInput as never, {
      domain: 'recruiter',
      persona: 'fleet',
    }) as typeof baseInput;
    expect(out.agencyMembership).toEqual(baseInput.agencyMembership);
    expect(out.recruiterProfile).toEqual(baseInput.recruiterProfile);
    expect(out.sourceState).toEqual(baseInput.sourceState);
  });
});

// ---------------------------------------------------------------------------
// 4. Agency overlay
// ---------------------------------------------------------------------------
describe('agencyQaOverlay', () => {
  it('fails closed for assistant_free exactly like a missing entitlement row', () => {
    const overlay = agencyQaOverlay('assistant_free')!;
    expect(overlay.status).toBe('cancelled');
    expect(overlay.hasRow).toBe(false);
    expect(overlay.planKey).toBe('agency_starter');
  });

  it('returns real plan defaults for paid agency personas', () => {
    for (const p of OWNER_QA_AGENCY_PERSONAS.filter(
      (x) => x !== 'assistant_free',
    )) {
      const overlay = agencyQaOverlay(p)!;
      expect(overlay.planKey).toBe(p);
      expect(overlay.status).toBe('active');
      expect(overlay.hasRow).toBe(true);
      expect(overlay.memberLimit).not.toBeUndefined();
    }
  });

  it('returns null outside the agency vocabulary', () => {
    expect(agencyQaOverlay('growth')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. SQL candidate contract
// ---------------------------------------------------------------------------
describe('owner QA SQL candidate contract', () => {
  it('creates the QA session table with RLS enabled and no client write policy', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.owner_qa_sessions');
    expect(SQL).toContain(
      'ALTER TABLE public.owner_qa_sessions ENABLE ROW LEVEL SECURITY',
    );
    expect(SQL).toContain('GRANT SELECT ON TABLE public.owner_qa_sessions TO authenticated');
    expect(SQL).not.toMatch(
      /GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*owner_qa_sessions[^;]*TO\s+authenticated/i,
    );
    expect(SQL).not.toMatch(/CREATE POLICY[\s\S]{0,200}FOR\s+(INSERT|UPDATE|DELETE)[\s\S]{0,200}owner_qa_sessions/i);
    expect(SQL).not.toMatch(/owner_qa_sessions\s+TO\s+anon/i);
  });

  it('gates every QA read and mutation on is_super_admin(auth.uid())', () => {
    expect(SQL).toContain('public.is_super_admin(auth.uid())');
    const notAuthorized = SQL.match(/owner_qa_not_authorized/g) ?? [];
    expect(notAuthorized.length).toBeGreaterThanOrEqual(2);
  });

  it('expires QA sessions and never trusts a client-supplied expiry', () => {
    expect(SQL).toContain("now() + interval '60 minutes'");
    expect(SQL).toContain('s.expires_at > now()');
    expect(SQL).not.toMatch(/set_owner_qa_persona\s*\([^)]*expires/i);
  });

  it('confines the QA overlay to the caller\'s own entities', () => {
    expect(SQL).toContain('_driver = auth.uid()');
    expect(SQL).toContain('_owner_id = auth.uid()');
    expect(SQL).toContain('rp.user_id = auth.uid()');
  });

  it('writes an admin audit row on set and disable', () => {
    expect(SQL).toContain("'owner_qa_persona_set'");
    expect(SQL).toContain("'owner_qa_persona_disabled'");
    expect(SQL).toContain('INSERT INTO public.admin_audit_log');
  });

  it('replaces exactly the four authorized central gates', () => {
    const replaced = [
      ...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/g),
    ].map((m) => m[1]);
    expect(replaced.sort()).toEqual(
      [
        '_owner_qa_persona_for',
        'current_owner_qa_persona',
        'disable_owner_qa_persona',
        'driver_has_active_pro',
        'effective_recruiter_tier',
        'get_effective_agency_limits',
        'opportunities_billing_guard',
        'set_owner_qa_persona',
      ].sort(),
    );
  });

  it('never writes to any billing table', () => {
    for (const table of [
      'subscriptions',
      'recruiter_billing_profiles',
      'agency_entitlements',
      'stripe_webhook_events',
    ]) {
      expect(SQL).not.toMatch(
        new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+public\\.${table}\\b`, 'i'),
      );
    }
  });

  it('never touches RLS, permission, relationship, or Telegram authorization surfaces', () => {
    expect(SQL).not.toMatch(/DROP\s+POLICY(?![\s\S]{0,80}owner_qa_sessions)/i);
    for (const forbidden of [
      'current_user_has_recruiter_permission',
      'current_user_has_agency_permission',
      'assistant_has_permission',
      'telegram',
      'is_admin(uuid)',
      'has_role',
    ]) {
      expect(
        new RegExp(
          `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION[^;]*${forbidden}`,
          'i',
        ).test(SQL),
      ).toBe(false);
    }
  });

  it('narrows the admin billing bypass only for a super-admin QA recruiter persona on their own entity', () => {
    expect(SQL).toContain('_qa_recruiter_self');
    expect(SQL).toContain('IF NOT _qa_recruiter_self THEN');
    expect(SQL).toContain('RETURN NEW;');
    // Authorization is still evaluated by the untouched permission resolver.
    expect(SQL).toContain('current_user_can_recruiter_opportunity_action');
  });
});

// ---------------------------------------------------------------------------
// 6. Client contract
// ---------------------------------------------------------------------------
describe('owner QA client contract', () => {
  it('treats the server as the only source of QA truth (no browser persistence)', () => {
    for (const src of [HOOK, PANEL, BANNER, PERSONA_MODULE]) {
      expect(src).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    }
    expect(HOOK).toContain('current_owner_qa_persona');
    expect(HOOK).toContain('set_owner_qa_persona');
    expect(HOOK).toContain('disable_owner_qa_persona');
  });

  it('queries QA state only for a resolved super_admin', () => {
    expect(HOOK).toContain("role === 'super_admin'");
    expect(HOOK).toContain('enabled: isOwner');
  });

  it('re-validates domain/persona and expiry client-side before applying', () => {
    expect(HOOK).toContain('isValidOwnerQaSelection');
    expect(HOOK).toContain('expires_at');
  });

  it('keeps the persona module pure — no network, no supabase client', () => {
    expect(PERSONA_MODULE).not.toMatch(/supabase|fetch\(/);
  });

  it('injects the overlay at each of the three authorized client resolvers', () => {
    expect(SUBSCRIPTION).toContain('driverQaOverlay');
    expect(RECRUITER_BILLING).toContain('applyBusinessQaOverlay');
    expect(AGENCY_ENTITLEMENT).toContain('agencyQaOverlay');
  });

  it('lets a driver QA persona win over the admin auto-Pro override', () => {
    expect(SUBSCRIPTION).toContain(
      'const isPro = driverQa ? driverQa.isPro : isAdmin || isProStatus(status)',
    );
  });

  it('renders the banner only for an active owner QA session', () => {
    expect(BANNER).toContain('if (!isOwner || !isActive');
    expect(BANNER).toContain('Exit to Actual Account');
  });

  it('states plainly in the owner UI that billing is untouched', () => {
    expect(PANEL).toMatch(/does\s*<strong>not<\/strong>\{' '\}\s*\n?\s*change Stripe/);
    expect(PANEL).toContain('OWNER_QA_ACTUAL_ACCOUNT');
    expect(PANEL).toContain('if (!isOwner) return null');
  });

  it('exposes the actual-account sentinel distinct from every persona', () => {
    expect(OWNER_QA_ACTUAL_ACCOUNT).toBe('actual_account');
    expect(isValidOwnerQaSelection('driver', OWNER_QA_ACTUAL_ACCOUNT)).toBe(false);
  });
});
