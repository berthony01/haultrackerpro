import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const PACKAGES = read('src/components/agency/ServicePackagesSection.tsx');
const SLUG_CARD = read('src/components/agency/AgencySlugCard.tsx');
const SQL = read(
  'supabase/migration-candidates/20260811140000_phase1u_b_agency_console_workflow_integrity.sql',
);

describe('Phase 1U-B — A: single truthful share-link UX', () => {
  it('ServicePackagesSection no longer builds a request link or copy action', () => {
    expect(PACKAGES).not.toMatch(/agency\/request\//);
    expect(PACKAGES.toLowerCase()).not.toContain('private request link');
    expect(PACKAGES).not.toMatch(/requestLink/);
    expect(PACKAGES).not.toMatch(/clipboard/);
    expect(PACKAGES).not.toMatch(/\bCopy\b/);
  });

  it('ServicePackagesSection points owners to the Overview share request link', () => {
    expect(PACKAGES).toContain('Share request link');
    expect(PACKAGES).toContain('Overview');
  });

  it('AgencySlugCard is the canonical share-link surface with the exact title', () => {
    expect(SLUG_CARD).toContain('Share request link');
    expect(SLUG_CARD).not.toContain('Public request link');
    expect(SLUG_CARD.toLowerCase()).not.toContain('private request link');
    expect(SLUG_CARD).toContain('/a/${slug}');
    expect(SLUG_CARD).toContain('/agency/request/${agencyId}');
  });
});

describe('Phase 1U-B — B: billing-aware presentation guards', () => {
  it('ServicePackagesSection blocks New package only for cancelled', () => {
    expect(PACKAGES).toContain('useAgencyEntitlement');
    expect(PACKAGES).toContain("entitlement.status === 'cancelled'");
    expect(PACKAGES).toMatch(/disabled=\{billingCancelled\}/);
    expect(PACKAGES).not.toMatch(/'past_due'|'trialing'|'manual_beta'/);
  });

  it('ServicePackagesSection retains existing package editing', () => {
    expect(PACKAGES).toContain('<PackageEditorDialog agencyId={agencyId} existing={pkg} />');
    expect(PACKAGES).toContain('Edit package');
  });

  it('AgencySlugCard disables sharing while cancelled', () => {
    expect(SLUG_CARD).toContain('useAgencyEntitlement');
    expect(SLUG_CARD).toContain("entitlement.status === 'cancelled'");
    expect(SLUG_CARD).toContain('disabled={billingCancelled}');
  });

  it('AgencySlugCard allows clearing but not setting a slug while cancelled', () => {
    expect(SLUG_CARD).toContain("const isClearing = value.trim() === ''");
    expect(SLUG_CARD).toContain('(billingCancelled && !isClearing)');
  });
});

describe('Phase 1U-B — C: candidate migration scope', () => {
  it('is marked as a candidate and transactional', () => {
    expect(SQL.split('\n')[0]).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect(SQL).toContain('BEGIN;');
    expect(SQL).toContain('COMMIT;');
  });

  it('modifies exactly list_agency_clients and no other database object', () => {
    const creates = SQL.match(/^CREATE\s+(OR\s+REPLACE\s+)?[A-Z]+/gim) ?? [];
    expect(creates).toHaveLength(1);
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.list_agency_clients(_agency_id uuid)');
    expect(SQL).toMatch(/LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public/);
    expect(SQL).not.toMatch(/\bALTER\b|\bDROP\b/i);
  });

  it('keeps approved-only rows and owner/admin visibility', () => {
    expect(SQL).toContain("d.status='approved'");
    expect(SQL).toContain('public.is_agency_owner_or_admin(_agency_id, auth.uid())');
    expect(SQL).toContain('SELECT DISTINCT ON (d.driver_user_id)');
    expect(SQL).toContain('ORDER BY d.driver_user_id, d.decided_at DESC NULLS LAST');
  });

  it('member branch requires active membership AND delegation to that member', () => {
    expect(SQL).toContain('d.member_user_id = auth.uid()');
    expect(SQL).toContain('FROM public.agency_members m');
    expect(SQL).toContain("m.status = 'active'");
    expect(SQL).toContain('m.member_user_id = auth.uid()');
  });

  it('contains no mutations, policy/grant, stripe, or production-application language', () => {
    expect(SQL).not.toMatch(/\bINSERT INTO\b|\bUPDATE \b|\bDELETE FROM\b|\bTRUNCATE\b/i);
    expect(SQL).not.toMatch(/\bGRANT\b|\bREVOKE\b|\bPOLICY\b|ROW LEVEL SECURITY/i);
    expect(SQL).not.toMatch(/stripe/i);
    expect(SQL).not.toMatch(/settlement/i);
    expect(SQL).not.toMatch(/applied to production|APPLIED LIVE\b(?!\.)/i);
  });
});
