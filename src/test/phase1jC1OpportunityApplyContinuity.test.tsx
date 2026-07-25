// Phase 1J-C1 — Apply-context continuity across Opportunity Preferences.
//
// Renders the real OpportunitiesPage, OpportunityDetail, and ApplyNowDialog.
// Narrow, allowed mocks only: data hooks, OpportunityCard list presentation,
// DriverOpportunityProfile form boundary, and ReferDriverDialog (hermetic
// isolation from the referral hook -> Supabase client chain).
//
// Covers all thirteen scenarios required by the Phase 1J-C1 contract.

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Radix pointer-capture polyfill for jsdom.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as any;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

// -- Mutable stores driving mocked data hooks -----------------------------
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      listeners.forEach((l) => l());
    },
    use: () => {
      const [, setTick] = React.useState(0);
      React.useEffect(() => {
        const l = () => setTick((t) => t + 1);
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      }, []);
      return value;
    },
  };
}

type OppRow = { id: string; recruiter_id: string; title: string; company_name: string };
type ProfileRow = { profile_completed: boolean; email?: string; phone?: string; full_name?: string } | null;
type AppRow = { opportunity_id: string; application_type: 'apply' | 'request_info'; status: string };

const opportunitiesStore = createStore<OppRow[]>([]);
const profileStore = createStore<ProfileRow>(null);
const applicationsStore = createStore<AppRow[]>([]);

// -- Mocks ---------------------------------------------------------------
vi.mock('@/hooks/opportunities/useOpportunities', () => ({
  useOpportunities: () => {
    const opportunities = opportunitiesStore.use();
    return { opportunities, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
}));
vi.mock('@/hooks/opportunities/useSavedOpportunities', () => ({
  useSavedOpportunities: () => ({
    saved: [] as any[],
    save: { mutate: vi.fn(), isPending: false },
    unsave: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ isPro: false, isLoading: false, error: null }),
}));
vi.mock('@/hooks/opportunities/useDriverOpportunityProfile', () => ({
  useDriverOpportunityProfile: () => {
    const profile = profileStore.use();
    return {
      profile,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      upsertProfile: { mutate: vi.fn(), isPending: false },
      deleteProfile: { mutate: vi.fn(), isPending: false },
    };
  },
}));
const submitMutateAsync = vi.fn().mockResolvedValue({ result_code: 'created' });
vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: () => {
    const driverApplications = applicationsStore.use();
    return {
      driverApplications,
      submitApplication: { mutateAsync: submitMutateAsync, isPending: false },
      createApplication: { mutate: vi.fn(), isPending: false },
    };
  },
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

// OpportunityCard: list presentation only. We also re-export a
// deterministic `displayHiringCoverage` helper because OpportunityDetail
// imports it from this module; a mock that omitted the helper would
// leave it undefined and break every apply-continuity scenario that
// renders the real OpportunityDetail.
vi.mock('@/components/opportunities/OpportunityCard', () => ({
  OpportunityCard: ({ opportunity, onView }: any) => (
    <button data-testid={`card-${opportunity.id}`} onClick={onView}>
      Open {opportunity.title}
    </button>
  ),
  displayHiringCoverage: (canonical: any): string | null => {
    const area = canonical?.hiringArea;
    if (!area) return null;
    const city = area.city;
    const state = area.state;
    if (city?.state === 'provided' && state?.state === 'provided') {
      return `${city.value}, ${state.value}`;
    }
    const states = area.states;
    if (states?.state === 'provided' && Array.isArray(states.value)) {
      const arr: string[] = states.value;
      if (arr.length === 48) return 'Nationwide — Lower 48';
      if (arr.length === 0) return null;
      if (arr.length <= 6) return arr.join(', ');
      return `${arr.length} states`;
    }
    return null;
  },
}));
// ReferDriverDialog isolation (mirrors A2 detail test).
vi.mock('@/components/opportunities/ReferDriverDialog', () => ({
  ReferDriverDialog: () => null,
}));

// Phase 1J-C1 hook-order proof: mock DriverApplicationsPanel and
// DriverReferralsPanel as simple panels with Back buttons so a real
// list→panel→list transition is deterministic without pulling in
// referral/application Supabase chains.
vi.mock('@/components/opportunities/DriverApplicationsPanel', () => ({
  DriverApplicationsPanel: ({ onBack }: any) => (
    <div data-testid="apps-panel">
      <h1>My Requests Panel</h1>
      <button onClick={onBack}>Apps Back</button>
    </div>
  ),
}));
vi.mock('@/components/opportunities/DriverReferralsPanel', () => ({
  DriverReferralsPanel: ({ onBack }: any) => (
    <div data-testid="referrals-panel">
      <h1>My Referrals Panel</h1>
      <button onClick={onBack}>Referrals Back</button>
    </div>
  ),
}));


// DriverOpportunityProfile parent boundary — exposes deterministic buttons
// for the two save-success outcomes the real component can produce. The real
// component's mutation-failure contract (mutate onError → onSaveSuccess is
// NEVER called) is exercised separately against the REAL component in
// `phase1jC1DriverProfileMutationFailure.test.tsx` under a dedicated file.

const prefsCallbacks: {
  onBack: Array<() => void>;
  onSaveSuccess: Array<(r: { completed: boolean }) => void>;
} = { onBack: [], onSaveSuccess: [] };
vi.mock('@/components/opportunities/DriverOpportunityProfile', () => ({
  DriverOpportunityProfile: ({ onBack, onSaveSuccess }: any) => {
    prefsCallbacks.onBack.push(onBack);
    prefsCallbacks.onSaveSuccess.push(onSaveSuccess);
    return (
      <div data-testid="prefs-mock">
        <h1>Opportunity Preferences</h1>
        <button onClick={onBack}>Prefs Back</button>
        <button onClick={() => onSaveSuccess?.({ completed: false })}>Save Incomplete</button>
        <button onClick={() => onSaveSuccess?.({ completed: true })}>Save Completed</button>
      </div>
    );
  },
}));


import {
  OpportunitiesPage,
  resolveApplyResumeAfterSave,
  consumeMatchingResumeState,
} from '@/components/opportunities/OpportunitiesPage';

const OPP_A: OppRow = { id: 'opp-A', recruiter_id: 'rec-1', title: 'Route A', company_name: 'Alpha' };
const OPP_B: OppRow = { id: 'opp-B', recruiter_id: 'rec-2', title: 'Route B', company_name: 'Beta' };

const completedProfile = {
  profile_completed: true,
  full_name: 'Jane Driver',
  email: 'jane@example.com',
  phone: '5551234567',
} as any;
const incompleteProfile = { profile_completed: false, email: 'jane@example.com', phone: '5551234567' } as any;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OpportunitiesPage onUpgrade={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  submitMutateAsync.mockClear();
  prefsCallbacks.onBack = [];
  prefsCallbacks.onSaveSuccess = [];
  // Fresh stores per test.
  opportunitiesStore.set([OPP_A, OPP_B]);
  profileStore.set(incompleteProfile);
  applicationsStore.set([]);
});

afterEach(() => {
  // Reset to defaults so tests do not bleed state.
  opportunitiesStore.set([]);
  profileStore.set(null);
  applicationsStore.set([]);
});

// -- Helpers ---------------------------------------------------------------
async function openDetail(id: 'opp-A' | 'opp-B') {
  await userEvent.click(screen.getByTestId(`card-${id}`));
  // Detail heading is "Route A" or "Route B" inside an h1.
  await screen.findByRole('heading', { name: id === 'opp-A' ? 'Route A' : 'Route B' });
}

async function openApplyDialog() {
  await userEvent.click(screen.getByRole('button', { name: /^Apply Now$/ }));
  await screen.findByRole('dialog');
}

async function enterPrefsFromApply() {
  // Dialog shows Preferences-required panel because profile is incomplete.
  const cta =
    screen.queryByRole('button', { name: /^Complete Opportunity Preferences$/i }) ??
    screen.getByRole('button', { name: /^Update Opportunity Preferences$/i });
  await userEvent.click(cta);
  await screen.findByTestId('prefs-mock');
}

async function clickPrefsBack() {
  await userEvent.click(screen.getByRole('button', { name: /^Prefs Back$/ }));
}
async function clickSaveCompleted() {
  await userEvent.click(screen.getByRole('button', { name: /^Save Completed$/ }));
}
async function clickSaveIncomplete() {
  await userEvent.click(screen.getByRole('button', { name: /^Save Incomplete$/ }));
}

// ==========================================================================
describe('Phase 1J-C1 — Opportunity Apply continuity (integration)', () => {
  it('1. Apply Now on A → Preferences preserves A (Back returns to A detail); detail exposes exactly one dominant Apply Now action', async () => {
    renderPage();
    await openDetail('opp-A');
    // Phase 1O-B contract: the detail surface exposes exactly one
    // dominant Apply Now action (the sticky action bar) — no duplicate
    // top-of-summary button. Any Referral secondary button that carries
    // the word "Apply" (e.g. "Applied?") is excluded via an exact match.
    const applyButtons = screen.getAllByRole('button', { name: /^Apply Now$/i });
    expect(applyButtons).toHaveLength(1);
    await openApplyDialog();
    await enterPrefsFromApply();
    // Dialog/detail hidden while editing preferences.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Route A' })).toBeNull();
    // Back returns to A (proves selectedId was preserved in parent state).
    await clickPrefsBack();
    expect(await screen.findByRole('heading', { name: 'Route A' })).toBeInTheDocument();
    // Apply dialog remains closed.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('2. Back from apply-origin Preferences never auto-opens Apply', async () => {
    renderPage();
    await openDetail('opp-A');
    await openApplyDialog();
    await enterPrefsFromApply();
    await clickPrefsBack();
    // Rerenders/interactions do not auto-open Apply.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('3. successful incomplete save: remains on Preferences, no resume/open', async () => {
    renderPage();
    await openDetail('opp-A');
    await openApplyDialog();
    await enterPrefsFromApply();
    await clickSaveIncomplete();
    // Still on prefs screen.
    expect(screen.getByTestId('prefs-mock')).toBeInTheDocument();
    // Rerender by mutating a store shouldn't open anything either.
    act(() => profileStore.set({ ...incompleteProfile }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('prefs-mock')).toBeInTheDocument();
  });

  it('4. successful completed save: returns to A; dialog opens once only after profile hook completes', async () => {
    renderPage();
    await openDetail('opp-A');
    await openApplyDialog();
    await enterPrefsFromApply();
    // Save completed BEFORE the shared profile hook reflects completion.
    await clickSaveCompleted();
    // Detail should render, but dialog stays closed because profile is not yet completed.
    expect(await screen.findByRole('heading', { name: 'Route A' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Now the shared profile hook refetches to completed.
    act(() => profileStore.set(completedProfile));
    // Dialog opens exactly once.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // Ordinary rerender does not reopen or duplicate.
    act(() => profileStore.set({ ...completedProfile }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('5. close resumed dialog and rerender multiple times: remains closed', async () => {
    renderPage();
    await openDetail('opp-A');
    await openApplyDialog();
    await enterPrefsFromApply();
    await clickSaveCompleted();
    act(() => profileStore.set(completedProfile));
    await screen.findByRole('dialog');
    // Close dialog.
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => profileStore.set({ ...completedProfile }));
    act(() => profileStore.set({ ...completedProfile }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('6. later distinct completed attempt for A opens Apply exactly once again', async () => {
    renderPage();
    // First cycle.
    await openDetail('opp-A');
    await openApplyDialog();
    await enterPrefsFromApply();
    await clickSaveCompleted();
    act(() => profileStore.set(completedProfile));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Second Apply cycle on the same opportunity.
    await openApplyDialog();
    // With completed profile the dialog now shows the submit form directly.
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    // Simulate an Apply → Preferences → Save Completed sequence again.
    await openApplyDialog();
    // Force the required panel back by pretending prefs need updating: bump
    // profileStore to a fresh completed reference AFTER re-entry.
    // The dialog shows the submit form (profile is completed). Enter Prefs
    // manually via the "Edit Opportunity Preferences" button inside the form.
    await userEvent.click(
      screen.getByRole('button', { name: /Edit Opportunity Preferences/i }),
    );
    await screen.findByTestId('prefs-mock');
    await clickSaveCompleted();
    act(() => profileStore.set({ ...completedProfile }));
    // A second, distinct resume must open the dialog exactly once.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('7. manual Preferences entry + completed save: remains on Preferences, never opens Apply', async () => {
    // No opportunity selected — user enters Preferences directly from the list card.
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Set Preferences/i }));
    await screen.findByTestId('prefs-mock');
    await clickSaveCompleted();
    // Even if the shared profile hook subsequently becomes completed, no
    // Apply dialog opens because there was no Apply origin.
    act(() => profileStore.set(completedProfile));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('prefs-mock')).toBeInTheDocument();
  });

  it('8. boundary contract: when the DriverOpportunityProfile mutation fails and never invokes onSaveSuccess, the parent never sets resume state (rendered proof through the parent state machine)', async () => {
    renderPage();
    await openDetail('opp-A');
    await openApplyDialog();
    await enterPrefsFromApply();
    // Do NOT call any Save button — the real component under a failing
    // mutation invokes NEITHER onSaveSuccess({completed:true}) NOR
    // onSaveSuccess({completed:false}). Simulate that boundary by leaving
    // both unclicked; the profile hook subsequently becoming completed on
    // its own must not open Apply, because no resume token was ever minted.
    expect(screen.getByTestId('prefs-mock')).toBeInTheDocument();
    act(() => profileStore.set(completedProfile));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('prefs-mock')).toBeInTheDocument();
    // The parent state-machine's fail-closed decision under the same
    // {origin, selectedId, existingIds} shape returns 'resume' only when
    // both invariants hold — proved directly here so this scenario cannot
    // silently degrade to always-open regardless of the boundary contract.
    expect(
      resolveApplyResumeAfterSave({
        originId: 'opp-A',
        selectedId: 'opp-A',
        existingIds: ['opp-A', 'opp-B'],
      }),
    ).toBe('resume');
  });

  it('9. selection mismatch (origin A, selectedId B, both still exist): pure fail-closed helper returns clear-to-list', () => {
    // Honest evidence for the defensive branch. This state cannot be
    // reached through a legitimate exposed interaction today, so the
    // exported pure helper is exercised directly (per the phase contract).
    expect(
      resolveApplyResumeAfterSave({
        originId: 'opp-A',
        selectedId: 'opp-B',
        existingIds: ['opp-A', 'opp-B'],
      }),
    ).toBe('clear-to-list');
    // Missing origin also fails closed.
    expect(
      resolveApplyResumeAfterSave({
        originId: 'opp-A',
        selectedId: 'opp-A',
        existingIds: ['opp-B'],
      }),
    ).toBe('clear-to-list');
    // Matching origin+selection with origin present → resume.
    expect(
      resolveApplyResumeAfterSave({
        originId: 'opp-A',
        selectedId: 'opp-A',
        existingIds: ['opp-A'],
      }),
    ).toBe('resume');
    // No origin → no-op.
    expect(
      resolveApplyResumeAfterSave({
        originId: null,
        selectedId: 'opp-A',
        existingIds: ['opp-A'],
      }),
    ).toBe('no-origin');
  });

  it('9b. rendered proof: manual Preferences entry clears any stale selected opportunity and Back returns to the list', async () => {
    // Deep-link path enters Preferences as a manual origin. Even though
    // the initial mount has no prior selection in this environment, we
    // prove Back from a manual origin lands on the list (not on any
    // detail view), which is only possible when openPreferencesManual
    // clears selectedId. Combined with the sibling helper assertion
    // below, this covers the stale-selectedId branch.
    sessionStorage.setItem('htp_opportunities_initial_view', 'driver-profile');
    renderPage();
    await screen.findByTestId('prefs-mock');
    await clickPrefsBack();
    // Back must render the list surface (ProfileEntryCard visible), and
    // must NOT render any OpportunityDetail heading.
    expect(
      await screen.findByRole('button', { name: /Set Preferences|Edit Preferences/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Route A' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Route B' })).toBeNull();
    // Structural source assertion: openPreferencesManual clears selectedId.
    const src = fs.readFileSync(
      path.resolve(__dirname, '../components/opportunities/OpportunitiesPage.tsx'),
      'utf8',
    );
    expect(src).toMatch(/openPreferencesManual\s*=\s*\(\)\s*=>\s*\{[\s\S]*?setSelectedId\(null\)/);
  });

  it('10. opportunity A removed before handoff: no dialog; stale state cleared; safe list result', async () => {
    renderPage();
    await openDetail('opp-A');
    await openApplyDialog();
    await enterPrefsFromApply();
    // Remove A entirely.
    act(() => opportunitiesStore.set([OPP_B]));
    await clickSaveCompleted();
    act(() => profileStore.set(completedProfile));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Falls back to the list (Set Preferences CTA is visible on the list surface).
    expect(await screen.findByRole('button', { name: /Set Preferences|Edit Preferences/i })).toBeInTheDocument();
  });

  it('11. stable consume callback: pure helper clears ONLY when both token AND selected opportunity match', () => {
    type R = { opportunityId: string; token: string };
    const prev: R = { opportunityId: 'opp-A', token: 'resume-2' };
    // Stale (older) token must not clear a newer one.
    expect(consumeMatchingResumeState(prev, 'opp-A', 'resume-1')).toBe(prev);
    // Matching token but wrong selected opportunity must not clear.
    expect(consumeMatchingResumeState(prev, 'opp-B', 'resume-2')).toBe(prev);
    // Selection null must not clear.
    expect(consumeMatchingResumeState(prev, null, 'resume-2')).toBe(prev);
    // Exact token + opportunity clears.
    expect(consumeMatchingResumeState(prev, 'opp-A', 'resume-2')).toBeNull();
    // Null prev is a no-op.
    expect(consumeMatchingResumeState<R>(null, 'opp-A', 'resume-2')).toBeNull();
    // Structural: parent wires the stable callback via useCallback and the pure helper.
    const src = fs.readFileSync(
      path.resolve(__dirname, '../components/opportunities/OpportunitiesPage.tsx'),
      'utf8',
    );
    expect(src).toMatch(/useCallback/);
    expect(src).toMatch(/handleResumeApplyConsumed/);
    expect(src).toMatch(/onResumeApplyConsumed=\{handleResumeApplyConsumed\}/);
    expect(src).toMatch(/consumeMatchingResumeState\(prev,\s*selectedId,\s*consumedToken\)/);
    // Token generation remains monotonic (no runtime UUID/timestamp calls).
    expect(src).toMatch(/resumeTokenCounterRef/);
    expect(src).not.toMatch(/crypto\.randomUUID\(/);
    expect(src).not.toMatch(/Date\.now\(\)/);
  });

  it('12. active formal application disables Apply Now at the source (authoritative resume-token behavior is proved on the real OpportunityDetail in phase1hA2OpportunityDetail.test.tsx)', async () => {
    renderPage();
    // Seed an active formal application on A so Apply Now is disabled.
    applicationsStore.set([{ opportunity_id: 'opp-A', application_type: 'apply', status: 'interviewing' }]);
    await openDetail('opp-A');
    act(() => profileStore.set(completedProfile));
    const applyBtn = screen.getByRole('button', { name: /Application Submitted/i });
    expect(applyBtn).toBeDisabled();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Note: there is no legitimate UI path that mints a resume token
    // while a formal application is active (openPreferencesForApply is
    // unreachable when Apply Now is disabled). The authoritative proof
    // that OpportunityDetail refuses to open the dialog AND does not
    // invoke onResumeApplyConsumed when a non-null token appears against
    // active/completed formal state lives in the real-OpportunityDetail
    // resume-token matrix (scenarios 5 and 6 in phase1hA2OpportunityDetail).
  });



  it('13. source audit: required copy present, no old user-facing literal, and no schema/type renames across the five production files AND the canonical hook', () => {
    const rootPaths = [
      'src/components/opportunities/ApplyNowDialog.tsx',
      'src/components/opportunities/OpportunityDetail.tsx',
      'src/components/opportunities/OpportunitiesPage.tsx',
      'src/components/opportunities/DriverOpportunityProfile.tsx',
      'src/lib/opportunities/applicationSubmission.ts',
    ];
    const roots = rootPaths.map((p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8'));
    const all = roots.join('\n\n');
    // No user-facing legacy literal in the five authorized production files.
    expect(all).not.toMatch(/\bOpportunity Profile\b/);
    expect(all).not.toMatch(/professional profile snapshot/i);
    // Required Preferences copy.
    expect(all).toMatch(/Opportunity Preferences/);
    expect(all).toMatch(/Complete your Opportunity Preferences/);
    expect(all).toMatch(/Update Opportunity Preferences/);
    expect(all).toMatch(/Complete Opportunity Preferences/);
    // profile_required public-safe copy exact string.
    expect(all).toMatch(/Complete your Opportunity Preferences before applying\./);
    // Schema/type/internal names must not be renamed in the five files.
    expect(all).toMatch(/DriverOpportunityProfile/);
    expect(all).toMatch(/profile_completed/);
    // Canonical hook audit (read-only) — the underlying table name and
    // exported type name are the authoritative schema identifiers. A rename
    // there would be a real schema/type rename even if the five files above
    // were unchanged.
    const hookSrc = fs.readFileSync(
      path.resolve(__dirname, '../../src/hooks/opportunities/useDriverOpportunityProfile.ts'),
      'utf8',
    );
    expect(hookSrc).toMatch(/from\('driver_opportunity_profiles'\)/);
    expect(hookSrc).toMatch(/export type DriverOpportunityProfile\b/);
    expect(hookSrc).toMatch(/Tables<'driver_opportunity_profiles'>/);
  });

  it('14. hook-order source audit: existingIds useMemo and handleResumeApplyConsumed useCallback occur BEFORE the first conditional return', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../components/opportunities/OpportunitiesPage.tsx'),
      'utf8',
    );
    const fnStart = src.indexOf('export function OpportunitiesPage');
    expect(fnStart).toBeGreaterThan(-1);
    const body = src.slice(fnStart);
    const idxExisting = body.indexOf('const existingIds = useMemo');
    const idxCallback = body.indexOf('const handleResumeApplyConsumed = useCallback');
    // Locate top-level early-return patterns (must include the `return`
    // immediately after the guard to distinguish from `if (showProfile)`
    // inside effects/side-effect blocks).
    const findFirstReturn = (marker: RegExp) => {
      const m = body.match(marker);
      return m ? (m.index as number) : -1;
    };
    const idxIsError = findFirstReturn(/if \(isError\)\s*\{\s*\n\s*return/);
    const idxApps = findFirstReturn(/if \(showDriverApps\)\s*\{\s*\n\s*return/);
    const idxRefs = findFirstReturn(/if \(showReferrals\)\s*\{\s*\n\s*return/);
    const idxProfile = findFirstReturn(/if \(showProfile\)\s*\{\s*\n\s*return/);
    expect(idxExisting).toBeGreaterThan(-1);
    expect(idxCallback).toBeGreaterThan(-1);
    expect(idxIsError).toBeGreaterThan(-1);
    expect(idxApps).toBeGreaterThan(-1);
    expect(idxRefs).toBeGreaterThan(-1);
    expect(idxProfile).toBeGreaterThan(-1);
    const firstReturn = Math.min(idxIsError, idxApps, idxRefs, idxProfile);
    expect(idxExisting).toBeLessThan(firstReturn);
    expect(idxCallback).toBeLessThan(firstReturn);
    // Additionally, no `useMemo(` / `useCallback(` / `useState(` /
    // `useEffect(` / `useRef(` may appear AFTER the first conditional return.
    const afterFirstReturn = body.slice(firstReturn);
    expect(afterFirstReturn).not.toMatch(/\buseMemo\(/);
    expect(afterFirstReturn).not.toMatch(/\buseCallback\(/);
    expect(afterFirstReturn).not.toMatch(/\buseState\(/);
    expect(afterFirstReturn).not.toMatch(/\buseEffect\(/);
    expect(afterFirstReturn).not.toMatch(/\buseRef\(/);
  });


  it('15. rendered proof: View My Requests / My Referrals transitions do not throw a hook-order error and return cleanly to the list', async () => {
    // A hook-order violation surfaces as a synchronous React exception
    // during the panel→list re-render. We wrap the React error surface
    // ONLY to fail the test loudly rather than to suppress it: any
    // captured console.error is re-asserted as a failure below.
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      const first = args[0];
      const msg =
        typeof first === 'string'
          ? first
          : first instanceof Error
            ? first.message
            : String(first);
      errors.push(msg);
      // Still forward so vitest reporters show it.
      origError.apply(console, args as any);
    };
    try {
      renderPage();
      // List surface present.
      expect(
        await screen.findByRole('button', { name: /View My Requests/i }),
      ).toBeInTheDocument();

      // → View My Requests → Back
      await userEvent.click(screen.getByRole('button', { name: /View My Requests/i }));
      expect(await screen.findByTestId('apps-panel')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Apps Back/i }));
      expect(
        await screen.findByRole('button', { name: /View My Requests/i }),
      ).toBeInTheDocument();

      // → View My Referrals → Back
      await userEvent.click(screen.getByRole('button', { name: /View My Referrals/i }));
      expect(await screen.findByTestId('referrals-panel')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Referrals Back/i }));
      expect(
        await screen.findByRole('button', { name: /View My Requests/i }),
      ).toBeInTheDocument();

      // No global crash surfaces.
      expect(screen.queryByText(/Preview render diagnostic/i)).toBeNull();
      expect(screen.queryByText(/Something went wrong/i)).toBeNull();
    } finally {
      console.error = origError;
    }
    // Hook-order / render-count violations MUST NOT have surfaced.
    const hookOrderHits = errors.filter(
      (m) =>
        /Rendered fewer hooks than expected/i.test(m) ||
        /Rendered more hooks than during the previous render/i.test(m) ||
        /change in the order of Hooks/i.test(m) ||
        /Rules of Hooks/i.test(m),
    );
    expect(hookOrderHits).toEqual([]);
  });
});

