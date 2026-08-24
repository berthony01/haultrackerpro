// Phase 1L-F2B-P2 — canonical financial-disclosure adoption.
//
// This component is now a strict consumer of the Phase 1L-F1 canonical view.
// It never re-derives financials from the raw opportunity row and never
// presents guaranteed pay. Free tier surfaces Listing Transparency and a
// neutral upgrade panel; Pro tier surfaces the canonical financial estimate
// (recurring weekly gross with its source label, effective RPM, deadhead
// percentage, and — only for cost-bearing employment models — known weekly
// costs, estimated weekly net, and net-per-total-mile), along with the
// calculator's diagnostics (missing / invalid / conflicts / assumptions).
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Info,
  Lock,
  AlertTriangle,
  ShieldCheck,
  TrendingUp,
  Gauge,
  DollarSign,
} from 'lucide-react';
import type {
  CanonicalOpportunity,
  ListingTransparencyBand,
  Disclosure,
  CanonicalRecurringAmount,
} from '@/lib/opportunities/opportunityCanonicalView';

interface Props {
  canonical: CanonicalOpportunity;
  isPro: boolean;
  onUpgrade: () => void;
  /**
   * Phase OD-2 — presentation-only. When true, Listing Transparency and the
   * Financial Disclosure block are merged into a single surface and the
   * secondary cost rows / diagnostics collapse behind an expander. No value,
   * gating, or disclosure semantics change.
   */
  compact?: boolean;
}


const BAND_LABEL: Record<ListingTransparencyBand, string> = {
  complete: 'Complete',
  mostly_complete: 'Mostly complete',
  partial: 'Partial',
  sparse: 'Sparse',
};

const BAND_CLASS: Record<ListingTransparencyBand, string> = {
  complete: 'border-success/40 text-success',
  mostly_complete: 'border-primary/40 text-primary',
  partial: 'border-warning/40 text-warning',
  sparse: 'border-border text-muted-foreground',
};

const STATUS_LABEL: Record<
  CanonicalOpportunity['derived']['financialEstimate']['status'],
  string
> = {
  available: 'Available',
  incomplete: 'Incomplete',
  not_applicable: 'Not applicable',
  conflict: 'Conflict',
};

const fmtMoneyN = (v: number | null): string =>
  v == null ? '—' : `$${Math.round(v).toLocaleString()}`;
const fmtRpm = (v: number | null): string =>
  v == null ? '—' : `$${Number(v).toFixed(2)}/mi`;
const fmtPct = (v: number | null): string =>
  v == null ? '—' : `${Math.round(v)}%`;

function grossLabel(source: 'derived' | 'recruiter_provided' | null): string {
  if (source === 'derived') return 'Derived weekly gross';
  if (source === 'recruiter_provided') return 'Recruiter weekly gross';
  return 'Weekly gross';
}

function grossValue(fe: CanonicalOpportunity['derived']['financialEstimate']): string {
  if (typeof fe.recurringWeeklyGross === 'number' && Number.isFinite(fe.recurringWeeklyGross)) {
    return `$${Math.round(fe.recurringWeeklyGross).toLocaleString()}`;
  }
  if (fe.status === 'not_applicable') return 'Not applicable';
  if (fe.status === 'incomplete' || fe.status === 'conflict') return 'Incomplete';
  return 'Not disclosed';
}

function fmtRecurring(d: Disclosure<CanonicalRecurringAmount>): string {
  if (d.state === 'provided') {
    const { amount, frequency } = d.value;
    if (!Number.isFinite(amount)) return 'Not disclosed';
    const money = `$${Math.round(amount).toLocaleString()}`;
    if (frequency == null) return money;
    return `${money} ${frequency}`;
  }
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Not disclosed';
}

function fmtStr(d: Disclosure<string>): string {
  if (d.state === 'provided') return d.value;
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Not disclosed';
}

function fmtBoolYN(d: Disclosure<boolean>): string {
  if (d.state === 'provided') return d.value ? 'Yes' : 'No';
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Not disclosed';
}

function humanize(key: string): string {
  const cleaned = key.replace(/\[\d+\]/g, '').replace(/([A-Z])/g, ' $1').trim();
  if (!cleaned) return key;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

export function OpportunityProfitBreakdown({ canonical, isPro, onUpgrade }: Props) {
  const t = canonical.derived.transparencyScore;
  const fe = canonical.derived.financialEstimate;
  const em = canonical.classification.employmentModel;
  const isCostBearing =
    em === 'contractor_1099' || em === 'owner_operator' || em === 'lease_purchase';
  const isCompanyDriver = em === 'company_driver';
  const isUnknownEm = em === 'unknown';

  const missingCount = t.missingRelevantFields.length;
  const conflictCount = t.conflicts.length;
  const transparencyDescriptor = `Listing transparency: ${t.score} out of 100, ${BAND_LABEL[t.band]}. Measures disclosure completeness and consistency, not profitability.`;

  return (
    <div className="space-y-4">
      {/* Listing Transparency — always visible, free + pro */}
      <Card className="p-5 border-border/60">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="rounded-lg bg-primary/10 p-1.5">
            <ShieldCheck className="h-4 w-4 text-primary" />
          </div>
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
            Listing Transparency
          </h3>
          <Badge
            variant="outline"
            className={`ml-auto gap-1 ${BAND_CLASS[t.band]}`}
            title={transparencyDescriptor}
            aria-label={transparencyDescriptor}
          >
            <Info className="h-3 w-3" aria-hidden /> Transparency {t.score} · {BAND_LABEL[t.band]}
          </Badge>
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <p className="font-mono text-2xl font-black text-foreground">{t.score}</p>
          <p className="text-xs text-muted-foreground">/100</p>
        </div>
        <Progress value={t.score} className="h-2 mb-3" />
        <div className="grid grid-cols-2 gap-3 text-sm mb-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Missing disclosures
            </p>
            <p className="text-sm font-semibold text-foreground">{missingCount}</p>
          </div>
          {conflictCount > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Conflicts
              </p>
              <p className="text-sm font-semibold text-destructive">{conflictCount}</p>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Listing Transparency measures disclosure completeness and consistency, not profitability.
        </p>
      </Card>

      {!isPro ? (
        <Card className="p-6 border-primary/30 bg-primary/5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/15 p-2">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-bold text-foreground mb-1">
                Unlock detailed financial disclosures
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                See the disclosed recurring gross and, for cost-bearing employment models,
                the estimated weekly net calculated from the recruiter's disclosed weekly costs.
                Estimates never present as guaranteed pay.
              </p>
              <Button onClick={onUpgrade}>Upgrade to Pro</Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-5 border-border/60">
          <div className="flex items-center gap-2 mb-4">
            <div className="rounded-lg bg-primary/10 p-1.5">
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
              Financial Disclosure
            </h3>
            <Badge variant="outline" className="ml-auto">{STATUS_LABEL[fe.status]}</Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <KV icon={DollarSign} label={grossLabel(fe.grossSource)} value={grossValue(fe)} highlight />
            <KV icon={Gauge} label="Gross per total mile" value={fmtRpm(fe.effectiveRpm)} />
            <KV
              icon={AlertTriangle}
              label="Deadhead %"
              value={fmtPct(fe.deadheadPercentage)}
              warn={(fe.deadheadPercentage ?? 0) > 30}
            />
            {isCostBearing && (
              <>
                <KV
                  icon={DollarSign}
                  label="Known weekly costs"
                  value={fmtMoneyN(fe.totalKnownWeeklyCosts)}
                />
                <KV
                  icon={TrendingUp}
                  label="Estimated weekly net"
                  value={fmtMoneyN(fe.estimatedWeeklyNet)}
                  highlight
                />
                <KV icon={Gauge} label="Net per total mile" value={fmtRpm(fe.netRpm)} />
              </>
            )}
          </div>

          {isCompanyDriver && (
            <p className="text-xs text-muted-foreground mb-3">
              Company driver: employer-borne operating costs are excluded.
            </p>
          )}
          {isUnknownEm && (
            <p className="text-xs text-muted-foreground mb-3">
              Employment arrangement must be disclosed before ownership-cost net can be estimated.
            </p>
          )}

          {isCostBearing && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <KV label="Fuel paid by" value={fmtStr(canonical.costs.fuelPaidBy)} />
              <KV label="Insurance" value={fmtRecurring(canonical.costs.insurance)} />
              <KV label="Maintenance" value={fmtRecurring(canonical.costs.maintenance)} />
              <KV label="Other recurring cost" value={fmtRecurring(canonical.costs.otherRecurringCost)} />
              {em === 'lease_purchase' && (
                <KV label="Lease payment" value={fmtRecurring(canonical.costs.lease)} />
              )}
              <KV label="Escrow required" value={fmtBoolYN(canonical.costs.escrowRequired)} />
              {canonical.costs.escrowRequired.state === 'provided' &&
                canonical.costs.escrowRequired.value === true && (
                  <KV label="Escrow amount" value={fmtRecurring(canonical.costs.escrowAmount)} />
                )}
            </div>
          )}

          {fe.missingInputs.length > 0 && (
            <DiagBlock
              title="Missing disclosures"
              items={fe.missingInputs.map(humanize)}
              tone="warn"
            />
          )}
          {fe.invalidInputs.length > 0 && (
            <DiagBlock
              title="Invalid disclosures"
              items={fe.invalidInputs.map(humanize)}
              tone="destructive"
            />
          )}
          {fe.conflicts.length > 0 && (
            <DiagBlock title="Conflicts" items={fe.conflicts} tone="destructive" />
          )}
          {fe.assumptions.length > 0 && (
            <DiagBlock title="Calculation assumptions" items={fe.assumptions} tone="muted" />
          )}

          <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground mt-3">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Estimates use disclosed recurring compensation and relevant recurring costs.
              They are not guaranteed pay.
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}

function KV({
  icon: Icon,
  label,
  value,
  highlight,
  warn,
}: {
  icon?: typeof DollarSign;
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className={`h-3 w-3 ${warn ? 'text-destructive' : 'text-primary'}`} />}
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </p>
      </div>
      <p
        className={`text-sm font-bold whitespace-nowrap ${
          warn ? 'text-destructive' : highlight ? 'text-primary' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function DiagBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'warn' | 'destructive' | 'muted';
}) {
  const cls =
    tone === 'destructive'
      ? 'bg-destructive/10 border-destructive/30 text-destructive'
      : tone === 'warn'
      ? 'bg-warning/10 border-warning/30 text-warning'
      : 'bg-muted/30 border-border text-muted-foreground';
  return (
    <div className={`rounded-lg border p-3 mb-3 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold mb-1">{title}</p>
      <ul className="list-disc pl-5 space-y-0.5">
        {items.map((i, idx) => (
          <li key={idx} className="text-xs">
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}
