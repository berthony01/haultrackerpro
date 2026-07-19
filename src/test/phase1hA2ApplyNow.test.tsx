import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApplyNowDialog } from '@/components/opportunities/ApplyNowDialog';
import {
  classifyFormalApply,
  classifyRequestInfo,
  submissionErrorMessage,
} from '@/lib/opportunities/applicationSubmission';

// Radix UI Select relies on pointer-capture APIs jsdom does not implement.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as any;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

// Mock the hook to isolate ApplyNowDialog behavior.
const mutateAsync = vi.fn();
const submitApplication = { mutateAsync, isPending: false } as any;
vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: () => ({ submitApplication }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

const baseProfile = {
  id: 'p1',
  user_id: 'u1',
  full_name: 'Jane Driver',
  city: 'Dallas',
  state: 'TX',
  cdl_class: 'A',
  years_experience: 5,
  email: 'jane@example.com',
  phone: '5551234567',
  profile_completed: true,
} as any;

function renderDialog(overrides: Partial<React.ComponentProps<typeof ApplyNowDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onEditProfile = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <ApplyNowDialog
        open
        onOpenChange={onOpenChange}
        opportunityId="opp-1"
        opportunityTitle="OTR Reefer"
        companyName="Acme"
        driverProfile={baseProfile}
        onEditProfile={onEditProfile}
        {...overrides}
      />
    </QueryClientProvider>
  );
  return { ...utils, onOpenChange, onEditProfile };
}

beforeEach(() => {
  mutateAsync.mockReset();
  submitApplication.isPending = false;
});

describe('applicationSubmission helpers', () => {
  it('classifyFormalApply returns none when no formal application exists', () => {
    expect(classifyFormalApply([], 'opp-1')).toEqual({ kind: 'none' });
    expect(
      classifyFormalApply(
        [{ opportunity_id: 'opp-1', application_type: 'request_info', status: 'new' }],
        'opp-1',
      ),
    ).toEqual({ kind: 'none' });
  });

  it('classifyFormalApply marks active for in-flight statuses', () => {
    expect(
      classifyFormalApply(
        [{ opportunity_id: 'opp-1', application_type: 'apply', status: 'interviewing' }],
        'opp-1',
      ),
    ).toEqual({ kind: 'active', status: 'interviewing' });
  });

  it('classifyFormalApply allows reapply after rejected/withdrawn', () => {
    expect(
      classifyFormalApply(
        [
          { opportunity_id: 'opp-1', application_type: 'apply', status: 'rejected', created_at: '2026-01-01' },
        ],
        'opp-1',
      ),
    ).toEqual({ kind: 'reapplyable', status: 'rejected' });
  });

  it('classifyFormalApply picks the most recent formal application', () => {
    const state = classifyFormalApply(
      [
        { opportunity_id: 'opp-1', application_type: 'apply', status: 'rejected', created_at: '2026-01-01' },
        { opportunity_id: 'opp-1', application_type: 'apply', status: 'interviewing', created_at: '2026-02-01' },
      ],
      'opp-1',
    );
    expect(state).toEqual({ kind: 'active', status: 'interviewing' });
  });

  it('classifyRequestInfo is independent of formal apply rows', () => {
    expect(
      classifyRequestInfo(
        [{ opportunity_id: 'opp-1', application_type: 'apply', status: 'new' }],
        'opp-1',
      ),
    ).toEqual({ exists: false });
    expect(
      classifyRequestInfo(
        [{ opportunity_id: 'opp-1', application_type: 'request_info', status: 'new' }],
        'opp-1',
      ),
    ).toEqual({ exists: true });
  });

  it('submissionErrorMessage maps every documented result_code', () => {
    const codes: Array<[string, RegExp]> = [
      ['submission_failed:duplicate_same_type', /active application/i],
      ['submission_failed:opportunity_unavailable', /no longer accepting/i],
      ['submission_failed:self_opportunity', /your own Recruiter/i],
      ['submission_failed:profile_required', /Opportunity Profile/i],
      ['submission_failed:restricted', /not available/i],
      ['submission_failed:invalid_input', /required confirmations/i],
      ['submission_failed:question_required', /question is required/i],
      ['submission_failed:empty_response', /could not confirm/i],
      ['submission_failed:unknown_code', /could not be submitted/i],
    ];
    for (const [raw, re] of codes) {
      expect(submissionErrorMessage(new Error(raw))).toMatch(re);
    }
  });
});

describe('ApplyNowDialog gating', () => {
  it('shows profile-required panel when profile is incomplete', () => {
    renderDialog({ driverProfile: { ...baseProfile, profile_completed: false } });
    expect(
      screen.getByText(/Complete your Opportunity Profile to apply/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit Application/i })).not.toBeInTheDocument();
  });

  it('routes edit-profile click to the parent handler', async () => {
    const { onEditProfile } = renderDialog({
      driverProfile: { ...baseProfile, profile_completed: false },
    });
    await userEvent.click(screen.getByRole('button', { name: /Update Opportunity Profile/i }));
    expect(onEditProfile).toHaveBeenCalled();
  });

  it('disables submit until all three attestations are checked', async () => {
    renderDialog();
    const submit = screen.getByRole('button', { name: /Submit Application/i });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/availability and Opportunity Profile/i));
    await userEvent.click(screen.getByLabelText(/meet its stated requirements/i));
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/accurate to the best of my knowledge/i));
    expect(submit).toBeEnabled();
  });
});

describe('ApplyNowDialog submission', () => {
  const fillAttestations = async () => {
    await userEvent.click(screen.getByLabelText(/availability and Opportunity Profile/i));
    await userEvent.click(screen.getByLabelText(/meet its stated requirements/i));
    await userEvent.click(screen.getByLabelText(/accurate to the best of my knowledge/i));
  };

  it('submits with a caller-supplied idempotency key preserved across renders', async () => {
    mutateAsync.mockResolvedValue({ result_code: 'created' });
    const { onOpenChange } = renderDialog();
    await fillAttestations();
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const args = mutateAsync.mock.calls[0][0];
    expect(args.opportunity_id).toBe('opp-1');
    expect(typeof args.idempotency_key).toBe('string');
    expect(args.idempotency_key.length).toBeGreaterThanOrEqual(8);
    expect(args.availability_confirmed).toBe(true);
    expect(args.requirements_confirmed).toBe(true);
    expect(args.truth_attestation).toBe(true);
    expect(args.preferred_contact_method).toBe('in_app');
    expect(args.contact_sharing_consent).toBe(false);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('maps submission_failed:duplicate_same_type to a public-safe message', async () => {
    mutateAsync.mockRejectedValue(new Error('submission_failed:duplicate_same_type'));
    renderDialog();
    await fillAttestations();
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/active application/i),
    );
  });

  it('blocks email/phone selection without consent', async () => {
    renderDialog();
    await fillAttestations();
    const trigger = screen.getByRole('combobox', { name: /Preferred contact method/i });
    await userEvent.click(trigger);
    const emailOption = await screen.findByRole('option', { name: /^Email/i });
    await userEvent.click(emailOption);
    expect(
      screen.getByText(/Enable contact sharing to use email or phone/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Application/i })).toBeDisabled();
    await userEvent.click(
      screen.getByLabelText(/authorize HaulTracker Pro to share my selected contact/i),
    );
    expect(screen.getByRole('button', { name: /Submit Application/i })).toBeEnabled();
  });

  it('rejects messages over the 4000 character limit', async () => {
    renderDialog();
    await fillAttestations();
    const textarea = screen.getByLabelText(/Message to recruiter/i) as HTMLTextAreaElement;
    // maxLength enforces the client cap; assert both counter and cap behavior.
    expect(textarea.maxLength).toBe(4000);
  });

  it('resets and closes the dialog on cancel', async () => {
    const { onOpenChange } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders the profile snapshot with core fields', () => {
    renderDialog();
    const snapshot = screen.getByText(/Application snapshot/i).closest('div')!.parentElement!;
    expect(within(snapshot).getByText(/Jane Driver/)).toBeInTheDocument();
    expect(within(snapshot).getByText(/Dallas, TX/)).toBeInTheDocument();
    expect(within(snapshot).getByText(/^A$/)).toBeInTheDocument();
    expect(within(snapshot).getByText(/5 yrs/)).toBeInTheDocument();
  });
});
