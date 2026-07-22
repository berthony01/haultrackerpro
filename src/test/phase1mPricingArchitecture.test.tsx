/**
 * Phase 1M-A — Pricing audience architecture.
 *
 * Verifies:
 *  - Query-param audience routing (?audience=driver|recruiter|agency).
 *  - Legacy hash mapping (#driver-plans / #for-recruiters / #assistants-agencies).
 *  - Mutually exclusive views: each audience mounts only its own plans.
 *  - Driver monthly/annual toggle appears only in the driver view.
 *  - Recruiter Standard callout appears only in the recruiter view.
 *  - Driver Assistant free callout appears only in the back-office view.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

import Pricing from '@/pages/Pricing';

function renderAt(url: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <Pricing />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe('Phase 1M-A — audience selector renders three tabs', () => {
  it('renders the three audience tabs regardless of active view', () => {
    renderAt('/pricing');
    expect(screen.getByRole('tab', { name: 'Drivers' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Recruiters & Carriers' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Back-Office Businesses' })).toBeTruthy();
  });
});

describe('Phase 1M-A — driver audience', () => {
  it('mounts only driver plans and the monthly/annual toggle', () => {
    renderAt('/pricing?audience=driver');
    expect(screen.getByRole('tab', { name: 'Drivers' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('driver-billing-toggle')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Free$/, level: 3 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Pro$/, level: 3 })).toBeTruthy();
    // Recruiter/agency plans absent
    expect(screen.queryByRole('heading', { name: /Recruiter Standard/i, level: 3 })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Agency Workspace/i })).toBeNull();
  });

  it('legacy #driver-plans hash resolves to the driver view', () => {
    renderAt('/pricing#driver-plans');
    expect(screen.getByTestId('driver-billing-toggle')).toBeTruthy();
  });
});

describe('Phase 1M-A — recruiter audience', () => {
  it('mounts only recruiter plans; driver toggle and agency callout are absent', () => {
    renderAt('/pricing?audience=recruiter');
    expect(screen.getByRole('tab', { name: 'Recruiters & Carriers' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: /Recruiter Standard/i, level: 3 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Starter$/, level: 3 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Growth$/, level: 3 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Fleet$/, level: 3 })).toBeTruthy();
    expect(screen.queryByTestId('driver-billing-toggle')).toBeNull();
    expect(screen.queryByRole('heading', { name: /Agency Workspace/i })).toBeNull();
  });

  it('legacy #for-recruiters hash resolves to the recruiter view', () => {
    renderAt('/pricing#for-recruiters');
    expect(screen.getByRole('heading', { name: /Recruiter Standard/i, level: 3 })).toBeTruthy();
  });
});

describe('Phase 1M-A — back-office (agency) audience', () => {
  it('mounts only assistant/agency plans; driver toggle and recruiter cards are absent', () => {
    renderAt('/pricing?audience=agency');
    expect(screen.getByRole('tab', { name: 'Back-Office Businesses' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: /Agency Workspace/i })).toBeTruthy();
    // Driver Assistant free callout present (h3 heading)
    expect(screen.getByRole('heading', { name: /^Driver Assistant$/, level: 3 })).toBeTruthy();
    expect(screen.queryByTestId('driver-billing-toggle')).toBeNull();
    expect(screen.queryByRole('heading', { name: /Recruiter Standard/i, level: 3 })).toBeNull();
  });

  it('legacy #assistants-agencies hash resolves to the agency view', () => {
    renderAt('/pricing#assistants-agencies');
    expect(screen.getByRole('heading', { name: /Agency Workspace/i })).toBeTruthy();
  });
});

describe('Phase 1M-A — invalid audience query falls back to driver', () => {
  it('unknown ?audience= value defaults to driver view', () => {
    renderAt('/pricing?audience=bogus');
    expect(screen.getByTestId('driver-billing-toggle')).toBeTruthy();
  });
});
