/**
 * Phase 1M-A — Pricing audience architecture.
 *
 * Durable, rendered coverage of the three-audience `/pricing` contract:
 *  - Default view + explicit query views (?audience=driver|recruiter|agency).
 *  - Invalid query defaults driver and does NOT fall through to legacy hash.
 *  - Query precedence beats hash when both are present.
 *  - Legacy hash mapping only when query is absent.
 *  - Accessible tab semantics (exactly three tabs, correct aria-selected).
 *  - Tab interaction mounts/unmounts the correct panel and updates the URL.
 *  - Driver disclosures + contained comparison scroll.
 *  - Recruiter foundation + exact paid grid (Starter, Growth, Fleet).
 *  - Agency separation + exact paid grid (Agency Starter, Team, Growth).
 *  - Exactly one major audience panel mounted per view.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

import Pricing from '@/pages/Pricing';

function LocationProbe() {
  const loc = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={loc.pathname}
      data-search={loc.search}
      data-hash={loc.hash}
    />
  );
}

function renderAt(url: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <Pricing />
        <LocationProbe />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

function expectOnlyPanel(active: 'driver' | 'recruiter' | 'agency') {
  const ids = {
    driver: 'pricing-driver-view',
    recruiter: 'pricing-recruiter-view',
    agency: 'pricing-agency-view',
  } as const;
  expect(screen.getByTestId(ids[active])).toBeTruthy();
  for (const key of ['driver', 'recruiter', 'agency'] as const) {
    if (key === active) continue;
    expect(screen.queryByTestId(ids[key])).toBeNull();
  }
}

describe('Phase 1M-A — default view', () => {
  it('/pricing selects the driver view with Free + Pro and billing toggle', () => {
    renderAt('/pricing');
    expectOnlyPanel('driver');
    expect(screen.getByTestId('driver-billing-toggle')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Free$/, level: 3 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Pro$/, level: 3 })).toBeTruthy();
  });
});

describe('Phase 1M-A — explicit query views', () => {
  it('?audience=recruiter mounts only the recruiter panel and hides driver toggle', () => {
    renderAt('/pricing?audience=recruiter');
    expectOnlyPanel('recruiter');
    expect(screen.queryByTestId('driver-billing-toggle')).toBeNull();
  });

  it('?audience=agency mounts only the agency panel and hides driver toggle', () => {
    renderAt('/pricing?audience=agency');
    expectOnlyPanel('agency');
    expect(screen.queryByTestId('driver-billing-toggle')).toBeNull();
  });
});

describe('Phase 1M-A — invalid query defaults to driver (no hash fall-through)', () => {
  it('unknown audience alone defaults to driver', () => {
    renderAt('/pricing?audience=unknown');
    expectOnlyPanel('driver');
  });

  it('unknown audience with a legacy hash still defaults to driver', () => {
    renderAt('/pricing?audience=unknown#for-recruiters');
    expectOnlyPanel('driver');
  });
});

describe('Phase 1M-A — query precedence over hash', () => {
  it('?audience=driver#for-recruiters selects driver', () => {
    renderAt('/pricing?audience=driver#for-recruiters');
    expectOnlyPanel('driver');
  });

  it('?audience=agency#for-recruiters selects agency', () => {
    renderAt('/pricing?audience=agency#for-recruiters');
    expectOnlyPanel('agency');
  });
});

describe('Phase 1M-A — legacy hashes when query is absent', () => {
  it('#driver-plans selects driver', () => {
    renderAt('/pricing#driver-plans');
    expectOnlyPanel('driver');
  });

  it('#for-recruiters selects recruiter', () => {
    renderAt('/pricing#for-recruiters');
    expectOnlyPanel('recruiter');
  });

  it('#assistants-agencies selects agency', () => {
    renderAt('/pricing#assistants-agencies');
    expectOnlyPanel('agency');
  });
});

describe('Phase 1M-A — accessible tabs', () => {
  it('exposes exactly three audience tabs with the required accessible names', () => {
    renderAt('/pricing');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    const names = tabs.map((t) => t.getAttribute('aria-label'));
    expect(names).toEqual(['Drivers', 'Recruiters & Carriers', 'Back-Office Businesses']);
  });

  it('marks aria-selected correctly for each active view', () => {
    renderAt('/pricing?audience=driver');
    expect(
      screen.getByRole('tab', { name: 'Drivers' }).getAttribute('aria-selected'),
    ).toBe('true');
    cleanup();

    renderAt('/pricing?audience=recruiter');
    expect(
      screen.getByRole('tab', { name: 'Recruiters & Carriers' }).getAttribute('aria-selected'),
    ).toBe('true');
    cleanup();

    renderAt('/pricing?audience=agency');
    expect(
      screen.getByRole('tab', { name: 'Back-Office Businesses' }).getAttribute('aria-selected'),
    ).toBe('true');
  });
});

describe('Phase 1M-A — tab interaction updates panel and URL', () => {
  it('clicking each tab mounts its panel and pushes ?audience=<key> without legacy hash', () => {
    renderAt('/pricing');
    expectOnlyPanel('driver');

    fireEvent.click(screen.getByRole('tab', { name: 'Recruiters & Carriers' }));
    expectOnlyPanel('recruiter');
    let probe = screen.getByTestId('location-probe');
    expect(probe.getAttribute('data-pathname')).toBe('/pricing');
    expect(probe.getAttribute('data-search')).toBe('?audience=recruiter');
    expect(probe.getAttribute('data-hash')).toBe('');

    fireEvent.click(screen.getByRole('tab', { name: 'Back-Office Businesses' }));
    expectOnlyPanel('agency');
    probe = screen.getByTestId('location-probe');
    expect(probe.getAttribute('data-search')).toBe('?audience=agency');
    expect(probe.getAttribute('data-hash')).toBe('');

    fireEvent.click(screen.getByRole('tab', { name: 'Drivers' }));
    expectOnlyPanel('driver');
    probe = screen.getByTestId('location-probe');
    expect(probe.getAttribute('data-search')).toBe('?audience=driver');
    expect(probe.getAttribute('data-hash')).toBe('');
  });
});

describe('Phase 1M-A — driver disclosures + contained comparison', () => {
  it('exposes both native details disclosures and a scroll-contained comparison', () => {
    renderAt('/pricing?audience=driver');

    // Two native <details> elements with the required summaries.
    const summaries = screen.getAllByText(
      /View all Pro features|View full Driver Free vs Pro comparison/,
    );
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    for (const s of summaries) {
      // The nearest enclosing element must be a native <details> block via summary.
      // Walk up to find a <details> ancestor.
      let node: HTMLElement | null = s as HTMLElement;
      while (node && node.tagName !== 'DETAILS') node = node.parentElement;
      expect(node?.tagName).toBe('DETAILS');
    }

    // Scroll container present with the stable test id.
    expect(screen.getByTestId('driver-comparison-scroll')).toBeTruthy();

    // "Coming soon — not included today" comparison label still rendered.
    expect(
      screen.getByText(/Coming soon — not included today/),
    ).toBeTruthy();
  });
});

describe('Phase 1M-A — recruiter foundation + exact paid grid', () => {
  it('renders Recruiter Standard outside the paid grid; grid = Starter, Growth, Fleet', () => {
    renderAt('/pricing?audience=recruiter');

    // Recruiter Standard is a level-3 heading outside the paid grid.
    const recruiterStandard = screen.getByRole('heading', {
      name: /^Recruiter Standard$/,
      level: 3,
    });
    expect(recruiterStandard).toBeTruthy();

    const paid = screen.getByTestId('recruiter-paid-grid');
    const paidHeadings = within(paid)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent?.trim());
    expect(paidHeadings).toEqual(['Starter', 'Growth', 'Fleet']);

    expect(paid.contains(recruiterStandard)).toBe(false);

    // Growth accompanied by MOST POPULAR (rendered inside recruiter view).
    expect(within(paid).getAllByText(/MOST POPULAR/i).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 1M-A — back-office separation + exact paid grid', () => {
  it('Driver Assistant callout sits outside the agency paid grid; grid = Starter/Team/Growth', () => {
    renderAt('/pricing?audience=agency');

    const driverAssistant = screen.getByRole('heading', {
      name: /^Driver Assistant$/,
      level: 3,
    });
    expect(driverAssistant).toBeTruthy();

    const paid = screen.getByTestId('agency-paid-grid');
    const paidHeadings = within(paid)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent?.trim());
    expect(paidHeadings).toEqual(['Agency Starter', 'Agency Team', 'Agency Growth']);

    expect(paid.contains(driverAssistant)).toBe(false);

    // CTAs present.
    expect(screen.getAllByText(/Become a Driver Assistant/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Start an Agency Workspace/).length).toBeGreaterThanOrEqual(1);

    // Outside-platform payment truth.
    expect(
      screen.getAllByText(/HaulTracker Pro does not/i).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
