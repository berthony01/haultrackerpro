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

  it('sends contact_sharing_consent flag when the driver enables it', async () => {
    mutateAsync.mockResolvedValue({ result_code: 'created' });
    renderDialog();
    await fillAttestations();
    await userEvent.click(
      screen.getByLabelText(/authorize HaulTracker Pro to share my selected contact/i),
    );
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0].contact_sharing_consent).toBe(true);
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
    const snapshot = screen.getByText(/Application snapshot \(read-only\)/i)
      .closest('div')!.parentElement!.parentElement!;
    expect(within(snapshot).getByText(/Jane Driver/)).toBeInTheDocument();
    expect(within(snapshot).getByText(/Dallas, TX/)).toBeInTheDocument();
    expect(within(snapshot).getByText(/5 yrs/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 1H-A2 CLOSEOUT — SMS support, payload allowlist, idempotency lifecycle,
// error rendering, and success-reset coverage.
// ---------------------------------------------------------------------------

const ALLOWED_KEYS = [
  'availability_confirmed',
  'contact_sharing_consent',
  'idempotency_key',
  'message',
  'opportunity_id',
  'preferred_contact_method',
  'requirements_confirmed',
  'truth_attestation',
].sort();

const FORBIDDEN_KEYS = [
  'driver_user_id', 'recruiter_id', 'driver_profile_id', 'full_name', 'name',
  'email', 'phone', 'cdl_class', 'years_experience', 'endorsements',
  'trailer_experience', 'submission_snapshot', 'snapshot', 'snapshot_version',
  'status', 'application_type', 'submitted_at', 'created_by', 'is_pro',
  'subscription', 'finance', 'load', 'expense', 'fuel', 'tax',
];

async function fillAttest() {
  await userEvent.click(screen.getByLabelText(/availability and Opportunity Profile/i));
  await userEvent.click(screen.getByLabelText(/meet its stated requirements/i));
  await userEvent.click(screen.getByLabelText(/accurate to the best of my knowledge/i));
}

describe('ApplyNowDialog — SMS support', () => {
  it('offers SMS only when phone is present', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('combobox', { name: /Preferred contact method/i }));
    const smsOpt = await screen.findByRole('option', { name: /^SMS/i });
    expect(smsOpt).toBeInTheDocument();
    expect(smsOpt).not.toHaveAttribute('data-disabled');
  });

  it('disables SMS when profile has no phone', async () => {
    renderDialog({ driverProfile: { ...baseProfile, phone: null } });
    await userEvent.click(screen.getByRole('combobox', { name: /Preferred contact method/i }));
    const smsOpt = await screen.findByRole('option', { name: /SMS \(no phone on profile\)/i });
    expect(smsOpt).toHaveAttribute('data-disabled');
  });

  it('submits with preferred_contact_method=sms and no phone number in payload', async () => {
    mutateAsync.mockResolvedValue({ result_code: 'created' });
    renderDialog();
    await fillAttest();
    // Enable consent FIRST so external methods aren't reverted to in_app.
    await userEvent.click(
      screen.getByLabelText(/authorize HaulTracker Pro to share my selected contact/i),
    );
    await userEvent.click(screen.getByRole('combobox', { name: /Preferred contact method/i }));
    await userEvent.click(await screen.findByRole('option', { name: /^SMS/i }));
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload.preferred_contact_method).toBe('sms');
    expect(payload.contact_sharing_consent).toBe(true);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it('reverts SMS to in_app when contact consent is turned off', async () => {
    renderDialog();
    await fillAttest();
    // Enable consent then select SMS
    const consent = screen.getByLabelText(/authorize HaulTracker Pro to share my selected contact/i);
    await userEvent.click(consent);
    await userEvent.click(screen.getByRole('combobox', { name: /Preferred contact method/i }));
    await userEvent.click(await screen.findByRole('option', { name: /^SMS/i }));
    expect(screen.getByRole('combobox', { name: /Preferred contact method/i })).toHaveTextContent(/SMS/i);
    // Turn consent off — should revert to in_app
    await userEvent.click(consent);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /Preferred contact method/i }))
        .toHaveTextContent(/In-app messaging/i),
    );
  });
});

describe('ApplyNowDialog — exact payload allowlist', () => {
  it('sends exactly the whitelisted keys and no PII/snapshot fields', async () => {
    mutateAsync.mockResolvedValue({ result_code: 'created' });
    renderDialog();
    await fillAttest();
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const payload = mutateAsync.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(ALLOWED_KEYS);
    for (const k of FORBIDDEN_KEYS) {
      expect(payload).not.toHaveProperty(k);
    }
    // Explicit: never send raw phone/email even as separate fields.
    expect(JSON.stringify(payload)).not.toContain(baseProfile.phone);
    expect(JSON.stringify(payload)).not.toContain(baseProfile.email);
  });
});

describe('ApplyNowDialog — idempotency-key lifecycle', () => {
  it('reuses the same key across a failed submission retry within one open attempt', async () => {
    mutateAsync
      .mockRejectedValueOnce(new Error('submission_failed:empty_response'))
      .mockResolvedValueOnce({ result_code: 'created' });
    renderDialog();
    await fillAttest();
    const submit = screen.getByRole('button', { name: /Submit Application/i });
    await userEvent.click(submit);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const firstKey = mutateAsync.mock.calls[0][0].idempotency_key;
    // Dialog stays open on error; click again
    await userEvent.click(submit);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync.mock.calls[1][0].idempotency_key).toBe(firstKey);
  });

  it('generates a new key when reopened after cancel', async () => {
    mutateAsync.mockRejectedValue(new Error('submission_failed:empty_response'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let open = true;
    const onOpenChange = vi.fn((v: boolean) => { open = v; });
    const Render = () => (
      <QueryClientProvider client={qc}>
        <ApplyNowDialog
          open={open}
          onOpenChange={onOpenChange}
          opportunityId="opp-1"
          opportunityTitle="OTR Reefer"
          companyName="Acme"
          driverProfile={baseProfile}
          onEditProfile={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(<Render />);
    await fillAttest();
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const firstKey = mutateAsync.mock.calls[0][0].idempotency_key;
    // Cancel via the actual button so handleOpenChange fires and resetForm runs.
    await userEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    rerender(<Render />); // reflect open=false
    // Reopen
    open = true;
    rerender(<Render />);
    await fillAttest();
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    const secondKey = mutateAsync.mock.calls[1][0].idempotency_key;
    expect(secondKey).not.toBe(firstKey);
  });

  it('generates a new key after a successful submission and reopen', async () => {
    mutateAsync.mockResolvedValue({ result_code: 'created' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let openState = true;
    const onOpenChange = vi.fn((v: boolean) => { openState = v; });
    const Rerender = ({ open }: { open: boolean }) => (
      <QueryClientProvider client={qc}>
        <ApplyNowDialog
          open={open}
          onOpenChange={onOpenChange}
          opportunityId="opp-1"
          opportunityTitle="OTR Reefer"
          companyName="Acme"
          driverProfile={baseProfile}
          onEditProfile={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(<Rerender open={openState} />);
    await fillAttest();
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const firstKey = mutateAsync.mock.calls[0][0].idempotency_key;
    rerender(<Rerender open={false} />);
    rerender(<Rerender open />);
    await fillAttest();
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync.mock.calls[1][0].idempotency_key).not.toBe(firstKey);
  });
});

describe('ApplyNowDialog — public-safe error rendering', () => {
  const cases: Array<[string, RegExp]> = [
    ['duplicate_same_type', /active application/i],
    ['opportunity_unavailable', /no longer accepting/i],
    ['self_opportunity', /your own Recruiter/i],
    ['profile_required', /Opportunity Profile/i],
    ['restricted', /not available for your account/i],
    ['invalid_input', /required confirmations/i],
    ['empty_response', /could not confirm/i],
    ['weird_unmapped_code_xyz', /could not be submitted/i],
  ];
  for (const [code, re] of cases) {
    it(`renders public-safe copy for ${code}`, async () => {
      mutateAsync.mockRejectedValue(new Error(`submission_failed:${code}`));
      renderDialog();
      await fillAttest();
      await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(re),
      );
      // Never leak raw code / SQL / stack.
      expect(screen.getByRole('status').textContent ?? '').not.toContain('submission_failed:');
      // Dialog remains open on failure.
      expect(screen.getByRole('button', { name: /Submit Application/i })).toBeInTheDocument();
    });
  }
});

describe('ApplyNowDialog — success reset', () => {
  it('closes and clears form after success; reopen shows a fresh state and new key', async () => {
    mutateAsync.mockResolvedValue({ result_code: 'created' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onOpenChange = vi.fn();
    const Render = (open: boolean) => (
      <QueryClientProvider client={qc}>
        <ApplyNowDialog
          open={open}
          onOpenChange={onOpenChange}
          opportunityId="opp-1"
          opportunityTitle="OTR Reefer"
          companyName="Acme"
          driverProfile={baseProfile}
          onEditProfile={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(Render(true));
    await fillAttest();
    await userEvent.type(screen.getByLabelText(/Message to recruiter/i), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const firstKey = mutateAsync.mock.calls[0][0].idempotency_key;
    rerender(Render(false));
    rerender(Render(true));
    // Fresh state
    const textarea = screen.getByLabelText(/Message to recruiter/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
    expect(screen.getByLabelText(/availability and Opportunity Profile/i)).not.toBeChecked();
    expect(screen.getByLabelText(/meet its stated requirements/i)).not.toBeChecked();
    expect(screen.getByLabelText(/accurate to the best of my knowledge/i)).not.toBeChecked();
    expect(screen.getByLabelText(/authorize HaulTracker Pro/i)).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: /Preferred contact method/i }))
      .toHaveTextContent(/In-app messaging/i);
    // New key on reopen after submitting
    await fillAttest();
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync.mock.calls[1][0].idempotency_key).not.toBe(firstKey);
  });
});
