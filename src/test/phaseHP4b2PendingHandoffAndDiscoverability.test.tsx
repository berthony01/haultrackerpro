/**
 * HP-4B2 — pending profile review handoff + Find Work discoverability.
 *
 * Proves: the handoff is memory-only, one-shot and employment-only; the review
 * form shows pending values over a stored profile without any write; the
 * existing Save remains the only mutation boundary; Back and save-success clear
 * the pending state; and the single Find Work entry point renders only when the
 * dashboard supplies its callback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'fs';
import { join } from 'path';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const roleState = { isDriver: true, isLoading: false };
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => roleState }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'driver-1', email: 'driver@example.com', user_metadata: {} } }),
}));

const upsertMutate = vi.fn();
const profileState: { profile: unknown; isLoading: boolean; isError: boolean } = {
  profile: null,
  isLoading: false,
  isError: false,
};
vi.mock('@/hooks/opportunities/useDriverOpportunityProfile', () => ({
  useDriverOpportunityProfile: () => ({
    ...profileState,
    error: null,
    refetch: vi.fn(),
    upsertProfile: { mutate: upsertMutate, isPending: false },
    deleteProfile: { mutate: vi.fn() },
  }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import FindWork from '@/pages/FindWork';
import {
  DriverOpportunityProfile,
  PENDING_REVIEW_BANNER,
} from '@/components/opportunities/DriverOpportunityProfile';
import {
  setPendingProfileAnswers,
  consumePendingProfileAnswers,
  clearPendingProfileAnswers,
  hasPendingProfileAnswers,
  PENDING_HANDOFF_FIELDS,
} from '@/lib/home/pendingProfileHandoff';
import { HOME_INTAKE_NEXT_PATH } from '@/lib/home/conversationIntake';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const HANDOFF_SRC = read('src/lib/home/pendingProfileHandoff.ts');
const FIND_WORK_SRC = read('src/pages/FindWork.tsx');
const INDEX_SRC = read('src/pages/Index.tsx');
const APP_SRC = read('src/App.tsx');
const OPPS_SRC = read('src/components/opportunities/OpportunitiesPage.tsx');

const STORED_PROFILE = {
  full_name: 'Jane Driver',
  phone: '555-0100',
  email: 'jane@example.com',
  city: 'Houston',
  state: 'TX',
  cdl_class: 'A',
  years_experience: 5,
  endorsements: [],
  trailer_experience: ['Dry Van'],
  preferred_driver_type: 'Company Driver',
  preferred_route_type: 'OTR',
  preferred_home_time: '2-3 weeks out',
  preferred_states: ['TX'],
  min_weekly_gross: 1500,
  min_weekly_net: null,
  min_effective_rpm: null,
  visibility: 'private',
  allow_verified_recruiter_contact: false,
  contact_preference: 'in_app',
  profile_completed: true,
};

beforeEach(() => {
  clearPendingProfileAnswers();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [], error: null });
  navigateSpy.mockReset();
  upsertMutate.mockReset();
  roleState.isDriver = true;
  roleState.isLoading = false;
  profileState.profile = null;
  profileState.isLoading = false;
  profileState.isError = false;
  sessionStorage.clear();
  localStorage.clear();
});

const renderProfile = (onBack = vi.fn()) => {
  const r = render(<DriverOpportunityProfile onBack={onBack} />);
  return { ...r, onBack };
};

/* ------------------------------------------------------------------ */
/* Handoff module                                                      */
/* ------------------------------------------------------------------ */

describe('HP-4B2 pending handoff module', () => {
  it('accepts only the approved employment fields', () => {
    setPendingProfileAnswers({
      city: 'Dallas',
      state: 'TX',
      cdl_class: 'A',
      years_experience: 7,
      preferred_route_type: 'Regional',
      preferred_driver_type: 'Owner Operator',
      preferred_home_time: 'Weekly',
      trailer_experience: ['Flatbed'],
      min_weekly_gross: 2000,
      initialMessage: 'I run flatbed out of Dallas',
      // Forbidden data must be structurally incapable of entering the store.
      full_name: 'Jane Driver',
      phone: '555-0100',
      email: 'jane@example.com',
      endorsements: ['H (Hazmat)'],
      visibility: 'verified_recruiters',
      allow_verified_recruiter_contact: true,
      contact_preference: 'phone',
      min_weekly_net: 1200,
      min_effective_rpm: 2.1,
    } as never);

    const stored = consumePendingProfileAnswers()!;
    expect(Object.keys(stored).sort()).toEqual([...PENDING_HANDOFF_FIELDS].sort());
    expect(stored).not.toHaveProperty('initialMessage');
    expect(stored).not.toHaveProperty('full_name');
    expect(stored).not.toHaveProperty('endorsements');
    expect(stored).not.toHaveProperty('visibility');
  });

  it('drops out-of-vocabulary values instead of coercing them', () => {
    setPendingProfileAnswers({
      preferred_driver_type: 'Company Driver',
      preferred_route_type: 'Whatever',
      years_experience: 4.5,
      state: 'ZZ',
      min_weekly_gross: 0,
      cdl_class: 'A',
    } as never);
    expect(consumePendingProfileAnswers()).toEqual({ cdl_class: 'A' });
  });

  it('stores nothing when no approved field survives validation', () => {
    setPendingProfileAnswers({ initialMessage: 'hello', full_name: 'Jane' } as never);
    expect(hasPendingProfileAnswers()).toBe(false);
    expect(consumePendingProfileAnswers()).toBeNull();
  });

  it('is one-shot: consume clears the module store', () => {
    setPendingProfileAnswers({ city: 'Dallas' });
    expect(hasPendingProfileAnswers()).toBe(true);
    expect(consumePendingProfileAnswers()).toEqual({ city: 'Dallas' });
    expect(hasPendingProfileAnswers()).toBe(false);
    expect(consumePendingProfileAnswers()).toBeNull();
  });

  it('clear drops pending answers without consuming them', () => {
    setPendingProfileAnswers({ city: 'Dallas' });
    clearPendingProfileAnswers();
    expect(consumePendingProfileAnswers()).toBeNull();
  });

  it('uses no browser persistence of any kind', () => {
    expect(HANDOFF_SRC).not.toMatch(/sessionStorage|localStorage|document\.cookie|indexedDB/);
    expect(HANDOFF_SRC).not.toMatch(/supabase|fetch\(/i);
  });
});

/* ------------------------------------------------------------------ */
/* FindWork handoff                                                    */
/* ------------------------------------------------------------------ */

describe('HP-4B2 FindWork continuation', () => {
  it('stores the filtered final answers and then navigates, with no write', async () => {
    profileState.profile = STORED_PROFILE;
    render(
      <MemoryRouter>
        <FindWork />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('home-conversation-confirm-yes'));
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('home-conversation-continue'));
    expect(navigateSpy).toHaveBeenCalledWith(HOME_INTAKE_NEXT_PATH);

    const pending = consumePendingProfileAnswers()!;
    expect(pending.city).toBe('Houston');
    expect(pending.cdl_class).toBe('A');
    expect(pending).not.toHaveProperty('initialMessage');
    expect(pending).not.toHaveProperty('full_name');

    expect(upsertMutate).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('writes nothing to browser storage or the profile from FindWork', () => {
    expect(FIND_WORK_SRC).not.toMatch(/sessionStorage|localStorage|saveIntakeSnapshot/);
    expect(FIND_WORK_SRC).not.toMatch(/upsertProfile|\.insert\(|\.update\(|\.delete\(/);
  });
});

/* ------------------------------------------------------------------ */
/* Review form                                                         */
/* ------------------------------------------------------------------ */

describe('HP-4B2 pending review in the profile form', () => {
  it('shows pending answers over an existing stored profile, with banner and markers', () => {
    profileState.profile = STORED_PROFILE;
    setPendingProfileAnswers({
      preferred_route_type: 'Regional',
      city: 'Dallas',
      min_weekly_gross: 2200,
    });
    renderProfile();

    expect(screen.getByTestId('driver-profile-pending-review-note').textContent).toBe(
      PENDING_REVIEW_BANNER,
    );
    expect((screen.getByDisplayValue('Dallas') as HTMLInputElement).value).toBe('Dallas');
    expect(screen.getByDisplayValue('2200')).toBeTruthy();
    // Untouched stored values remain.
    expect(screen.getByDisplayValue('Jane Driver')).toBeTruthy();
    expect(screen.getByDisplayValue('5')).toBeTruthy();
    // Exactly the overridden fields are marked.
    expect(screen.getAllByTestId('driver-profile-pending-badge')).toHaveLength(3);
    // Nothing was written.
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it('shows the stored profile only when the module store is empty (hard refresh)', () => {
    profileState.profile = STORED_PROFILE;
    renderProfile();
    expect(screen.queryByTestId('driver-profile-pending-review-note')).toBeNull();
    expect(screen.queryByTestId('driver-profile-pending-badge')).toBeNull();
    expect(screen.getByDisplayValue('Houston')).toBeTruthy();
  });

  it('applies the overlay once and a later profile refetch does not erase it', () => {
    profileState.profile = STORED_PROFILE;
    setPendingProfileAnswers({ city: 'Dallas' });
    const { rerender } = renderProfile();
    expect(screen.getByDisplayValue('Dallas')).toBeTruthy();

    // A refetch returns a NEW object identity for the same row.
    profileState.profile = { ...STORED_PROFILE };
    rerender(<DriverOpportunityProfile onBack={vi.fn()} />);
    expect(screen.getByDisplayValue('Dallas')).toBeTruthy();
    expect(screen.getByTestId('driver-profile-pending-review-note')).toBeTruthy();
  });

  it('saves the reviewed values through the existing save path and clears pending on success', async () => {
    profileState.profile = STORED_PROFILE;
    setPendingProfileAnswers({ city: 'Dallas' });
    renderProfile();

    fireEvent.click(screen.getByText('Save Preferences'));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    const [payload, handlers] = upsertMutate.mock.calls[0];
    expect(payload.city).toBe('Dallas');
    expect(payload.full_name).toBe('Jane Driver');
    expect(payload.visibility).toBe('private');

    handlers.onSuccess();
    await waitFor(() =>
      expect(screen.queryByTestId('driver-profile-pending-review-note')).toBeNull(),
    );
    expect(hasPendingProfileAnswers()).toBe(false);
  });

  it('Back clears the pending state and the module store', () => {
    profileState.profile = STORED_PROFILE;
    setPendingProfileAnswers({ city: 'Dallas' });
    const onBack = vi.fn();
    renderProfile(onBack);
    fireEvent.click(screen.getByText('Back to Opportunities'));
    expect(onBack).toHaveBeenCalled();
    expect(hasPendingProfileAnswers()).toBe(false);
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it('a later manual visit shows no stale pending values', () => {
    profileState.profile = STORED_PROFILE;
    setPendingProfileAnswers({ city: 'Dallas' });
    const first = renderProfile();
    expect(screen.getByDisplayValue('Dallas')).toBeTruthy();
    first.unmount();

    renderProfile();
    expect(screen.queryByTestId('driver-profile-pending-review-note')).toBeNull();
    expect(screen.getByDisplayValue('Houston')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Discoverability                                                     */
/* ------------------------------------------------------------------ */

describe('HP-4B2 Find Work discoverability', () => {
  it('renders the card only when the dashboard supplies the callback', () => {
    expect(OPPS_SRC).toContain('onFindWork?: () => void;');
    expect(OPPS_SRC).toContain('{onFindWork && (');
    expect(OPPS_SRC).toContain("data-testid=\"opportunities-find-work\"");
    expect(OPPS_SRC).toContain('onClick={onFindWork}');
    // No Router dependency is introduced into this component.
    expect(OPPS_SRC).not.toMatch(/useNavigate/);
  });

  it('is wired exactly once from the dashboard to /find-work', () => {
    const matches = INDEX_SRC.match(/onFindWork=\{\(\) => navigate\('\/find-work'\)\}/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('leaves the public / route and PublicRoute implementation unchanged', () => {
    expect(APP_SRC).toContain('<Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />');
    expect(APP_SRC).toContain(
      'if (user) return <Navigate to={resolvePostAuthDestination(location.search)} replace />;',
    );
  });
});
