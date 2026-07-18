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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Phase 1G-R1A4 rendered Recruiter billing copy', () => {
  it('separates standard access, verification, and paid premium tools in the real component', () => {
    render(<RecruiterBillingPanel />);
    const text = document.body.textContent ?? '';

    expect(text).toContain(
      'Recruiters with a complete, non-suspended profile can post standard opportunities.',
    );
    expect(text).toContain('Verification adds a Verified Recruiter badge.');
    expect(text).toContain('Paid plans add premium recruiting tools, limits, and reporting.');
    expect(text).toContain(
      'Standard posting depends on profile completeness and suspension status, not verification or payment.',
    );
    expect(screen.getByText('Standard Access')).toBeInTheDocument();
    expect(screen.getByText('Standard Recruiter Access')).toBeInTheDocument();
  });

  it('does not render verification, approval, admin review, or payment as standard-posting gates', () => {
    render(<RecruiterBillingPanel />);
    const text = document.body.textContent ?? '';

    for (const forbidden of [
      'Free Verified',
      'Verified recruiters can post',
      'Unlimited for verified recruiters',
      'Unlimited standard opportunity posts',
      'Admin-reviewed listings',
      'Standard posting is based on recruiter approval',
      'Included once your recruiter profile is approved',
      'Paid plans unlock standard posting',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
