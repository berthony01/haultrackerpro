import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Lock,
  AlertTriangle,
  ShieldCheck,
  TrendingUp,
  Gauge,
  DollarSign,
  Info,
} from 'lucide-react';
import {
  calculateOpportunityFinancials,
  profitScoreLabel,
  type OpportunityLike,
} from '@/lib/opportunities/opportunityProfit';

interface Props {
  opportunity: OpportunityLike;
  isPro: boolean;
  onUpgrade: () => void;
}

const fmtMoney = (v: number | null | undefined) =>
  v == null ? '—' : `$${Math.round(Number(v)).toLocaleString()}`;
const fmtRpm = (v: number | null | undefined) =>
  v == null ? '—' : `$${Number(v).toFixed(2)}/mi`;
const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${v.toFixed(0)}%`;

export function OpportunityProfitBreakdown({ opportunity, isPro, onUpgrade }: Props) {
  if (!isPro) {
    return (
      <Card className="p-6 border-primary/30 bg-primary/5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/15 p-2">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-foreground mb-1">
              Unlock Profit Intelligence
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              See estimated net pay, RPM, deductions, deadhead risk, and profit
              warnings before you request info.
            </p>
            <Button onClick={onUpgrade}>Upgrade to Pro</Button>
          </div>
        </div>
      </Card>
    );
  }

  const f = calculateOpportunityFinancials(opportunity);
  const score = profitScoreLabel(f.profitScore);

  const warnings: { text: string; tone: 'warn' | 'destructive' }[] = [];
  if (f.hasUnpaidDeadhead) warnings.push({ text: 'Deadhead appears unpaid', tone: 'destructive' });
  if (f.hasUnknownDeadheadPay) warnings.push({ text: 'Deadhead pay not disclosed', tone: 'warn' });
  if (f.hasLeaseRisk) warnings.push({ text: 'Lease payment detected', tone: 'warn' });
  if (f.hasHighDeductionRisk) warnings.push({ text: 'High deductions may reduce take-home pay', tone: 'warn' });
  if (f.missingPayData) warnings.push({ text: 'Pay data is incomplete', tone: 'warn' });
  if (f.estimatedGross != null && f.estimatedNet != null && f.estimatedNet < f.estimatedGross * 0.7) {
    warnings.push({ text: 'Net estimate may be lower than advertised gross', tone: 'warn' });
  }

  const scoreToneClass =
    score.tone === 'success'
      ? 'text-success'
      : score.tone === 'primary'
      ? 'text-primary'
      : score.tone === 'warn'
      ? 'text-warning'
      : 'text-destructive';

  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-center gap-2 mb-4">
        <div className="rounded-lg bg-primary/10 p-1.5">
          <ShieldCheck className="h-4 w-4 text-primary" />
        </div>
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
          Profit Intelligence
        </h3>
        <Badge variant="outline" className="ml-auto">Estimate</Badge>
      </div>

      {/* Score */}
      <div className="rounded-xl bg-muted/30 p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Profit Clarity Score
          </p>
          <span className={`text-xs font-bold ${scoreToneClass}`}>{score.label}</span>
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <p className={`font-mono text-3xl font-black ${scoreToneClass}`}>{f.profitScore}</p>
          <p className="text-xs text-muted-foreground">/100</p>
        </div>
        <Progress value={f.profitScore} className="h-2" />
      </div>

      {/* Financials grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <KV icon={DollarSign} label="Est. gross" value={fmtMoney(f.estimatedGross)} highlight />
        <KV icon={DollarSign} label="Est. deductions" value={fmtMoney(f.totalKnownDeductions || null)} />
        <KV icon={TrendingUp} label="Est. net" value={fmtMoney(f.estimatedNet)} highlight />
        <KV icon={Gauge} label="Effective RPM" value={fmtRpm(f.effectiveRpm)} />
        <KV icon={Gauge} label="Net RPM" value={fmtRpm(f.netRpm)} />
        <KV
          icon={AlertTriangle}
          label="Deadhead %"
          value={fmtPct(f.deadheadPercentage)}
          warn={(f.deadheadPercentage ?? 0) > 30}
        />
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-2 mb-4">
          {warnings.map((w, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-lg p-3 text-sm border ${
                w.tone === 'destructive'
                  ? 'bg-destructive/10 border-destructive/30 text-destructive'
                  : 'bg-warning/10 border-warning/30 text-warning'
              }`}
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{w.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Disclaimer */}
      <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          These estimates are based on the information provided by the recruiter
          and are not guaranteed pay.
        </span>
      </div>
    </Card>
  );
}

function KV({
  icon: Icon,
  label,
  value,
  highlight,
  warn,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`h-3 w-3 ${warn ? 'text-destructive' : 'text-primary'}`} />
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
