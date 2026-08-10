/**
 * Phase 1T-F1 — Settlement CSV + print export acceptance proofs.
 *
 * Pure utility proofs plus source-contract integration proofs. No DB, no
 * network, no snapshots.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  buildSettlementCsv,
  buildSettlementCsvFilename,
  buildSettlementPrintHtml,
  downloadSettlementCsv,
  printSettlement,
  SETTLEMENT_EXPORT_DISCLAIMER,
  type SettlementExportItem,
  type SettlementExportStatement,
} from '@/lib/settlements/settlementExport';

const EXPORT_SOURCE = resolve(process.cwd(), 'src/lib/settlements/settlementExport.ts');
const DRIVER_SOURCE = resolve(
  process.cwd(),
  'src/components/settlements/DriverSettlementsView.tsx',
);
const BUSINESS_SOURCE = resolve(
  process.cwd(),
  'src/components/settlements/BusinessSettlementManager.tsx',
);

const FAKE_UUID = '11111111-2222-3333-4444-555555555555';

function statement(
  overrides: Partial<SettlementExportStatement> = {},
): SettlementExportStatement {
  return {
    sourceLabel: 'Blue Line Carriers',
    payerLabel: 'Blue Line Carriers LLC',
    driverLabel: 'Jordan D.',
    status: 'finalized',
    versionNumber: 2,
    periodStart: '2026-07-01',
    periodEnd: '2026-07-07',
    payDate: '2026-07-11',
    statementReference: 'STMT-4412',
    reportedGrossAmount: 4200.5,
    reportedNetAmount: 3810.25,
    notes: 'Weekly statement',
    ...overrides,
  };
}

function item(overrides: Partial<SettlementExportItem> = {}): SettlementExportItem {
  return {
    itemType: 'load_pay',
    category: 'linehaul',
    description: 'Dallas to Houston',
    amount: 900,
    payMethod: 'per_mile',
    quantity: 240,
    rate: 0.62,
    unitLabel: 'miles',
    loadReference: 'LD-9001',
    pickupDate: '2026-07-02',
    deliveryDate: '2026-07-03',
    origin: 'Dallas, TX',
    destination: 'Houston, TX',
    loadedMiles: 240,
    deadheadMiles: 18,
    payableMiles: 258,
    eligibleRevenue: 1500,
    expectedAmount: 910,
    ...overrides,
  };
}

describe('Phase 1T-F1 — CSV content', () => {
  it('1. includes the HaulTracker Pro title, summary values and statement line content', () => {
    const csv = buildSettlementCsv(statement(), [item()]);
    expect(csv).toContain('HaulTracker Pro — Settlement Record');
    expect(csv).toContain('Blue Line Carriers');
    expect(csv).toContain('Blue Line Carriers LLC');
    expect(csv).toContain('finalized');
    expect(csv).toContain('Version,2');
    expect(csv).toContain('2026-07-01 to 2026-07-07');
    expect(csv).toContain('4200.5');
    expect(csv).toContain('3810.25');
    expect(csv).toContain('STATEMENT LINES');
    expect(csv).toContain('Dallas to Houston');
    expect(csv).toContain('LD-9001');
    expect(csv).toContain(SETTLEMENT_EXPORT_DISCLAIMER);
  });

  it('2. escapes commas, quotes and CR/LF safely', () => {
    const csv = buildSettlementCsv(
      statement({ notes: 'line one\r\nline two' }),
      [
        item({ description: 'Fuel, tolls', category: 'He said "ok"' }),
      ],
    );
    expect(csv).toContain('"Fuel, tolls"');
    expect(csv).toContain('"He said ""ok"""');
    expect(csv).toContain('"line one\r\nline two"');
  });

  it('3. nulls are blank and non-finite numbers never emit NaN/Infinity/undefined', () => {
    const csv = buildSettlementCsv(
      statement({
        notes: null,
        statementReference: null,
        payDate: null,
        driverLabel: null,
        reportedGrossAmount: Number.NaN,
        reportedNetAmount: Number.POSITIVE_INFINITY,
      }),
      [item({ amount: Number.NaN, rate: null, quantity: Number.NEGATIVE_INFINITY })],
    );
    expect(csv).not.toContain('NaN');
    expect(csv).not.toContain('Infinity');
    expect(csv).not.toContain('undefined');
    expect(csv).not.toContain('null');
    expect(csv).toContain('Notes,');
  });

  it('4. cannot leak raw UUIDs because the export API has no id fields', () => {
    const csv = buildSettlementCsv(
      statement(),
      [item({ ...({ id: FAKE_UUID, settlement_id: FAKE_UUID } as object) })],
    );
    expect(csv).not.toContain(FAKE_UUID);
  });
});

describe('Phase 1T-F1 — download', () => {
  const created: string[] = [];
  let revoked: string[] = [];
  let clicked = 0;

  beforeEach(() => {
    revoked = [];
    clicked = 0;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => {
      created.push('blob:mock');
      return 'blob:mock';
    });
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn(
      (u: string) => {
        revoked.push(u);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('5. uses Blob + object URL + anchor with a date-range filename and no UUID', () => {
    const anchor = document.createElement('a');
    anchor.click = () => {
      clicked += 1;
    };
    const spy = vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    downloadSettlementCsv(statement(), [item()]);

    spy.mockRestore();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clicked).toBe(1);
    expect(anchor.download).toBe(
      'haultrackerpro-settlement_2026-07-01_to_2026-07-07.csv',
    );
    expect(anchor.download).not.toContain(FAKE_UUID);
    expect(revoked).toEqual(['blob:mock']);
  });

  it('5b. filename sanitizes unsafe segments and never contains a UUID', () => {
    const name = buildSettlementCsvFilename(
      statement({ periodStart: FAKE_UUID, periodEnd: null }),
    );
    expect(name).not.toContain(FAKE_UUID);
    expect(name).toMatch(/^haultrackerpro-settlement_[A-Za-z0-9-]+_to_[A-Za-z0-9-]+\.csv$/);
  });
});

describe('Phase 1T-F1 — print HTML', () => {
  it('6. escapes HTML so injected markup never becomes an executable element', () => {
    const html = buildSettlementPrintHtml(
      statement({
        payerLabel: '<script>alert("x")</script>',
        notes: 'a & b "quoted" <b>bold</b>',
      }),
      [item({ description: "<img src=x onerror='hack()'>" })],
    );
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');

    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('script').length).toBe(0);
    expect(doc.querySelectorAll('img').length).toBe(0);
  });

  it('7. includes summary, lines, disclaimer and no raw IDs', () => {
    const html = buildSettlementPrintHtml(statement(), [item()]);
    expect(html).toContain('Summary');
    expect(html).toContain('Statement lines');
    expect(html).toContain('Blue Line Carriers LLC');
    expect(html).toContain('Jordan D.');
    expect(html).toContain('Dallas to Houston');
    expect(html).toContain(SETTLEMENT_EXPORT_DISCLAIMER);
    expect(html).not.toContain(FAKE_UUID);
  });

  it('8. printSettlement throws the exact safe error when the window cannot open', () => {
    const spy = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => printSettlement(statement(), [item()])).toThrow(
      'Unable to open print window',
    );
    spy.mockRestore();
  });
});

describe('Phase 1T-F1 — source integration contracts', () => {
  const driverSrc = readFileSync(DRIVER_SOURCE, 'utf8');
  const businessSrc = readFileSync(BUSINESS_SOURCE, 'utf8');
  const exportSrc = readFileSync(EXPORT_SOURCE, 'utf8');

  it('9. driver detail exposes both export controls via the shared utility, ungated', () => {
    expect(driverSrc).toContain('data-testid="settlement-export-csv"');
    expect(driverSrc).toContain('data-testid="settlement-print"');
    expect(driverSrc).toContain('Download CSV');
    expect(driverSrc).toContain('downloadSettlementCsv(');
    expect(driverSrc).toContain('printSettlement(');

    const csvIndex = driverSrc.indexOf('data-testid="settlement-export-csv"');
    const printIndex = driverSrc.indexOf('data-testid="settlement-print"');
    const block = driverSrc.slice(csvIndex - 600, printIndex + 400);
    for (const gate of [
      'advancedToolsVisible',
      'basicReconcileVisible',
      'isPro',
      'settlements_manage',
    ]) {
      expect(block.includes(gate), `${gate} gates export`).toBe(false);
    }
  });

  it('10. business detail exposes both export controls outside canManage gating', () => {
    expect(businessSrc).toContain('data-testid="business-settlement-export-csv"');
    expect(businessSrc).toContain('data-testid="business-settlement-print"');
    expect(businessSrc).toContain('downloadSettlementCsv(');
    expect(businessSrc).toContain('printSettlement(');

    const csvIndex = businessSrc.indexOf('data-testid="business-settlement-export-csv"');
    const printIndex = businessSrc.indexOf('data-testid="business-settlement-print"');
    const block = businessSrc.slice(csvIndex - 600, printIndex + 400);
    expect(block.includes('canManage')).toBe(false);
    expect(block.includes('editable')).toBe(false);
  });

  it('11. existing exported event compatibility label is untouched', () => {
    expect(businessSrc).toContain("exported: 'Statement exported',");
  });

  it('12. export utility imports no backend/auth/subscription surface', () => {
    for (const forbidden of [
      'integrations/supabase',
      'useAuth',
      'useSubscription',
      'settlementService',
      'settlementReadService',
      'hooks/settlements',
      '.rpc(',
      '.from(',
    ]) {
      expect(exportSrc.includes(forbidden), `${forbidden} present`).toBe(false);
    }
  });
});
