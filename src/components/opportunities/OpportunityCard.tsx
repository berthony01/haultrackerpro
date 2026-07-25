// Phase 1O-B — Driver Opportunity Card reconstruction.
//
// Information hierarchy (top → bottom):
//   1. Title
//   2. Company name
//   3. Main compensation headline (dominant fact after title/company)
//   4. Hiring coverage (prominent)
//   5. Compact facts row: employment / team / route / trailer / home time
//   6. Secondary trust indicators: Verified Recruiter, Priority placement,
//      Transparency, Match — all visually secondary to the job itself.
//   7. Single dominant primary action (View Details)
//
// Omission rules: unprovided disclosures (unknown, unspecified, not_disclosed,
// not_applicable, empty strings) render as absent — NOT as "Not disclosed",
// "Not applicable", "—", "Unavailable", empty labels, or blank metric boxes.
// The one exception is the Est. net / Gross per total mile stat pair for Pro
// cost-bearing users, which continues to render the canonical financial
// estimate exactly as calculated (a negative value is a truthful signal,
// not filler).
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
  Home,
  Briefcase,
  Users,
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
import { LOWER_48_STATE_CODES } from './RecruiterOpportunityForm';
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
  unknown: '',
};

const TEAM_LABEL: Record<CanonicalTeamConfiguration, string> = {
  solo: 'Solo',
  team: 'Team',
  solo_or_team: 'Team optional',
  unspecified: '',
};

const LOWER_48_SET = new Set(LOWER_48_STATE_CODES);

function isCostBearing(em: CanonicalEmploymentModel): boolean {
  return em === 'contractor_1099' || em === 'owner_operator' || em === 'lease_purchase';
}

function providedStr(d: Disclosure<string>): string | null {
  return d.state === 'provided' ? d.value : null;
}

/**
 * Truthful, concise coverage label:
 *   - City + State  → "Dallas, TX"
 *   - Exactly 48 contiguous state codes → "Nationwide — Lower 48"
 *   - ≤ 6 selected states → joined codes
 *   - 7+ selected states → "{N} states"
 *   - Otherwise → null (row is hidden)
 */
export function displayHiringCoverage(canonical: CanonicalOpportunity): string | null {
  const cityD = canonical.hiringArea.city;
  const stateD = canonical.hiringArea.state;
  const statesD = canonical.hiringArea.states;
  const city = cityD.state === 'provided' ? cityD.value : null;
  const state = stateD.state === 'provided' ? stateD.value : null;
  if (city && state) return `${city}, ${state}`;
  if (statesD.state === 'provided' && statesD.value.length > 0) {
    const arr = statesD.value;
    if (arr.length === 48 && arr.every((x) => LOWER_48_SET.has(x))) {
      return 'Nationwide — Lower 48';
    }
    if (arr.length <= 6) return arr.join(', ');
    return `${arr.length} states`;
  }
  return null;
}

/**
 * Dominant pay headline. Returns null when no recurring gross is available,
 * so the card can degrade gracefully rather than showing filler.
 */
function payHeadline(canonical: CanonicalOpportunity): {
  amount: string;
  suffix: string;
  source: string;
} | null {
  const fe = canonical.derived.financialEstimate;
  if (typeof fe.recurringWeeklyGross === 'number' && Number.isFinite(fe.recurringWeeklyGross)) {
    const source =
      fe.grossSource === 'derived'
        ? 'Derived weekly gross'
        : fe.grossSource === 'recruiter_provided'
          ? 'Recruiter weekly gross'
          : 'Weekly gross';
    return { amount: fmtMoney(fe.recurringWeeklyGross), suffix: '/wk', source };
  }
  return null;
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

  const companyName = providedStr(canonical.identity.companyName);
  const coverage = displayHiringCoverage(canonical);
  const pay = payHeadline(canonical);

  const employmentLabel = EMPLOYMENT_LABEL[employment];
  const teamLabel = TEAM_LABEL[team];
  const routeLabel = providedStr(canonical.classification.routeType);
  const trailerLabel = providedStr(canonical.classification.trailerType);
  const homeTimeLabel = providedStr(canonical.operatingTerms.homeTime);

  const facts: { icon: typeof MapPin; label: string; text: string }[] = [];
  if (employmentLabel) facts.push({ icon: Briefcase, label: 'Employment', text: employmentLabel });
  if (teamLabel) facts.push({ icon: Users, label: 'Config', text: teamLabel });
  if (routeLabel) facts.push({ icon: MapPin, label: 'Route', text: routeLabel });
  if (trailerLabel) facts.push({ icon: Truck, label: 'Trailer', text: trailerLabel });
  if (homeTimeLabel) facts.push({ icon: Home, label: 'Home time', text: homeTimeLabel });

  const mileage = canonical.compensation.mileage;
  const totalMiles = mileage.totalWeeklyMiles;
  const deadheadMiles = mileage.deadheadWeeklyMiles;
  const deadheadPaid = mileage.deadheadPaid;

  const fe = canonical.derived.financialEstimate;
  const canShowNet = costBearing && typeof fe.estimatedWeeklyNet === 'number';
  const showCostBearingPro = isPro && costBearing;

  const deadheadValue =
    deadheadMiles.state === 'provided'
      ? deadheadPaid.state === 'provided'
        ? `${fmtMilesN(deadheadMiles.value)} · ${deadheadPaid.value ? 'paid' : 'unpaid'}`
        : fmtMilesN(deadheadMiles.value)
      : null;
  const deadheadWarn =
    deadheadMiles.state === 'provided' &&
    deadheadMiles.value > 0 &&
    deadheadPaid.state === 'provided' &&
    deadheadPaid.value === false;

  const weeklyMilesValue = totalMiles.state === 'provided' ? fmtMilesN(totalMiles.value) : null;

  return (
    <Card className="p-5 border-border/60 hover:border-primary/40 transition-colors flex flex-col gap-4 w-full">
      {/* Row 1 — title + save */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-foreground leading-tight break-words">
            {canonical.identity.title}
          </h3>
          {companyName && (
            <p className="text-sm text-muted-foreground font-semibold truncate mt-0.5">
              {companyName}
            </p>
          )}
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

      {/* Row 2 — dominant pay headline + coverage */}
      {(pay || coverage) && (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          {pay && (
            <div className="min-w-0" aria-label={`${pay.source} ${pay.amount} per week`}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {pay.source}
              </p>
              <p className="text-2xl sm:text-3xl font-black text-primary leading-none whitespace-nowrap">
                {pay.amount}
              </p>
              <p className="text-[10px] font-semibold text-muted-foreground mt-0.5">per week</p>
            </div>
          )}
          {coverage && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Hiring
              </p>
              <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-primary shrink-0" aria-hidden />
                <span className="truncate">{coverage}</span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Row 3 — compact facts row (employment / config / route / trailer / home time) */}
      {facts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2 text-sm">
          {facts.map((f) => (
            <Stat key={f.label} icon={f.icon} label={f.label} value={f.text} />
          ))}
        </div>
      )}

      {/* Row 4 — Pro cost-bearing financial stats (kept for parity with canonical estimates). */}
      {showCostBearingPro && (canShowNet || weeklyMilesValue || deadheadValue) && (
        <div className="grid grid-cols-2 gap-3 text-sm border-t border-border/40 pt-3">
          {canShowNet ? (
            <EstimatedNetStat value={fe.estimatedWeeklyNet as number} />
          ) : weeklyMilesValue ? (
            <Stat icon={Gauge} label="Weekly miles" value={weeklyMilesValue} />
          ) : null}
          {typeof fe.effectiveRpm === 'number' ? (
            <Stat icon={Gauge} label="Gross per total mile" value={fmtRpm(fe.effectiveRpm)} />
          ) : deadheadValue ? (
            <Stat icon={Truck} label="Deadhead" value={deadheadValue} warn={deadheadWarn} />
          ) : null}
        </div>
      )}

      {/* Row 4b — Non-Pro or non cost-bearing: show weekly miles / deadhead only when provided. */}
      {!showCostBearingPro && (weeklyMilesValue || deadheadValue) && (
        <div className="grid grid-cols-2 gap-3 text-sm border-t border-border/40 pt-3">
          {weeklyMilesValue && <Stat icon={Gauge} label="Weekly miles" value={weeklyMilesValue} />}
          {deadheadValue && (
            <Stat icon={Truck} label="Deadhead" value={deadheadValue} warn={deadheadWarn} />
          )}
        </div>
      )}

      {/* Row 5 — secondary indicators (visually secondary to the job) */}
      <div className="flex flex-wrap items-center gap-1.5">
        {isVerifiedRecruiter && (
          <Badge
            variant="outline"
            className="border-success/40 text-success gap-1 text-[10px] font-semibold"
          >
            <ShieldCheck className="h-3 w-3" aria-hidden /> Verified Recruiter
          </Badge>
        )}
        <Badge
          variant="outline"
          className={`gap-1 text-[10px] font-semibold ${BAND_CLASS[t.band]}`}
          title={transparencyDescriptor}
          aria-label={transparencyDescriptor}
        >
          <Info className="h-3 w-3" aria-hidden /> {transparencyText}
        </Badge>
        {featured && (
          <Badge
            variant="secondary"
            className="bg-primary/10 text-primary border-primary/20 text-[10px] font-semibold"
            title="Priority placement — Growth or Fleet plan"
            aria-label="Priority placement — Growth or Fleet plan"
          >
            Priority placement
          </Badge>
        )}
        {match && <OpportunityMatchBadge score={match.matchScore} tier={match.matchTier} />}
      </div>

      {/* Row 6 — match rationale, secondary */}
      {match && (match.reasons.length > 0 || match.hasSevereWarning) && (
        <div className="space-y-1.5 rounded-lg bg-muted/30 border border-border/40 p-3">
          {match.reasons.slice(0, 2).map((r) => (
            <div key={r} className="flex items-start gap-2 text-xs text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" aria-hidden />
              <span>{r}</span>
            </div>
          ))}
          {match.hasSevereWarning && match.warnings[0] && (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
              <span>{match.warnings[0]}</span>
            </div>
          )}
        </div>
      )}

      {/* Row 7 — single dominant primary action */}
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
      <Icon
        className={`h-4 w-4 mt-0.5 shrink-0 ${warn ? 'text-destructive' : 'text-primary'}`}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
        <p className="text-sm font-semibold text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}

/**
 * Est. net can go negative when the driver's personal weekly cost profile
 * exceeds the listing's estimated gross. Surfaced with a warning tone and
 * explanatory caption rather than hidden.
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
