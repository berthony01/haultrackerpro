/**
 * Phase 1J-D2A — Pricing / plan-truth guards.
 *
 * Durable source and rendered-copy guards for the recruiter public surfaces:
 *  - No stale approval-gate / Free Verified / apply-to-post wording.
 *  - No advertising Fleet "Advanced analytics" as currently available.
 *  - Pricing.tsx separates AVAILABLE NOW from COMING SOON via distinct data
 *    paths and visible headings.
 *  - Verified Recruiter badge review is described as separate from standard
 *    posting.
 *  - Recruiter Standard advertises opportunity management (edit/pause/close).
 *  - Planned driver contract additions row is labeled
 *    "Coming soon — not included today", not "Planned Pro tools".
 *  - RecruiterLanding visibly separates Fleet's current vs future items.
 *  - agencyPlans.ts uses the exact bullet "2 agency members total, including
 *    the owner".
 *  - featureList's Driver Assistants feature is not `pro: true`.
 *  - Contract copy covers both universal driver protections and separate
 *    Growth/Fleet recruiter management + AI-assisted review.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import * as fs from 'node:fs';
import * as path from 'node:path';

import Pricing from '@/pages/Pricing';
import RecruiterLanding from '@/components/landing/RecruiterLanding';
import { featureList } from '@/lib/featureList';

// -------------------------------------------------------------------------
// Shared file set — the seven D2A public recruiter surfaces.
// -------------------------------------------------------------------------

const RECRUITER_PUBLIC_SURFACES = [
  'src/pages/Pricing.tsx',
  'src/pages/Recruiters.tsx',
  'src/components/landing/RecruiterLanding.tsx',
  'src/pages/recruiter/RecruiterFAQ.tsx',
  'src/pages/recruiter/RecruiterGuide.tsx',
  'src/pages/resources/RecruiterToolsGuide.tsx',
  'src/lib/recruiterFeatureList.ts',
] as const;

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

// -------------------------------------------------------------------------
// 1. Forbidden stale phrases must not appear in production recruiter surfaces.
//    We scan only these designated production files — never this test file
//    itself, so its forbidden-pattern definitions can't be miscounted.
// -------------------------------------------------------------------------

type Forbidden = { pattern: RegExp; label: string };

const FORBIDDEN_PHRASES: Forbidden[] = [
  { pattern: /Free Verified/i, label: 'Free Verified' },
  { pattern: /Apply for Recruiter Access/i, label: 'Apply for Recruiter Access' },
  { pattern: /Approval required before posting/i, label: 'Approval required before posting' },
  { pattern: /approved recruiters can post/i, label: 'approved recruiters can post' },
  { pattern: /approved profiles unlock posting/i, label: 'approved profiles unlock posting' },
  { pattern: /once verified,\s*post/i, label: 'once verified, post' },
  { pattern: /verified recruiters post unlimited/i, label: 'verified recruiters post unlimited' },
  { pattern: /Standard posting is based on recruiter approval/i, label: 'Standard posting is based on recruiter approval' },
  { pattern: /Admin review required before posting/i, label: 'Admin review required before posting' },
  { pattern: /Verified-only recruiter access/i, label: 'Verified-only recruiter access' },
  { pattern: /DOT-verified recruiters only/i, label: 'DOT-verified recruiters only' },
  { pattern: /Basic applicant pipeline analytics/i, label: 'Basic applicant pipeline analytics' },
];

describe('Phase 1J-D2A — no stale recruiter approval-gate phrases in public surfaces', () => {
  for (const rel of RECRUITER_PUBLIC_SURFACES) {
    it(`${rel} contains none of the forbidden phrases`, () => {
      const body = readSource(rel);
      for (const { pattern, label } of FORBIDDEN_PHRASES) {
        expect(
          pattern.test(body),
          `Forbidden phrase "${label}" found in ${rel}. Public recruiter copy must reflect the D2A truth: standard posting unlocks on profile completion + posting terms, and Verified Recruiter badge review is a separate trust-display process.`,
        ).toBe(false);
      }
    });
  }
});

// -------------------------------------------------------------------------
// 2. No "Advanced analytics" claimed as a currently-available Fleet feature.
//    "Analytics" alone is fine (Growth has pipeline analytics today).
// -------------------------------------------------------------------------

describe('Phase 1J-D2A — no Fleet "Advanced analytics" claim in recruiter surfaces', () => {
  for (const rel of RECRUITER_PUBLIC_SURFACES) {
    it(`${rel} does not advertise "Advanced analytics"`, () => {
      const body = readSource(rel);
      expect(
        /Advanced analytics/i.test(body),
        `${rel} advertises "Advanced analytics" — that feature is not shipped today and must not appear as a current Fleet claim.`,
      ).toBe(false);
    });
  }
});

// -------------------------------------------------------------------------
// 3. Pricing.tsx source structure + rendered proof.
// -------------------------------------------------------------------------

describe('Phase 1J-D2A — Pricing.tsx source structure', () => {
  const src = readSource('src/pages/Pricing.tsx');

  it('names the free recruiter tier "Recruiter Standard"', () => {
    expect(src).toMatch(/Recruiter Standard/);
  });

  it('uses distinct availableBullets and comingSoonBullets data paths', () => {
    expect(src).toMatch(/availableBullets\s*:/);
    expect(src).toMatch(/comingSoonBullets\s*:/);
  });

  it('renders both AVAILABLE NOW and COMING SOON section headings', () => {
    // The rendered strings are checked separately; here we assert the source
    // contains the two visible headings so the data separation is user-visible.
    expect(src).toMatch(/Available Now/);
    expect(src).toMatch(/Coming Soon/);
  });

  it('advertises opportunity management edit/pause/close for Recruiter Standard', () => {
    expect(src).toMatch(/Opportunity management:\s*edit,\s*pause,?\s*and close/i);
  });

  it('labels the planned driver contract additions row "Coming soon — not included today"', () => {
    expect(src).toMatch(/Coming soon — not included today/);
    expect(src).not.toMatch(/Planned Pro tools/);
  });

  it('describes Verified Recruiter badge as separate from standard posting', () => {
    // Either the badge review wording or an equivalent "shown only after
    // separate badge approval" phrase must be present.
    const separates =
      /Verified Recruiter badge[^.\n]*separate/i.test(src) ||
      /separate badge approval/i.test(src) ||
      /separate trust-display/i.test(src);
    expect(
      separates,
      'Pricing.tsx must describe the Verified Recruiter badge as a separate trust-display review distinct from standard posting.',
    ).toBe(true);
  });
});

describe('Phase 1J-D2A — Pricing.tsx rendered proof', () => {
  it('recruiter audience view: three current cards are AVAILABLE NOW and Fleet shows existing/included access plus COMING SOON', () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/pricing?audience=recruiter"]}>
          <Pricing />
        </MemoryRouter>
      </HelmetProvider>,
    );

    // Recruiter section heading — anchor.
    expect(screen.getByRole('heading', { name: /Recruiter\s*&\s*Carrier Plans/i })).toBeTruthy();

    // Every recruiter plan name renders.
    for (const name of ['Recruiter Standard', 'Starter', 'Growth', 'Fleet']) {
      expect(
        screen.getByRole('heading', { name, level: 3 }),
        `Recruiter plan card "${name}" must render on Pricing.`,
      ).toBeTruthy();
    }

    // Recruiter Standard, Starter, and Growth render "Available Now"; Fleet renders
    // "Existing / Included Access" because it is preview-only for new standalone checkout.
    const availableLabels = screen.getAllByText(/Available Now/i);
    expect(
      availableLabels.length,
      'Expected an AVAILABLE NOW label on each of the 3 currently purchasable recruiter plan cards.',
    ).toBeGreaterThanOrEqual(3);

    expect(
      screen.getAllByText(/Existing \/ Included Access/i).length,
      'Fleet card must render EXISTING / INCLUDED ACCESS.',
    ).toBeGreaterThanOrEqual(1);

    // Fleet renders a visible COMING SOON heading.
    expect(
      screen.getAllByText(/Coming Soon/i).length,
      'Fleet card must render a distinct COMING SOON heading.',
    ).toBeGreaterThanOrEqual(1);

    // Fleet coming-soon items must be visible.
    for (const item of [
      'Team seats',
      'Bulk opportunity tools',
      'Custom recruiter profile',
      'Company-level hiring dashboard',
    ]) {
      expect(
        screen.getAllByText(new RegExp(item, 'i')).length,
        `Fleet COMING SOON list must include "${item}".`,
      ).toBeGreaterThanOrEqual(1);
    }

    // No "(coming soon)" mixed into AVAILABLE NOW bullets anywhere.
    expect(screen.queryAllByText(/\(coming soon\)/i).length).toBe(0);

    // Recruiter Standard advertises opportunity management (rendered).
    expect(
      screen.getByText(/Opportunity management:\s*edit,\s*pause,?\s*and close/i),
      'Recruiter Standard must advertise opportunity management: edit, pause, and close listings.',
    ).toBeTruthy();

    // Starter must not advertise "Basic applicant pipeline analytics".
    expect(screen.queryByText(/Basic applicant pipeline analytics/i)).toBeNull();
  });

  it('driver audience view: planned contract additions row uses the required "Coming soon — not included today" label', () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/pricing?audience=driver"]}>
          <Pricing />
        </MemoryRouter>
      </HelmetProvider>,
    );

    expect(
      screen.getAllByText(/Coming soon — not included today/i).length,
      'Driver comparison row for planned contract additions must render "Coming soon — not included today".',
    ).toBeGreaterThanOrEqual(1);
  });
});

// -------------------------------------------------------------------------
// 4. RecruiterLanding — visibly separated Fleet current vs future.
// -------------------------------------------------------------------------

describe('Phase 1J-D2A — RecruiterLanding separates Fleet current from future features', () => {
  it('renders AVAILABLE NOW and COMING SOON headings and separates Fleet items', () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <RecruiterLanding />
        </MemoryRouter>
      </HelmetProvider>,
    );

    expect(screen.getAllByText(/Available Now/i).length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText(/Coming Soon/i).length).toBeGreaterThanOrEqual(1);

    for (const item of [
      'Team seats',
      'Bulk opportunity tools',
      'Custom recruiter profile',
      'Company-level hiring dashboard',
    ]) {
      expect(
        screen.getAllByText(new RegExp(item, 'i')).length,
        `Fleet COMING SOON must include "${item}".`,
      ).toBeGreaterThanOrEqual(1);
    }

    // Available-now Fleet must contain "Top-placement eligibility" and
    // "Priority support" but not the coming-soon items masquerading as live.
    expect(screen.getAllByText(/Top-placement eligibility/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Priority support/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByText(/\(coming soon\)/i).length).toBe(0);
  });
});

// -------------------------------------------------------------------------
// 5. agencyPlans exact bullet.
// -------------------------------------------------------------------------

describe('Phase 1J-D2A — agencyPlans.ts member bullet is verbatim', () => {
  it('contains the exact bullet "2 agency members total, including the owner"', () => {
    const src = readSource('src/lib/agencyPlans.ts');
    expect(src).toContain('2 agency members total, including the owner');
  });
});

// -------------------------------------------------------------------------
// 6. Driver Assistants feature must not be pro-gated.
// -------------------------------------------------------------------------

describe('Phase 1J-D2A — Driver Assistants feature is not pro-only', () => {
  it('featureList Driver Assistants entry does not set pro: true', () => {
    let found = false;
    for (const cat of featureList) {
      for (const f of cat.features) {
        if (f.title === 'Driver Assistants') {
          found = true;
          expect(
            (f as { pro?: boolean }).pro,
            'Driver Assistants must not be marked pro: true — invitations are free.',
          ).not.toBe(true);
        }
      }
    }
    expect(found, 'Driver Assistants feature entry must exist in featureList.').toBe(true);
  });
});

// -------------------------------------------------------------------------
// 7. Contract copy — universal driver protections AND separate Growth/Fleet
//    recruiter management + AI-assisted review must both be described.
// -------------------------------------------------------------------------

describe('Phase 1J-D2A — contract copy separates universal driver protections from Growth/Fleet recruiter tools', () => {
  const contractSurfaces = [
    'src/lib/recruiterFeatureList.ts',
    'src/pages/recruiter/RecruiterFAQ.tsx',
    'src/pages/recruiter/RecruiterGuide.tsx',
    'src/pages/Pricing.tsx',
  ];

  it('at least one recruiter surface documents universal driver review/decision/hired-state protections', () => {
    const combined = contractSurfaces.map(readSource).join('\n');
    const universal =
      /approve,?\s*request changes,?\s*(or\s*)?reject/i.test(combined) &&
      /(in-app signature|hired-status|hired-state|driver approv)/i.test(combined);
    expect(
      universal,
      'Copy must describe universal driver contract protections: review, approve, request changes, reject, optional in-app signature, and the hired-status protection requiring driver approval.',
    ).toBe(true);
  });

  it('at least one recruiter surface documents Growth/Fleet contract-management + AI-assisted risk review', () => {
    const combined = contractSurfaces.map(readSource).join('\n');
    const growthFleet =
      /contract-management/i.test(combined) &&
      /AI-assisted (contract )?risk review/i.test(combined) &&
      /(Growth\s*(&|and)\s*Fleet|Growth\b|Fleet\b)/i.test(combined);
    expect(
      growthFleet,
      'Copy must describe Growth/Fleet recruiter contract-management and AI-assisted risk review as separate premium recruiter tools.',
    ).toBe(true);
  });
});

// -------------------------------------------------------------------------
// 8. Recruiters.tsx plan preview truth — Recruiter Standard exists and Fleet
//    names all four future items with today-vs-coming-soon separation.
// -------------------------------------------------------------------------

describe('Phase 1J-D2A — Recruiters.tsx plan preview truth', () => {
  const src = readSource('src/pages/Recruiters.tsx');

  it('exposes Recruiter Standard in the plan preview', () => {
    expect(src).toMatch(/Recruiter Standard/);
  });

  it('Fleet tagline names all four coming-soon items', () => {
    const fleetTagline = src.match(/name:\s*'Fleet'[\s\S]{0,400}?tagline:\s*'([^']+)'/);
    expect(fleetTagline, 'Fleet plan entry with tagline must exist in Recruiters.tsx').not.toBeNull();
    const tagline = fleetTagline![1];
    for (const item of [
      'Team seats',
      'Bulk opportunity tools',
      'Custom recruiter profile',
      'Company-level hiring dashboard',
    ]) {
      expect(
        new RegExp(item, 'i').test(tagline),
        `Fleet tagline must explicitly name "${item}". Actual: ${tagline}`,
      ).toBe(true);
    }
  });

  it('Fleet tagline distinguishes today from coming soon and avoids vague/false claims', () => {
    const fleetTagline = src.match(/name:\s*'Fleet'[\s\S]{0,400}?tagline:\s*'([^']+)'/)![1];
    expect(/today/i.test(fleetTagline), 'Fleet tagline must mark current features with "today".').toBe(true);
    expect(/coming soon/i.test(fleetTagline), 'Fleet tagline must mark future features with "coming soon".').toBe(true);
    expect(
      /&\s*more\s+coming\s+soon/i.test(fleetTagline),
      'Fleet tagline must not use the vague "& more coming soon" phrase.',
    ).toBe(false);
    expect(
      /Advanced analytics/i.test(fleetTagline),
      'Fleet tagline must not claim "Advanced analytics".',
    ).toBe(false);
  });
});

// Consume `within` so it stays imported for future targeted subtree assertions.
void within;
