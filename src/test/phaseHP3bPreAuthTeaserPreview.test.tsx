/**
 * HP-3B — pre-auth public opportunity teaser preview contract.
 *
 * Asserts the signed-out homepage preview: no request before the conversation
 * completes, bounded and approved RPC args, honest listed-criteria labels, no
 * banned claims, no pay math, and an error path that never blocks Continue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import HomeOpportunityPreview from '@/components/home/HomeOpportunityPreview';
import HomeConversationFlow from '@/components/home/HomeConversationFlow';
import type { IntakeAnswers } from '@/lib/home/conversationIntake';
import {
  QUALIFICATION_LABELS,
  ADDITIONAL_REQUIREMENTS_NOTE,
  EMPTY_RESULTS_COPY,
  LOAD_FAILURE_COPY,
  MORE_RESULTS_COPY,
  MAX_PREVIEW_CARDS,
  TEASER_FETCH_LIMIT,
} from '@/lib/home/publicTeaserPresentation';

const PREVIEW_SRC = readFileSync(
  join(process.cwd(), 'src/components/home/HomeOpportunityPreview.tsx'),
  'utf8',
);
const PRESENTATION_SRC = readFileSync(
  join(process.cwd(), 'src/lib/home/publicTeaserPresentation.ts'),
  'utf8',
);
const FLOW_SRC = readFileSync(
  join(process.cwd(), 'src/components/home/HomeConversationFlow.tsx'),
  'utf8',
);

function teaser(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
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
    min_years_experience: null,
    required_cdl_class: null,
    required_endorsements: null,
    typical_lanes: null,
    published_at: '2026-09-01T00:00:00Z',
    featured: false,
    has_additional_requirements: false,
    ...overrides,
  };
}

const ANSWERS: IntakeAnswers = {
  state: 'TX',
  city: 'Dallas',
  cdl_class: 'A',
  years_experience: 5,
  preferred_route_type: 'OTR',
  preferred_home_time: 'Weekly',
  trailer_experience: ['Dry Van'],
  min_weekly_gross: 1800,
};

const FLOW_PROPS = {
  onContinue: () => {},
  amber: 'hsl(25, 95%, 53%)',
  surface: 'hsl(220, 22%, 10%)',
  border: 'hsl(220, 16%, 24%)',
  textMuted: 'hsl(220, 10%, 70%)',
  textDim: 'hsl(220, 10%, 55%)',
};

beforeEach(() => {
  rpcMock.mockReset();
});

describe('HP-3B — fetch discipline', () => {
  it('issues no RPC while the conversation is still in progress', () => {
    render(<HomeConversationFlow {...FLOW_PROPS} />);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('home-teaser-preview')).toBeNull();
  });

  it('renders the preview only inside the completed summary block, above Continue', () => {
    const idx = FLOW_SRC.indexOf('<HomeOpportunityPreview');
    const completeIdx = FLOW_SRC.indexOf('{complete && (');
    const continueIdx = FLOW_SRC.indexOf('home-conversation-continue');
    expect(idx).toBeGreaterThan(completeIdx);
    expect(idx).toBeLessThan(continueIdx);
  });

  it('sends only approved arg keys and never driver/route type filters', async () => {
    rpcMock.mockResolvedValue({ data: [teaser()], error: null });
    render(<HomeOpportunityPreview answers={ANSWERS} />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fn, args] = rpcMock.mock.calls[0];
    expect(fn).toBe('list_public_opportunity_teasers');
    expect(Object.keys(args).sort()).toEqual(['_limit', '_state']);
    expect(args._state).toBe('TX');
    expect(args._limit).toBe(TEASER_FETCH_LIMIT);
    expect(args).not.toHaveProperty('_driver_type');
    expect(args).not.toHaveProperty('_route_type');
  });

  it('makes a single unfiltered call when no state was given', async () => {
    rpcMock.mockResolvedValue({ data: [teaser()], error: null });
    render(<HomeOpportunityPreview answers={{ cdl_class: 'A' }} />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(rpcMock.mock.calls[0][1])).toEqual(['_limit']);
  });

  it('falls back at most once (two calls maximum) when the state query is empty', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    render(<HomeOpportunityPreview answers={ANSWERS} />);
    await waitFor(() => expect(screen.getByTestId('home-teaser-empty')).toBeTruthy());
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(rpcMock.mock.calls[1][1])).toEqual(['_limit']);
    expect(screen.getByTestId('home-teaser-empty').textContent).toBe(EMPTY_RESULTS_COPY);
  });
});

describe('HP-3B — rendering', () => {
  it('renders a single card without any count or inventory claim', async () => {
    rpcMock.mockResolvedValue({ data: [teaser()], error: null });
    render(<HomeOpportunityPreview answers={ANSWERS} />);
    await waitFor(() => expect(screen.getAllByTestId('home-teaser-card')).toHaveLength(1));
    expect(screen.queryByTestId('home-teaser-more')).toBeNull();
  });

  it('caps at three cards and discloses more listings without a total', async () => {
    rpcMock.mockResolvedValue({
      data: [teaser(), teaser(), teaser(), teaser(), teaser()],
      error: null,
    });
    render(<HomeOpportunityPreview answers={ANSWERS} />);
    await waitFor(() =>
      expect(screen.getAllByTestId('home-teaser-card')).toHaveLength(MAX_PREVIEW_CARDS),
    );
    expect(screen.getByTestId('home-teaser-more').textContent).toBe(MORE_RESULTS_COPY);
  });

  it('uses the exact four qualification labels', async () => {
    expect(QUALIFICATION_LABELS).toEqual({
      meets_known_criteria: 'Meets the requirements this recruiter listed',
      needs_driver_information: 'Needs a bit more from you',
      does_not_meet_known_criteria: "Doesn't match one listed requirement",
      no_structured_criteria: 'No specific requirements listed',
    });

    rpcMock.mockResolvedValue({
      data: [
        teaser({ min_years_experience: 2, required_cdl_class: 'A' }),
        teaser({ required_endorsements: ['hazmat'] }),
        teaser({ min_years_experience: 20 }),
      ],
      error: null,
    });
    render(<HomeOpportunityPreview answers={ANSWERS} />);
    await waitFor(() => expect(screen.getAllByTestId('home-teaser-card')).toHaveLength(3));

    const statuses = screen
      .getAllByTestId('home-teaser-card')
      .map((el) => el.getAttribute('data-status'));
    expect(statuses).toContain('meets_known_criteria');
    expect(statuses).toContain('needs_driver_information');
    expect(statuses).toContain('does_not_meet_known_criteria');

    const texts = screen.getAllByTestId('home-teaser-status').map((el) => el.textContent);
    expect(texts).toContain(QUALIFICATION_LABELS.meets_known_criteria);
    expect(texts).toContain(QUALIFICATION_LABELS.needs_driver_information);
    expect(texts).toContain(QUALIFICATION_LABELS.does_not_meet_known_criteria);
  });

  it('shows no_structured_criteria when the recruiter listed nothing structured', async () => {
    rpcMock.mockResolvedValue({ data: [teaser()], error: null });
    render(<HomeOpportunityPreview answers={ANSWERS} />);
    await waitFor(() => expect(screen.getByTestId('home-teaser-status')).toBeTruthy());
    expect(screen.getByTestId('home-teaser-status').textContent).toBe(
      QUALIFICATION_LABELS.no_structured_criteria,
    );
  });

  it('never hides a card that misses a listed requirement', async () => {
    rpcMock.mockResolvedValue({ data: [teaser({ min_years_experience: 25 })], error: null });
    render(<HomeOpportunityPreview answers={ANSWERS} />);
    await waitFor(() => expect(screen.getAllByTestId('home-teaser-card')).toHaveLength(1));
  });

  it('discloses additional recruiter requirements when the flag is set', async () => {
    rpcMock.mockResolvedValue({
      data: [teaser({ has_additional_requirements: true })],
      error: null,
    });
    render(<HomeOpportunityPreview answers={ANSWERS} />);
    await waitFor(() =>
      expect(screen.getByTestId('home-teaser-additional-requirements')).toBeTruthy(),
    );
    expect(screen.getByTestId('home-teaser-additional-requirements').textContent).toBe(
      ADDITIONAL_REQUIREMENTS_NOTE,
    );
  });

  it('shows only recruiter-authored pay and a neutral driver goal line', async () => {
    rpcMock.mockResolvedValue({ data: [teaser({ cpm: 62 })], error: null });
    render(<HomeOpportunityPreview answers={ANSWERS} />);
    await waitFor(() => expect(screen.getByTestId('home-teaser-goal')).toBeTruthy());
    expect(screen.getByTestId('home-teaser-goal').textContent).toBe('Your goal: $1,800/wk');
    expect(screen.getByTestId('home-teaser-preview').textContent).toContain('62 CPM');
  });
});

describe('HP-3B — failure handling', () => {
  it('shows neutral copy and does not block Continue when the RPC errors', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    render(<HomeOpportunityPreview answers={ANSWERS} />);
    await waitFor(() => expect(screen.getByTestId('home-teaser-error')).toBeTruthy());
    expect(screen.getByTestId('home-teaser-error').textContent).toBe(LOAD_FAILURE_COPY);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the Continue button enabled while listings load', () => {
    rpcMock.mockReturnValue(new Promise(() => {}));
    const flow = render(<HomeConversationFlow {...FLOW_PROPS} />);
    flow.unmount();
    expect(FLOW_SRC).toContain('onClick={() => onContinue(answers)}');
    expect(FLOW_SRC).not.toContain('disabled={');
  });
});

describe('HP-3B — source guardrails', () => {
  const sources = [PREVIEW_SRC, PRESENTATION_SRC];

  it('contains no banned user-facing claims', () => {
    const banned = [
      /\bqualified\b/i,
      /\beligible\b/i,
      /\bapproved\b/i,
      /\bhired\b/i,
      /\bguaranteed\b/i,
      /match score/i,
      /%\s*match/i,
      /we found \d+/i,
      /take-?home/i,
      /\bnet pay\b/i,
    ];
    for (const src of sources) {
      for (const pattern of banned) {
        expect(src).not.toMatch(pattern);
      }
    }
  });

  it('does not import or use pay/profit math helpers', () => {
    for (const src of sources) {
      expect(src).not.toContain('calculateOpportunityMatch');
      expect(src).not.toContain('opportunityProfit');
      expect(src).not.toContain('OpportunityQualificationPanel');
      expect(src).not.toContain('useOpportunities');
    }
  });

  it('keeps the presentation module free of network access', () => {
    expect(PRESENTATION_SRC).not.toContain('supabase/client');
    expect(PRESENTATION_SRC).not.toContain('.rpc(');
    expect(PRESENTATION_SRC).not.toContain('fetch(');
  });

  it('reuses the existing structured evaluator as-is', () => {
    expect(PREVIEW_SRC).toContain(
      "import { evaluateKnownOpportunityQualification } from '@/lib/opportunities/opportunityQualification'",
    );
  });

  it('calls the public teaser RPC and nothing else', () => {
    const calls = PREVIEW_SRC.match(/supabase\.rpc\('([^']+)'/g) ?? [];
    expect(calls.length).toBe(2);
    for (const call of calls) {
      expect(call).toContain('list_public_opportunity_teasers');
    }
  });
});
