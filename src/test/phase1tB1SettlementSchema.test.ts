// @vitest-environment node
// =====================================================================
// Phase 1T-B1 — Settlement physical schema candidate proofs.
//
// Applies the REAL candidate SQL on top of a minimal Supabase-compatible
// bootstrap inside PGlite and proves the physical contract at catalog and
// runtime level, plus static source-contract checks.
//
// No production database, no Stripe, no deploy, no publish.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const CANDIDATE_REL =
  '../../supabase/migration-candidates/20260808161500_phase1t_b1_settlement_schema.sql';

const CANDIDATE_SQL = fs.readFileSync(
  fileURLToPath(new URL(CANDIDATE_REL, import.meta.url)),
  'utf8',
);

const TABLES = [
  'carrier_driver_relationships',
  'driver_settlements',
  'driver_settlement_items',
  'driver_settlement_matches',
  'driver_settlement_events',
] as const;

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
);
CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL
);
CREATE TABLE public.loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
);
`;

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

let db: AnyPGlite;
// ids reused across runtime proofs
const ids = {
  driver: '' as string,
  otherDriver: '' as string,
  recruiter: '' as string,
  agency: '' as string,
  relationship: '' as string,
  load: '' as string,
};

/** Snapshot of pre-candidate catalog state, for "candidate adds only X" proofs. */
let beforeTables: string[] = [];
let beforeFunctions: string[] = [];
let beforeTriggers: string[] = [];

async function tableNames(): Promise<string[]> {
  const r = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
  );
  return r.rows.map((x) => x.tablename);
}

async function functionNames(): Promise<string[]> {
  const r = await db.query<{ proname: string }>(
    `SELECT p.proname FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' ORDER BY 1`,
  );
  return r.rows.map((x) => x.proname);
}

async function triggerNames(): Promise<string[]> {
  const r = await db.query<{ tgname: string }>(
    `SELECT t.tgname FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' ORDER BY 1`,
  );
  return r.rows.map((x) => x.tgname);
}

/** Run SQL and return the error message, or null when it succeeded. */
async function failure(sql: string, params?: unknown[]): Promise<string | null> {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return (e as Error).message ?? 'error';
  }
}

async function insertSettlement(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const source = (overrides.source as string) ?? 'driver_imported';
  const needsDisplayName =
    source === 'carrier_issued' || source === 'agency_prepared';
  const row: Record<string, unknown> = {
    driver_user_id: ids.driver,
    source: 'driver_imported',
    period_start: '2026-08-01',
    period_end: '2026-08-07',
    created_by_user_id: ids.driver,
    ...(needsDisplayName &&
    !Object.prototype.hasOwnProperty.call(overrides, 'source_display_name_snapshot')
      ? { source_display_name_snapshot: 'Acme Logistics LLC' }
      : {}),
    ...overrides,
  };
  const keys = Object.keys(row);
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlements (${keys.join(', ')})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    keys.map((k) => row[k]),
  );
  return r.rows[0].id;
}

async function insertItem(
  settlementId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const row: Record<string, unknown> = {
    settlement_id: settlementId,
    item_type: 'load_pay',
    amount: 100,
    created_by_user_id: ids.driver,
    ...overrides,
  };
  const keys = Object.keys(row);
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlement_items (${keys.join(', ')})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    keys.map((k) => row[k]),
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;
  await db.exec(BOOTSTRAP);

  beforeTables = await tableNames();
  beforeFunctions = await functionNames();
  beforeTriggers = await triggerNames();

  // Proof 1 — the real candidate applies cleanly, as written.
  await db.exec(CANDIDATE_SQL);

  const d = await db.query<{ id: string }>(
    `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
  );
  ids.driver = d.rows[0].id;
  const d2 = await db.query<{ id: string }>(
    `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
  );
  ids.otherDriver = d2.rows[0].id;
  const rp = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles (user_id) VALUES ($1) RETURNING id`,
    [ids.otherDriver],
  );
  ids.recruiter = rp.rows[0].id;
  const ap = await db.query<{ id: string }>(
    `INSERT INTO public.agency_profiles (owner_user_id) VALUES ($1) RETURNING id`,
    [ids.otherDriver],
  );
  ids.agency = ap.rows[0].id;
  const rel = await db.query<{ id: string }>(
    `INSERT INTO public.carrier_driver_relationships
       (recruiter_id, driver_user_id, status, created_by_user_id)
     VALUES ($1, $2, 'active', $3) RETURNING id`,
    [ids.recruiter, ids.driver, ids.otherDriver],
  );
  ids.relationship = rel.rows[0].id;
  const ld = await db.query<{ id: string }>(
    `INSERT INTO public.loads (user_id) VALUES ($1) RETURNING id`,
    [ids.driver],
  );
  ids.load = ld.rows[0].id;
});

// ---------------------------------------------------------------------
// Catalog shape — proofs 1–6
// ---------------------------------------------------------------------
describe('Phase 1T-B1 — candidate applies and adds exactly the five tables', () => {
  it('applies cleanly and adds exactly the five Phase 1T tables', async () => {
    const after = await tableNames();
    const added = after.filter((t) => !beforeTables.includes(t)).sort();
    expect(added).toEqual([...TABLES].sort());
  });

  it('enables row-level security on all five tables', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [[...TABLES]],
    );
    expect(r.rows.length).toBe(5);
    for (const row of r.rows) expect(row.relrowsecurity).toBe(true);
  });

  it('creates zero policies on the five tables', async () => {
    const r = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_policies
        WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [[...TABLES]],
    );
    expect(r.rows[0].count).toBe('0');
    expect(CANDIDATE_SQL).not.toMatch(/CREATE\s+POLICY/i);
  });

  it('creates zero user triggers', async () => {
    const after = await triggerNames();
    expect(after.filter((t) => !beforeTriggers.includes(t))).toEqual([]);
  });

  it('creates zero new public functions', async () => {
    const after = await functionNames();
    expect(after.filter((f) => !beforeFunctions.includes(f))).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Allowlists — proofs 7, 13
// ---------------------------------------------------------------------
describe('Phase 1T-B1 — value allowlists reject unknown values', () => {
  it('rejects an unknown relationship status', async () => {
    expect(
      await failure(
        `INSERT INTO public.carrier_driver_relationships
           (recruiter_id, driver_user_id, status, created_by_user_id)
         VALUES ($1, $2, 'paused', $3)`,
        [ids.recruiter, ids.otherDriver, ids.otherDriver],
      ),
    ).toBeTruthy();
  });

  it('rejects an unknown settlement source', async () => {
    expect(
      await failure(
        `INSERT INTO public.driver_settlements
           (driver_user_id, source, period_start, period_end, created_by_user_id)
         VALUES ($1, 'broker_issued', '2026-08-01', '2026-08-07', $1)`,
        [ids.driver],
      ),
    ).toBeTruthy();
  });

  it('rejects an unknown settlement status', async () => {
    expect(
      await failure(
        `INSERT INTO public.driver_settlements
           (driver_user_id, source, status, period_start, period_end, created_by_user_id)
         VALUES ($1, 'driver_imported', 'paid', '2026-08-01', '2026-08-07', $1)`,
        [ids.driver],
      ),
    ).toBeTruthy();
  });

  it('rejects an unknown item type', async () => {
    const s = await insertSettlement();
    expect(
      await failure(
        `INSERT INTO public.driver_settlement_items
           (settlement_id, item_type, amount, created_by_user_id)
         VALUES ($1, 'bonus_payout', 10, $2)`,
        [s, ids.driver],
      ),
    ).toBeTruthy();
  });

  it('rejects a `mixed` pay_method and accepts the four canonical methods', async () => {
    const s = await insertSettlement();
    expect(
      await failure(
        `INSERT INTO public.driver_settlement_items
           (settlement_id, item_type, amount, pay_method, created_by_user_id)
         VALUES ($1, 'load_pay', 10, 'mixed', $2)`,
        [s, ids.driver],
      ),
    ).toBeTruthy();
    for (const m of ['per_mile', 'percentage', 'flat_rate', 'manual']) {
      await expect(insertItem(s, { pay_method: m })).resolves.toBeTruthy();
    }
  });

  it('rejects an unknown match_state', async () => {
    const s = await insertSettlement();
    const item = await insertItem(s);
    expect(
      await failure(
        `INSERT INTO public.driver_settlement_matches
           (settlement_item_id, driver_load_id, match_state)
         VALUES ($1, $2, 'maybe')`,
        [item, ids.load],
      ),
    ).toBeTruthy();
  });

  it('rejects an unknown event_type and accepts every allowed one', async () => {
    const s = await insertSettlement();
    expect(
      await failure(
        `INSERT INTO public.driver_settlement_events (settlement_id, event_type)
         VALUES ($1, 'deleted')`,
        [s],
      ),
    ).toBeTruthy();
    for (const e of [
      'created',
      'updated',
      'finalized',
      'superseded',
      'voided',
      'match_confirmed',
      'exported',
    ]) {
      expect(
        await failure(
          `INSERT INTO public.driver_settlement_events (settlement_id, event_type)
           VALUES ($1, $2)`,
          [s, e],
        ),
      ).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------
// Relationship + settlement constraints — proofs 8–12, 14, 15
// ---------------------------------------------------------------------
describe('Phase 1T-B1 — relationship and settlement constraints', () => {
  it('enforces UNIQUE(recruiter_id, driver_user_id)', async () => {
    expect(
      await failure(
        `INSERT INTO public.carrier_driver_relationships
           (recruiter_id, driver_user_id, created_by_user_id)
         VALUES ($1, $2, $3)`,
        [ids.recruiter, ids.driver, ids.otherDriver],
      ),
    ).toBeTruthy();
  });

  it('rejects period_end before period_start', async () => {
    expect(
      await failure(
        `INSERT INTO public.driver_settlements
           (driver_user_id, source, period_start, period_end, created_by_user_id)
         VALUES ($1, 'driver_imported', '2026-08-07', '2026-08-01', $1)`,
        [ids.driver],
      ),
    ).toBeTruthy();
  });

  it('accepts the three valid source identity shapes', async () => {
    await expect(insertSettlement()).resolves.toBeTruthy();
    await expect(
      insertSettlement({
        source: 'carrier_issued',
        carrier_recruiter_profile_id: ids.recruiter,
        carrier_driver_relationship_id: ids.relationship,
      }),
    ).resolves.toBeTruthy();
    await expect(
      insertSettlement({ source: 'agency_prepared', agency_id: ids.agency }),
    ).resolves.toBeTruthy();
  });

  it('rejects crossed or missing business identities', async () => {
    // carrier_issued missing relationship
    await expect(
      insertSettlement({
        source: 'carrier_issued',
        carrier_recruiter_profile_id: ids.recruiter,
      }),
    ).rejects.toBeTruthy();
    // carrier_issued missing recruiter profile
    await expect(
      insertSettlement({
        source: 'carrier_issued',
        carrier_driver_relationship_id: ids.relationship,
      }),
    ).rejects.toBeTruthy();
    // carrier_issued also carrying an agency id
    await expect(
      insertSettlement({
        source: 'carrier_issued',
        carrier_recruiter_profile_id: ids.recruiter,
        carrier_driver_relationship_id: ids.relationship,
        agency_id: ids.agency,
      }),
    ).rejects.toBeTruthy();
    // agency_prepared missing agency id
    await expect(insertSettlement({ source: 'agency_prepared' })).rejects.toBeTruthy();
    // agency_prepared carrying carrier identity
    await expect(
      insertSettlement({
        source: 'agency_prepared',
        agency_id: ids.agency,
        carrier_recruiter_profile_id: ids.recruiter,
      }),
    ).rejects.toBeTruthy();
    // driver_imported carrying either business identity
    await expect(
      insertSettlement({ source: 'driver_imported', agency_id: ids.agency }),
    ).rejects.toBeTruthy();
    await expect(
      insertSettlement({
        source: 'driver_imported',
        carrier_recruiter_profile_id: ids.recruiter,
      }),
    ).rejects.toBeTruthy();
  });

  it('enforces the revision shape and rejects self-supersede', async () => {
    const first = await insertSettlement();
    // version 1 must not supersede
    await expect(
      insertSettlement({ version_number: 1, supersedes_settlement_id: first }),
    ).rejects.toBeTruthy();
    // version > 1 must supersede
    await expect(insertSettlement({ version_number: 2 })).rejects.toBeTruthy();
    // valid revision
    const second = await insertSettlement({
      version_number: 2,
      supersedes_settlement_id: first,
    });
    expect(second).toBeTruthy();
    // self-supersede
    expect(
      await failure(
        `UPDATE public.driver_settlements SET supersedes_settlement_id = id WHERE id = $1`,
        [second],
      ),
    ).toBeTruthy();
  });

  it('rejects a negative reported gross amount', async () => {
    await expect(
      insertSettlement({ reported_gross_amount: -1 }),
    ).rejects.toBeTruthy();
  });

  it('rejects negative item amounts and accepts zero/positive', async () => {
    const s = await insertSettlement();
    await expect(insertItem(s, { amount: -0.01 })).rejects.toBeTruthy();
    await expect(insertItem(s, { amount: 0 })).resolves.toBeTruthy();
    await expect(insertItem(s, { amount: 1234.56 })).resolves.toBeTruthy();
  });

  it('rejects negative values in every nullable numeric snapshot field', async () => {
    const s = await insertSettlement();
    const fields = [
      'quantity',
      'rate',
      'expected_amount_snapshot',
      'loaded_miles_snapshot',
      'deadhead_miles_snapshot',
      'payable_miles_snapshot',
      'eligible_revenue_snapshot',
    ];
    for (const f of fields) {
      await expect(insertItem(s, { [f]: -1 })).rejects.toBeTruthy();
      await expect(insertItem(s, { [f]: 1 })).resolves.toBeTruthy();
    }
    await expect(insertItem(s, { sort_order: -1 })).rejects.toBeTruthy();
  });

  it('rejects confidence outside 0..1 and accepts the inclusive bounds', async () => {
    const s = await insertSettlement();
    const item = await insertItem(s);
    for (const c of [-0.0001, 1.0001]) {
      expect(
        await failure(
          `INSERT INTO public.driver_settlement_matches
             (settlement_item_id, driver_load_id, match_state, confidence)
           VALUES ($1, $2, 'likely', $3)`,
          [item, ids.load, c],
        ),
      ).toBeTruthy();
    }
    expect(
      await failure(
        `INSERT INTO public.driver_settlement_matches
           (settlement_item_id, driver_load_id, match_state, confidence)
         VALUES ($1, $2, 'likely', 1)`,
        [item, ids.load],
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Match uniqueness — proofs 16, 17
// ---------------------------------------------------------------------
describe('Phase 1T-B1 — match uniqueness', () => {
  it('rejects a duplicate item/load match pair', async () => {
    const s = await insertSettlement();
    const item = await insertItem(s);
    expect(
      await failure(
        `INSERT INTO public.driver_settlement_matches
           (settlement_item_id, driver_load_id, match_state)
         VALUES ($1, $2, 'likely')`,
        [item, ids.load],
      ),
    ).toBeNull();
    expect(
      await failure(
        `INSERT INTO public.driver_settlement_matches
           (settlement_item_id, driver_load_id, match_state)
         VALUES ($1, $2, 'possible')`,
        [item, ids.load],
      ),
    ).toBeTruthy();
  });

  it('allows many likely/possible candidates but only one accepted match', async () => {
    const s = await insertSettlement();
    const item = await insertItem(s);
    const loads: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const l = await db.query<{ id: string }>(
        `INSERT INTO public.loads (user_id) VALUES ($1) RETURNING id`,
        [ids.driver],
      );
      loads.push(l.rows[0].id);
    }
    expect(
      await failure(
        `INSERT INTO public.driver_settlement_matches
           (settlement_item_id, driver_load_id, match_state)
         VALUES ($1, $2, 'likely'), ($1, $3, 'possible')`,
        [item, loads[0], loads[1]],
      ),
    ).toBeNull();
    expect(
      await failure(
        `INSERT INTO public.driver_settlement_matches
           (settlement_item_id, driver_load_id, match_state)
         VALUES ($1, $2, 'exact')`,
        [item, loads[2]],
      ),
    ).toBeNull();
    expect(
      await failure(
        `INSERT INTO public.driver_settlement_matches
           (settlement_item_id, driver_load_id, match_state)
         VALUES ($1, $2, 'confirmed')`,
        [item, loads[3]],
      ),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------
// FK actions, indexes, cascade behavior — proofs 18–21
// ---------------------------------------------------------------------
describe('Phase 1T-B1 — foreign keys, indexes, and cascade behavior', () => {
  it('declares the requested delete actions on every foreign key', async () => {
    const r = await db.query<{
      table_name: string;
      column_name: string;
      confdeltype: string;
    }>(
      `SELECT c.relname AS table_name,
              a.attname AS column_name,
              con.confdeltype AS confdeltype
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN unnest(con.conkey) AS k(attnum) ON true
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
        WHERE con.contype = 'f' AND n.nspname = 'public'
          AND c.relname = ANY($1::text[])`,
      [[...TABLES]],
    );
    const map = new Map(
      r.rows.map((x) => [`${x.table_name}.${x.column_name}`, x.confdeltype]),
    );
    const expected: Record<string, string> = {
      'carrier_driver_relationships.recruiter_id': 'c',
      'carrier_driver_relationships.driver_user_id': 'c',
      'driver_settlements.driver_user_id': 'c',
      'driver_settlements.supersedes_settlement_id': 'c',
      'driver_settlement_items.settlement_id': 'c',
      'driver_settlement_matches.settlement_item_id': 'c',
      'driver_settlement_matches.driver_load_id': 'c',
      'driver_settlement_events.settlement_id': 'c',
    };
    for (const [key, action] of Object.entries(expected)) {
      expect(map.get(key), key).toBe(action);
    }
    // Historical provenance columns must NOT be foreign keys at all.
    for (const key of [
      'driver_settlements.carrier_recruiter_profile_id',
      'driver_settlements.carrier_driver_relationship_id',
      'driver_settlements.agency_id',
    ]) {
      expect(map.has(key), key).toBe(false);
    }
    expect(map.size).toBe(Object.keys(expected).length);
  });

  it('creates the practical lookup indexes and the partial accepted-match index', async () => {
    const r = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [[...TABLES]],
    );
    const byName = new Map(r.rows.map((x) => [x.indexname, x.indexdef]));
    for (const name of [
      'idx_carrier_driver_relationships_recruiter_status',
      'idx_carrier_driver_relationships_driver_status',
      'idx_driver_settlements_driver_pay_date',
      'idx_driver_settlements_carrier_status',
      'idx_driver_settlements_agency_status',
      'idx_driver_settlements_driver_period',
      'idx_driver_settlement_items_settlement_sort',
      'idx_driver_settlement_matches_item_state',
      'idx_driver_settlement_matches_load',
      'idx_driver_settlement_events_settlement_created',
      'uq_driver_settlement_matches_accepted',
    ]) {
      expect(byName.has(name), name).toBe(true);
    }
    const accepted = byName.get('uq_driver_settlement_matches_accepted') ?? '';
    expect(accepted).toMatch(/CREATE UNIQUE INDEX/i);
    expect(accepted).toMatch(/settlement_item_id/);
    expect(accepted.toLowerCase()).toContain('where');
    expect(accepted).toMatch(/exact/);
    expect(accepted).toMatch(/confirmed/);
    expect(byName.get('idx_driver_settlements_driver_pay_date')).toMatch(/DESC/);
  });

  it('cascades items, matches, and events when a settlement is deleted', async () => {
    const s = await insertSettlement();
    const item = await insertItem(s);
    await db.query(
      `INSERT INTO public.driver_settlement_matches
         (settlement_item_id, driver_load_id, match_state) VALUES ($1, $2, 'likely')`,
      [item, ids.load],
    );
    await db.query(
      `INSERT INTO public.driver_settlement_events (settlement_id, event_type)
       VALUES ($1, 'created')`,
      [s],
    );
    await db.query(`DELETE FROM public.driver_settlements WHERE id = $1`, [s]);
    for (const [table, col, val] of [
      ['driver_settlement_items', 'settlement_id', s],
      ['driver_settlement_matches', 'settlement_item_id', item],
      ['driver_settlement_events', 'settlement_id', s],
    ] as const) {
      const c = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM public.${table} WHERE ${col} = $1`,
        [val],
      );
      expect(c.rows[0].count, table).toBe('0');
    }
  });

  it('deletes only the match when a matched load is deleted', async () => {
    const s = await insertSettlement();
    const item = await insertItem(s);
    const l = await db.query<{ id: string }>(
      `INSERT INTO public.loads (user_id) VALUES ($1) RETURNING id`,
      [ids.driver],
    );
    const loadId = l.rows[0].id;
    await db.query(
      `INSERT INTO public.driver_settlement_matches
         (settlement_item_id, driver_load_id, match_state) VALUES ($1, $2, 'confirmed')`,
      [item, loadId],
    );
    await db.query(`DELETE FROM public.loads WHERE id = $1`, [loadId]);
    const matches = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.driver_settlement_matches
        WHERE settlement_item_id = $1`,
      [item],
    );
    expect(matches.rows[0].count).toBe('0');
    const items = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.driver_settlement_items WHERE id = $1`,
      [item],
    );
    expect(items.rows[0].count).toBe('1');
  });
});

// ---------------------------------------------------------------------
// Privacy boundary + source contract — proofs 22–24
// ---------------------------------------------------------------------
describe('Phase 1T-B1 — privacy boundary and source contract', () => {
  const FORBIDDEN_COLUMN_TOKENS = [
    'email',
    'ssn',
    'social_security',
    'ein',
    'bank_account',
    'routing_number',
    'direct_deposit',
    'w4',
    'w_4',
    'i9',
    'i_9',
    'tax_filing',
    'stripe',
    'payroll_tax',
    'payment_credential',
    'card_number',
  ];

  it('has no sensitive or payroll-credential column in the catalog', async () => {
    const r = await db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [[...TABLES]],
    );
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) {
      const col = row.column_name.toLowerCase();
      for (const token of FORBIDDEN_COLUMN_TOKENS) {
        expect(
          col.includes(token),
          `${row.table_name}.${row.column_name} matched ${token}`,
        ).toBe(false);
      }
    }
  });

  it('does not declare a linked load id on settlement items', async () => {
    const r = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'driver_settlement_items'
          AND column_name = 'linked_load_id'`,
    );
    expect(r.rows[0].count).toBe('0');
  });

  it('declares itself a candidate that is not applied live', () => {
    expect(CANDIDATE_SQL.split('\n')[0]).toBe(
      '-- CANDIDATE MIGRATION — NOT APPLIED LIVE.',
    );
    expect(CANDIDATE_SQL).toMatch(/Phase 1T-B1/);
  });

  it('wraps everything in exactly one BEGIN/COMMIT transaction', () => {
    const begins = CANDIDATE_SQL.match(/^BEGIN;$/gm) ?? [];
    const commits = CANDIDATE_SQL.match(/^COMMIT;$/gm) ?? [];
    expect(begins.length).toBe(1);
    expect(commits.length).toBe(1);
    expect(CANDIDATE_SQL.indexOf('\nBEGIN;')).toBeLessThan(
      CANDIDATE_SQL.lastIndexOf('\nCOMMIT;'),
    );
  });

  it('contains no policy, function, trigger, DML, or IF NOT EXISTS table masking', () => {
    const statements = CANDIDATE_SQL.split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?POLICY/i);
    expect(statements).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(statements).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i);
    expect(statements).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(statements).not.toMatch(/^\s*UPDATE\s+/im);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i);
  });

  it('creates exactly the five expected tables in the source', () => {
    const created = (
      CANDIDATE_SQL.match(/CREATE TABLE public\.([a-z_]+)/g) ?? []
    ).map((s) => s.replace('CREATE TABLE public.', ''));
    expect(created.sort()).toEqual([...TABLES].sort());
  });
});
