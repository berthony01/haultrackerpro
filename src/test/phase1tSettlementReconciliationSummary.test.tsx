/**
 * Phase 1T-F2 — Statement-line net vs reported-net reconciliation proofs.
 *
 * Pure arithmetic proofs, presentation proofs, and source-contract proofs.
 * No DB, no network, no snapshots.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  computeSettlementReconciliation,
  type SettlementReconciliationItem,
} from '@/lib/settlements/settlementReconciliation';
import { SettlementReconciliationSummary } from '@/components/settlements/SettlementReconciliationSummary';

const HELPER_SOURCE = resolve(process.cwd(), 'src/lib/settlements/settlementReconciliation.ts');
const COMPONENT_SOURCE = resolve(
  process.cwd(),
  'src/components/settlements/SettlementReconciliationSummary.tsx',
);
const DRIVER_SOURCE = resolve(
  process.cwd(),
  'src/components/settlements/DriverSettlementsView.tsx',
);
const BUSINESS_SOURCE = resolve(
  process.cwd(),
  'src/components/settlements/BusinessSettlementManager.tsx',
);

const FAKE_UUID = '11111111-2222-3333-4444-555555555555';

function line(
  itemType: string | null | undefined,
  amount: number | null | undefined,
): SettlementReconciliationItem {
  return { itemType, amount };
}

const FULL_LINES = [
  line('load_pay', 1000),
  line('earning', 100),
  line('reimbursement', 50),
  line('deduction', 75),
  line('withholding', 25),
];

describe('Phase 1T-F2 — pure reconciliation arithmetic', () => {
  it('1. sums credits and subtractions into a signed line net', () => {
    const r = computeSettlementReconciliation(FULL_LINES, null);
    expect(r.status).toBe('ready');
    expect(r.creditTotal).toBe(1150);
    expect(r.subtractionTotal).toBe(100);
    expect(r.lineNetTotal).toBe(1050);
    expect(r.lineCount).toBe(5);
  });

  it('2. reports a positive difference above reported net', () => {
    const r = computeSettlementReconciliation(FULL_LINES, 1000);
    expect(r.difference).toBe(50);
    expect(r.matchesReportedNet).toBe(false);
  });

  it('3. exact match returns zero difference and true', () => {
    const r = computeSettlementReconciliation(FULL_LINES, 1050);
    expect(r.difference).toBe(0);
    expect(r.matchesReportedNet).toBe(true);
  });

  it('4. negative line net matches a negative reported net', () => {
    const r = computeSettlementReconciliation(
      [line('load_pay', 100), line('deduction', 150)],
      -50,
    );
    expect(r.lineNetTotal).toBe(-50);
    expect(r.difference).toBe(0);
    expect(r.matchesReportedNet).toBe(true);
  });

  it('5. cent arithmetic avoids floating drift', () => {
    const r = computeSettlementReconciliation(
      [line('load_pay', 0.1), line('earning', 0.2)],
      0.3,
    );
    expect(r.lineNetTotal).toBe(0.3);
    expect(r.difference).toBe(0);
    expect(r.matchesReportedNet).toBe(true);
  });

  it('6. unknown item type fails the whole calculation closed', () => {
    const r = computeSettlementReconciliation(
      [line('load_pay', 100), line('mystery_type', 25)],
      100,
    );
    expect(r.status).toBe('invalid_lines');
    expect(r.creditTotal).toBeNull();
    expect(r.lineNetTotal).toBeNull();
    expect(r.difference).toBeNull();
    expect(r.matchesReportedNet).toBeNull();
  });

  it('7. null, negative and non-finite amounts fail closed with no partial totals', () => {
    for (const bad of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = computeSettlementReconciliation(
        [line('load_pay', 100), line('deduction', bad as number | null)],
        100,
      );
      expect(r.status).toBe('invalid_lines');
      expect(r.creditTotal).toBeNull();
      expect(r.subtractionTotal).toBeNull();
      expect(r.lineNetTotal).toBeNull();
    }
    const blank = computeSettlementReconciliation([line('', 10)], 10);
    expect(blank.status).toBe('invalid_lines');
  });

  it('8. empty items produce no_items with no line totals or difference', () => {
    const r = computeSettlementReconciliation([], 500);
    expect(r.status).toBe('no_items');
    expect(r.lineCount).toBe(0);
    expect(r.creditTotal).toBeNull();
    expect(r.subtractionTotal).toBeNull();
    expect(r.lineNetTotal).toBeNull();
    expect(r.difference).toBeNull();
    expect(r.matchesReportedNet).toBeNull();
    expect(r.reportedNetAmount).toBe(500);
  });

  it('9. non-comparable reported net keeps valid line totals but nulls the comparison', () => {
    for (const bad of [null, undefined, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const r = computeSettlementReconciliation(FULL_LINES, bad as number | null);
      expect(r.status).toBe('ready');
      expect(r.lineNetTotal).toBe(1050);
      expect(r.reportedNetAmount).toBeNull();
      expect(r.difference).toBeNull();
      expect(r.matchesReportedNet).toBeNull();
    }
  });
});

const UI_ITEMS = FULL_LINES.map((l) => ({ item_type: l.itemType, amount: l.amount }));

describe('Phase 1T-F2 — presentation', () => {
  it('10. ready state renders the four labels and the exact-match message', () => {
    render(<SettlementReconciliationSummary items={UI_ITEMS} reportedNetAmount={1050} />);
    expect(screen.getByTestId('settlement-reconciliation-summary')).toBeTruthy();
    expect(screen.getByText('Statement reconciliation')).toBeTruthy();
    expect(screen.getByText('Credits from lines')).toBeTruthy();
    expect(screen.getByText('Deductions & withholdings')).toBeTruthy();
    expect(screen.getByText('Net from lines')).toBeTruthy();
    expect(screen.getByText('Reported net')).toBeTruthy();
    expect(
      screen.getByTestId('settlement-reconciliation-difference').textContent,
    ).toBe('Line items match reported net.');
  });

  it('11. above/below wording uses absolute formatted money', () => {
    const above = render(
      <SettlementReconciliationSummary items={UI_ITEMS} reportedNetAmount={1000} />,
    );
    expect(
      above.getByTestId('settlement-reconciliation-difference').textContent,
    ).toBe('Net from lines is $50.00 above reported net.');
    above.unmount();

    const below = render(
      <SettlementReconciliationSummary items={UI_ITEMS} reportedNetAmount={1100} />,
    );
    expect(
      below.getByTestId('settlement-reconciliation-difference').textContent,
    ).toBe('Net from lines is $50.00 below reported net.');
    below.unmount();

    const unavailable = render(
      <SettlementReconciliationSummary items={UI_ITEMS} reportedNetAmount={null} />,
    );
    expect(
      unavailable.getByText('Reported net is unavailable for comparison.'),
    ).toBeTruthy();
    unavailable.unmount();
  });

  it('12. no-items and invalid-lines messages are exact and safe', () => {
    const empty = render(
      <SettlementReconciliationSummary items={[]} reportedNetAmount={100} />,
    );
    expect(
      empty.getByText('No statement lines are available for comparison yet.'),
    ).toBeTruthy();
    empty.unmount();

    const invalid = render(
      <SettlementReconciliationSummary
        items={[{ item_type: 'bogus', amount: 5 }]}
        reportedNetAmount={100}
      />,
    );
    expect(
      invalid.getByText('Statement line totals are unavailable for comparison.'),
    ).toBeTruthy();
    invalid.unmount();
  });

  it('13. no raw identifier or backend error text can surface through props', () => {
    const { container } = render(
      <SettlementReconciliationSummary
        items={[
          {
            ...({ id: FAKE_UUID, settlement_id: FAKE_UUID } as object),
            item_type: 'load_pay',
            amount: 10,
          },
        ]}
        reportedNetAmount={10}
      />,
    );
    expect(container.textContent).not.toContain(FAKE_UUID);
    expect(container.textContent).not.toContain('error');
  });
});

describe('Phase 1T-F2 — source contracts', () => {
  const helperSrc = readFileSync(HELPER_SOURCE, 'utf8');
  const componentSrc = readFileSync(COMPONENT_SOURCE, 'utf8');
  const driverSrc = readFileSync(DRIVER_SOURCE, 'utf8');
  const businessSrc = readFileSync(BUSINESS_SOURCE, 'utf8');

  it('14. driver surface renders the shared summary and keeps one direct settlement-lib import', () => {
    expect(driverSrc).toContain('<SettlementReconciliationSummary');
    expect(driverSrc).toContain('items={items}');
    expect(driverSrc).toContain('reportedNetAmount={settlement.reported_net_amount}');

    const libImports = Array.from(
      driverSrc.matchAll(/from '(@\/lib\/settlements\/[^']+)'/g),
    ).map((m) => m[1]);
    expect(Array.from(new Set(libImports))).toEqual([
      '@/lib/settlements/settlementExport',
    ]);
  });

  it('15. business surface renders the shared summary outside canManage/editable gates', () => {
    expect(businessSrc).toContain('<SettlementReconciliationSummary');
    const idx = businessSrc.indexOf('<SettlementReconciliationSummary');
    const block = businessSrc.slice(idx - 500, idx + 300);
    expect(block.includes('canManage')).toBe(false);
    expect(block.includes('editable')).toBe(false);
  });

  it('16. shared component has no gating or mutation surface', () => {
    for (const forbidden of [
      'useSubscription',
      'isPro',
      'canManage',
      'advancedToolsVisible',
      'basicReconcileVisible',
      'settlements_manage',
      'settlements_finalize',
      'mutateAsync',
      'useMutation',
      'integrations/supabase',
    ]) {
      expect(componentSrc.includes(forbidden), `${forbidden} present`).toBe(false);
    }
  });

  it('17. pure helper imports nothing and touches no backend surface', () => {
    for (const forbidden of [
      'react',
      'integrations/supabase',
      'useAuth',
      'useSubscription',
      'hooks/',
      'Service',
      'document',
      'window',
      'localStorage',
      'fetch(',
      '.rpc(',
      '.from(',
    ]) {
      expect(helperSrc.includes(forbidden), `${forbidden} present`).toBe(false);
    }
    expect(/^\s*import\s/m.test(helperSrc)).toBe(false);
  });

  it('18. existing export controls remain present in both detail surfaces', () => {
    expect(driverSrc).toContain('data-testid="settlement-export-csv"');
    expect(driverSrc).toContain('data-testid="settlement-print"');
    expect(businessSrc).toContain('data-testid="business-settlement-export-csv"');
    expect(businessSrc).toContain('data-testid="business-settlement-print"');
  });
});
