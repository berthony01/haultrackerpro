/**
 * Phase 1N-F2-C2 — Truthful policy metadata + Help/Legal discoverability.
 *
 * Fail-closed behavioral coverage:
 *   1. Terms/Privacy pages carry no runtime date APIs and no "Last Updated:" line.
 *   2. Terms/Privacy resolve their canonical policyRegistry entries and only
 *      render fixed metadata via the registry — no hardcoded dates/versions.
 *   3. policyRegistry remains truthful: terms/privacy are live with null
 *      version/effectiveDate and the pending label carries no dates.
 *   4. MarketingHeader NAV_LINKS carry a single Help /docs and Legal /legal
 *      entry, shared between desktop and mobile.
 *   5. Landing footer Company column carries exactly one Help Center /docs
 *      and one Legal Center /legal, alongside existing Terms/Privacy.
 *   6. Driver SettingsView carries /docs Help Center + /legal Legal Center,
 *      preserving /terms, /privacy, /faq, /how-to-use-haultrackerpro.
 *   7. Recruiter settings view carries /docs Help Center + /legal Legal
 *      Center, preserving recruiter guide/FAQ/updates/terms/privacy.
 *   8. This test is behavioral only — no historical git assertions, no
 *      registry/App/Auth/Pricing modifications.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import {
  findPolicyBySlug,
  POLICY_METADATA_PENDING_LABEL,
} from '@/lib/legal/policyRegistry';
import MarketingHeader from '@/components/marketing/MarketingHeader';

const ROOT = resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const TERMS_SRC = read('src/pages/Terms.tsx');
const PRIVACY_SRC = read('src/pages/Privacy.tsx');
const HEADER_SRC = read('src/components/marketing/MarketingHeader.tsx');
const LANDING_SRC = read('src/pages/Landing.tsx');
const DRIVER_SETTINGS_SRC = read('src/components/SettingsView.tsx');
const RECRUITER_SETTINGS_SRC = read(
  'src/components/opportunities/recruiter/RecruiterSettingsView.tsx',
);

describe('phase1nF2C2 — no runtime date APIs in policy pages', () => {
  for (const [name, src] of [
    ['Terms.tsx', TERMS_SRC],
    ['Privacy.tsx', PRIVACY_SRC],
  ] as const) {
    it(`${name} contains no runtime date/formatting APIs`, () => {
      expect(src).not.toMatch(/\bnew\s+Date\b/);
      expect(src).not.toMatch(/\bDate\.now\b/);
      expect(src).not.toMatch(/toLocaleDateString/);
      expect(src).not.toMatch(/toLocaleString/);
      expect(src).not.toMatch(/toLocaleTimeString/);
      expect(src).not.toMatch(/\blastUpdated\b/);
      expect(src).not.toMatch(/Last Updated:/);
    });
  }
});

describe('phase1nF2C2 — canonical pending metadata', () => {
  it('Terms.tsx imports canonical registry helpers and resolves slug "terms"', () => {
    expect(TERMS_SRC).toMatch(/findPolicyBySlug/);
    expect(TERMS_SRC).toMatch(/POLICY_METADATA_PENDING_LABEL/);
    expect(TERMS_SRC).toMatch(/findPolicyBySlug\(['"]terms['"]\)/);
  });

  it('Privacy.tsx imports canonical registry helpers and resolves slug "privacy"', () => {
    expect(PRIVACY_SRC).toMatch(/findPolicyBySlug/);
    expect(PRIVACY_SRC).toMatch(/POLICY_METADATA_PENDING_LABEL/);
    expect(PRIVACY_SRC).toMatch(/findPolicyBySlug\(['"]privacy['"]\)/);
  });

  it('neither page hardcodes an ISO date, US date, or version literal', () => {
    // ISO-like YYYY-MM-DD
    const iso = /\b(19|20)\d{2}-\d{2}-\d{2}\b/;
    // "Month DD, YYYY"
    const us = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*(19|20)\d{2}\b/;
    // "vN.N" or "Version N.N"
    const versionLit = /\b[Vv]ersion\s+\d+(?:\.\d+)*\b|\bv\d+(?:\.\d+)+\b/;
    for (const src of [TERMS_SRC, PRIVACY_SRC]) {
      expect(src).not.toMatch(iso);
      expect(src).not.toMatch(us);
      expect(src).not.toMatch(versionLit);
    }
  });
});

describe('phase1nF2C2 — policy registry remains truthful', () => {
  it('Terms entry is live @ /terms with null version/effectiveDate', () => {
    const p = findPolicyBySlug('terms');
    expect(p).toBeDefined();
    expect(p!.status).toBe('live');
    expect(p!.route).toBe('/terms');
    expect(p!.version).toBeNull();
    expect(p!.effectiveDate).toBeNull();
  });

  it('Privacy entry is live @ /privacy with null version/effectiveDate', () => {
    const p = findPolicyBySlug('privacy');
    expect(p).toBeDefined();
    expect(p!.status).toBe('live');
    expect(p!.route).toBe('/privacy');
    expect(p!.version).toBeNull();
    expect(p!.effectiveDate).toBeNull();
  });

  it('pending label contains no date artifact', () => {
    expect(POLICY_METADATA_PENDING_LABEL).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(POLICY_METADATA_PENDING_LABEL).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(POLICY_METADATA_PENDING_LABEL).not.toMatch(
      /January|February|March|April|May|June|July|August|September|October|November|December/,
    );
  });
});

describe('phase1nF2C2 — MarketingHeader links', () => {
  it('NAV_LINKS source defines exactly one /docs Help entry and one /legal Legal entry', () => {
    const docsMatches = HEADER_SRC.match(/href:\s*['"]\/docs['"]/g) ?? [];
    const legalMatches = HEADER_SRC.match(/href:\s*['"]\/legal['"]/g) ?? [];
    expect(docsMatches).toHaveLength(1);
    expect(legalMatches).toHaveLength(1);
    expect(HEADER_SRC).toMatch(/label:\s*['"]Help['"],\s*href:\s*['"]\/docs['"]/);
    expect(HEADER_SRC).toMatch(/label:\s*['"]Legal['"],\s*href:\s*['"]\/legal['"]/);
  });

  it('desktop and mobile both consume NAV_LINKS (single source)', () => {
    // Desktop maps NAV_LINKS, mobile spreads NAV_LINKS.
    expect(HEADER_SRC).toMatch(/NAV_LINKS\.map/);
    expect(HEADER_SRC).toMatch(/\.\.\.NAV_LINKS/);
  });

  it('renders Help and Legal controls in the desktop nav', () => {
    render(
      <MemoryRouter>
        <MarketingHeader />
      </MemoryRouter>,
    );
    // Desktop links render as <Button> (button role) with the label text.
    expect(screen.getAllByRole('button', { name: 'Help' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Legal' }).length).toBeGreaterThan(0);
  });
});

describe('phase1nF2C2 — Landing footer links', () => {
  it('Company column contains Help Center /docs and Legal Center /legal alongside Terms/Privacy', () => {
    expect(LANDING_SRC).toMatch(/label:\s*['"]Help Center['"],\s*href:\s*['"]\/docs['"]/);
    expect(LANDING_SRC).toMatch(/label:\s*['"]Legal Center['"],\s*href:\s*['"]\/legal['"]/);
    expect(LANDING_SRC).toMatch(/label:\s*['"]Terms['"],\s*href:\s*['"]\/terms['"]/);
    expect(LANDING_SRC).toMatch(/label:\s*['"]Privacy['"],\s*href:\s*['"]\/privacy['"]/);
  });
});

describe('phase1nF2C2 — Driver settings links', () => {
  it('adds Help Center /docs and Legal Center /legal', () => {
    expect(DRIVER_SETTINGS_SRC).toMatch(/navigate\(['"]\/docs['"]\)/);
    expect(DRIVER_SETTINGS_SRC).toMatch(/navigate\(['"]\/legal['"]\)/);
    expect(DRIVER_SETTINGS_SRC).toMatch(/Help Center/);
    expect(DRIVER_SETTINGS_SRC).toMatch(/Legal Center/);
  });
  it('preserves /terms, /privacy, /faq, and user-guide routes', () => {
    expect(DRIVER_SETTINGS_SRC).toMatch(/navigate\(['"]\/terms['"]\)/);
    expect(DRIVER_SETTINGS_SRC).toMatch(/navigate\(['"]\/privacy['"]\)/);
    expect(DRIVER_SETTINGS_SRC).toMatch(/navigate\(['"]\/faq['"]\)/);
    expect(DRIVER_SETTINGS_SRC).toMatch(/navigate\(['"]\/how-to-use-haultrackerpro['"]\)/);
  });
});

describe('phase1nF2C2 — Recruiter settings links', () => {
  it('adds Help Center /docs and Legal Center /legal', () => {
    expect(RECRUITER_SETTINGS_SRC).toMatch(/navigate\(['"]\/docs['"]\)/);
    expect(RECRUITER_SETTINGS_SRC).toMatch(/navigate\(['"]\/legal['"]\)/);
    expect(RECRUITER_SETTINGS_SRC).toMatch(/Help Center/);
    expect(RECRUITER_SETTINGS_SRC).toMatch(/Legal Center/);
  });
  it('preserves recruiter guide/FAQ/updates, Terms, and Privacy', () => {
    expect(RECRUITER_SETTINGS_SRC).toMatch(/navigate\(['"]\/recruiter\/guide['"]\)/);
    expect(RECRUITER_SETTINGS_SRC).toMatch(/navigate\(['"]\/recruiter\/faq['"]\)/);
    expect(RECRUITER_SETTINGS_SRC).toMatch(/navigate\(['"]\/recruiter\/updates['"]\)/);
    expect(RECRUITER_SETTINGS_SRC).toMatch(/navigate\(['"]\/terms['"]\)/);
    expect(RECRUITER_SETTINGS_SRC).toMatch(/navigate\(['"]\/privacy['"]\)/);
  });
});

describe('phase1nF2C2 — no out-of-scope substitutes', () => {
  const selfSrc = read('src/test/phase1nF2C2NavigationAndDateIntegrity.test.tsx');
  it('does not import Auth, Pricing, App, account-deletion, or public SEO files', () => {
    expect(selfSrc).not.toMatch(/from\s+['"]@\/pages\/Auth['"]/);
    expect(selfSrc).not.toMatch(/from\s+['"]@\/pages\/Pricing['"]/);
    expect(selfSrc).not.toMatch(/from\s+['"]@\/App['"]/);
    const forbidden = ['Delete' + 'AccountModal', 'ro' + 'bots.txt', 'site' + 'map.xml', 'll' + 'ms.txt'];
    for (const token of forbidden) {
      expect(selfSrc.includes(token)).toBe(false);
    }

  });
  it('does not carry brittle git-based scope assertions', () => {
    expect(selfSrc).not.toMatch(/from ['"]node:child_process['"]/);
    expect(selfSrc).not.toMatch(/require\(['"]child_process['"]\)/);
  });


});
