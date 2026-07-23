// Phase 1N-C — Driver Profile Clarity & Privacy Consistency
//
// Verifies that:
//   • Leaderboard Identity (PublicProfileSection) is clearly labelled as
//     leaderboard-only and defaults anonymous.
//   • Opportunity Preferences (DriverOpportunityProfile) presents itself
//     as recruiter-facing, uses the new Recruiter Contact Information
//     section, exposes "Use account email"/"Use account phone" actions,
//     and enforces fail-closed recruiter-contact privacy.

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Radix pointer-capture polyfill for jsdom.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as any;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

// ---------------------------------------------------------------------------
// Shared spies on globalThis so hoisted vi.mock factories can reach them.
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __1nc_opp_mutate: (payload: any, opts?: any) => void;
  // eslint-disable-next-line no-var
  var __1nc_opp_profile: any;
  // eslint-disable-next-line no-var
  var __1nc_user: any;
  // eslint-disable-next-line no-var
  var __1nc_leaderboard_mutate: (payload: any) => void;
}

// Stable user object — hooks depend on identity.
const DEFAULT_USER = {
  id: 'u-1nc',
  email: 'account@example.com',
  user_metadata: { phone: '+15551234567', display_name: 'Account Name' },
};

globalThis.__1nc_user = DEFAULT_USER;
globalThis.__1nc_opp_profile = null;

// -- Opportunity profile hook mock -------------------------------------------
vi.mock('@/hooks/opportunities/useDriverOpportunityProfile', () => ({
  useDriverOpportunityProfile: () => ({
    profile: globalThis.__1nc_opp_profile,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    upsertProfile: {
      mutate: (p: any, o: any) => globalThis.__1nc_opp_mutate(p, o),
      isPending: false,
    },
    deleteProfile: { mutate: () => {}, isPending: false },
  }),
}));

// -- Auth hook mock ----------------------------------------------------------
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: globalThis.__1nc_user }),
}));

// -- Driver leaderboard profile hook mock ------------------------------------
vi.mock('@/hooks/useDriverProfile', () => ({
  HANDLE_EMOJIS: ['🚛', '🐺'],
  useDriverProfile: () => ({
    data: {
      user_id: 'u-1nc',
      display_name: 'Account Name',
      driver_handle: null,
      handle_emoji: null,
      handle_public: false,
    },
    isLoading: false,
  }),
  useUpdateDriverProfile: () => ({
    mutate: (payload: any) => globalThis.__1nc_leaderboard_mutate(payload),
    isPending: false,
  }),
  checkHandleAvailable: async () => true,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, {
    success: () => {},
    error: () => {},
    message: () => {},
  }),
}));

// Imports AFTER mocks.
import { DriverOpportunityProfile } from '@/components/opportunities/DriverOpportunityProfile';
import { PublicProfileSection } from '@/components/PublicProfileSection';

const oppMutate = vi.fn();
const leaderboardMutate = vi.fn();
globalThis.__1nc_opp_mutate = (p, o) => oppMutate(p, o);
globalThis.__1nc_leaderboard_mutate = (p) => leaderboardMutate(p);

function renderOpp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DriverOpportunityProfile onBack={() => {}} onSaveSuccess={() => {}} />
    </QueryClientProvider>,
  );
}

function renderLeaderboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PublicProfileSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  oppMutate.mockReset();
  leaderboardMutate.mockReset();
  globalThis.__1nc_user = DEFAULT_USER;
  globalThis.__1nc_opp_profile = null;
});

// ---------------------------------------------------------------------------
// Leaderboard Identity — PublicProfileSection
// ---------------------------------------------------------------------------
describe('Phase 1N-C · Leaderboard Identity clarity', () => {
  it('renders the Leaderboard Identity heading and drops "Public Profile"', () => {
    renderLeaderboard();
    // Heading paragraph (case-sensitive, exact) — button label uses
    // lowercase "leaderboard identity" so a case-insensitive match would
    // legitimately find both nodes.
    expect(screen.getByText('Leaderboard Identity')).toBeInTheDocument();
    expect(screen.queryByText('Public Profile')).toBeNull();
  });

  it('explains leaderboard-only purpose and anonymous default', () => {
    renderLeaderboard();
    const copy = screen.getByText(
      (_, el) =>
        el?.tagName === 'P' &&
        /weekly leaderboard/i.test(el.textContent ?? '') &&
        /not your recruiter or job profile/i.test(el.textContent ?? '') &&
        /Driver\s*#XXXX/i.test(el.textContent ?? ''),
    );
    expect(copy).toBeInTheDocument();
  });

  it('uses the "Save leaderboard identity" button label', () => {
    renderLeaderboard();
    expect(
      screen.getByRole('button', { name: /Save leaderboard identity/i }),
    ).toBeInTheDocument();
  });

  it('success toast wording is "Leaderboard identity updated" (source contract)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../hooks/useDriverProfile.ts'),
      'utf8',
    );
    expect(src).toContain("'Leaderboard identity updated'");
    expect(src).not.toContain("'Public profile updated'");
  });
});

// ---------------------------------------------------------------------------
// Opportunity Preferences — recruiter-facing framing and contact section
// ---------------------------------------------------------------------------
describe('Phase 1N-C · Opportunity Preferences recruiter framing', () => {
  it('identifies itself as recruiter-facing and distinct from account/leaderboard', () => {
    renderOpp();
    expect(screen.getByRole('heading', { name: /Opportunity Preferences/i })).toBeInTheDocument();
    const copy = screen.getByText((_, el) => {
      const t = el?.textContent ?? '';
      return /recruiter-facing/i.test(t) &&
        /separate/i.test(t) &&
        /Leaderboard Identity/i.test(t);
    });
    expect(copy).toBeInTheDocument();
  });

  it('exposes Recruiter Contact Information labels', () => {
    renderOpp();
    expect(
      screen.getByRole('heading', { name: /Recruiter Contact Information/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Name shown to recruiters/i)).toBeInTheDocument();
    expect(screen.getByText(/Recruiter contact phone/i)).toBeInTheDocument();
    expect(screen.getByText(/Recruiter contact email/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// "Use account" quick actions
// ---------------------------------------------------------------------------
describe('Phase 1N-C · Use account email/phone actions', () => {
  it('"Use account email" copies user.email into ONLY the recruiter email field', () => {
    renderOpp();
    const emailInput = screen.getByPlaceholderText('you@example.com') as HTMLInputElement;
    const phoneInput = screen.getByPlaceholderText('(555) 555-5555') as HTMLInputElement;
    // Simulate the driver typing a distinct value first.
    fireEvent.change(emailInput, { target: { value: 'typed@driver.example' } });
    fireEvent.change(phoneInput, { target: { value: '(999) 000-1111' } });

    fireEvent.click(screen.getByRole('button', { name: /Use account email/i }));

    expect(emailInput.value).toBe('account@example.com');
    // Phone must not be touched.
    expect(phoneInput.value).toBe('(999) 000-1111');
  });

  it('"Use account phone" appears only when metadata phone exists and copies it', () => {
    renderOpp();
    const phoneBtn = screen.getByRole('button', { name: /Use account phone/i });
    const phoneInput = screen.getByPlaceholderText('(555) 555-5555') as HTMLInputElement;
    const emailInput = screen.getByPlaceholderText('you@example.com') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'keep@example.com' } });

    fireEvent.click(phoneBtn);
    expect(phoneInput.value).toBe('+15551234567');
    // Email must not be touched.
    expect(emailInput.value).toBe('keep@example.com');
  });

  it('"Use account phone" is not rendered when metadata phone is missing', () => {
    globalThis.__1nc_user = { id: 'u-nophone', email: 'a@b.co', user_metadata: {} };
    renderOpp();
    expect(screen.queryByRole('button', { name: /Use account phone/i })).toBeNull();
    // Email action still available.
    expect(screen.getByRole('button', { name: /Use account email/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Fail-closed privacy / recruiter-contact rules
// ---------------------------------------------------------------------------
function baseProfile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user_id: 'u-1nc',
    full_name: 'Jane Driver',
    phone: '5551112222',
    email: 'jane@example.com',
    city: 'Dallas',
    state: 'TX',
    cdl_class: 'A',
    years_experience: 3,
    endorsements: [],
    trailer_experience: [],
    preferred_driver_type: 'Company Driver',
    preferred_route_type: 'OTR',
    preferred_home_time: null,
    preferred_states: [],
    available_start_date: null,
    willing_to_relocate: false,
    min_weekly_gross: 1500,
    min_weekly_net: null,
    min_effective_rpm: null,
    visibility: 'private',
    allow_verified_recruiter_contact: true,
    contact_preference: 'in_app',
    profile_completed: true,
    ...overrides,
  };
}

function getContactToggle() {
  return screen.getByRole('switch', {
    name: /Allow approved recruiters to contact me/i,
  }) as HTMLButtonElement;
}

async function selectVisibility(labelPattern: RegExp) {
  // The visibility <SelectTrigger> is the first combobox rendered in the
  // Privacy section. There are two comboboxes in that section (visibility
  // then contact method). Grab the first one.
  const triggers = screen.getAllByRole('combobox');
  const visibilityTrigger = triggers[triggers.length - 2] ?? triggers[0];
  fireEvent.click(visibilityTrigger);
  const option = await screen.findByRole('option', { name: labelPattern });
  fireEvent.click(option);
}

describe('Phase 1N-C · Fail-closed recruiter-contact privacy', () => {
  it('loads private + allow=true as toggle OFF and DISABLED', () => {
    globalThis.__1nc_opp_profile = baseProfile({ visibility: 'private', allow_verified_recruiter_contact: true });
    renderOpp();
    const toggle = getContactToggle();
    expect(toggle).toBeDisabled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('loads apply_only + allow=true as toggle OFF and DISABLED', () => {
    globalThis.__1nc_opp_profile = baseProfile({ visibility: 'apply_only', allow_verified_recruiter_contact: true });
    renderOpp();
    const toggle = getContactToggle();
    expect(toggle).toBeDisabled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('verified_recruiters does NOT auto-enable the contact toggle', async () => {
    globalThis.__1nc_opp_profile = baseProfile({ visibility: 'private', allow_verified_recruiter_contact: false });
    renderOpp();
    await selectVisibility(/Approved recruiters/i);
    const toggle = getContactToggle();
    expect(toggle).not.toBeDisabled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('switching verified_recruiters → private clears + disables contact', async () => {
    globalThis.__1nc_opp_profile = baseProfile({
      visibility: 'verified_recruiters',
      allow_verified_recruiter_contact: true,
    });
    renderOpp();
    // Loaded state: enabled + on.
    let toggle = getContactToggle();
    expect(toggle).not.toBeDisabled();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await selectVisibility(/Private/i);
    toggle = getContactToggle();
    expect(toggle).toBeDisabled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('switching verified_recruiters → apply_only clears + disables contact', async () => {
    globalThis.__1nc_opp_profile = baseProfile({
      visibility: 'verified_recruiters',
      allow_verified_recruiter_contact: true,
    });
    renderOpp();
    await selectVisibility(/Application only/i);
    const toggle = getContactToggle();
    expect(toggle).toBeDisabled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('save payload can never send allow=true unless visibility is verified_recruiters', async () => {
    globalThis.__1nc_opp_profile = baseProfile({
      visibility: 'verified_recruiters',
      allow_verified_recruiter_contact: true,
    });
    renderOpp();
    await selectVisibility(/Private/i);
    fireEvent.click(screen.getByRole('button', { name: /Save Preferences/i }));
    expect(oppMutate).toHaveBeenCalledTimes(1);
    const [payload] = oppMutate.mock.calls[0];
    expect(payload.visibility).toBe('private');
    expect(payload.allow_verified_recruiter_contact).toBe(false);
  });

  it('preserves existing validation + completion semantics for a complete form', () => {
    globalThis.__1nc_opp_profile = baseProfile();
    renderOpp();
    fireEvent.click(screen.getByRole('button', { name: /Save Preferences/i }));
    expect(oppMutate).toHaveBeenCalledTimes(1);
    const [payload] = oppMutate.mock.calls[0];
    expect(payload.profile_completed).toBe(true);
    expect(payload.full_name).toBe('Jane Driver');
    expect(payload.cdl_class).toBe('A');
    // Never a positive allow flag under 'private' (defensive).
    expect(
      payload.visibility === 'verified_recruiters'
        ? true
        : payload.allow_verified_recruiter_contact === false,
    ).toBe(true);
  });
});
