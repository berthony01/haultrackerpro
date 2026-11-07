import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecruiterOpportunityManager, RecruiterStaffOpportunityManager } from '@/components/opportunities/RecruiterOpportunityManager';

const h = vi.hoisted(() => ({ profile: {} as any, fresh: vi.fn(), form: vi.fn(), create: vi.fn(), saveChatDraft: vi.fn(), completed: vi.fn(), back: vi.fn() }));
vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({ useRecruiterProfile: () => ({ profile: h.profile, isLoading: false, refetchProfile: h.fresh }) }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ intentRecruiter: true }) }));
vi.mock('@/hooks/opportunities/useRecruiterBilling', () => ({ useRecruiterBilling: () => ({ activeCount: 0, effectiveActiveOpportunityLimit: 15, isAtActiveOpportunityLimit: false, refresh: vi.fn() }) }));
vi.mock('@/hooks/opportunities/useRecruiterQaPublicationContext', () => ({ useRecruiterQaPublicationContext: () => ({}) }));
vi.mock('@/hooks/opportunities/useRecruiterOpportunities', () => {
  const store = () => ({ opportunities: [], isLoading: false, setStatus: { isPending: false, mutate: vi.fn() }, deleteOpportunity: { isPending: false, mutate: vi.fn() }, createOpportunity: { isPending: false, mutate: h.create }, updateOpportunity: { isPending: false, mutate: vi.fn() }, refetch: vi.fn() });
  return { useRecruiterOpportunities: store, useRecruiterStaffOpportunities: store };
});
vi.mock('@/hooks/opportunities/useTelegramOpportunityDraft', () => ({ readTelegramDraftLocator: () => null, useTelegramOpportunityDraft: () => ({ savePayload: h.saveChatDraft }) }));
vi.mock('@/components/opportunities/RecruiterOpportunityForm', () => ({ RecruiterOpportunityForm: (props: any) => { h.form(props); return <div><p>Canonical opportunity form</p><button onClick={props.onSaved}>Finish QA save</button></div>; } }));
vi.mock('@/components/opportunities/RecruiterReadinessDialog', () => ({ RecruiterReadinessDialog: ({ open }: any) => open ? <div role="dialog">Complete required recruiter information</div> : null }));
vi.mock('@/components/opportunities/RecruiterReferralsPanel', () => ({ RecruiterReferralsPanel: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  h.profile = { id: 'qa-recruiter', user_id: 'qa-user', recruiter_name: 'QA Recruiter', recruiter_email: 'qa@example.invalid', company_name: 'QA Carrier', company_type: 'carrier', dot_number: '123456', mc_number: null,
    status: 'active', verification_status: 'approved', posting_terms_accepted_at: '2026-07-17T00:00:00Z', posting_terms_version: '2026-07-17.v1', legacy_terms_grandfathered_at: null };
  h.fresh.mockImplementation(async () => h.profile);
});

describe('Mini App direct opportunity entry', () => {
  it('opens the canonical form through the existing live readiness check', async () => {
    render(<RecruiterOpportunityManager onBack={h.back} initialAction="create" onCreationFinished={h.completed} />);
    await screen.findByText('Canonical opportunity form'); expect(h.fresh).toHaveBeenCalledOnce();
    expect(h.create).not.toHaveBeenCalled(); expect(h.saveChatDraft).not.toHaveBeenCalled();
  });
  it('runs the entry once under StrictMode and returns to the list after save', async () => {
    render(<StrictMode><RecruiterOpportunityManager onBack={h.back} initialAction="create" onCreationFinished={h.completed} /></StrictMode>);
    await screen.findByText('Canonical opportunity form'); expect(h.fresh).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Finish QA save' })); await waitFor(() => expect(h.completed).toHaveBeenCalledOnce());
  });
  it('asks for the existing readiness requirements instead of bypassing them', async () => {
    h.profile.company_type = null;
    render(<RecruiterOpportunityManager onBack={h.back} initialAction="create" />);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Complete required recruiter information'); expect(h.form).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  });
  it('does not open a suspended recruiter form', () => {
    h.profile.status = 'suspended'; render(<RecruiterOpportunityManager onBack={h.back} initialAction="create" />);
    expect(h.form).not.toHaveBeenCalled(); expect(h.fresh).not.toHaveBeenCalled();
  });
  it('preserves normal website list entry when no create intent is supplied', () => {
    render(<RecruiterOpportunityManager onBack={h.back} />);
    expect(screen.getByTestId('post-opportunity-cta')).toBeInTheDocument(); expect(h.form).not.toHaveBeenCalled(); expect(h.fresh).not.toHaveBeenCalled();
  });
  it('opens staff authoring only with both view and create permissions', async () => {
    render(<RecruiterStaffOpportunityManager recruiterId="qa-recruiter" companyName="QA Carrier" permissions={{ canViewOpportunities: true, canCreateOpportunities: true, canEditOpportunities: false, canChangeOpportunityStatus: false, canDeleteOpportunities: false }} initialAction="create" onBack={h.back} />);
    await screen.findByText('Canonical opportunity form');
    expect(h.form).toHaveBeenCalledWith(expect.objectContaining({ staffController: expect.objectContaining({ permissions: { canCreate: true, canEdit: false, canChangeStatus: false } }) }));
    expect(h.create).not.toHaveBeenCalled();
  });
  it.each([[false, false], [true, false]])('does not infer staff create access from entry intent (%s, %s)', (canViewOpportunities, canCreateOpportunities) => {
    render(<RecruiterStaffOpportunityManager recruiterId="qa-recruiter" companyName="QA Carrier" permissions={{ canViewOpportunities, canCreateOpportunities, canEditOpportunities: false, canChangeOpportunityStatus: false, canDeleteOpportunities: false }} initialAction="create" onBack={h.back} />);
    expect(h.form).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  });
});
