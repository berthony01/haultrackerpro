/**
 * Phase 1T-F2 — Shared, read-only statement reconciliation summary.
 *
 * Presentation only. No mutations, no plan/permission/entitlement checks, no
 * backend access. It compares the visible statement lines with the reported
 * net purely for recordkeeping.
 */

import { useMemo } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  computeSettlementReconciliation,
  type SettlementReconciliationItem,
} from '@/lib/settlements/settlementReconciliation';

export interface SettlementReconciliationSummaryProps {
  items: readonly { item_type?: string | null; amount?: number | null }[];
  reportedNetAmount: number | null | undefined;
}

function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function SettlementReconciliationSummary({
  items,
  reportedNetAmount,
}: SettlementReconciliationSummaryProps) {
  const result = useMemo(() => {
    const mapped: SettlementReconciliationItem[] = items.map((item) => ({
      itemType: item.item_type,
      amount: item.amount,
    }));
    return computeSettlementReconciliation(mapped, reportedNetAmount);
  }, [items, reportedNetAmount]);

  return (
    <Card className="border-border/60" data-testid="settlement-reconciliation-summary">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Statement reconciliation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Compares the visible statement lines with the reported net for recordkeeping.
        </p>

        {result.status === 'no_items' && (
          <p className="text-sm text-muted-foreground">
            No statement lines are available for comparison yet.
          </p>
        )}

        {result.status === 'invalid_lines' && (
          <p className="text-sm text-muted-foreground">
            Statement line totals are unavailable for comparison.
          </p>
        )}

        {result.status === 'ready' && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Figure label="Credits from lines" value={formatMoney(result.creditTotal)} />
              <Figure
                label="Deductions & withholdings"
                value={formatMoney(result.subtractionTotal)}
              />
              <Figure label="Net from lines" value={formatMoney(result.lineNetTotal)} />
              <Figure label="Reported net" value={formatMoney(result.reportedNetAmount)} />
            </div>

            {result.difference === null ? (
              <p className="text-sm text-muted-foreground">
                Reported net is unavailable for comparison.
              </p>
            ) : (
              <p
                className="text-sm text-foreground"
                data-testid="settlement-reconciliation-difference"
              >
                {result.matchesReportedNet
                  ? 'Line items match reported net.'
                  : result.difference > 0
                    ? `Net from lines is ${formatMoney(result.difference)} above reported net.`
                    : `Net from lines is ${formatMoney(Math.abs(result.difference))} below reported net.`}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default SettlementReconciliationSummary;
