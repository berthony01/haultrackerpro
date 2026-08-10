/**
 * Phase 1T-C — Read-side settlement query service contract proofs.
 *
 * Fully mocked: no network, no database, no real Supabase client.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type QueryResult = { data: unknown; error: unknown };

interface RecordedOp {
  op: string;
  args: unknown[];
}

interface RecordedQuery {
  table: string;
  ops: RecordedOp[];
}

const queries: RecordedQuery[] = [];
let nextResults: QueryResult[] = [];

function takeResult(): QueryResult {
  const next = nextResults.shift();
  return next ?? { data: null, error: null };
}

function createBuilder(record: RecordedQuery) {
  const builder = {
    select(...args: unknown[]) {
      record.ops.push({ op: 'select', args });
      return builder;
    },
    eq(...args: unknown[]) {
      record.ops.push({ op: 'eq', args });
      return builder;
    },
    in(...args: unknown[]) {
      record.ops.push({ op: 'in', args });
      return builder;
    },
    order(...args: unknown[]) {
      record.ops.push({ op: 'order', args });
      return builder;
    },
    maybeSingle() {
      record.ops.push({ op: 'maybeSingle', args: [] });
      return Promise.resolve(takeResult());
    },
    then(
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(takeResult()).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from(table: string) {
      const record: RecordedQuery = { table, ops: [] };
      queries.push(record);
      return createBuilder(record);
    },
  },
}));

import {
  listVisibleSettlements,
  getVisibleSettlementHeader,
  listVisibleSettlementItems,
  listVisibleSettlementMatches,
  listVisibleSettlementEvents,
} from '@/lib/settlements/settlementReadService';

const SERVICE_PATH = resolve(
  process.cwd(),
  'src/lib/settlements/settlementReadService.ts',
);
const TEST_PATH = resolve(
  process.cwd(),
  'src/test/phase1tSettlementReadService.test.ts',
);
const SERVICE_SRC = readFileSync(SERVICE_PATH, 'utf8');
const TEST_SRC = readFileSync(TEST_PATH, 'utf8');

// Prohibited patterns are assembled at runtime so this file never contains them
// literally and therefore cannot trip its own guardrails.
const LOOSE_TYPE = new RegExp('\\b' + 'a' + 'ny' + '\\b');
const DOUBLE_CAST = 'as ' + 'unknown ' + 'as';
const TS_IGNORE = '@ts-' + 'ignore';
const TS_EXPECT = '@ts-' + 'expect-error';
const ESLINT_DISABLE = 'eslint-' + 'disable';

function ops(query: RecordedQuery, op: string) {
  return query.ops.filter((entry) => entry.op === op);
}

beforeEach(() => {
  queries.length = 0;
  nextResults = [];
});

describe('Phase 1T-C — settlement read service', () => {
  // A
  it('1. exports exactly the five required read functions', () => {
    expect(typeof listVisibleSettlements).toBe('function');
    expect(typeof getVisibleSettlementHeader).toBe('function');
    expect(typeof listVisibleSettlementItems).toBe('function');
    expect(typeof listVisibleSettlementMatches).toBe('function');
    expect(typeof listVisibleSettlementEvents).toBe('function');
  });

  // B
  it('2. listVisibleSettlements reads driver_settlements with deterministic order', async () => {
    const data = [{ id: 's1' }];
    nextResults = [{ data, error: null }];

    const result = await listVisibleSettlements();

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe('driver_settlements');
    expect(ops(queries[0], 'select')[0].args[0]).toBe('*');
    const orders = ops(queries[0], 'order');
    expect(orders).toHaveLength(2);
    expect(orders[0].args).toEqual(['period_end', { ascending: false }]);
    expect(orders[1].args).toEqual(['created_at', { ascending: false }]);
    expect(ops(queries[0], 'eq')).toHaveLength(0);
    expect(result).toBe(data);
  });

  it('3. listVisibleSettlements throws the exact error unchanged without retry', async () => {
    const sentinel = { message: 'rls denied' };
    nextResults = [{ data: null, error: sentinel }];

    await expect(listVisibleSettlements()).rejects.toBe(sentinel);
    expect(queries).toHaveLength(1);
  });

  // C
  it('4. getVisibleSettlementHeader reads one row by exact id via maybeSingle', async () => {
    const data = { id: 'abc' };
    nextResults = [{ data, error: null }];

    const result = await getVisibleSettlementHeader('abc');

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe('driver_settlements');
    expect(ops(queries[0], 'select')[0].args[0]).toBe('*');
    expect(ops(queries[0], 'eq')[0].args).toEqual(['id', 'abc']);
    expect(ops(queries[0], 'maybeSingle')).toHaveLength(1);
    expect(result).toBe(data);
  });

  it('5. getVisibleSettlementHeader returns null unchanged and throws exact error', async () => {
    nextResults = [{ data: null, error: null }];
    await expect(getVisibleSettlementHeader('missing')).resolves.toBeNull();

    const sentinel = { message: 'boom' };
    nextResults = [{ data: null, error: sentinel }];
    await expect(getVisibleSettlementHeader('x')).rejects.toBe(sentinel);
  });

  // D
  it('6. listVisibleSettlementItems reads items for the exact settlement in order', async () => {
    const data = [{ id: 'i1' }];
    nextResults = [{ data, error: null }];

    const result = await listVisibleSettlementItems('set-1');

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe('driver_settlement_items');
    expect(ops(queries[0], 'select')[0].args[0]).toBe('*');
    expect(ops(queries[0], 'eq')[0].args).toEqual(['settlement_id', 'set-1']);
    const orders = ops(queries[0], 'order');
    expect(orders[0].args).toEqual(['sort_order', { ascending: true }]);
    expect(orders[1].args).toEqual(['created_at', { ascending: true }]);
    expect(result).toBe(data);
  });

  it('7. listVisibleSettlementItems throws the exact error unchanged', async () => {
    const sentinel = { message: 'items denied' };
    nextResults = [{ data: null, error: sentinel }];
    await expect(listVisibleSettlementItems('s')).rejects.toBe(sentinel);
  });

  // E
  it('8. listVisibleSettlementMatches uses exact ids through .in with created_at ASC', async () => {
    const data = [{ id: 'm1' }];
    nextResults = [{ data, error: null }];

    const result = await listVisibleSettlementMatches(['i1', 'i2']);

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe('driver_settlement_matches');
    expect(ops(queries[0], 'select')[0].args[0]).toBe('*');
    expect(ops(queries[0], 'in')[0].args).toEqual([
      'settlement_item_id',
      ['i1', 'i2'],
    ]);
    const orders = ops(queries[0], 'order');
    expect(orders).toHaveLength(1);
    expect(orders[0].args).toEqual(['created_at', { ascending: true }]);
    expect(result).toBe(data);
  });

  it('9. listVisibleSettlementMatches throws the exact error unchanged', async () => {
    const sentinel = { message: 'matches denied' };
    nextResults = [{ data: null, error: sentinel }];
    await expect(listVisibleSettlementMatches(['i1'])).rejects.toBe(sentinel);
  });

  // F
  it('10. listVisibleSettlementMatches([]) returns [] with zero Supabase calls', async () => {
    const result = await listVisibleSettlementMatches([]);
    expect(result).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  // G
  it('11. listVisibleSettlementEvents reads events for the exact settlement, oldest first', async () => {
    const data = [{ id: 'e1' }];
    nextResults = [{ data, error: null }];

    const result = await listVisibleSettlementEvents('set-9');

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe('driver_settlement_events');
    expect(ops(queries[0], 'select')[0].args[0]).toBe('*');
    expect(ops(queries[0], 'eq')[0].args).toEqual(['settlement_id', 'set-9']);
    const orders = ops(queries[0], 'order');
    expect(orders).toHaveLength(1);
    expect(orders[0].args).toEqual(['created_at', { ascending: true }]);
    expect(result).toBe(data);
  });

  it('12. listVisibleSettlementEvents throws the exact error unchanged', async () => {
    const sentinel = { message: 'events denied' };
    nextResults = [{ data: null, error: sentinel }];
    await expect(listVisibleSettlementEvents('s')).rejects.toBe(sentinel);
  });

  // H
  it('13. service source targets exactly the four accepted tables', () => {
    const targets = [...SERVICE_SRC.matchAll(/\.from\('([^']+)'\)/g)].map(
      (match) => match[1],
    );
    expect(new Set(targets)).toEqual(
      new Set([
        'driver_settlements',
        'driver_settlement_items',
        'driver_settlement_matches',
        'driver_settlement_events',
      ]),
    );
    expect(targets).toHaveLength(5);
  });

  it('14. service source contains no write, rpc, or alternate transport calls', () => {
    for (const forbidden of [
      '.insert(',
      '.update(',
      '.upsert(',
      '.delete(',
      '.remove(',
      '.rpc(',
      'functions.invoke',
      'fetch(',
      'storage',
      'setTimeout',
      'setInterval',
      'localStorage',
      'sessionStorage',
    ]) {
      expect(SERVICE_SRC.includes(forbidden)).toBe(false);
    }
  });

  it('15. service source performs no client-side authorization', () => {
    for (const forbidden of [
      'settlement_current_user_can_',
      'auth.getUser',
      'auth.getSession',
      'entitlement',
      'has_role',
    ]) {
      expect(SERVICE_SRC.includes(forbidden)).toBe(false);
    }
  });

  it('16. service source imports no UI, hook, router, or query-layer modules', () => {
    for (const forbidden of [
      'react',
      'React',
      '@tanstack',
      'react-router',
      '@/components',
      '@/hooks',
      '@/pages',
    ]) {
      expect(SERVICE_SRC.includes(forbidden)).toBe(false);
    }
  });

  it('17. service source contains no prohibited type escapes', () => {
    expect(LOOSE_TYPE.test(SERVICE_SRC)).toBe(false);
    expect(SERVICE_SRC.includes(DOUBLE_CAST)).toBe(false);
    expect(SERVICE_SRC.includes(TS_IGNORE)).toBe(false);
    expect(SERVICE_SRC.includes(TS_EXPECT)).toBe(false);
    expect(SERVICE_SRC.includes(ESLINT_DISABLE)).toBe(false);
  });

  // I
  it('18. test source itself contains no prohibited escapes and no .only/.skip', () => {
    expect(LOOSE_TYPE.test(TEST_SRC)).toBe(false);
    expect(TEST_SRC.includes(DOUBLE_CAST)).toBe(false);
    expect(TEST_SRC.includes(TS_IGNORE)).toBe(false);
    expect(TEST_SRC.includes(TS_EXPECT)).toBe(false);
    expect(TEST_SRC.includes(ESLINT_DISABLE)).toBe(false);
    expect(/\b(it|describe|test)\.(only|skip)\b/.test(TEST_SRC)).toBe(false);
  });
});
