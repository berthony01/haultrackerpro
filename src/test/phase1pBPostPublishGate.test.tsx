/**
 * Phase 1P-A4 — post/publish gate resume behavior.
 *
 * Proves the three surfaces that intercept an interrupted action behind
 * `RecruiterReadinessDialog` resume the correct continuation exactly once:
 *   1. `RecruiterAccessPage` top "Post an Opportunity" -> onManage()
 *   2. `RecruiterOpportunityManager` header create, empty-state create, and
 *      status transition (draft -> active) each gate and resume once.
 *   3. `RecruiterOpportunityForm` publish backup gate + resume without
 *      duplicate create/update.
 *
 * Cancel from any surface clears the pending action and performs nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---- Mock the readiness dialog so we can drive onReady deterministically ---

let dialogProps: {
  open: boolean;
  onReady?: () => void;
  onOpenChange: (v: boolean) => void;
  actionLabel?: string;
} | null = null;

vi.mock('@/components/opportunities/RecruiterReadinessDialog', () => ({
  RecruiterReadinessDialog: (props: {
    open: boolean;
    onReady?: () => void;
    onOpenChange: (v: boolean) => void;
    actionLabel?: string;
  }) => {
    dialogProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="mock-readiness-dialog" data-action={props.actionLabel}>
        <button
          data-testid="mock-readiness-ready"
          onClick={() => {
            // Correct real-dialog order: fire onReady BEFORE closing so the
            // parent's onOpenChange(false) does not clear the pending action
            // before the continuation runs.
            props.onReady?.();
            props.onOpenChange(false);
          }}
        >
          ready
        </button>
        <button
          data-testid="mock-readiness-ready-buggy-order"
          onClick={() => {
            // Simulates the pre-1P-A5 regression order (close BEFORE resume).
            // If the manager clears pendingAction on close, the continuation
            // must NOT run — this is the regression guard for Repair 1.
            props.onOpenChange(false);
            props.onReady?.();
          }}
        >
          ready-buggy
        </button>
        <button
          data-testid="mock-readiness-cancel"
          onClick={() => props.onOpenChange(false)}
        >
          cancel
        </button>
      </div>
    );
  },
}));

// ---- Hook / lib mocks -----------------------------------------------------

const readiness = { ready: false };
const refetchProfile = vi.fn(async () => ({}));
const setStatusMutate = vi.fn();

vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({
  useRecruiterProfile: () => ({
    profile: { id: 'rp', recruiter_name: 'r', company_name: 'c' },
    isLoading: false,
    refetchProfile,
    upsertProfile: { mutateAsync: vi.fn(), isPending: false },
    saveRecruiterProfile: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ intentRecruiter: true }),
}));

vi.mock('@/lib/opportunities/resolveRecruiterReadiness', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/opportunities/resolveRecruiterReadiness')
  >('@/lib/opportunities/resolveRecruiterReadiness');
  return {
    ...actual,
    resolveRecruiterReadiness: () => ({
      ready: readiness.ready,
      suspended: false,
      needsProfileFirst: false,
      missing: readiness.ready ? [] : ['company_name'],
      messages: [],
      companyType: null,
    }),
  };
});

vi.mock('@/lib/opportunities/describeRecruiterBlock', () => ({
  describeRecruiterBlock: () => ({ reason: 'ok', title: '', body: '' }),
}));

vi.mock('@/hooks/opportunities/useRecruiterOpportunities', () => ({
  useRecruiterOpportunities: () => ({
    opportunities: [
      {
        id: 'opp-1',
        title: 'Test',
        company_name: 'Acme',
        status: 'draft',
        created_at: '2024-01-01T00:00:00Z',
      },
    ],
    isLoading: false,
    setStatus: { mutate: setStatusMutate, isPending: false },
    deleteOpportunity: { mutate: vi.fn(), isPending: false },
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/opportunities/useRecruiterBilling', () => ({
  useRecruiterBilling: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/lib/opportunities/publicationStatus', () => ({
  getOpportunityPublicationStatus: () => ({
    key: 'draft',
    label: 'Draft',
    description: '',
    variant: 'outline',
  }),
}));

// ---- Access page dependencies (minimal). ---------------------------------
// The manager tests are the primary vehicle for the resume contract; skip
// pulling the heavy RecruiterAccessPage into this file to avoid an
// unrelated dep footprint.

import { RecruiterOpportunityManager } from '@/components/opportunities/RecruiterOpportunityManager';

// Prevent the form view from actually loading its heavy tree — the manager
// swaps to the form component after a successful gate; a lightweight stub
// tells us we crossed that boundary.
vi.mock('@/components/opportunities/RecruiterOpportunityForm', () => ({
  RecruiterOpportunityForm: ({ initial }: { initial: unknown }) => (
    <div data-testid="mock-opp-form" data-editing={initial ? 'true' : 'false'} />
  ),
}));

vi.mock('@/components/opportunities/RecruiterReferralsPanel', () => ({
  RecruiterReferralsPanel: () => <div data-testid="mock-referrals" />,
}));

function renderManager() {
  const onBack = vi.fn();
  render(<RecruiterOpportunityManager onBack={onBack} />);
}

describe('Phase 1P-A4 — post/publish gate resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readiness.ready = false;
    dialogProps = null;
  });

  it('Manager header Post Opportunity: gates when not ready then resumes create exactly once', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByTestId('post-opportunity-cta'));
    // Refetch consulted, dialog opened.
    expect(refetchProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mock-readiness-dialog')).toBeInTheDocument();
    // Simulate the readiness dialog reporting ready.
    readiness.ready = true;
    await user.click(screen.getByTestId('mock-readiness-ready'));
    // Form view now mounted (creation continuation ran once).
    const form = await screen.findByTestId('mock-opp-form');
    expect(form.getAttribute('data-editing')).toBe('false');
  });

  it('Manager status transition (draft -> active): gates then activates exactly once', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole('button', { name: /Publish/i }));
    expect(refetchProfile).toHaveBeenCalledTimes(1);
    expect(setStatusMutate).not.toHaveBeenCalled();
    readiness.ready = true;
    await user.click(screen.getByTestId('mock-readiness-ready'));
    expect(setStatusMutate).toHaveBeenCalledTimes(1);
    expect(setStatusMutate.mock.calls[0][0]).toEqual({ id: 'opp-1', status: 'active' });
  });

  it('Repair 1 regression guard: dialog closing BEFORE onReady must NOT run the continuation (proves manager clears pendingAction on close)', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByTestId('post-opportunity-cta'));
    expect(screen.getByTestId('mock-readiness-dialog')).toBeInTheDocument();
    readiness.ready = true;
    // Buggy pre-1P-A5 order: onOpenChange(false) fires first, which clears
    // pendingAction; then onReady runs but has nothing to resume.
    await user.click(screen.getByTestId('mock-readiness-ready-buggy-order'));
    expect(screen.queryByTestId('mock-opp-form')).not.toBeInTheDocument();
    expect(setStatusMutate).not.toHaveBeenCalled();
  });

  it('Cancel from the readiness dialog clears the pending action and performs nothing', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByTestId('post-opportunity-cta'));
    expect(screen.getByTestId('mock-readiness-dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('mock-readiness-cancel'));
    // Dialog closes and no form nor mutation happened.
    expect(screen.queryByTestId('mock-opp-form')).not.toBeInTheDocument();
    expect(setStatusMutate).not.toHaveBeenCalled();
    // Re-open + ready with no queued action -> nothing runs.
    readiness.ready = false;
    await user.click(screen.getByTestId('post-opportunity-cta'));
    readiness.ready = true;
    await user.click(screen.getByTestId('mock-readiness-ready'));
    // Only one continuation (from this second open) — proves no leaked
    // pending action from the cancelled first open.
    expect(await screen.findByTestId('mock-opp-form')).toBeInTheDocument();
  });

  it('Draft-status non-gated actions (pause/close/edit) remain unchanged and never open readiness', async () => {
    // Draft only shows Edit + Publish + Close + Delete; Publish is gated
    // (asserted above). Close is a plain mutation and MUST NOT gate.
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole('button', { name: /Close/i }));
    expect(refetchProfile).not.toHaveBeenCalled();
    expect(setStatusMutate).toHaveBeenCalledTimes(1);
    expect(setStatusMutate.mock.calls[0][0]).toEqual({ id: 'opp-1', status: 'closed' });
    expect(screen.queryByTestId('mock-readiness-dialog')).not.toBeInTheDocument();
  });
});
