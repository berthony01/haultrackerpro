/**
 * HP-3C — homepage job/campaign deep-link contract.
 *
 * Asserts: strict UUID gating before any RPC, exactly one bounded targeted
 * lookup, one identical unavailable line for every failure mode, public-safe
 * rendering only, in-memory-only campaign context, and an untouched HP-2
 * conversation script / Continue handoff.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'fs';
import { join } from 'path';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));
vi.mock('@/components/SEOHead', () => ({ default: () => null }));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

import Landing from '@/pages/Landing';
import {
  readHomeDeepLink,
  isValidJobId,
  buildTargetedOpeningNote,
  UNAVAILABLE_JOB_COPY,
  CAMPAIGN_VALUE_MAX_LENGTH,
} from '@/lib/home/homeDeepLink';
import { HOME_INTAKE_SNAPSHOT_KEY, WORK_TYPE_CHOICES } from '@/lib/home/conversationIntake';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const DEEP_LINK_SRC = read('src/lib/home/homeDeepLink.ts');
const CONTEXT_SRC = read('src/components/home/HomeTargetedJobContext.tsx');
const LANDING_SRC = read('src/pages/Landing.tsx');

const JOB_ID = '3f0c5b72-2a41-4f0e-9c51-8b2f61d0a7e1';

function teaser(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    title: 'OTR Dry Van Driver',
    company_name: 'NEW WAY Freight INC',
    hiring_city: 'Dallas',
    hiring_state: 'TX',
    hiring_states: ['TX'],
    driver_type: '1099',
    route_type: 'OTR',
    trailer_type: 'Dry Van',
    employment_model: null,
    team_configuration: null,
    home_time: 'Every 2 weeks',
    pay_model: 'cpm',
    cpm: 62,
    percentage_pay: null,
    percentage_basis_label: null,
    flat_weekly_pay: null,
    salary_amount: null,
    salary_frequency: null,
    other_pay_method_label: null,
    estimated_weekly_gross: null,
    estimated_weekly_miles: null,
    estimated_loaded_miles: null,
    estimated_deadhead_miles: null,
    deadhead_paid: null,
    sign_on_bonus: null,
    min_years_experience: 1,
    required_cdl_class: 'A',
    required_endorsements: null,
    typical_lanes: null,
    published_at: '2026-09-01T00:00:00Z',
    featured: false,
    has_additional_requirements: true,
    ...overrides,
  };
}

function setSearch(search: string) {
  window.history.replaceState({}, '', `/${search}`);
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Landing />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [], error: null });
  navigateSpy.mockReset();
  sessionStorage.clear();
  setSearch('');
});

describe('HP-3C — pure deep-link parsing', () => {
  it('accepts only canonical UUIDs for job', () => {
    expect(isValidJobId(JOB_ID)).toBe(true);
    expect(isValidJobId('not-a-uuid')).toBe(false);
    expect(isValidJobId('')).toBe(false);
    expect(isValidJobId(null)).toBe(false);
    expect(readHomeDeepLink(`?job=${JOB_ID}`).jobId).toBe(JOB_ID);
    expect(readHomeDeepLink('?job=not-a-uuid').jobId).toBeNull();
    expect(readHomeDeepLink('').jobId).toBeNull();
  });

  it('sanitizes and clamps campaign values, dropping anything invalid', () => {
    const long = 'a'.repeat(CAMPAIGN_VALUE_MAX_LENGTH + 1);
    const parsed = readHomeDeepLink(
      `?campaign=tiktok_houston_otr&utm_source=tik-tok&utm_medium=<script>&utm_campaign=${long}&unknown_key=keepout`,
    );
    expect(parsed.campaign).toEqual({
      campaign: 'tiktok_houston_otr',
      utm_source: 'tik-tok',
    });
    expect(Object.keys(parsed.campaign)).not.toContain('unknown_key');
  });

  it('is pure — no network, storage, router or analytics', () => {
    const code = DEEP_LINK_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(
      /supabase|\.rpc\(|fetch\(|localStorage|sessionStorage|document\.cookie|analytics|react-router/i,
    );
    expect(code).not.toMatch(/^import /m);
  });


  it('builds public-safe opening context only from listing fields', () => {
    expect(buildTargetedOpeningNote('OTR Dry Van Driver', 'NEW WAY Freight INC')).toBe(
      'You opened OTR Dry Van Driver at NEW WAY Freight INC.',
    );
    expect(buildTargetedOpeningNote(null, 'Anyone')).toBeUndefined();
  });
});

describe('HP-3C — targeted job lookup', () => {
  it('makes no targeted-job RPC when there is no job param', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByTestId('home-conversation-transcript')).toBeInTheDocument());
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('home-targeted-job-card')).not.toBeInTheDocument();
  });

  it('never calls the RPC for a malformed job value and shows the generic line is absent', async () => {
    setSearch('?job=not-a-uuid');
    renderLanding();
    await waitFor(() => expect(screen.getByTestId('home-conversation-transcript')).toBeInTheDocument());
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('home-targeted-job-card')).not.toBeInTheDocument();
  });

  it('makes exactly one call with only _opportunity_id and _limit: 1 for a valid UUID', async () => {
    setSearch(`?job=${JOB_ID}`);
    rpcMock.mockResolvedValue({ data: [teaser()], error: null });
    renderLanding();
    await waitFor(() => expect(screen.getByTestId('home-targeted-job-card')).toBeInTheDocument());
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('list_public_opportunity_teasers', {
      _opportunity_id: JOB_ID,
      _limit: 1,
    });
  });

  it('renders only public-safe listing data plus the additional-requirements note', async () => {
    setSearch(`?job=${JOB_ID}`);
    rpcMock.mockResolvedValue({ data: [teaser()], error: null });
    renderLanding();
    const card = await screen.findByTestId('home-targeted-job-card');
    expect(card).toHaveTextContent('OTR Dry Van Driver');
    expect(card).toHaveTextContent('NEW WAY Freight INC');
    expect(card).toHaveTextContent('Dallas, TX');
    expect(card).toHaveTextContent('62 CPM (recruiter listed)');
    expect(within(card).getByTestId('home-targeted-job-additional-requirements')).toBeInTheDocument();
    expect(card.textContent ?? '').not.toMatch(
      /qualified|eligible|approved|hired|guaranteed|match score|% match|take-home|net pay|recruiter_id/i,
    );
  });

  it('adapts only the first assistant line and keeps the script intact', async () => {
    setSearch(`?job=${JOB_ID}`);
    rpcMock.mockResolvedValue({ data: [teaser()], error: null });
    renderLanding();
    const transcript = await screen.findByTestId('home-conversation-transcript');
    await waitFor(() =>
      expect(transcript).toHaveTextContent('You opened OTR Dry Van Driver at NEW WAY Freight INC.'),
    );
    expect(transcript).toHaveTextContent('What kind of trucking work are you looking for?');
    const chips = screen.getByTestId('home-conversation-chips');
    WORK_TYPE_CHOICES.forEach((choice) => expect(chips).toHaveTextContent(choice));
  });

  it.each([
    ['unknown or ineligible id', { data: [], error: null }],
    ['RPC error', { data: null, error: { message: 'boom' } }],
  ])('shows the identical unavailable line for %s', async (_label, response) => {
    setSearch(`?job=${JOB_ID}`);
    rpcMock.mockResolvedValue(response);
    renderLanding();
    const line = await screen.findByTestId('home-targeted-job-unavailable');
    expect(line).toHaveTextContent(UNAVAILABLE_JOB_COPY);
    expect(screen.getByTestId('home-conversation-transcript')).toHaveTextContent(
      'What kind of trucking work are you looking for?',
    );
    expect(screen.queryByTestId('home-targeted-job-card')).not.toBeInTheDocument();
  });
});

describe('HP-3C — campaign context and untouched handoff', () => {
  it('campaign-only links cause no RPC, no storage, and no visible campaign claim', async () => {
    setSearch('?campaign=tiktok_houston_otr&utm_source=tiktok');
    const { container } = renderLanding();
    await waitFor(() => expect(screen.getByTestId('home-conversation-transcript')).toBeInTheDocument());
    expect(rpcMock).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(container.textContent ?? '').not.toMatch(/tiktok/i);
  });

  it('the Continue/snapshot/auth handoff is unchanged and carries no campaign or job data', async () => {
    setSearch(`?job=${JOB_ID}&campaign=tiktok_houston_otr`);
    rpcMock.mockResolvedValue({ data: [teaser()], error: null });
    renderLanding();
    await screen.findByTestId('home-targeted-job-card');

    // Walk the unchanged script to completion using quick replies / skips.
    for (let guard = 0; guard < 12; guard += 1) {
      const chips = screen.queryByTestId('home-conversation-chips');
      const firstChip = chips?.querySelector('button');
      if (firstChip) {
        fireEvent.click(firstChip);
        continue;
      }
      const skip = screen.queryByTestId('home-conversation-skip');
      if (skip) {
        fireEvent.click(skip);
        continue;
      }
      const input = screen.queryByTestId('home-conversation-input');
      if (!input) break;
      fireEvent.change(input, { target: { value: 'Dallas, TX' } });
      fireEvent.click(screen.getByTestId('home-conversation-send'));
    }

    const cont = await screen.findByTestId('home-conversation-continue');
    fireEvent.click(cont);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const dest = navigateSpy.mock.calls[0][0] as string;
    expect(dest.startsWith('/auth?intent=driver&next=')).toBe(true);
    expect(dest).not.toMatch(/campaign|utm_|job=/i);

    const snapshot = sessionStorage.getItem(HOME_INTAKE_SNAPSHOT_KEY) ?? '';
    expect(snapshot).not.toMatch(/campaign|utm_|tiktok/i);
    expect(snapshot).not.toContain(JOB_ID);
  });

  it('the deep-link surfaces write nothing and add no persistence', () => {
    expect(CONTEXT_SRC).not.toMatch(/localStorage|sessionStorage|document\.cookie|insert\(|update\(|upsert\(/);
    expect(CONTEXT_SRC).not.toMatch(/calculateOpportunityMatch|opportunityProfit|net pay|take-home/i);
    // Only one RPC call site exists in the targeted-job surface.
    expect(CONTEXT_SRC.match(/supabase\.rpc\(/g) ?? []).toHaveLength(1);
    // The auth handoff in Landing is untouched.
    expect(LANDING_SRC).toContain(
      'navigate(`/auth?intent=driver&next=${encodeURIComponent(HOME_CONVERSATION_NEXT_PATH)}`)',
    );
  });
});
