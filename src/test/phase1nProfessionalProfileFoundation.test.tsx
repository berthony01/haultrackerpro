import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

beforeAll(() => {
  const proto = window.HTMLElement.prototype as any;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

declare global {
  // eslint-disable-next-line no-var
  var __phase1nProfessionalUser: any;
  // eslint-disable-next-line no-var
  var __phase1nProfessionalProfile: any;
  // eslint-disable-next-line no-var
  var __phase1nProfessionalUpsert: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line no-var
  var __phase1nProfessionalRemove: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line no-var
  var __phase1nProfessionalToast: ReturnType<typeof vi.fn>;
}

const DEFAULT_USER = {
  id: 'user-professional-1',
  email: 'account@example.com',
  user_metadata: {
    display_name: 'Account Person',
    phone: '+15551234567',
  },
};

globalThis.__phase1nProfessionalUser = DEFAULT_USER;
globalThis.__phase1nProfessionalProfile = null;
globalThis.__phase1nProfessionalUpsert = vi.fn();
globalThis.__phase1nProfessionalRemove = vi.fn();
globalThis.__phase1nProfessionalToast = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: globalThis.__phase1nProfessionalUser,
    loading: false,
  }),
}));

vi.mock('@/hooks/useProfessionalProfile', () => ({
  useMyProfessionalProfile: () => ({
    data: globalThis.__phase1nProfessionalProfile,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useProfessionalProfileMutations: () => ({
    upsert: {
      mutateAsync: globalThis.__phase1nProfessionalUpsert,
      isPending: false,
    },
    remove: {
      mutateAsync: globalThis.__phase1nProfessionalRemove,
      isPending: false,
    },
  }),
  useAuthorizedProfessionalProfiles: () => ({ data: {}, isLoading: false }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: globalThis.__phase1nProfessionalToast }),
}));

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock('@/components/layout/PageNav', () => ({
  PageNav: () => <nav data-testid="page-nav" />,
}));

import ProfessionalProfilePage, {
  parseProfessionalProfileList,
} from '@/pages/ProfessionalProfile';
import {
  PROFESSIONAL_PROFILE_UNAVAILABLE_COPY,
  ProfessionalProfileSummaryCard,
} from '@/components/profiles/ProfessionalProfileCard';

function completeProfile(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-professional-1',
    display_name: 'Jane Professional',
    professional_title: 'Dispatch Specialist',
    bio: 'Experienced trucking back-office professional.',
    years_experience: 8,
    services: ['Dispatch', 'Bookkeeping'],
    service_areas: ['Texas', 'Nationwide'],
    availability: 'available',
    contact_email: 'jane@example.com',
    contact_phone: '555-1234',
    visibility: 'authorized_connections',
    share_contact_details: true,
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.__phase1nProfessionalUser = DEFAULT_USER;
  globalThis.__phase1nProfessionalProfile = null;
  globalThis.__phase1nProfessionalUpsert.mockReset();
  globalThis.__phase1nProfessionalUpsert.mockResolvedValue(completeProfile());
  globalThis.__phase1nProfessionalRemove.mockReset();
  globalThis.__phase1nProfessionalRemove.mockResolvedValue(true);
  globalThis.__phase1nProfessionalToast.mockReset();
});

describe('Phase 1N-D · shared Professional Profile page', () => {
  it('explains the one-profile model and every required separation boundary', () => {
    render(<ProfessionalProfilePage />);

    expect(
      screen.getByRole('heading', { name: 'Professional Profile' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/one reusable professional identity/i)).toBeInTheDocument();
    expect(screen.getByText(/agency's business profile/i)).toBeInTheDocument();
    expect(screen.getByText(/sign-in or account information/i)).toBeInTheDocument();
    expect(screen.getByText(/Leaderboard Identity/i)).toBeInTheDocument();
    expect(screen.getByText(/Opportunity Preferences/i)).toBeInTheDocument();
    expect(screen.getByText(/never grants access to a driver or agency/i)).toBeInTheDocument();
  });

  it('renders the required fields and exact availability/visibility vocabulary', () => {
    render(<ProfessionalProfilePage />);

    for (const label of [
      'Display name',
      'Professional title',
      'Bio',
      'Years of experience',
      'Services offered',
      'Service areas',
      'Availability',
      'Professional contact email',
      'Professional contact phone',
      'Profile visibility',
      'Share contact details',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }

    const availability = screen.getByLabelText('Availability') as HTMLSelectElement;
    expect(Array.from(availability.options).map((option) => option.value)).toEqual([
      'available',
      'limited',
      'unavailable',
    ]);

    const visibility = screen.getByLabelText('Profile visibility') as HTMLSelectElement;
    expect(Array.from(visibility.options).map((option) => option.value)).toEqual([
      'private',
      'authorized_connections',
    ]);
  });

  it('prefills from account data without saving automatically', () => {
    render(<ProfessionalProfilePage />);

    expect(screen.getByLabelText('Display name')).toHaveValue('Account Person');
    expect(screen.getByLabelText('Professional contact email')).toHaveValue(
      'account@example.com',
    );
    expect(screen.getByLabelText('Professional contact phone')).toHaveValue(
      '+15551234567',
    );
    expect(globalThis.__phase1nProfessionalUpsert).not.toHaveBeenCalled();
  });

  it('copies account email into only the professional email field', () => {
    render(<ProfessionalProfilePage />);

    const email = screen.getByLabelText('Professional contact email');
    const phone = screen.getByLabelText('Professional contact phone');
    fireEvent.change(email, { target: { value: 'typed@example.com' } });
    fireEvent.change(phone, { target: { value: '555-9999' } });

    fireEvent.click(screen.getByRole('button', { name: 'Use account email' }));

    expect(email).toHaveValue('account@example.com');
    expect(phone).toHaveValue('555-9999');
  });

  it('shows and applies account phone only when usable metadata exists', () => {
    const first = render(<ProfessionalProfilePage />);
    const email = screen.getByLabelText('Professional contact email');
    fireEvent.change(email, { target: { value: 'keep@example.com' } });
    fireEvent.change(screen.getByLabelText('Professional contact phone'), {
      target: { value: '555-9999' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Use account phone' }));
    expect(screen.getByLabelText('Professional contact phone')).toHaveValue(
      '+15551234567',
    );
    expect(email).toHaveValue('keep@example.com');

    first.unmount();
    globalThis.__phase1nProfessionalUser = {
      id: 'user-no-phone',
      email: 'account@example.com',
      user_metadata: { display_name: 'No Phone' },
    };
    render(<ProfessionalProfilePage />);
    expect(
      screen.queryByRole('button', { name: 'Use account phone' }),
    ).not.toBeInTheDocument();
  });

  it('loads an existing professional profile into the form', async () => {
    globalThis.__phase1nProfessionalProfile = completeProfile();
    render(<ProfessionalProfilePage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Display name')).toHaveValue('Jane Professional');
    });
    expect(screen.getByLabelText('Professional title')).toHaveValue(
      'Dispatch Specialist',
    );
    expect(screen.getByLabelText('Services offered')).toHaveValue(
      'Dispatch, Bookkeeping',
    );
    expect(screen.getByLabelText('Profile visibility')).toHaveValue(
      'authorized_connections',
    );
    expect(screen.getByRole('switch', { name: 'Share contact details' })).toBeChecked();
  });

  it('loads contradictory private sharing fail-closed', async () => {
    globalThis.__phase1nProfessionalProfile = completeProfile({
      visibility: 'private',
      share_contact_details: true,
    });
    render(<ProfessionalProfilePage />);

    const sharing = screen.getByRole('switch', { name: 'Share contact details' });
    await waitFor(() => {
      expect(screen.getByLabelText('Profile visibility')).toHaveValue('private');
    });
    expect(sharing).not.toBeChecked();
    expect(sharing).toBeDisabled();
  });

  it('clears and disables sharing immediately when visibility becomes private', async () => {
    globalThis.__phase1nProfessionalProfile = completeProfile();
    render(<ProfessionalProfilePage />);

    const sharing = screen.getByRole('switch', { name: 'Share contact details' });
    await waitFor(() => expect(sharing).toBeChecked());

    fireEvent.change(screen.getByLabelText('Profile visibility'), {
      target: { value: 'private' },
    });

    expect(sharing).not.toBeChecked();
    expect(sharing).toBeDisabled();
  });

  it('does not automatically enable sharing when authorized connections is selected', () => {
    render(<ProfessionalProfilePage />);

    const sharing = screen.getByRole('switch', { name: 'Share contact details' });
    fireEvent.change(screen.getByLabelText('Profile visibility'), {
      target: { value: 'authorized_connections' },
    });

    expect(sharing).not.toBeDisabled();
    expect(sharing).not.toBeChecked();
  });

  it('normalizes private sharing false in the save payload', async () => {
    render(<ProfessionalProfilePage />);
    fireEvent.change(screen.getByLabelText('Services offered'), {
      target: { value: ' Dispatch, dispatch, Bookkeeping ' },
    });
    fireEvent.change(screen.getByLabelText('Service areas'), {
      target: { value: ' Texas, texas, Nationwide ' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Save professional profile' }),
    );

    await waitFor(() => {
      expect(globalThis.__phase1nProfessionalUpsert).toHaveBeenCalledTimes(1);
    });
    expect(globalThis.__phase1nProfessionalUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: 'Account Person',
        services: ['Dispatch', 'Bookkeeping'],
        service_areas: ['Texas', 'Nationwide'],
        visibility: 'private',
        share_contact_details: false,
      }),
    );
  });

  it('shows a clear error instead of silently dropping more than 12 entries', async () => {
    render(<ProfessionalProfilePage />);
    fireEvent.change(screen.getByLabelText('Services offered'), {
      target: {
        value: Array.from({ length: 13 }, (_, index) => `Service ${index + 1}`).join(', '),
      },
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Save professional profile' }),
    );

    expect(
      await screen.findByText('Services offered may contain at most 12 entries.'),
    ).toBeInTheDocument();
    expect(globalThis.__phase1nProfessionalUpsert).not.toHaveBeenCalled();
  });

  it('requires confirmation and deletes only through the delete mutation', async () => {
    globalThis.__phase1nProfessionalProfile = completeProfile();
    render(<ProfessionalProfilePage />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete professional profile' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Delete your professional profile?' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }));
    await waitFor(() => {
      expect(globalThis.__phase1nProfessionalRemove).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Phase 1N-D · list parsing and neutral summaries', () => {
  it('trims, drops blanks, and deduplicates case-insensitively in first-value order', () => {
    expect(
      parseProfessionalProfileList(
        ' Dispatch, dispatch, , Bookkeeping, DISPATCH, Compliance ',
        'Services offered',
        60,
      ),
    ).toEqual(['Dispatch', 'Bookkeeping', 'Compliance']);
  });

  it('rejects raw nonblank input over 12 before deduplication', () => {
    expect(() =>
      parseProfessionalProfileList(
        Array.from({ length: 13 }, () => 'Dispatch').join(','),
        'Services offered',
        60,
      ),
    ).toThrow('Services offered may contain at most 12 entries.');
  });

  it('uses neutral unavailable copy without disclosing the reason', () => {
    render(<ProfessionalProfileSummaryCard summary={null} />);
    expect(screen.getByText(PROFESSIONAL_PROFILE_UNAVAILABLE_COPY)).toBeInTheDocument();
    expect(PROFESSIONAL_PROFILE_UNAVAILABLE_COPY).not.toMatch(
      /private|unauthorized|missing/i,
    );
  });

  it('shows contact only when contact was returned by the authorized RPC', () => {
    const summary = completeProfile();
    const first = render(
      <ProfessionalProfileSummaryCard
        summary={{
          ...summary,
          created_at: undefined,
        } as any}
      />,
    );
    expect(screen.getByText(/Contact email: jane@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/Contact phone: 555-1234/)).toBeInTheDocument();

    first.unmount();
    render(
      <ProfessionalProfileSummaryCard
        summary={{
          ...summary,
          created_at: undefined,
          contact_email: null,
          contact_phone: null,
        } as any}
      />,
    );
    expect(screen.queryByText(/Contact email:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Contact phone:/)).not.toBeInTheDocument();
  });
});

describe('Phase 1N-D · source-level integration and security contracts', () => {
  const read = (relativePath: string) =>
    fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

  it('registers the protected professional-profile route', () => {
    const app = read('App.tsx');
    expect(app).toContain('const ProfessionalProfile = lazy(');
    expect(app).toContain(
      '<Route path="/professional-profile" element={<ProtectedRoute><ProfessionalProfile /></ProtectedRoute>} />',
    );
  });

  it('uses the exact production RPC argument names and stable batch contract', () => {
    const hook = read('hooks/useProfessionalProfile.ts');
    for (const parameter of [
      'p_display_name',
      'p_professional_title',
      'p_bio',
      'p_years_experience',
      'p_services',
      'p_service_areas',
      'p_availability',
      'p_contact_email',
      'p_contact_phone',
      'p_visibility',
      'p_share_contact_details',
    ]) {
      expect(hook).toContain(parameter);
    }
    expect(hook).not.toContain('_display_name: input.display_name');
    expect(hook).toContain("'list_authorized_professional_profiles'");
    expect(hook).toContain('{ _user_ids: normalized }');
    expect(hook).toContain('normalizeProfessionalProfileUserIds');
  });

  it('adds exactly one personal profile entry to assistant and agency overview', () => {
    const assistant = read('pages/AssistantDashboard.tsx');
    const agency = read('pages/AgencyDashboard.tsx');

    expect((assistant.match(/<MyProfessionalProfileCard context="assistant" \/>/g) ?? [])).toHaveLength(1);
    expect((agency.match(/<MyProfessionalProfileCard context="agency" \/>/g) ?? [])).toHaveLength(1);
    expect(agency).toContain('separate');
    expect(agency).toContain('AgencyDetailCard');
  });

  it('batch-loads and renders agency-member, assistant, and pending-delegation summaries', () => {
    const agency = read('pages/AgencyDashboard.tsx');
    const assistants = read('components/assistants/AssistantsPanel.tsx');
    const approvals = read('pages/DriverDelegationApprovals.tsx');

    expect(agency).toContain('useAuthorizedProfessionalProfiles(memberUserIds)');
    expect(agency).toContain('<ProfessionalProfileSummaryCard');
    expect(agency).toContain('m.member_user_id');

    expect(assistants).toContain(
      'useAuthorizedProfessionalProfiles(assistantProfileIds)',
    );
    expect(assistants).toContain('row.assistant_user_id');
    expect(assistants).toContain("row.source === 'agency'");
    expect(assistants).toContain('<PermissionEditor row={row} />');
    expect(assistants).toContain('<RevokeButton row={row} />');

    expect(approvals).toContain(
      'useAuthorizedProfessionalProfiles(memberUserIds)',
    );
    expect(approvals.indexOf('<ProfessionalProfileSummaryCard')).toBeLessThan(
      approvals.indexOf("What they're asking to do:"),
    );
    expect(approvals).toContain(
      'await decide.mutateAsync({ id: r.id, approve: true })',
    );
    expect(approvals).toContain(
      'await decide.mutateAsync({ id: r.id, approve: false })',
    );
  });

  it('keeps the migration self-only, fail-closed, relationship-scoped, and non-operational', () => {
    const migration = read(
      '../supabase/migrations/20260723020000_phase1n_d_professional_profile_foundation.sql',
    );

    for (const required of [
      'CREATE TABLE public.professional_profiles',
      'ALTER TABLE public.professional_profiles ENABLE ROW LEVEL SECURITY',
      'CREATE POLICY professional_profiles_owner_select',
      'USING (user_id = auth.uid())',
      'REVOKE ALL ON TABLE public.professional_profiles FROM authenticated',
      'GRANT SELECT ON TABLE public.professional_profiles TO authenticated',
      'get_my_professional_profile',
      'upsert_my_professional_profile',
      'delete_my_professional_profile',
      'list_authorized_professional_profiles',
      "da.status = 'active'",
      "adr.status IN ('pending_driver_approval', 'approved')",
      "ap.status = 'active'",
      "target_member.status = 'active'",
      "viewer_member.status = 'active'",
      "visibility = 'authorized_connections'",
      'share_contact_details = false',
    ]) {
      expect(migration).toContain(required);
    }

    expect(migration).not.toMatch(/CREATE POLICY[\s\S]*ON public\.(loads|expenses|fuel_logs|subscriptions)/i);
    expect(migration).not.toMatch(/ALTER TABLE public\.(loads|expenses|fuel_logs|subscriptions)/i);
  });

  it('preserves existing agency and assistant access warnings and permission controls', () => {
    const agency = read('pages/AgencyDashboard.tsx');
    const assistants = read('components/assistants/AssistantsPanel.tsx');
    const approvals = read('pages/DriverDelegationApprovals.tsx');

    expect(agency).toContain(
      'Members do <strong>not</strong> automatically get access to any driver',
    );
    expect(assistants).toContain('What assistants can and cannot do');
    expect(assistants).toContain('ASSISTANT_PERMISSION_KEYS');
    expect(assistants).toContain('Their access ends the moment you click Revoke.');
    expect(approvals).toContain('ASSISTANT_FORBIDDEN_AREAS');
  });
});
