/**
 * Phase 1T-C1 — Settlement service contract proofs.
 *
 * No real Supabase, network, or database access. The Supabase client module is
 * mocked with a deterministic `rpc` fake that records calls and returns
 * controlled `{ data, error }` values.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RpcCall = { fn: string; args: unknown };

const rpcCalls: RpcCall[] = [];
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
  },
}));

import * as service from '@/lib/settlements/settlementService';

const SERVICE_PATH = path.resolve(
  __dirname,
  '../../src/lib/settlements/settlementService.ts',
);
const SERVICE_SOURCE = readFileSync(SERVICE_PATH, 'utf8');

const SETTLEMENT_ROW = Object.freeze({ id: 'settlement-1', status: 'draft' });
const ITEM_ROW = Object.freeze({ id: 'item-1', item_type: 'load_pay' });
const MATCH_ROW = Object.freeze({
  settlement_item_id: 'item-1',
  driver_load_id: 'load-1',
  match_state: 'confirmed',
});
const MATCH_ROWS = Object.freeze([MATCH_ROW]);
const UUID_RESULT = '00000000-0000-4000-8000-000000000001';

type WrapperCase = {
  wrapper: keyof typeof service;
  rpcName: string;
  args: Record<string, unknown>;
  data: unknown;
};

const CASES: readonly WrapperCase[] = [
  {
    wrapper: 'createDriverImportedSettlementDraft',
    rpcName: 'settlement_create_driver_imported_draft',
    args: {
      _driver_user_id: 'driver-1',
      _period_start: '2026-08-01',
      _period_end: '2026-08-07',
      _statement_reference: 'STMT-1',
      _reported_gross_amount: 1000,
      _reported_net_amount: 900,
    },
    data: SETTLEMENT_ROW,
  },
  {
    wrapper: 'createCarrierSettlementDraft',
    rpcName: 'settlement_create_carrier_draft',
    args: {
      _driver_user_id: 'driver-1',
      _recruiter_id: 'recruiter-1',
      _relationship_id: 'rel-1',
      _period_start: '2026-08-01',
      _period_end: '2026-08-07',
    },
    data: SETTLEMENT_ROW,
  },
  {
    wrapper: 'createAgencySettlementDraft',
    rpcName: 'settlement_create_agency_draft',
    args: {
      _agency_id: 'agency-1',
      _driver_user_id: 'driver-1',
      _period_start: '2026-08-01',
      _period_end: '2026-08-07',
    },
    data: SETTLEMENT_ROW,
  },
  {
    wrapper: 'updateSettlementDraftHeader',
    rpcName: 'settlement_update_draft_header',
    args: {
      _settlement_id: 'settlement-1',
      _period_start: '2026-08-01',
      _period_end: '2026-08-07',
      _notes: 'note',
    },
    data: SETTLEMENT_ROW,
  },
  {
    wrapper: 'addSettlementDraftItem',
    rpcName: 'settlement_add_draft_item',
    args: {
      _settlement_id: 'settlement-1',
      _item_type: 'load_pay',
      _category: 'linehaul',
      _description: 'Load 123',
      _amount: 500,
    },
    data: ITEM_ROW,
  },
  {
    wrapper: 'updateSettlementDraftItem',
    rpcName: 'settlement_update_draft_item',
    args: {
      _item_id: 'item-1',
      _item_type: 'load_pay',
      _category: 'linehaul',
      _description: 'Load 123',
      _amount: 550,
    },
    data: ITEM_ROW,
  },
  {
    wrapper: 'deleteSettlementDraftItem',
    rpcName: 'settlement_delete_draft_item',
    args: { _item_id: 'item-1' },
    data: UUID_RESULT,
  },
  {
    wrapper: 'confirmSettlementLoadMatch',
    rpcName: 'settlement_confirm_load_match',
    args: { _settlement_item_id: 'item-1', _driver_load_id: 'load-1' },
    data: MATCH_ROW,
  },
  {
    wrapper: 'clearSettlementLoadMatch',
    rpcName: 'settlement_clear_load_match',
    args: { _settlement_item_id: 'item-1' },
    data: UUID_RESULT,
  },
  {
    wrapper: 'refreshSettlementLoadMatchSuggestions',
    rpcName: 'settlement_refresh_load_match_suggestions',
    args: { _settlement_item_id: 'item-1' },
    data: MATCH_ROWS,
  },
  {
    wrapper: 'rejectSettlementLoadMatch',
    rpcName: 'settlement_reject_load_match',
    args: { _settlement_item_id: 'item-1', _driver_load_id: 'load-1' },
    data: MATCH_ROW,
  },
  {
    wrapper: 'finalizeSettlementDraft',
    rpcName: 'settlement_finalize_draft',
    args: { _settlement_id: 'settlement-1' },
    data: SETTLEMENT_ROW,
  },
  {
    wrapper: 'voidFinalizedSettlement',
    rpcName: 'settlement_void_finalized',
    args: { _settlement_id: 'settlement-1' },
    data: SETTLEMENT_ROW,
  },
  {
    wrapper: 'createSettlementCorrectionDraft',
    rpcName: 'settlement_create_correction_draft',
    args: { _settlement_id: 'settlement-1' },
    data: SETTLEMENT_ROW,
  },
];

/**
 * Compile-safe dynamic dispatch: an exhaustive switch over the 14 exported
 * wrapper names. Each branch applies at most a single direct cast from the
 * generic test argument record to that wrapper's exported generated Args
 * alias — never through `unknown`. The production service remains fully
 * generated-type-driven.
 */
function invoke(
  name: keyof typeof service,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'createDriverImportedSettlementDraft':
      return service.createDriverImportedSettlementDraft(
        args as service.CreateDriverImportedSettlementDraftArgs,
      );
    case 'createCarrierSettlementDraft':
      return service.createCarrierSettlementDraft(
        args as service.CreateCarrierSettlementDraftArgs,
      );
    case 'createAgencySettlementDraft':
      return service.createAgencySettlementDraft(
        args as service.CreateAgencySettlementDraftArgs,
      );
    case 'updateSettlementDraftHeader':
      return service.updateSettlementDraftHeader(
        args as service.UpdateSettlementDraftHeaderArgs,
      );
    case 'addSettlementDraftItem':
      return service.addSettlementDraftItem(
        args as service.AddSettlementDraftItemArgs,
      );
    case 'updateSettlementDraftItem':
      return service.updateSettlementDraftItem(
        args as service.UpdateSettlementDraftItemArgs,
      );
    case 'deleteSettlementDraftItem':
      return service.deleteSettlementDraftItem(
        args as service.DeleteSettlementDraftItemArgs,
      );
    case 'confirmSettlementLoadMatch':
      return service.confirmSettlementLoadMatch(
        args as service.ConfirmSettlementLoadMatchArgs,
      );
    case 'clearSettlementLoadMatch':
      return service.clearSettlementLoadMatch(
        args as service.ClearSettlementLoadMatchArgs,
      );
    case 'refreshSettlementLoadMatchSuggestions':
      return service.refreshSettlementLoadMatchSuggestions(
        args as service.RefreshSettlementLoadMatchSuggestionsArgs,
      );
    case 'rejectSettlementLoadMatch':
      return service.rejectSettlementLoadMatch(
        args as service.RejectSettlementLoadMatchArgs,
      );
    case 'finalizeSettlementDraft':
      return service.finalizeSettlementDraft(
        args as service.FinalizeSettlementDraftArgs,
      );
    case 'voidFinalizedSettlement':
      return service.voidFinalizedSettlement(
        args as service.VoidFinalizedSettlementArgs,
      );
    case 'createSettlementCorrectionDraft':
      return service.createSettlementCorrectionDraft(
        args as service.CreateSettlementCorrectionDraftArgs,
      );
    default:
      return Promise.reject(new Error(`unknown wrapper: ${String(name)}`));
  }
}

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = { data: null, error: null };
});

describe('Phase 1T-C1 — settlement service transport contract', () => {
  it('1. exports exactly the 14 required wrappers as functions', () => {
    for (const c of CASES) {
      expect(typeof service[c.wrapper]).toBe('function');
    }
    expect(CASES.length).toBe(14);
    expect(new Set(CASES.map((c) => c.rpcName)).size).toBe(14);
  });

  for (const c of CASES) {
    it(`2. ${String(c.wrapper)} calls ${c.rpcName} once and passes args through unchanged`, async () => {
      rpcResult = { data: c.data, error: null };
      const argsSnapshot = JSON.parse(JSON.stringify(c.args)) as unknown;

      const result = await invoke(c.wrapper, c.args);

      expect(rpcCalls.length).toBe(1);
      expect(rpcCalls[0].fn).toBe(c.rpcName);
      expect(rpcCalls[0].args).toBe(c.args);
      expect(rpcCalls[0].args).toEqual(argsSnapshot);
      expect(c.args).toEqual(argsSnapshot);
      expect(result).toBe(c.data);
    });
  }

  const ERROR_CASES: readonly WrapperCase[] = [
    CASES.find((c) => c.wrapper === 'finalizeSettlementDraft')!,
    CASES.find((c) => c.wrapper === 'deleteSettlementDraftItem')!,
    CASES.find((c) => c.wrapper === 'refreshSettlementLoadMatchSuggestions')!,
  ];

  for (const c of ERROR_CASES) {
    it(`3. ${String(c.wrapper)} rejects with the exact error object, no retry or fallback`, async () => {
      const sentinel = { message: 'settlement_not_authorized', code: 'P0001' };
      rpcResult = { data: null, error: sentinel };

      await expect(invoke(c.wrapper, c.args)).rejects.toBe(sentinel);
      expect(rpcCalls.length).toBe(1);
      expect(rpcCalls[0].fn).toBe(c.rpcName);
    });
  }

  it('4. source references all 14 RPC names', () => {
    for (const c of CASES) {
      expect(SERVICE_SOURCE).toContain(`'${c.rpcName}'`);
    }
  });

  it('5. source never calls settlement_current_user_can_ helpers', () => {
    expect(SERVICE_SOURCE).not.toContain('settlement_current_user_can_');
  });

  it('6. source performs no table access', () => {
    expect(SERVICE_SOURCE).not.toContain('.from(');
  });

  it('7. source imports no React, React Query, or UI modules', () => {
    expect(SERVICE_SOURCE).not.toMatch(/from\s+['"]react['"]/);
    expect(SERVICE_SOURCE).not.toMatch(/from\s+['"]@tanstack\/react-query['"]/);
    expect(SERVICE_SOURCE).not.toContain('useQuery');
    expect(SERVICE_SOURCE).not.toContain('useMutation');
    expect(SERVICE_SOURCE).not.toMatch(/from\s+['"]@\/components\//);
    expect(SERVICE_SOURCE).not.toMatch(/from\s+['"]@\/pages\//);
    expect(SERVICE_SOURCE).not.toMatch(/from\s+['"]@\/hooks\//);
  });

  it('8. source uses no type escapes', () => {
    expect(SERVICE_SOURCE).not.toMatch(/\bany\b/);
    expect(SERVICE_SOURCE).not.toContain('@ts-ignore');
    expect(SERVICE_SOURCE).not.toContain('@ts-expect-error');
    expect(SERVICE_SOURCE).not.toContain('as unknown as');
    expect(SERVICE_SOURCE).not.toContain('eslint-disable');
  });

  it('9. source uses one rpc call per wrapper and no other transport', () => {
    const rpcOccurrences = SERVICE_SOURCE.match(/supabase\.rpc\(/g) ?? [];
    expect(rpcOccurrences.length).toBe(14);
    expect(SERVICE_SOURCE).not.toContain('fetch(');
    expect(SERVICE_SOURCE).not.toContain('localStorage');
    expect(SERVICE_SOURCE).not.toContain('setTimeout');
  });

  it('10. this suite contains no focused or skipped tests', () => {
    const self = readFileSync(
      path.resolve(__dirname, 'phase1tC1SettlementServiceContract.test.ts'),
      'utf8',
    );
    expect(self).not.toMatch(/\b(it|describe)\.only\b/);
    expect(self).not.toMatch(/\b(it|describe)\.skip\b/);
  });

  it('11. this suite itself uses no type escapes', () => {
    const self = readFileSync(
      path.resolve(__dirname, 'phase1tC1SettlementServiceContract.test.ts'),
      'utf8',
    );
    const DOUBLE_CAST = ['as', 'unknown', 'as'].join(' ');
    const TS_IGNORE = ['@ts', 'ignore'].join('-');
    const TS_EXPECT_ERROR = ['@ts', 'expect', 'error'].join('-');
    const ESLINT_DISABLE = ['eslint', 'disable'].join('-');
    expect(self).not.toContain(DOUBLE_CAST);
    expect(self).not.toContain(TS_IGNORE);
    expect(self).not.toContain(TS_EXPECT_ERROR);
    expect(self).not.toContain(ESLINT_DISABLE);
    expect(self).not.toMatch(new RegExp(String.raw`\b` + 'any' + String.raw`\b`));
  });
});
