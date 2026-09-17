/**
 * HP-4B — profile-aware authenticated Driver conversation contract.
 *
 * Proves: employment-only mapping, out-of-vocabulary drops, precedence,
 * disclosure without identity/contact, Change / Start over without any write,
 * fail-open profile error, protected route, and zero persistence.
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
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => roleState,
}));

const upsertMock = vi.fn();
const deleteMock = vi.fn();
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
    upsertProfile: { mutate: upsertMock },
    deleteProfile: { mutate: deleteMock },
  }),
}));

import HomeConversationFlow, {
  PROFILE_REUSE_PREFIX,
  PROFILE_CONFIRM_PROMPT,
  PROFILE_CONFIRM_YES,
  PROFILE_CONFIRM_CHANGE,
} from '@/components/home/HomeConversationFlow';
import FindWork, {
  FIND_WORK_CONTINUE_LABEL,
  FIND_WORK_PROFILE_ERROR_LINE,
  FIND_WORK_NOT_AVAILABLE,
} from '@/pages/FindWork';
import {
  mapProfileToIntakeAnswers,
  describeProfileReuse,
  PROFILE_FORBIDDEN_FIELDS,
} from '@/lib/home/profileConversationMerge';
import {
  INTAKE_OPENING_PROMPT,
  HOME_INTAKE_NEXT_PATH,
  extractFirstMessagePreferences,
  type IntakeAnswers,
} from '@/lib/home/conversationIntake';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const MERGE_SRC = read('src/lib/home/profileConversationMerge.ts');
const FIND_WORK_SRC = read('src/pages/FindWork.tsx');
const APP_SRC = read('src/App.tsx');

const FULL_PROFILE = {
  full_name: 'Jane Driver',
  phone: '555-0100',
  email: 'jane@example.com',
  city: 'Houston',
  state: 'tx',
  cdl_class: 'A',
  years_experience: 5,
  preferred_route_type: 'Regional',
  preferred_driver_type: 'Owner Operator',
  preferred_home_time: 'Weekly',
  trailer_experience: ['Flatbed', 'Flatbed', 'Unicycle'],
  min_weekly_gross: 1800,
  min_weekly_net: 1200,
  min_effective_rpm: 2.1,
  endorsements: ['H (Hazmat)'],
  visibility: 'verified_recruiters',
  allow_verified_recruiter_contact: true,
  contact_preference: 'phone',
  preferred_states: ['TX'],
  willing_to_relocate: true,
  available_start_date: '2026-10-01',
  profile_completed: true,
};

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [], error: null });
  navigateSpy.mockReset();
  upsertMock.mockReset();
  deleteMock.mockReset();
  roleState.isDriver = true;
  roleState.isLoading = false;
  profileState.profile = null;
  profileState.isLoading = false;
  profileState.isError = false;
  sessionStorage.clear();
});

const PALETTE = {
  amber: 'hsl(25, 95%, 53%)',
  surface: 'hsl(220, 20%, 11%)',
  border: 'hsl(220, 16%, 18%)',
  textMuted: 'hsl(220, 10%, 65%)',
  textDim: 'hsl(220, 10%, 50%)',
};

function renderFlow(props: Partial<React.ComponentProps<typeof HomeConversationFlow>> = {}) {
  return render(
    <MemoryRouter>
      <HomeConversationFlow onContinue={vi.fn()} {...PALETTE} {...props} />
    </MemoryRouter>,
  );
}

function renderFindWork() {
  return render(
    <MemoryRouter initialEntries={['/find-work']}>
      <FindWork />
    </MemoryRouter>,
  );
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

describe('HP-4B profile → intake mapping', () => {
  it('maps every valid employment field exactly', () => {
    const seed = mapProfileToIntakeAnswers(FULL_PROFILE);
    expect(seed.city).toBe('Houston');
    expect(seed.state).toBe('TX');
    expect(seed.cdl_class).toBe('A');
    expect(seed.years_experience).toBe(5);
    expect(seed.preferred_route_type).toBe('Regional');
    expect(seed.preferred_driver_type).toBe('Owner Operator');
    expect(seed.preferred_home_time).toBe('Weekly');
    expect(seed.trailer_experience).toEqual(['Flatbed']); // deduped, unknown dropped
    expect(seed.min_weekly_gross).toBe(1800);
  });

  it('never carries identity, contact, consent or My Trucking fields into the seed', () => {
    const seed = mapProfileToIntakeAnswers(FULL_PROFILE) as Record<string, unknown>;
    for (const forbidden of PROFILE_FORBIDDEN_FIELDS) {
      expect(seed[forbidden]).toBeUndefined();
    }
    const disclosure = describeProfileReuse(mapProfileToIntakeAnswers(FULL_PROFILE)).join(' • ');
    expect(disclosure).not.toMatch(/Jane|555-0100|jane@example\.com|Hazmat|recruiter/i);
  });

  it('never coerces Company Driver or Lease Purchase', () => {
    for (const value of ['Company Driver', 'Lease Purchase', 'anything else']) {
      const seed = mapProfileToIntakeAnswers({ preferred_driver_type: value });
      expect(seed.preferred_driver_type).toBeUndefined();
      expect(seed.preferred_route_type).toBeUndefined();
    }
  });

  it('drops fractional, negative, out-of-range and non-numeric years', () => {
    for (const value of [2.5, -1, 61, '5', null, NaN, Infinity]) {
      expect(mapProfileToIntakeAnswers({ years_experience: value }).years_experience).toBeUndefined();
    }
    expect(mapProfileToIntakeAnswers({ years_experience: 0 }).years_experience).toBe(0);
  });

  it('drops out-of-vocabulary route, home time, CDL, state, city and pay values', () => {
    const seed = mapProfileToIntakeAnswers({
      preferred_route_type: 'Long Haul',
      preferred_home_time: 'Sometimes',
      cdl_class: 'D',
      state: 'ZZ',
      city: '   ',
      min_weekly_gross: 0,
    });
    expect(seed).toEqual({});
    expect(mapProfileToIntakeAnswers({ min_weekly_gross: 100001 }).min_weekly_gross).toBeUndefined();
    expect(mapProfileToIntakeAnswers({ city: 'x'.repeat(61) }).city).toBeUndefined();
  });

  it('handles a missing profile without throwing', () => {
    expect(mapProfileToIntakeAnswers(null)).toEqual({});
    expect(mapProfileToIntakeAnswers(undefined)).toEqual({});
    expect(describeProfileReuse({})).toEqual([]);
  });

  it('reads no forbidden column name anywhere in the merge module', () => {
    for (const forbidden of PROFILE_FORBIDDEN_FIELDS) {
      expect(MERGE_SRC.includes(`profile.${forbidden}`)).toBe(false);
    }
    expect(MERGE_SRC).not.toMatch(/supabase|fetch\(|sessionStorage|localStorage/);
  });
});

/* ------------------------------------------------------------------ */
/* Conversation behavior                                               */
/* ------------------------------------------------------------------ */

describe('HP-4B profile-aware conversation', () => {
  it('with no seed the script is unchanged', () => {
    renderFlow();
    expect(screen.getByText(INTAKE_OPENING_PROMPT)).toBeTruthy();
    expect(screen.queryByText(new RegExp(PROFILE_REUSE_PREFIX))).toBeNull();
    expect(screen.queryByTestId('home-conversation-change-saved')).toBeNull();
  });

  it('a complete profile discloses reuse, skips known questions and confirms', () => {
    const seed = mapProfileToIntakeAnswers(FULL_PROFILE);
    renderFlow({ initialAnswers: seed, profileReuseLabels: describeProfileReuse(seed) });

    const disclosure = screen.getByText(new RegExp(PROFILE_REUSE_PREFIX));
    expect(disclosure.textContent).toContain('Regional');
    expect(disclosure.textContent).toContain('Houston, TX');
    expect(disclosure.textContent).toContain('CDL-A');
    expect(screen.getByText(PROFILE_CONFIRM_PROMPT)).toBeTruthy();
    // No known question is re-asked and no summary is shown before confirmation.
    expect(screen.queryByText(INTAKE_OPENING_PROMPT)).toBeNull();
    expect(screen.queryByTestId('home-conversation-summary')).toBeNull();

    fireEvent.click(screen.getByTestId('home-conversation-confirm-yes'));
    expect(screen.getByTestId('home-conversation-summary')).toBeTruthy();
    expect(screen.getByTestId('home-conversation-summary-line').textContent).toContain('Regional');
  });

  it('a partial profile asks only the missing questions', () => {
    const seed = mapProfileToIntakeAnswers({
      preferred_route_type: 'Regional',
      city: 'Dallas',
      state: 'TX',
    });
    renderFlow({ initialAnswers: seed, profileReuseLabels: describeProfileReuse(seed) });
    // Work type and location known → the CDL question is first.
    expect(screen.getByText('What CDL class do you hold?')).toBeTruthy();
    expect(screen.queryByText(INTAKE_OPENING_PROMPT)).toBeNull();
    expect(screen.queryByText('Where are you based? City and state, or just the state.')).toBeNull();
  });

  it('Change lets the driver correct a seeded answer, and the new answer wins', () => {
    const seed = mapProfileToIntakeAnswers(FULL_PROFILE);
    renderFlow({ initialAnswers: seed, profileReuseLabels: describeProfileReuse(seed) });

    fireEvent.click(screen.getByTestId('home-conversation-confirm-change'));
    expect(screen.getByText(new RegExp(INTAKE_OPENING_PROMPT))).toBeTruthy();
    fireEvent.click(screen.getByTestId('home-conversation-chip-local'));

    // Walking the rest of the review, the corrected value survives.
    expect(screen.getByTestId('home-conversation-transcript').textContent).toContain('Local');
    expect(upsertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('Start over drops the seed for this session only and restarts the normal script', () => {
    const seed = mapProfileToIntakeAnswers(FULL_PROFILE);
    renderFlow({ initialAnswers: seed, profileReuseLabels: describeProfileReuse(seed) });

    fireEvent.click(screen.getByTestId('home-conversation-restart'));
    expect(screen.getByText(INTAKE_OPENING_PROMPT)).toBeTruthy();
    expect(screen.queryByText(new RegExp(PROFILE_REUSE_PREFIX))).toBeNull();
    expect(screen.queryByTestId('home-conversation-change-saved')).toBeNull();
    expect(upsertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps facts out of first-message inference even though they may come from a profile', () => {
    const captured = extractFirstMessagePreferences(
      'class a driver with 5 years running regional flatbed',
    ) as IntakeAnswers & Record<string, unknown>;
    expect(captured.cdl_class).toBeUndefined();
    expect(captured.years_experience).toBeUndefined();
    expect(captured.endorsements).toBeUndefined();
    expect(captured.preferred_route_type).toBe('Regional');
    // …while the profile may legitimately supply the same facts.
    expect(mapProfileToIntakeAnswers({ cdl_class: 'A', years_experience: 5 })).toEqual({
      cdl_class: 'A',
      years_experience: 5,
    });
  });

  it('precedence: explicit current-session answer beats the profile seed', () => {
    const seed = mapProfileToIntakeAnswers({ preferred_route_type: 'Regional' });
    renderFlow({ initialAnswers: seed, profileReuseLabels: describeProfileReuse(seed) });
    fireEvent.click(screen.getByTestId('home-conversation-change-saved'));
    fireEvent.click(screen.getByTestId('home-conversation-chip-dedicated'));
    expect(screen.getByTestId('home-conversation-transcript').textContent).toContain('Dedicated');
  });
});

/* ------------------------------------------------------------------ */
/* FindWork page                                                       */
/* ------------------------------------------------------------------ */

describe('HP-4B FindWork page', () => {
  it('shows a concise loading state and no profile data while loading', () => {
    profileState.isLoading = true;
    profileState.profile = FULL_PROFILE;
    renderFindWork();
    expect(screen.getByTestId('find-work-loading')).toBeTruthy();
    expect(screen.queryByText(new RegExp(PROFILE_REUSE_PREFIX))).toBeNull();
    expect(screen.queryByText(/Houston/)).toBeNull();
  });

  it('shows a neutral not-available state for non-drivers and no profile data', () => {
    roleState.isDriver = false;
    profileState.profile = FULL_PROFILE;
    renderFindWork();
    expect(screen.getByTestId('find-work-unavailable').textContent).toContain(
      FIND_WORK_NOT_AVAILABLE,
    );
    expect(screen.queryByTestId('home-conversation-surface')).toBeNull();
    expect(screen.queryByText(/Houston|Jane Driver/)).toBeNull();
  });

  it('renders the profile-aware conversation for a driver with a saved profile', () => {
    profileState.profile = FULL_PROFILE;
    renderFindWork();
    expect(screen.getByText(new RegExp(PROFILE_REUSE_PREFIX)).textContent).toContain('Houston, TX');
    expect(screen.queryByText(/Jane Driver|555-0100|jane@example\.com/)).toBeNull();
  });

  it('runs the normal script when the driver has no profile', () => {
    renderFindWork();
    expect(screen.getByText(INTAKE_OPENING_PROMPT)).toBeTruthy();
    expect(screen.queryByText(new RegExp(PROFILE_REUSE_PREFIX))).toBeNull();
  });

  it('fails open with one neutral line when the profile query errors', () => {
    profileState.isError = true;
    profileState.profile = null;
    renderFindWork();
    expect(screen.getByTestId('find-work-profile-error').textContent).toBe(
      FIND_WORK_PROFILE_ERROR_LINE,
    );
    expect(screen.getByText(INTAKE_OPENING_PROMPT)).toBeTruthy();
    expect(screen.queryByText(new RegExp(PROFILE_REUSE_PREFIX))).toBeNull();
  });

  it('previews real teasers from the merged answers and continues without any write', async () => {
    profileState.profile = FULL_PROFILE;
    renderFindWork();
    fireEvent.click(screen.getByTestId('home-conversation-confirm-yes'));

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const [fn, args] = rpcMock.mock.calls[0];
    expect(fn).toBe('list_public_opportunity_teasers');
    expect((args as Record<string, unknown>)._state).toBe('TX');

    fireEvent.click(screen.getByTestId('home-conversation-continue'));
    expect(navigateSpy).toHaveBeenCalledWith(HOME_INTAKE_NEXT_PATH);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('uses the Review/update continuation label', () => {
    profileState.profile = FULL_PROFILE;
    renderFindWork();
    fireEvent.click(screen.getByTestId('home-conversation-confirm-yes'));
    expect(screen.getByTestId('home-conversation-continue').textContent).toContain(
      FIND_WORK_CONTINUE_LABEL,
    );
  });

  it('never persists or writes anything from the FindWork surface', () => {
    expect(FIND_WORK_SRC).not.toMatch(/sessionStorage|localStorage|saveIntakeSnapshot/);
    expect(FIND_WORK_SRC).not.toMatch(/upsertProfile|deleteProfile|\.insert\(|\.update\(|\.delete\(/);
    expect(FIND_WORK_SRC).not.toMatch(/full_name|phone|contact_preference|visibility|endorsements/);
  });
});

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

describe('HP-4B routing', () => {
  it('registers /find-work behind ProtectedRoute', () => {
    expect(APP_SRC).toContain(
      '<Route path="/find-work" element={<ProtectedRoute><FindWork /></ProtectedRoute>} />',
    );
  });

  it('leaves the public / route and PublicRoute implementation unchanged', () => {
    expect(APP_SRC).toContain('<Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />');
    expect(APP_SRC).toContain(
      'if (user) return <Navigate to={resolvePostAuthDestination(location.search)} replace />;',
    );
  });
});
