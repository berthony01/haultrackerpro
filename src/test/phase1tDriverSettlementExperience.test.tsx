/**
 * Phase 1T-D2 — Driver Settlement MVP experience contract.
 *
 * Proves the combined milestone: relationship read service scope, the new
 * query key + hook, presentation-only current-user scoping, exact invitation
 * mutation arguments, settlement list/detail data flow, difference
 * calculation semantics, absence of raw identifiers/metadata, dashboard
 * policy + navigation integration, Index wiring, and the absence of direct
 * backend / authorization / billing logic in the new UI.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { DRIVER_ONLY_PAGES, resolveDashboardNavigation } from '@/lib/dashboardWorkspacePolicy';

/* ------------------------------------------------------------------ source - */

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

const REL_SERVICE_PATH = 'src/lib/settlements/carrierDriverRelationshipReadService.ts';
const HOOK_PATH = 'src/hooks/settlements/useSettlementData.ts';
const VIEW_PATH = 'src/components/settlements/DriverSettlementsView.tsx';
const POLICY_PATH = 'src/lib/dashboardWorkspacePolicy.ts';
const SIDEBAR_PATH = 'src/components/premium/AppSidebar.tsx';
const BOTTOMNAV_PATH = 'src/components/BottomNav.tsx';
const INDEX_PATH = 'src/pages/Index.tsx';
const TEST_PATH = 'src/test/phase1tDriverSettlementExperience.test.tsx';

const REL_SERVICE_SOURCE = read(REL_SERVICE_PATH);
const HOOK_SOURCE = read(HOOK_PATH);
const VIEW_SOURCE = read(VIEW_PATH);
const POLICY_SOURCE = read(POLICY_PATH);
const SIDEBAR_SOURCE = read(SIDEBAR_PATH);
const BOTTOMNAV_SOURCE = read(BOTTOMNAV_PATH);
const INDEX_SOURCE = read(INDEX_PATH);
const TEST_SOURCE = read(TEST_PATH);

const DOUBLE_CAST = ['as', 'unknown', 'as'].join(' ');
const LOOSE_ANY = [':', ' any'].join('');
const TS_IGNORE = ['@ts', '-ignore'].join('');
const TS_EXPECT = ['@ts', '-expect-error'].join('');
const ESLINT_DISABLE = ['eslint', '-disable'].join('');
const FOCUSED = [['it', '.only'].join(''), ['describe', '.only'].join(''), ['it', '.skip'].join('')];

/* ------------------------------------------------------------------- mocks - */

const DRIVER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DRIVER_ID = '22222222-2222-4222-8222-222222222222';
const REL_ID = '33333333-3333-4333-8333-333333333333';
const SETTLEMENT_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';

const acceptMutate = vi.fn();
const declineMutate = vi.fn();
const refetchSettlements = vi.fn();
const confirmMatchMutate = vi.fn();
const clearMatchMutate = vi.fn();
const refreshSuggestionsMutate = vi.fn();
const rejectSuggestionMutate = vi.fn();
const createImportedMutate = vi.fn();

const LOAD_ID = '66666666-6666-4666-8666-666666666666';

type QueryStub = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

const state: {
  user: { id: string } | null;
  settlements: QueryStub;
  relationships: QueryStub;
  items: QueryStub;
  matches: QueryStub;
  events: QueryStub;
  matchesArgs: unknown[];
  itemsArgs: unknown[];
  eventsArgs: unknown[];
  isPro: boolean;
  isSubscriptionLoading: boolean;
  loads: Array<{
    id: string;
    load_date: string;
    dropoff_date: string | null;
    pickup_location: string;
    dropoff_location: string;
    estimated_pay: number | null;
  }>;
  loadRangeArgs: unknown[];
} = {
  user: null,
  settlements: { data: [], isLoading: false, isError: false, refetch: refetchSettlements },
  relationships: { data: [], isLoading: false, isError: false, refetch: vi.fn() },
  items: { data: [], isLoading: false, isError: false, refetch: vi.fn() },
  matches: { data: [], isLoading: false, isError: false, refetch: vi.fn() },
  events: { data: [], isLoading: false, isError: false, refetch: vi.fn() },
  matchesArgs: [],
  itemsArgs: [],
  eventsArgs: [],
  isPro: false,
  isSubscriptionLoading: false,
  loads: [],
  loadRangeArgs: [],
};


const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: state.user }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    isPro: state.isPro,
    isLoading: state.isSubscriptionLoading,
  }),
}));

vi.mock('@/hooks/useLoads', () => ({
  useLoads: (range: unknown) => {
    state.loadRangeArgs.push(range);
    return { loads: state.loads };
  },
}));

vi.mock('@/hooks/settlements/useSettlementData', () => ({
  useVisibleSettlements: () => state.settlements,
  useVisibleCarrierDriverRelationships: () => state.relationships,
  useVisibleSettlementItems: (id: string) => {
    state.itemsArgs.push(id);
    return state.items;
  },
  useVisibleSettlementMatches: (ids: readonly string[]) => {
    state.matchesArgs.push([...ids]);
    return state.matches;
  },
  useVisibleSettlementEvents: (id: string) => {
    state.eventsArgs.push(id);
    return state.events;
  },
  useAcceptMyCarrierDriverRelationship: () => ({
    mutate: acceptMutate,
    isPending: false,
  }),
  useDeclineMyCarrierDriverRelationship: () => ({
    mutate: declineMutate,
    isPending: false,
  }),
  useConfirmSettlementLoadMatch: () => ({ mutate: confirmMatchMutate, isPending: false }),
  useClearSettlementLoadMatch: () => ({ mutate: clearMatchMutate, isPending: false }),
  useRefreshSettlementLoadMatchSuggestions: () => ({
    mutate: refreshSuggestionsMutate,
    isPending: false,
  }),
  useRejectSettlementLoadMatch: () => ({ mutate: rejectSuggestionMutate, isPending: false }),
  useCreateDriverImportedSettlementDraft: () => ({
    mutate: createImportedMutate,
    isPending: false,
  }),
}));


import {
  DriverSettlementsView,
  computeItemDifference,
  describeItemBasis,
  describeLoadOption,
  humanizeToken,
  isBlankOrFinite,
  resolvePayerLabel,
  toNullableAmount,
  toNullableText,
} from '@/components/settlements/DriverSettlementsView';


function settlementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SETTLEMENT_ID,
    driver_user_id: DRIVER_ID,
    status: 'finalized',
    source: 'carrier_issued',
    period_start: '2026-07-01',
    period_end: '2026-07-07',
    pay_date: '2026-07-12',
    reported_gross_amount: 5200,
    reported_net_amount: 4100.5,
    payer_name_snapshot: null,
    source_display_name_snapshot: 'Blue Ridge Carriers',
    statement_reference: 'STMT-4412',
    notes: null,
    version_number: 2,
    ...overrides,
  };
}

function loadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LOAD_ID,
    load_date: '2026-07-02',
    dropoff_date: '2026-07-03',
    pickup_location: 'Dallas, TX',
    dropoff_location: 'Atlanta, GA',
    estimated_pay: 1850,
    ...overrides,
  };
}

/** Opens the settlement detail view for the single seeded settlement. */
function openDetail() {
  render(<DriverSettlementsView />);
  fireEvent.click(screen.getByTestId('settlement-card'));
}


beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: DRIVER_ID };
  state.settlements = { data: [], isLoading: false, isError: false, refetch: refetchSettlements };
  state.relationships = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  state.items = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  state.matches = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  state.events = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  state.matchesArgs = [];
  state.itemsArgs = [];
  state.eventsArgs = [];
  state.isPro = false;
  state.isSubscriptionLoading = false;
  state.loads = [];
  state.loadRangeArgs = [];
});


/* ----------------------------------------------------------------------- A - */

describe('A. carrier↔driver relationship read service scope', () => {
  it('exports the generated row type and exactly one read function', () => {
    expect(REL_SERVICE_SOURCE).toContain(
      "Database['public']['Tables']['carrier_driver_relationships']['Row']",
    );
    expect(REL_SERVICE_SOURCE).toContain(
      'export async function listVisibleCarrierDriverRelationships()',
    );
    expect([...REL_SERVICE_SOURCE.matchAll(/export async function/g)]).toHaveLength(1);
  });

  it('reads exactly one table, select *, ordered invited_at DESC', () => {
    expect([...REL_SERVICE_SOURCE.matchAll(/\.from\(/g)]).toHaveLength(1);
    expect(REL_SERVICE_SOURCE).toContain(".from('carrier_driver_relationships')");
    expect(REL_SERVICE_SOURCE).toContain(".select('*')");
    expect(REL_SERVICE_SOURCE).toContain(".order('invited_at', { ascending: false })");
  });

  it('never joins recruiter profiles and never writes, retries or pre-authorizes', () => {
    for (const banned of [
      'recruiter_profiles',
      'agency_profiles',
      '.insert(',
      '.update(',
      '.delete(',
      '.upsert(',
      '.rpc(',
      'retry',
      'getUser',
      'getSession',
      'isPro',
      'entitle',
      'hasRole',
    ]) {
      expect(REL_SERVICE_SOURCE).not.toContain(banned);
    }
  });

  it('re-throws client errors unchanged', () => {
    expect(REL_SERVICE_SOURCE).toContain('if (error) throw error;');
  });
});

/* ----------------------------------------------------------------------- B - */

describe('B. React Query extension preserves the accepted D1 contract', () => {
  it('imports the new read service and exposes the list key + hook', () => {
    expect(HOOK_SOURCE).toContain(
      "from '@/lib/settlements/carrierDriverRelationshipReadService'",
    );
    expect(HOOK_SOURCE).toContain("all: ['carrier-driver-relationships'] as const");
    expect(HOOK_SOURCE).toContain(
      "list: () => ['carrier-driver-relationships', 'list'] as const",
    );
    expect(HOOK_SOURCE).toContain('export function useVisibleCarrierDriverRelationships()');
    expect(HOOK_SOURCE).toContain('carrierDriverRelationshipQueryKeys.list()');
  });

  it('keeps all 5 settlement reads, 14 settlement mutations and 4 relationship mutations', () => {
    for (const name of [
      'useVisibleSettlements',
      'useVisibleSettlementHeader',
      'useVisibleSettlementItems',
      'useVisibleSettlementMatches',
      'useVisibleSettlementEvents',
      'useCreateDriverImportedSettlementDraft',
      'useCreateCarrierSettlementDraft',
      'useCreateAgencySettlementDraft',
      'useUpdateSettlementDraftHeader',
      'useAddSettlementDraftItem',
      'useUpdateSettlementDraftItem',
      'useDeleteSettlementDraftItem',
      'useConfirmSettlementLoadMatch',
      'useClearSettlementLoadMatch',
      'useRefreshSettlementLoadMatchSuggestions',
      'useRejectSettlementLoadMatch',
      'useFinalizeSettlementDraft',
      'useVoidFinalizedSettlement',
      'useCreateSettlementCorrectionDraft',
      'useInviteCarrierDriverRelationship',
      'useAcceptMyCarrierDriverRelationship',
      'useDeclineMyCarrierDriverRelationship',
      'useEndCarrierDriverRelationship',
    ]) {
      expect(HOOK_SOURCE).toContain(`export function ${name}(`);
    }
  });

  it('preserves both invalidation rules exactly', () => {
    expect(HOOK_SOURCE).toContain(
      'queryClient.invalidateQueries({ queryKey: settlementQueryKeys.all })',
    );
    expect(HOOK_SOURCE).toContain('carrierDriverRelationshipQueryKeys.all');
  });

  it('still performs no backend access of its own', () => {
    expect(HOOK_SOURCE).not.toContain('integrations/supabase');
    expect(HOOK_SOURCE).not.toContain('.from(');
    expect(HOOK_SOURCE).not.toContain('.rpc(');
  });
});

/* ----------------------------------------------------------------------- C - */

describe('C. presentation scoping to the current user', () => {
  it('hides settlements belonging to another driver', () => {
    state.settlements = {
      data: [settlementRow(), settlementRow({ id: 'other', driver_user_id: OTHER_DRIVER_ID })],
      isLoading: false,
      isError: false,
      refetch: refetchSettlements,
    };
    render(<DriverSettlementsView />);
    expect(screen.getAllByTestId('settlement-card')).toHaveLength(1);
  });

  it('renders no settlements and no invites when there is no current user', () => {
    state.user = null;
    state.settlements = {
      data: [settlementRow()],
      isLoading: false,
      isError: false,
      refetch: refetchSettlements,
    };
    state.relationships = {
      data: [{ id: REL_ID, driver_user_id: DRIVER_ID, status: 'pending', invited_at: '2026-07-01T00:00:00Z' }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<DriverSettlementsView />);
    expect(screen.queryByTestId('settlement-card')).toBeNull();
    expect(screen.queryByTestId('pending-invitations')).toBeNull();
  });

  it('shows only pending invitations addressed to the current driver', () => {
    state.relationships = {
      data: [
        { id: REL_ID, driver_user_id: DRIVER_ID, status: 'pending', invited_at: '2026-07-01T00:00:00Z' },
        { id: 'x', driver_user_id: DRIVER_ID, status: 'active', invited_at: '2026-07-01T00:00:00Z' },
        { id: 'y', driver_user_id: OTHER_DRIVER_ID, status: 'pending', invited_at: '2026-07-01T00:00:00Z' },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<DriverSettlementsView />);
    expect(screen.getAllByTestId('pending-invite-row')).toHaveLength(1);
  });
});

/* ----------------------------------------------------------------------- D - */

describe('D. invitation response uses the exact accepted mutation arguments', () => {
  beforeEach(() => {
    state.relationships = {
      data: [{ id: REL_ID, driver_user_id: DRIVER_ID, status: 'pending', invited_at: '2026-07-01T00:00:00Z' }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  });

  it('accept passes { _relationship_id } and toasts success', async () => {
    render(<DriverSettlementsView />);
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    expect(acceptMutate).toHaveBeenCalledTimes(1);
    expect(acceptMutate.mock.calls[0][0]).toEqual({ _relationship_id: REL_ID });
    acceptMutate.mock.calls[0][1].onSuccess();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('decline passes { _relationship_id } and surfaces errors', async () => {
    render(<DriverSettlementsView />);
    fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    expect(declineMutate).toHaveBeenCalledTimes(1);
    expect(declineMutate.mock.calls[0][0]).toEqual({ _relationship_id: REL_ID });
    declineMutate.mock.calls[0][1].onError(new Error('denied'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('still exposes no company-side issuance or line-item authoring actions', () => {
    render(<DriverSettlementsView />);
    for (const label of [/finalize/i, /void/i, /correction/i, /new settlement/i, /add line/i]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    for (const banned of [
      'useFinalizeSettlementDraft',
      'useVoidFinalizedSettlement',
      'useCreateSettlementCorrectionDraft',
      'useAddSettlementDraftItem',
      'useUpdateSettlementDraftItem',
      'useDeleteSettlementDraftItem',
      'useUpdateSettlementDraftHeader',
      'useCreateCarrierSettlementDraft',
      'useCreateAgencySettlementDraft',
    ]) {
      expect(VIEW_SOURCE).not.toContain(banned);
    }
  });

});

/* ----------------------------------------------------------------------- E - */

describe('E. settlement history list states and content', () => {
  it('renders the loading state', () => {
    state.settlements = { data: undefined, isLoading: true, isError: false, refetch: refetchSettlements };
    render(<DriverSettlementsView />);
    expect(screen.getByTestId('settlements-loading')).toBeTruthy();
  });

  it('renders the error state with a retry that calls refetch', () => {
    state.settlements = { data: undefined, isLoading: false, isError: true, refetch: refetchSettlements };
    render(<DriverSettlementsView />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetchSettlements).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state', () => {
    render(<DriverSettlementsView />);
    expect(screen.getByTestId('settlements-empty')).toBeTruthy();
  });

  it('renders payer snapshot, period, pay date, amounts, status, version and reference', () => {
    state.settlements = {
      data: [settlementRow()],
      isLoading: false,
      isError: false,
      refetch: refetchSettlements,
    };
    render(<DriverSettlementsView />);
    const card = screen.getByTestId('settlement-card');
    expect(card.textContent).toContain('Blue Ridge Carriers');
    expect(card.textContent).toContain('Finalized');
    expect(card.textContent).toContain('Version 2');
    expect(card.textContent).toContain('STMT-4412');
    expect(card.textContent).toContain('$4,100.50');
    expect(card.textContent).toContain('$5,200.00');
    expect(card.textContent).toContain('07/01/2026');
  });

  it('resolvePayerLabel honours snapshot precedence then a source-specific safe fallback', () => {
    expect(resolvePayerLabel('Display Co', 'Payer Co', 'carrier_issued')).toBe('Display Co');
    expect(resolvePayerLabel('   ', 'Payer Co', 'carrier_issued')).toBe('Payer Co');
    expect(resolvePayerLabel(null, 'Fallback Payer', 'agency_prepared')).toBe('Fallback Payer');
    expect(resolvePayerLabel(null, null, 'carrier_issued')).toBe('Carrier statement');
    expect(resolvePayerLabel(null, null, 'agency_prepared')).toBe('Agency-prepared statement');
    expect(resolvePayerLabel(null, null, 'driver_imported')).toBe('Driver-imported statement');
    expect(resolvePayerLabel(null, null, 'something_else')).toBe('Settlement statement');
    expect(resolvePayerLabel(null, null, null)).toBe('Settlement statement');
    expect(resolvePayerLabel(null, null, undefined)).toBe('Settlement statement');
    expect(resolvePayerLabel(null, null, SETTLEMENT_ID)).toBe('Settlement statement');
  });

  it.each([
    ['carrier_issued', 'Carrier statement'],
    ['agency_prepared', 'Agency-prepared statement'],
    ['driver_imported', 'Driver-imported statement'],
    ['mystery_source', 'Settlement statement'],
  ])('list card uses the safe %s fallback when both snapshots are absent', (source, label) => {
    state.settlements = {
      data: [
        settlementRow({
          source,
          source_display_name_snapshot: null,
          payer_name_snapshot: null,
          version_number: 1,
        }),
      ],
      isLoading: false,
      isError: false,
      refetch: refetchSettlements,
    };
    render(<DriverSettlementsView />);
    const card = screen.getByTestId('settlement-card');
    expect(card.textContent).toContain(label);
    expect(card.textContent).not.toContain('Unnamed payer');
    expect(card.textContent).not.toContain('Version 1');
  });


  it('states the recordkeeping / reconciliation boundary', () => {
    render(<DriverSettlementsView />);
    expect(screen.getByTestId('driver-settlements-view').textContent).toMatch(
      /recordkeeping and reconciliation/i,
    );
  });
});

/* --------------------------------------------------------------------- F/G - */

describe('F. detail mounts only after selection and reads with exact ids', () => {
  beforeEach(() => {
    state.settlements = {
      data: [settlementRow()],
      isLoading: false,
      isError: false,
      refetch: refetchSettlements,
    };
    state.items = {
      data: [
        {
          id: ITEM_ID,
          settlement_id: SETTLEMENT_ID,
          item_type: 'line_haul',
          category: null,
          description: 'Line haul — Dallas to Memphis',
          amount: 1800,
          expected_amount_snapshot: 1950,
          load_reference_snapshot: 'LD-9001',
          origin_snapshot: 'Dallas, TX',
          destination_snapshot: 'Memphis, TN',
        },
        {
          id: 'item-2',
          settlement_id: SETTLEMENT_ID,
          item_type: 'fuel_surcharge',
          category: null,
          description: null,
          amount: 220,
          expected_amount_snapshot: null,
          load_reference_snapshot: null,
          origin_snapshot: null,
          destination_snapshot: null,
        },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    state.matches = {
      data: [
        {
          id: 'match-1',
          settlement_item_id: ITEM_ID,
          driver_load_id: 'load-1',
          match_state: 'confirmed',
          confidence: 0.92,
        },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    state.events = {
      data: [
        { id: 'ev-1', settlement_id: SETTLEMENT_ID, event_type: 'settlement_finalized', created_at: '2026-07-12T15:04:00Z', actor_user_id: OTHER_DRIVER_ID, metadata: { secret: 'x' } },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  });

  it('does not mount detail queries before a settlement is selected', () => {
    render(<DriverSettlementsView />);
    expect(screen.queryByTestId('settlement-detail')).toBeNull();
    expect(state.itemsArgs).toHaveLength(0);
    expect(state.eventsArgs).toHaveLength(0);
    expect(state.matchesArgs).toHaveLength(0);
  });

  it('after selection reads items/events by settlement id and matches by item ids', () => {
    render(<DriverSettlementsView />);
    fireEvent.click(screen.getByTestId('settlement-card'));
    expect(screen.getByTestId('settlement-detail')).toBeTruthy();
    expect(new Set(state.itemsArgs)).toEqual(new Set([SETTLEMENT_ID]));
    expect(new Set(state.eventsArgs)).toEqual(new Set([SETTLEMENT_ID]));
    expect(state.matchesArgs.at(-1)).toEqual([ITEM_ID, 'item-2']);
  });

  it('renders readable item details and read-only match state/confidence', () => {
    render(<DriverSettlementsView />);
    fireEvent.click(screen.getByTestId('settlement-card'));
    const rows = screen.getAllByTestId('settlement-item-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Line haul — Dallas to Memphis');
    expect(rows[0].textContent).toContain('LD-9001');
    expect(rows[1].textContent).toContain('Fuel surcharge');
    const chip = screen.getByTestId('settlement-match-chip');
    expect(chip.textContent).toContain('Confirmed');
    expect(chip.textContent).toContain('92%');
    expect(chip.tagName).not.toBe('BUTTON');
  });

  it('humanizes events chronologically without actor ids or raw metadata', () => {
    render(<DriverSettlementsView />);
    fireEvent.click(screen.getByTestId('settlement-card'));
    const ev = screen.getByTestId('settlement-event-row');
    expect(ev.textContent).toContain('Settlement finalized');
    expect(ev.textContent).not.toContain(OTHER_DRIVER_ID);
    expect(ev.textContent).not.toContain('secret');
  });
});

describe('G. difference is derived only from a non-null expected snapshot', () => {
  it('computeItemDifference semantics', () => {
    expect(computeItemDifference(1800, 1950)).toBe(-150);
    expect(computeItemDifference(2000, 1950)).toBe(50);
    expect(computeItemDifference(1800, null)).toBeNull();
    expect(computeItemDifference(1800, undefined)).toBeNull();
    expect(computeItemDifference(null, 1950)).toBeNull();
    expect(computeItemDifference(Number.NaN, 1950)).toBeNull();
  });

  it('humanizeToken never leaks raw snake_case', () => {
    expect(humanizeToken('settlement_finalized')).toBe('Settlement finalized');
    expect(humanizeToken(null)).toBe('Update');
  });

  it('renders Difference only for the line carrying an expected snapshot', () => {
    state.settlements = { data: [settlementRow()], isLoading: false, isError: false, refetch: refetchSettlements };
    state.items = {
      data: [
        { id: ITEM_ID, settlement_id: SETTLEMENT_ID, item_type: 'line_haul', category: null, description: 'A', amount: 1800, expected_amount_snapshot: 1950, load_reference_snapshot: null, origin_snapshot: null, destination_snapshot: null },
        { id: 'item-2', settlement_id: SETTLEMENT_ID, item_type: 'detention', category: null, description: 'B', amount: 100, expected_amount_snapshot: null, load_reference_snapshot: null, origin_snapshot: null, destination_snapshot: null },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<DriverSettlementsView />);
    fireEvent.click(screen.getByTestId('settlement-card'));
    const diffs = screen.getAllByTestId('settlement-item-difference');
    expect(diffs).toHaveLength(1);
    expect(diffs[0].textContent).toContain('-$150.00');
  });
});

/* ----------------------------------------------------------------------- H - */

describe('H. no raw identifiers are rendered', () => {
  it('never prints uuids anywhere in the rendered surface', () => {
    state.settlements = { data: [settlementRow()], isLoading: false, isError: false, refetch: refetchSettlements };
    state.relationships = {
      data: [{ id: REL_ID, driver_user_id: DRIVER_ID, status: 'pending', invited_at: '2026-07-01T00:00:00Z' }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    const { container } = render(<DriverSettlementsView />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  it('uses privacy-safe generic invitation copy without recruiter profile lookups', () => {
    state.relationships = {
      data: [{ id: REL_ID, driver_user_id: DRIVER_ID, status: 'pending', invited_at: '2026-07-01T00:00:00Z' }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<DriverSettlementsView />);
    expect(screen.getByTestId('pending-invitations').textContent).toMatch(
      /carrier or recruiter has asked to share settlement statements/i,
    );
    expect(VIEW_SOURCE).not.toContain('recruiter_profiles');
    expect(VIEW_SOURCE).not.toContain('recruiter_id');
  });
});

/* --------------------------------------------------------------------- I/J - */

describe('I. dashboard workspace policy adds only settlements', () => {
  it('settlements is a driver-only page', () => {
    expect(DRIVER_ONLY_PAGES.has('settlements')).toBe(true);
    expect([...POLICY_SOURCE.matchAll(/'settlements'/g)]).toHaveLength(1);
  });

  it('driver workspace preserves the settlements page', () => {
    expect(
      resolveDashboardNavigation({
        requestedPage: 'settlements',
        effectiveWorkspace: 'driver',
        recruiterCapabilityStatus: null,
        recruiterHubAllowed: false,
        recruiterOperationsAllowed: false,
      }),
    ).toEqual({ page: 'settlements', recruiterSubview: null, unresolved: false });
  });

  it('recruiter workspace collapses settlements to the recruiter hub', () => {
    expect(
      resolveDashboardNavigation({
        requestedPage: 'settlements',
        effectiveWorkspace: 'recruiter',
        recruiterCapabilityStatus: 'active',
        recruiterHubAllowed: true,
        recruiterOperationsAllowed: true,
      }),
    ).toEqual({ page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false });
  });

  it('an unresolved workspace never authorizes settlements', () => {
    expect(
      resolveDashboardNavigation({
        requestedPage: 'settlements',
        effectiveWorkspace: null,
        recruiterCapabilityStatus: null,
        recruiterHubAllowed: false,
        recruiterOperationsAllowed: false,
      }).unresolved,
    ).toBe(true);
  });
});

describe('J. navigation surfaces expose settlements to drivers only', () => {
  it('AppSidebar lists Settlements in driverItems only', () => {
    const driverBlock = SIDEBAR_SOURCE.slice(
      SIDEBAR_SOURCE.indexOf('const driverItems'),
      SIDEBAR_SOURCE.indexOf('const recruiterActiveItems'),
    );
    expect(driverBlock).toContain("id: 'settlements', label: 'Settlements'");
    const recruiterBlock = SIDEBAR_SOURCE.slice(
      SIDEBAR_SOURCE.indexOf('const recruiterActiveItems'),
      SIDEBAR_SOURCE.indexOf('export function AppSidebar'),
    );
    expect(recruiterBlock).not.toContain('settlements');
  });

  it('BottomNav keeps five fixed driver buttons and adds Settlements only to the full driver More sheet', () => {
    const driverNavBlock = BOTTOMNAV_SOURCE.slice(
      BOTTOMNAV_SOURCE.indexOf('const driverNav = ['),
      BOTTOMNAV_SOURCE.indexOf('const recruiterActiveNav'),
    );
    expect([...driverNavBlock.matchAll(/\{ id: '/g)]).toHaveLength(5);
    expect(driverNavBlock).not.toContain('settlements');

    const fullMore = BOTTOMNAV_SOURCE.slice(
      BOTTOMNAV_SOURCE.indexOf('const driverMoreItemsFull'),
      BOTTOMNAV_SOURCE.indexOf('const driverMoreItemsAssistant'),
    );
    expect(fullMore).toContain("go('settlements')");

    const assistantMore = BOTTOMNAV_SOURCE.slice(
      BOTTOMNAV_SOURCE.indexOf('const driverMoreItemsAssistant'),
      BOTTOMNAV_SOURCE.indexOf('const recruiterActiveMoreItems'),
    );
    expect(assistantMore).not.toContain('settlements');

    const recruiterMore = BOTTOMNAV_SOURCE.slice(
      BOTTOMNAV_SOURCE.indexOf('const recruiterActiveMoreItems'),
      BOTTOMNAV_SOURCE.indexOf('let moreItems'),
    );
    expect(recruiterMore).not.toContain('settlements');
  });
});

/* --------------------------------------------------------------------- K/L - */

describe('K. Index integration', () => {
  it('lazy-imports the view, adds a subtitle and renders it for the driver page only', () => {
    expect(INDEX_SOURCE).toContain(
      "lazy(() => import('@/components/settlements/DriverSettlementsView')",
    );
    expect(INDEX_SOURCE).toContain("settlements: 'Reconcile carrier settlement statements'");
    expect(INDEX_SOURCE).toContain("{page === 'settlements' && !isRecruiterView && (");
  });

  it('adds no router route for settlements', () => {
    const appSource = read('src/App.tsx');
    expect(appSource).not.toContain('settlements');
  });
});

describe('L. the new UI performs no backend, authorization, or billing logic', () => {
  it('never imports the backend client or touches tables/RPCs', () => {
    for (const banned of [
      'integrations/supabase',
      '.from(',
      '.rpc(',
      'localStorage',
      'sessionStorage',
    ]) {
      expect(VIEW_SOURCE).not.toContain(banned);
    }
    expect(VIEW_SOURCE).not.toMatch(/(^|[^A-Za-z])fetch\(/);
  });

  it('contains no entitlement, role or billing logic beyond presentation-only Pro gating', () => {
    for (const banned of [
      'entitle',
      'capabilit',
      'hasRole',
      'stripe',
      'checkout',
      'plan_key',
      'admin',
    ]) {
      expect(VIEW_SOURCE.toLowerCase()).not.toContain(banned.toLowerCase());
    }
    // Pro visibility is derived only from the shared subscription hook and is
    // never used to decide authorization — the RPC layer stays authoritative.
    expect([...VIEW_SOURCE.matchAll(/useSubscription\(/g)]).toHaveLength(1);
    expect(VIEW_SOURCE).toContain('Presentation gating only');
  });


  it('reads and mutates exclusively through the accepted hook layer', () => {
    const imports = [...VIEW_SOURCE.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toContain('@/hooks/settlements/useSettlementData');
    expect(imports).toContain('@/hooks/useAuth');
    expect(imports.filter((i) => i.startsWith('@/lib/settlements'))).toHaveLength(0);
  });
});

/* ----------------------------------------------------------------------- N - */

describe('N. new and modified files avoid prohibited escapes', () => {
  it.each([
    ['relationship read service', REL_SERVICE_SOURCE],
    ['hook', HOOK_SOURCE],
    ['view', VIEW_SOURCE],
    ['test', TEST_SOURCE],
  ])('%s has no type escapes or focused/skipped tests', (_label, source) => {
    expect(source).not.toContain(DOUBLE_CAST);
    expect(source).not.toContain(LOOSE_ANY);
    expect(source).not.toContain(TS_IGNORE);
    expect(source).not.toContain(TS_EXPECT);
    expect(source).not.toContain(ESLINT_DISABLE);
    for (const marker of FOCUSED) {
      expect(source).not.toContain(marker);
    }
  });
});

/* ----------------------------------------------------------------------- O - */

describe('O. selected settlement detail renders the full statement summary', () => {
  beforeEach(() => {
    state.settlements = {
      data: [
        settlementRow({
          notes: 'Detention approved by dispatch on 07/09.',
          statement_reference: 'STMT-4412',
        }),
      ],
      isLoading: false,
      isError: false,
      refetch: refetchSettlements,
    };
  });

  it('shows payer, status, period, pay date, net, gross, version, reference and notes', () => {
    render(<DriverSettlementsView />);
    fireEvent.click(screen.getByTestId('settlement-card'));
    const summary = screen.getByTestId('settlement-detail-summary');
    expect(summary.textContent).toContain('Blue Ridge Carriers');
    expect(summary.textContent).toContain('Finalized');
    expect(summary.textContent).toContain('07/01/2026');
    expect(summary.textContent).toContain('07/07/2026');
    expect(summary.textContent).toContain('07/12/2026');
    expect(summary.textContent).toContain('$4,100.50');
    expect(summary.textContent).toContain('$5,200.00');
    expect(summary.textContent).toContain('Version 2');
    expect(summary.textContent).toContain('STMT-4412');
    expect(summary.textContent).toContain('Detention approved by dispatch on 07/09.');
  });

  it('uses the safe source fallback in the summary when both snapshots are absent', () => {
    state.settlements = {
      data: [
        settlementRow({
          source: 'driver_imported',
          source_display_name_snapshot: null,
          payer_name_snapshot: null,
          version_number: 1,
          notes: null,
        }),
      ],
      isLoading: false,
      isError: false,
      refetch: refetchSettlements,
    };
    render(<DriverSettlementsView />);
    fireEvent.click(screen.getByTestId('settlement-card'));
    const summary = screen.getByTestId('settlement-detail-summary');
    expect(summary.textContent).toContain('Driver-imported statement');
    expect(summary.textContent).not.toContain('Unnamed payer');
    expect(summary.textContent).not.toContain('Version 1');
  });

  it('never mounts the summary or detail queries before selection', () => {
    render(<DriverSettlementsView />);
    expect(screen.queryByTestId('settlement-detail-summary')).toBeNull();
    expect(state.itemsArgs).toHaveLength(0);
    expect(state.eventsArgs).toHaveLength(0);
    expect(state.matchesArgs).toHaveLength(0);
  });

  it('renders no raw identifiers in the detail surface', () => {
    state.events = {
      data: [
        {
          id: 'ev-1',
          settlement_id: SETTLEMENT_ID,
          event_type: 'settlement_finalized',
          created_at: '2026-07-12T15:04:00Z',
          actor_user_id: OTHER_DRIVER_ID,
          metadata: { secret: 'x' },
        },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    const { container } = render(<DriverSettlementsView />);
    fireEvent.click(screen.getByTestId('settlement-card'));
    const text = container.textContent ?? '';
    expect(text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(text).not.toContain('secret');
  });
});

/* ----------------------------------------------------------------------- P - */

describe('P. statement line pay-basis details', () => {
  it('describeItemBasis composes quantity/unit, rate and pay method only when present', () => {
    expect(
      describeItemBasis({ quantity: 2.5, unit_label: 'miles', rate: 0.7, pay_method: 'per_mile' }),
    ).toBe('2.5 miles · Rate $0.70 · Per mile');
    expect(describeItemBasis({ quantity: 3, unit_label: null, rate: null, pay_method: null })).toBe(
      '3',
    );
    expect(describeItemBasis({ quantity: null, unit_label: null, rate: 125, pay_method: null })).toBe(
      'Rate $125.00',
    );
    expect(
      describeItemBasis({ quantity: null, unit_label: null, rate: null, pay_method: 'flat_rate' }),
    ).toBe('Flat rate');
    expect(
      describeItemBasis({ quantity: null, unit_label: null, rate: null, pay_method: null }),
    ).toBeNull();
    expect(describeItemBasis({})).toBeNull();
  });

  it('renders the basis row for lines that carry pay-basis values and omits it otherwise', () => {
    state.settlements = {
      data: [settlementRow()],
      isLoading: false,
      isError: false,
      refetch: refetchSettlements,
    };
    state.items = {
      data: [
        {
          id: ITEM_ID,
          settlement_id: SETTLEMENT_ID,
          item_type: 'line_haul',
          category: null,
          description: 'Line haul',
          amount: 1800,
          expected_amount_snapshot: 1950,
          load_reference_snapshot: null,
          origin_snapshot: null,
          destination_snapshot: null,
          quantity: 2.5,
          rate: 0.7,
          unit_label: 'miles',
          pay_method: 'per_mile',
        },
        {
          id: 'item-2',
          settlement_id: SETTLEMENT_ID,
          item_type: 'detention',
          category: null,
          description: 'Detention',
          amount: 100,
          expected_amount_snapshot: null,
          load_reference_snapshot: null,
          origin_snapshot: null,
          destination_snapshot: null,
          quantity: null,
          rate: null,
          unit_label: null,
          pay_method: null,
        },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<DriverSettlementsView />);
    fireEvent.click(screen.getByTestId('settlement-card'));
    const bases = screen.getAllByTestId('settlement-item-basis');
    expect(bases).toHaveLength(1);
    expect(bases[0].textContent).toContain('2.5 miles');
    expect(bases[0].textContent).toContain('Rate $0.70');
    expect(bases[0].textContent).toContain('Per mile');

    const diffs = screen.getAllByTestId('settlement-item-difference');
    expect(diffs).toHaveLength(1);
  });
});
