import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const billingMocks = vi.hoisted(() => ({
  checkout: vi.fn(),
  portal: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/hooks/opportunities/useRecruiterBilling', () => ({
  RECRUITER_PLAN_LABELS: {
    none: 'None',
    starter: 'Starter',
    growth: 'Growth',
    fleet: 'Fleet',
  },
  useRecruiterBilling: () => ({
    billing: null,
    plan: 'none',
    status: 'inactive',
    isBillingActive: false,
    isLoading: false,
    startCheckout: { mutate: billingMocks.checkout, isPending: false },
    openPortal: { mutate: billingMocks.portal, isPending: false },
    refresh: billingMocks.refresh,
  }),
}));

import { RecruiterBillingPanel } from '@/components/opportunities/RecruiterBillingPanel';
import {
  createHtpBuildVersion,
  injectHtpBuildShaMeta,
  normalizeFullGitSha,
  resolveHtpBuildSha,
} from '@/lib/htpBuildVersion';

const HTP_SHA = 'a'.repeat(40);
const GITHUB_SHA = 'b'.repeat(40);
const VERCEL_SHA = 'c'.repeat(40);
const GIT_SHA = 'd'.repeat(40);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Phase 1G-R1A4 Recruiter billing copy', () => {
  it('renders the authoritative standard-access, verification, and paid-plan concepts', () => {
    render(<RecruiterBillingPanel />);
    const text = document.body.textContent ?? '';

    expect(text).toContain(
      'Complete, non-suspended Recruiter profiles can post standard opportunities.',
    );
    expect(text).toContain('Verification adds trust and a Verified Recruiter badge.');
    expect(text).toContain('Paid plans add premium recruiting tools.');
    expect(text).toContain(
      'Standard posting depends on profile completeness and suspension status, not verification or payment.',
    );
    expect(screen.getByText('Standard Recruiter Access')).toBeInTheDocument();
  });

  it('does not render legacy approval, admin-review, or paid-posting implications', () => {
    render(<RecruiterBillingPanel />);
    const text = document.body.textContent ?? '';

    for (const forbidden of [
      'Verified recruiters can post unlimited standard opportunities',
      'Unlimited for verified recruiters',
      'Admin-reviewed listings',
      'Admin-reviewed for driver trust',
      'Standard posting is based on recruiter approval',
      'Included once your recruiter profile is approved',
      'Free Verified',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('Phase 1G-R1A4 build SHA resolution', () => {
  it('uses HTP_BUILD_SHA before GitHub, Vercel, and git', () => {
    expect(
      resolveHtpBuildSha(
        {
          HTP_BUILD_SHA: HTP_SHA.toUpperCase(),
          GITHUB_SHA,
          VERCEL_GIT_COMMIT_SHA: VERCEL_SHA,
        },
        () => GIT_SHA,
      ),
    ).toBe(HTP_SHA);
  });

  it('uses GitHub before Vercel and git when the explicit HTP value is invalid', () => {
    expect(
      resolveHtpBuildSha(
        {
          HTP_BUILD_SHA: 'not-a-sha',
          GITHUB_SHA,
          VERCEL_GIT_COMMIT_SHA: VERCEL_SHA,
        },
        () => GIT_SHA,
      ),
    ).toBe(GITHUB_SHA);
  });

  it('uses Vercel, then git, then unknown as later fallbacks', () => {
    expect(
      resolveHtpBuildSha(
        { HTP_BUILD_SHA: 'bad', GITHUB_SHA: 'also-bad', VERCEL_GIT_COMMIT_SHA: VERCEL_SHA },
        () => GIT_SHA,
      ),
    ).toBe(VERCEL_SHA);

    expect(
      resolveHtpBuildSha(
        { HTP_BUILD_SHA: 'bad', GITHUB_SHA: 'bad', VERCEL_GIT_COMMIT_SHA: 'bad' },
        () => GIT_SHA,
      ),
    ).toBe(GIT_SHA);

    expect(resolveHtpBuildSha({}, () => undefined)).toBe('unknown');
  });

  it('accepts only a full 40-character hexadecimal SHA', () => {
    expect(normalizeFullGitSha(`  ${HTP_SHA.toUpperCase()}  `)).toBe(HTP_SHA);
    expect(normalizeFullGitSha('a'.repeat(39))).toBeUndefined();
    expect(normalizeFullGitSha('g'.repeat(40))).toBeUndefined();
    expect(normalizeFullGitSha(undefined)).toBeUndefined();
  });
});

describe('Phase 1G-R1A4 build artifacts', () => {
  it('creates exactly the public version fields with a parseable ISO timestamp', () => {
    const builtAt = new Date('2026-07-18T00:00:00.000Z');
    const version = createHtpBuildVersion(HTP_SHA, () => builtAt);

    expect(Object.keys(version).sort()).toEqual(['app', 'builtAt', 'sha']);
    expect(version).toEqual({
      app: 'haultrackerpro',
      sha: HTP_SHA,
      builtAt: '2026-07-18T00:00:00.000Z',
    });
    expect(new Date(version.builtAt).toISOString()).toBe(version.builtAt);
  });

  it('injects exactly one matching build meta tag and replaces stale tags', () => {
    const original = `<html><head><meta name="htp-build-sha" content="${GITHUB_SHA}"><title>HTP</title></head><body /></html>`;
    const result = injectHtpBuildShaMeta(original, HTP_SHA);
    const matches = result.match(/<meta name="htp-build-sha" content="[^"]+">/g) ?? [];

    expect(matches).toEqual([`<meta name="htp-build-sha" content="${HTP_SHA}">`]);
    expect(result).not.toContain(GITHUB_SHA);
  });

  it('keeps artifacts free of unrelated environment or secret markers', () => {
    const version = JSON.stringify(
      createHtpBuildVersion(HTP_SHA, () => new Date('2026-07-18T00:00:00.000Z')),
    );
    const html = injectHtpBuildShaMeta('<html><head></head><body /></html>', HTP_SHA);
    const combined = `${version}\n${html}`;

    for (const forbidden of [
      'STRIPE_SECRET_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'dummy-secret-marker',
      'DATABASE_URL',
      'GITHUB_REF',
    ]) {
      expect(combined).not.toContain(forbidden);
    }
  });
});
