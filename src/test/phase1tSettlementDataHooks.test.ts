/**
 * Phase 1T-D1 — contract proofs for the settlement React Query orchestration
 * layer. Service modules are mocked; no network, database, or backend client is
 * involved.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { QueryClient, QueryClientProvider, type UseMutationResult } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/settlements/settlementReadService', () => ({
  listVisibleSettlements: vi.fn(),
  getVisibleSettlementHeader: vi.fn(),
  listVisibleSettlementItems: vi.fn(),
  listVisibleSettlementMatches: vi.fn(),
  listVisibleSettlementEvents: vi.fn(),
}));

vi.mock('@/lib/settlements/settlementService', () => ({
  createDriverImportedSettlementDraft: vi.fn(),
  createCarrierSettlementDraft: vi.fn(),
  createAgencySettlementDraft: vi.fn(),
  updateSettlementDraftHeader: vi.fn(),
  addSettlementDraftItem: vi.fn(),
  updateSettlementDraftItem: vi.fn(),
  deleteSettlementDraftItem: vi.fn(),
  confirmSettlementLoadMatch: vi.fn(),
  clearSettlementLoadMatch: vi.fn(),
  refreshSettlementLoadMatchSuggestions: vi.fn(),
  rejectSettlementLoadMatch: vi.fn(),
  finalizeSettlementDraft: vi.fn(),
  voidFinalizedSettlement: vi.fn(),
  createSettlementCorrectionDraft: vi.fn(),
}));

vi.mock('@/lib/settlements/carrierDriverRelationshipService', () => ({
  inviteCarrierDriverRelationship: vi.fn(),
  acceptMyCarrierDriverRelationship: vi.fn(),
  declineMyCarrierDriverRelationship: vi.fn(),
  endCarrierDriverRelationship: vi.fn(),
}));

import * as readService from '@/lib/settlements/settlementReadService';
import * as settlementService from '@/lib/settlements/settlementService';
import * as relationshipService from '@/lib/settlements/carrierDriverRelationshipService';
import * as hooks from '@/hooks/settlements/useSettlementData';

const HOOK_PATH = resolve(process.cwd(), 'src/hooks/settlements/useSettlementData.ts');
const TEST_PATH = resolve(process.cwd(), 'src/test/phase1tSettlementDataHooks.test.ts');
const HOOK_SOURCE = readFileSync(HOOK_PATH, 'utf8');
const TEST_SOURCE = readFileSync(TEST_PATH, 'utf8');

const DOUBLE_CAST = ['as', 'unknown', 'as'].join(' ');
const LOOSE_ANY = [':', ' ', 'any'].join('');
const TS_IGNORE = ['@ts', '-', 'ignore'].join('');
const TS_EXPECT = ['@ts', '-', 'expect-error'].join('');
const ESLINT_DISABLE = ['eslint', '-', 'disable'].join('');
const FOCUSED = ['it', 'describe'].flatMap((fn) =>
  ['only', 'skip'].map((mod) => [fn, mod].join('.')),
);

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

async function exerciseMutation<TData, TArgs>(
  client: QueryClient,
  useHook: () => UseMutationResult<TData, Error, TArgs, unknown>,
  args: TArgs,
): Promise<{ result: TData | undefined; error: unknown }> {
  const { result } = renderHook(() => useHook(), { wrapper: wrapperFor(client) });
  let data: TData | undefined;
  let error: unknown;
  try {
    data = await result.current.mutateAsync(args);
  } catch (caught) {
    error = caught;
  }
  return { result: data, error };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* -------------------------------------------------------------------- A ---- */

describe('A. query key roots', () => {
  it('locks the settlement root key', () => {
    expect(hooks.settlementQueryKeys.all).toEqual(['settlements']);
  });

  it('locks the carrier<->driver relationship root key', () => {
    expect(hooks.carrierDriverRelationshipQueryKeys.all).toEqual([
      'carrier-driver-relationships',
    ]);
  });
});

/* -------------------------------------------------------------------- B ---- */

describe('B. read hooks', () => {
  it('useVisibleSettlements calls listVisibleSettlements', async () => {
    const client = makeClient();
    vi.mocked(readService.listVisibleSettlements).mockResolvedValue([]);
    renderHook(() => hooks.useVisibleSettlements(), { wrapper: wrapperFor(client) });
    await waitFor(() =>
      expect(readService.listVisibleSettlements).toHaveBeenCalledTimes(1),
    );
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toEqual([['settlements', 'list']]);
  });

  it('useVisibleSettlementHeader passes the exact id and keys on it', async () => {
    const client = makeClient();
    vi.mocked(readService.getVisibleSettlementHeader).mockResolvedValue(null);
    renderHook(() => hooks.useVisibleSettlementHeader('settlement-1'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(readService.getVisibleSettlementHeader).toHaveBeenCalledWith('settlement-1'),
    );
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toEqual([['settlements', 'header', 'settlement-1']]);
  });

  it('useVisibleSettlementItems passes the exact id and keys on it', async () => {
    const client = makeClient();
    vi.mocked(readService.listVisibleSettlementItems).mockResolvedValue([]);
    renderHook(() => hooks.useVisibleSettlementItems('settlement-2'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(readService.listVisibleSettlementItems).toHaveBeenCalledWith('settlement-2'),
    );
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toEqual([['settlements', 'items', 'settlement-2']]);
  });

  it('useVisibleSettlementMatches passes the exact item ids and keys on them', async () => {
    const client = makeClient();
    vi.mocked(readService.listVisibleSettlementMatches).mockResolvedValue([]);
    renderHook(() => hooks.useVisibleSettlementMatches(['item-a', 'item-b']), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(readService.listVisibleSettlementMatches).toHaveBeenCalledWith([
        'item-a',
        'item-b',
      ]),
    );
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toEqual([['settlements', 'matches', ['item-a', 'item-b']]]);
  });

  it('useVisibleSettlementEvents passes the exact id and keys on it', async () => {
    const client = makeClient();
    vi.mocked(readService.listVisibleSettlementEvents).mockResolvedValue([]);
    renderHook(() => hooks.useVisibleSettlementEvents('settlement-3'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(readService.listVisibleSettlementEvents).toHaveBeenCalledWith('settlement-3'),
    );
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toEqual([['settlements', 'events', 'settlement-3']]);
  });
});

/* ----------------------------------------------------------------- C / D --- */

const settlementCases: ReadonlyArray<{
  name: string;
  run: (client: QueryClient) => Promise<unknown>;
  spy: () => unknown;
  args: unknown;
}> = [
  {
    name: 'useCreateDriverImportedSettlementDraft',
    args: {
      _driver_user_id: 'driver-1',
      _period_start: '2026-08-01',
      _period_end: '2026-08-07',
    },
    spy: () => settlementService.createDriverImportedSettlementDraft,
    run: (client) =>
      exerciseMutation(client, hooks.useCreateDriverImportedSettlementDraft, {
        _driver_user_id: 'driver-1',
        _period_start: '2026-08-01',
        _period_end: '2026-08-07',
      }),
  },
  {
    name: 'useCreateCarrierSettlementDraft',
    args: {
      _driver_user_id: 'driver-1',
      _recruiter_id: 'recruiter-1',
      _relationship_id: 'rel-1',
      _period_start: '2026-08-01',
      _period_end: '2026-08-07',
    },
    spy: () => settlementService.createCarrierSettlementDraft,
    run: (client) =>
      exerciseMutation(client, hooks.useCreateCarrierSettlementDraft, {
        _driver_user_id: 'driver-1',
        _recruiter_id: 'recruiter-1',
        _relationship_id: 'rel-1',
        _period_start: '2026-08-01',
        _period_end: '2026-08-07',
      }),
  },
  {
    name: 'useCreateAgencySettlementDraft',
    args: {
      _agency_id: 'agency-1',
      _driver_user_id: 'driver-1',
      _period_start: '2026-08-01',
      _period_end: '2026-08-07',
    },
    spy: () => settlementService.createAgencySettlementDraft,
    run: (client) =>
      exerciseMutation(client, hooks.useCreateAgencySettlementDraft, {
        _agency_id: 'agency-1',
        _driver_user_id: 'driver-1',
        _period_start: '2026-08-01',
        _period_end: '2026-08-07',
      }),
  },
  {
    name: 'useUpdateSettlementDraftHeader',
    args: {
      _settlement_id: 'settlement-1',
      _period_start: '2026-08-01',
      _period_end: '2026-08-07',
    },
    spy: () => settlementService.updateSettlementDraftHeader,
    run: (client) =>
      exerciseMutation(client, hooks.useUpdateSettlementDraftHeader, {
        _settlement_id: 'settlement-1',
        _period_start: '2026-08-01',
        _period_end: '2026-08-07',
      }),
  },
  {
    name: 'useAddSettlementDraftItem',
    args: {
      _settlement_id: 'settlement-1',
      _item_type: 'line_haul',
      _category: 'revenue',
      _description: 'Load 1',
      _amount: 100,
    },
    spy: () => settlementService.addSettlementDraftItem,
    run: (client) =>
      exerciseMutation(client, hooks.useAddSettlementDraftItem, {
        _settlement_id: 'settlement-1',
        _item_type: 'line_haul',
        _category: 'revenue',
        _description: 'Load 1',
        _amount: 100,
      }),
  },
  {
    name: 'useUpdateSettlementDraftItem',
    args: {
      _item_id: 'item-1',
      _item_type: 'line_haul',
      _category: 'revenue',
      _description: 'Load 1',
      _amount: 120,
    },
    spy: () => settlementService.updateSettlementDraftItem,
    run: (client) =>
      exerciseMutation(client, hooks.useUpdateSettlementDraftItem, {
        _item_id: 'item-1',
        _item_type: 'line_haul',
        _category: 'revenue',
        _description: 'Load 1',
        _amount: 120,
      }),
  },
  {
    name: 'useDeleteSettlementDraftItem',
    args: { _item_id: 'item-1' },
    spy: () => settlementService.deleteSettlementDraftItem,
    run: (client) =>
      exerciseMutation(client, hooks.useDeleteSettlementDraftItem, {
        _item_id: 'item-1',
      }),
  },
  {
    name: 'useConfirmSettlementLoadMatch',
    args: { _settlement_item_id: 'item-1', _driver_load_id: 'load-1' },
    spy: () => settlementService.confirmSettlementLoadMatch,
    run: (client) =>
      exerciseMutation(client, hooks.useConfirmSettlementLoadMatch, {
        _settlement_item_id: 'item-1',
        _driver_load_id: 'load-1',
      }),
  },
  {
    name: 'useClearSettlementLoadMatch',
    args: { _settlement_item_id: 'item-1' },
    spy: () => settlementService.clearSettlementLoadMatch,
    run: (client) =>
      exerciseMutation(client, hooks.useClearSettlementLoadMatch, {
        _settlement_item_id: 'item-1',
      }),
  },
  {
    name: 'useRefreshSettlementLoadMatchSuggestions',
    args: { _settlement_item_id: 'item-1' },
    spy: () => settlementService.refreshSettlementLoadMatchSuggestions,
    run: (client) =>
      exerciseMutation(client, hooks.useRefreshSettlementLoadMatchSuggestions, {
        _settlement_item_id: 'item-1',
      }),
  },
  {
    name: 'useRejectSettlementLoadMatch',
    args: { _settlement_item_id: 'item-1', _driver_load_id: 'load-1' },
    spy: () => settlementService.rejectSettlementLoadMatch,
    run: (client) =>
      exerciseMutation(client, hooks.useRejectSettlementLoadMatch, {
        _settlement_item_id: 'item-1',
        _driver_load_id: 'load-1',
      }),
  },
  {
    name: 'useFinalizeSettlementDraft',
    args: { _settlement_id: 'settlement-1' },
    spy: () => settlementService.finalizeSettlementDraft,
    run: (client) =>
      exerciseMutation(client, hooks.useFinalizeSettlementDraft, {
        _settlement_id: 'settlement-1',
      }),
  },
  {
    name: 'useVoidFinalizedSettlement',
    args: { _settlement_id: 'settlement-1' },
    spy: () => settlementService.voidFinalizedSettlement,
    run: (client) =>
      exerciseMutation(client, hooks.useVoidFinalizedSettlement, {
        _settlement_id: 'settlement-1',
      }),
  },
  {
    name: 'useCreateSettlementCorrectionDraft',
    args: { _settlement_id: 'settlement-1' },
    spy: () => settlementService.createSettlementCorrectionDraft,
    run: (client) =>
      exerciseMutation(client, hooks.useCreateSettlementCorrectionDraft, {
        _settlement_id: 'settlement-1',
      }),
  },
];

describe('C. settlement mutation hooks map to the exact service function', () => {
  it('covers exactly fourteen settlement mutations', () => {
    expect(settlementCases).toHaveLength(14);
  });

  it.each(settlementCases.map((c) => [c.name, c] as const))(
    '%s',
    async (_name, testCase) => {
      const client = makeClient();
      const spy = vi.mocked(testCase.spy() as ReturnType<typeof vi.fn>);
      spy.mockResolvedValue('ok');
      await testCase.run(client);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(testCase.args);
    },
  );
});

describe('D. settlement invalidation contract', () => {
  it.each(settlementCases.map((c) => [c.name, c] as const))(
    '%s invalidates the settlement root on success',
    async (_name, testCase) => {
      const client = makeClient();
      const spy = vi.mocked(testCase.spy() as ReturnType<typeof vi.fn>);
      spy.mockResolvedValue('ok');
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      await testCase.run(client);
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settlements'] });
    },
  );

  it.each(settlementCases.map((c) => [c.name, c] as const))(
    '%s does not invalidate on failure',
    async (_name, testCase) => {
      const client = makeClient();
      const spy = vi.mocked(testCase.spy() as ReturnType<typeof vi.fn>);
      spy.mockRejectedValue(new Error('denied'));
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      await testCase.run(client);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(invalidate).not.toHaveBeenCalled();
    },
  );
});

/* ----------------------------------------------------------------- E / F --- */

const relationshipCases: ReadonlyArray<{
  name: string;
  run: (client: QueryClient) => Promise<unknown>;
  spy: () => unknown;
  args: unknown;
}> = [
  {
    name: 'useInviteCarrierDriverRelationship',
    args: { _recruiter_id: 'recruiter-1', _driver_user_id: 'driver-1' },
    spy: () => relationshipService.inviteCarrierDriverRelationship,
    run: (client) =>
      exerciseMutation(client, hooks.useInviteCarrierDriverRelationship, {
        _recruiter_id: 'recruiter-1',
        _driver_user_id: 'driver-1',
      }),
  },
  {
    name: 'useAcceptMyCarrierDriverRelationship',
    args: { _relationship_id: 'rel-1' },
    spy: () => relationshipService.acceptMyCarrierDriverRelationship,
    run: (client) =>
      exerciseMutation(client, hooks.useAcceptMyCarrierDriverRelationship, {
        _relationship_id: 'rel-1',
      }),
  },
  {
    name: 'useDeclineMyCarrierDriverRelationship',
    args: { _relationship_id: 'rel-1' },
    spy: () => relationshipService.declineMyCarrierDriverRelationship,
    run: (client) =>
      exerciseMutation(client, hooks.useDeclineMyCarrierDriverRelationship, {
        _relationship_id: 'rel-1',
      }),
  },
  {
    name: 'useEndCarrierDriverRelationship',
    args: { _relationship_id: 'rel-1' },
    spy: () => relationshipService.endCarrierDriverRelationship,
    run: (client) =>
      exerciseMutation(client, hooks.useEndCarrierDriverRelationship, {
        _relationship_id: 'rel-1',
      }),
  },
];

describe('E. relationship mutation hooks map to the exact service function', () => {
  it('covers exactly four relationship mutations', () => {
    expect(relationshipCases).toHaveLength(4);
  });

  it.each(relationshipCases.map((c) => [c.name, c] as const))(
    '%s',
    async (_name, testCase) => {
      const client = makeClient();
      const spy = vi.mocked(testCase.spy() as ReturnType<typeof vi.fn>);
      spy.mockResolvedValue('ok');
      await testCase.run(client);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(testCase.args);
    },
  );
});

describe('F. relationship invalidation contract', () => {
  it.each(relationshipCases.map((c) => [c.name, c] as const))(
    '%s invalidates both roots on success',
    async (_name, testCase) => {
      const client = makeClient();
      const spy = vi.mocked(testCase.spy() as ReturnType<typeof vi.fn>);
      spy.mockResolvedValue('ok');
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      await testCase.run(client);
      expect(invalidate).toHaveBeenCalledTimes(2);
      expect(invalidate).toHaveBeenNthCalledWith(1, {
        queryKey: ['carrier-driver-relationships'],
      });
      expect(invalidate).toHaveBeenNthCalledWith(2, { queryKey: ['settlements'] });
    },
  );

  it.each(relationshipCases.map((c) => [c.name, c] as const))(
    '%s does not invalidate on failure',
    async (_name, testCase) => {
      const client = makeClient();
      const spy = vi.mocked(testCase.spy() as ReturnType<typeof vi.fn>);
      spy.mockRejectedValue(new Error('denied'));
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      await testCase.run(client);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(invalidate).not.toHaveBeenCalled();
    },
  );
});

/* ------------------------------------------------------------- G / H / I --- */

describe('G. hook source performs no backend access and no local precheck', () => {
  it('never imports the backend client and never touches tables or RPCs directly', () => {
    expect(HOOK_SOURCE).not.toContain('integrations/supabase');
    expect(HOOK_SOURCE).not.toContain('supabase');
    expect(HOOK_SOURCE).not.toContain('.from(');
    expect(HOOK_SOURCE).not.toContain('.rpc(');
    expect(HOOK_SOURCE).not.toContain('fetch(');
    expect(HOOK_SOURCE).not.toContain('localStorage');
    expect(HOOK_SOURCE).not.toContain('sessionStorage');
    expect(HOOK_SOURCE).not.toContain('setTimeout');
  });

  it('contains no local authorization or plan gating', () => {
    for (const token of [
      'auth',
      'session',
      'useUser',
      'isPro',
      'entitle',
      'capabilit',
      'hasRole',
      'subscription',
    ]) {
      expect(HOOK_SOURCE.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });

  it('imports only react-query and the five accepted service modules', () => {
    const imports = [...HOOK_SOURCE.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(new Set(imports)).toEqual(
      new Set([
        '@tanstack/react-query',
        '@/lib/settlements/settlementReadService',
        '@/lib/settlements/settlementService',
        '@/lib/settlements/carrierDriverRelationshipService',
        '@/lib/settlements/carrierDriverRelationshipReadService',
        '@/lib/settlements/settlementAssistantAccessService',
      ]),
    );
  });

});

describe('H. hook source imports no UI, router, or toast modules', () => {
  it('has no component/page/router/toast imports', () => {
    for (const token of [
      '@/components',
      '@/pages',
      'react-router',
      'toast',
      'sonner',
      'lucide-react',
      '.tsx',
    ]) {
      expect(HOOK_SOURCE).not.toContain(token);
    }
  });
});

describe('I. both new files avoid prohibited escapes', () => {
  it.each([
    ['hook', HOOK_SOURCE],
    ['test', TEST_SOURCE],
  ])('%s file has no type escapes or focused tests', (_label, source) => {
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
