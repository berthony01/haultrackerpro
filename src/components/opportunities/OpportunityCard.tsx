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
  Info,
} from 'lucide-react';
import type { Opportunity } from '@/hooks/opportunities/useOpportunities';
import { calculateOpportunityFinancials } from '@/lib/opportunities/opportunityProfit';
import { calculateOpportunityMatch } from '@/lib/opportunities/opportunityMatch';
import {
  normalizeOpportunity,
  type CanonicalOpportunity,
  type OpportunitySourceRow,
  type Disclosure,
  type ListingTransparencyBand,
  type CanonicalEmploymentModel,
} from '@/lib/opportunities/opportunityCanonicalView';
import type { CanonicalTeamConfiguration } from '@/lib/opportunities/opportunityCanonical';
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

const fmtMoney = (v: number) => `$${Math.round(v).toLocaleString()}`;
const fmtMilesN = (v: number) => `${Math.round(v).toLocaleString()} mi`;
const fmtRpm = (v: number | null | undefined) =>
  v == null ? '—' : `$${Number(v).toFixed(2)}`;

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

const EMPLOYMENT_LABEL: Record<CanonicalEmploymentModel, string> = {
  company_driver: 'Company Driver',
  contractor_1099: '1099 Contractor',
  owner_operator: 'Owner-Operator',
  lease_purchase: 'Lease-Purchase',
  unknown: 'Employment not disclosed',
};

const TEAM_LABEL: Record<CanonicalTeamConfiguration, string> = {
  solo: 'Solo',
  team: 'Team',
  solo_or_team: 'Team optional',
  unspecified: 'Team setup not disclosed',
};

function isCostBearing(em: CanonicalEmploymentModel): boolean {
  return em === 'contractor_1099' || em === 'owner_operator' || em === 'lease_purchase';
}

function discString(d: Disclosure<string>): string {
  if (d.state === 'provided') return d.value;
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Not disclosed';
}

function companyDisplay(d: Disclosure<string>): string {
  if (d.state === 'provided') return d.value;
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Company not disclosed';
}

function discMilesDisplay(d: Disclosure<number>): string {
  if (d.state === 'provided') return fmtMilesN(d.value);
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Not disclosed';
}

function deadheadSuffix(d: Disclosure<boolean>): string {
  if (d.state === 'provided') return d.value ? ' · paid' : ' · unpaid';
  if (d.state === 'not_applicable') return '';
  return ' · pay not disclosed';
}

function grossLabelFor(source: 'derived' | 'recruiter_provided' | null): string {
  if (source === 'derived') return 'Derived weekly gross';
  if (source === 'recruiter_provided') return 'Recruiter weekly gross';
  return 'Weekly gross';
}

function grossValueFor(canonical: CanonicalOpportunity): string {
  const fe = canonical.derived.financialEstimate;
  if (typeof fe.recurringWeeklyGross === 'number' && Number.isFinite(fe.recurringWeeklyGross)) {
    return fmtMoney(fe.recurringWeeklyGross);
  }
  if (fe.status === 'not_applicable') return 'Not applicable';
  if (fe.status === 'incomplete' || fe.status === 'conflict') return 'Incomplete';
  return 'Not disclosed';
}

export function OpportunityCard({
  opportunity: o,
  isSaved,
  onView,
  onToggleSave,
  saving,
  isPro,
  driverProfile,
}: Props) {
  const canonical = normalizeOpportunity(o as OpportunitySourceRow);
  const f = calculateOpportunityFinancials(o);

  const match =
    driverProfile && driverProfile.profile_completed
      ? calculateOpportunityMatch({ opportunity: o, driverProfile, opportunityFinancials: f })
      : null;

  const t = canonical.derived.transparencyScore;
  const bandLabel = BAND_LABEL[t.band];
  const transparencyText = `Transparency ${t.score} · ${bandLabel}`;
  const transparencyDescriptor = `Listing transparency: ${t.score} out of 100, ${bandLabel}. Measures disclosure completeness and consistency, not profitability.`;

  const employment = canonical.classification.employmentModel;
  const team = canonical.classification.teamConfiguration;
  const costBearing = isCostBearing(employment);



  

  const featured = canonical.trust.featured;
  const isVerifiedRecruiter = canonical.trust.recruiterVerification === 'approved';

  const grossLabel = grossLabelFor(canonical.derived.financialEstimate.grossSource);
  const grossValue = grossValueFor(canonical);

  const totalMiles = canonical.compensation.mileage.totalWeeklyMiles;
  const deadheadMiles = canonical.compensation.mileage.deadheadWeeklyMiles;
  const deadheadPaid = canonical.compensation.mileage.deadheadPaid;

  const deadheadValue = `${discMilesDisplay(deadheadMiles)}${deadheadSuffix(deadheadPaid)}`;
  const deadheadWarn =
    deadheadMiles.state === 'provided' &&
    deadheadMiles.value > 0 &&
    deadheadPaid.state === 'provided' &&
    deadheadPaid.value === false;

  const fe = canonical.derived.financialEstimate;
  const canShowNet = costBearing && typeof fe.estimatedWeeklyNet === 'number';
  const showCostBearingPro = isPro && costBearing;

  return (
    <Card className="p-5 border-border/60 hover:border-primary/40 transition-colors flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-base font-bold text-foreground truncate">{canonical.identity.title}</h3>
            {featured && (
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
            <Badge
              variant="outline"
              className={`gap-1 ${BAND_CLASS[t.band]}`}
              title={transparencyDescriptor}
              aria-label={transparencyDescriptor}
            >
              <Info className="h-3 w-3" aria-hidden /> {transparencyText}
            </Badge>
            {match && <OpportunityMatchBadge score={match.matchScore} tier={match.matchTier} />}
          </div>
          <p className="text-sm text-muted-foreground font-semibold truncate">
            {companyDisplay(canonical.identity.companyName)}
          </p>
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
        <Badge variant="outline">{EMPLOYMENT_LABEL[employment]}</Badge>
        <Badge variant="outline">{TEAM_LABEL[team]}</Badge>
        <Badge variant="outline">{discString(canonical.classification.routeType)}</Badge>
        <Badge variant="outline">{discString(canonical.classification.trailerType)}</Badge>
        <Badge variant="outline">{discString(canonical.operatingTerms.homeTime)}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Stat icon={MapPin} label="Hiring" value={canonical.hiringArea.displayLabel} />
        <Stat icon={DollarSign} label={grossLabel} value={grossValue} />
        {showCostBearingPro ? (
          <>
            {canShowNet ? (
              <EstimatedNetStat value={fe.estimatedWeeklyNet as number} />
            ) : (
              <Stat icon={Gauge} label="Weekly miles" value={discMilesDisplay(totalMiles)} />
            )}
            <Stat icon={Gauge} label="Gross per total mile" value={fmtRpm(fe.effectiveRpm)} />
          </>
        ) : (
          <>
            <Stat icon={Gauge} label="Weekly miles" value={discMilesDisplay(totalMiles)} />
            <Stat icon={Truck} label="Deadhead" value={deadheadValue} warn={deadheadWarn} />
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

/**
 * Est. net can go negative when the driver's personal weekly cost profile
 * exceeds the listing's estimated gross. That's a personalized calculation
 * — not a broken listing — so we surface it with a warning tone, a
 * clarifying caption, and a tooltip explaining the source, rather than
 * hiding it or styling it as a plain metric.
 *
 * Only rendered for cost-bearing employment models. Company drivers and
 * unknown employment never see this stat.
 */
function EstimatedNetStat({ value }: { value: number }) {
  const isNegative = Number(value) < 0;
  const tooltip =
    'Est. net is your listing gross minus your weekly cost profile (fixed + variable costs). A negative value means this listing does not clear your current cost profile.';
  return (
    <div className="flex items-start gap-2 min-w-0" title={tooltip}>
      {isNegative ? (
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" aria-hidden />
      ) : (
        <TrendingUp className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden />
      )}
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Est. net
        </p>
        <p
          className={`text-sm font-semibold truncate ${
            isNegative ? 'text-warning' : 'text-foreground'
          }`}
        >
          {fmtMoney(value)}
        </p>
        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
          {isNegative ? 'Based on your cost profile' : 'After your cost profile'}
        </p>
      </div>
    </div>
  );
}
