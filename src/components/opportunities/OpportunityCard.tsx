import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  MapPin,
  Truck,
  DollarSign,
  Gauge,
  ShieldCheck,
  Bookmark,
  BookmarkCheck,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import type { Opportunity } from '@/hooks/opportunities/useOpportunities';
import {
  calculateOpportunityFinancials,
  profitScoreLabel,
} from '@/lib/opportunities/opportunityProfit';
import { calculateOpportunityMatch } from '@/lib/opportunities/opportunityMatch';
import type { DriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';
import { OpportunityMatchBadge } from './OpportunityMatchBadge';

interface Props {
  opportunity: Opportunity;
  isSaved: boolean;
  onView: () => void;
  onToggleSave: () => void;
  saving?: boolean;
  isPro?: boolean;
  driverProfile?: DriverOpportunityProfile | null;
}

const fmtMoney = (v: number | null | undefined) =>
  v == null ? '—' : `$${Math.round(Number(v)).toLocaleString()}`;
const fmtMiles = (v: number | null | undefined) =>
  v == null ? '—' : `${Math.round(Number(v)).toLocaleString()} mi`;
const fmtRpm = (v: number | null | undefined) =>
  v == null ? '—' : `$${Number(v).toFixed(2)}`;

export function OpportunityCard({ opportunity: o, isSaved, onView, onToggleSave, saving, isPro, driverProfile }: Props) {
  const location = [o.hiring_city, o.hiring_state].filter(Boolean).join(', ') || 'Multiple states';
  const f = calculateOpportunityFinancials(o);
  const score = profitScoreLabel(f.profitScore);
  const scoreClass =
    score.tone === 'success'
      ? 'border-success/40 text-success'
      : score.tone === 'primary'
      ? 'border-primary/40 text-primary'
      : score.tone === 'warn'
      ? 'border-warning/40 text-warning'
      : 'border-destructive/40 text-destructive';

  const match = driverProfile && driverProfile.profile_completed
    ? calculateOpportunityMatch({ opportunity: o, driverProfile, opportunityFinancials: f })
    : null;

  const recruiter = (o as Opportunity & {
    recruiter?: { verification_status?: string | null; status?: string | null } | null;
  }).recruiter ?? null;
  const isVerifiedRecruiter =
    !!recruiter &&
    recruiter.verification_status === 'approved' &&
    recruiter.status !== 'suspended';

  return (
    <Card className="p-5 border-border/60 hover:border-primary/40 transition-colors flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-base font-bold text-foreground truncate">{o.title}</h3>
            {o.featured && (
              <Badge
                variant="secondary"
                className="bg-primary/15 text-primary border-primary/20"
                title="Priority placement — Growth or Fleet plan"
                aria-label="Priority placement — Growth or Fleet plan"
              >
                Priority placement
              </Badge>
            )}
            {isVerifiedRecruiter && (
              <Badge variant="outline" className="border-success/40 text-success gap-1">
                <ShieldCheck className="h-3 w-3" /> Verified Recruiter
              </Badge>
            )}
            {isPro && (
              <Badge variant="outline" className={`gap-1 ${scoreClass}`}>
                <TrendingUp className="h-3 w-3" /> {f.profitScore}
              </Badge>
            )}
            {match && (
              <OpportunityMatchBadge score={match.matchScore} tier={match.matchTier} />
            )}
          </div>
          <p className="text-sm text-muted-foreground font-semibold truncate">{o.company_name}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSave}
          disabled={saving}
          aria-label={isSaved ? 'Unsave' : 'Save'}
          className="shrink-0 text-muted-foreground hover:text-primary"
        >
          {isSaved ? <BookmarkCheck className="h-5 w-5 text-primary" /> : <Bookmark className="h-5 w-5" />}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {o.driver_type && <Badge variant="outline">{o.driver_type}</Badge>}
        {o.route_type && <Badge variant="outline">{o.route_type}</Badge>}
        {o.trailer_type && <Badge variant="outline">{o.trailer_type}</Badge>}
        {o.home_time && <Badge variant="outline">{o.home_time}</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Stat icon={MapPin} label="Hiring" value={location} />
        <Stat icon={DollarSign} label="Est. weekly gross" value={fmtMoney(f.estimatedGross)} />
        {isPro ? (
          <>
            <EstimatedNetStat value={f.estimatedNet} />
            <Stat icon={Gauge} label="Effective RPM" value={fmtRpm(f.effectiveRpm)} />
          </>
        ) : (
          <>
            <Stat icon={Gauge} label="Weekly miles" value={fmtMiles(f.estimatedWeeklyMiles)} />
            <Stat
              icon={Truck}
              label="Deadhead"
              value={`${fmtMiles(f.estimatedDeadheadMiles)}${
                o.deadhead_paid === true ? ' • paid' : o.deadhead_paid === false ? ' • unpaid' : ''
              }`}
              warn={f.hasUnpaidDeadhead}
            />
          </>
        )}
      </div>

      {match && (match.reasons.length > 0 || match.hasSevereWarning) && (
        <div className="space-y-1.5 rounded-lg bg-muted/30 border border-border/40 p-3">
          {match.reasons.slice(0, 2).map((r) => (
            <div key={r} className="flex items-start gap-2 text-xs text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
              <span>{r}</span>
            </div>
          ))}
          {match.hasSevereWarning && match.warnings[0] && (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{match.warnings[0]}</span>
            </div>
          )}
        </div>
      )}

      <Button onClick={onView} className="w-full">View Details</Button>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  warn,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${warn ? 'text-destructive' : 'text-primary'}`} />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
        <p className="text-sm font-semibold text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}
