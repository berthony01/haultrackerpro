// Phase 1O-B — Driver Opportunity Detail reconstruction.
//
// Top summary: title, company, verified indicator, dominant pay headline,
// hiring coverage, route, trailer, driving configuration, home time, and a
// single dominant `Apply Now` action. Save and Refer a Driver remain secondary.
//
// Section order (each section hides entirely when it has no populated data):
//   1. Opportunity Overview       (description)
//   2. Pay & Compensation         (pay model, gross, mileage, accessorial, one-time incentives)
//   3. Hiring Coverage & Route    (coverage, route, trailer, typical lanes)
//   4. Home Time & Lifestyle      (home time, dispatch, pets, riders, equipment year)
//   5. Benefits & Equipment       (actual benefits)
//   6. Requirements               (requirements)
//   7. Costs & Operating Terms    (cost-bearing employment only)
//   8. Transparency & Financial Disclosure (secondary — Listing transparency + calc breakdown)
//   9. Sticky action bar          (Apply Now dominant, Save + Refer secondary)
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Send,
  ShieldCheck,
  AlertTriangle,
  Lock,
  CheckCircle2,
  DollarSign,
  Gauge,
  Truck,
  Home,
  MapPin,
  Info,
  UserPlus,
  Gift,
  ClipboardList,
  FileText,
  Briefcase,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Opportunity } from '@/hooks/opportunities/useOpportunities';
import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';
import { useSavedOpportunities } from '@/hooks/opportunities/useSavedOpportunities';
import type { DriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';
import { OpportunityProfitBreakdown } from './OpportunityProfitBreakdown';
import { calculateOpportunityFinancials } from '@/lib/opportunities/opportunityProfit';
import { calculateOpportunityMatch } from '@/lib/opportunities/opportunityMatch';
import { OpportunityMatchBadge } from './OpportunityMatchBadge';
import { ReferDriverDialog } from './ReferDriverDialog';
import { ApplyNowDialog } from './ApplyNowDialog';
import { displayHiringCoverage } from './OpportunityCard';
import { classifyFormalApply } from '@/lib/opportunities/applicationSubmission';
import {
  normalizeOpportunity,
  type OpportunitySourceRow,
  type Disclosure,
  type CanonicalPayModel,
  type CanonicalEmploymentModel,
  type CanonicalRecurringAmount,
  type CanonicalOpportunity,
} from '@/lib/opportunities/opportunityCanonicalView';
import type { CanonicalTeamConfiguration } from '@/lib/opportunities/opportunityCanonical';

interface Props {
  opportunity: Opportunity;
  onBack: () => void;
  isPro: boolean;
  onUpgrade: () => void;
  driverProfile?: DriverOpportunityProfile | null;
  onOpenPreferencesForApply: () => void;
  resumeApplyToken?: string | null;
  onResumeApplyConsumed?: (token: string) => void;
}

const PAY_MODEL_LABEL: Record<CanonicalPayModel, string> = {
  cpm: 'CPM',
  percentage: 'Percentage',
  flat_weekly: 'Flat weekly',
  salary: 'Salary',
  mixed: 'Mixed',
  other: 'Other',
  unknown: '',
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

/* ------------------------------ formatters ------------------------------ */

const fmtMilesN = (n: number): string => `${Math.round(n).toLocaleString()} mi`;
const fmtMoney = (n: number): string => `$${Math.round(n).toLocaleString()}`;

/** Returns the formatted value only when a Disclosure is `provided`, else null. */
const strOrNull = (d: Disclosure<string>): string | null =>
  d.state === 'provided' ? d.value : null;
const milesOrNull = (d: Disclosure<number>): string | null =>
  d.state === 'provided' ? fmtMilesN(d.value) : null;
const moneyOrNull = (d: Disclosure<number>): string | null =>
  d.state === 'provided' ? fmtMoney(d.value) : null;
const boolYNOrNull = (d: Disclosure<boolean>): string | null =>
  d.state === 'provided' ? (d.value ? 'Yes' : 'No') : null;
const recurringOrNull = (d: Disclosure<CanonicalRecurringAmount>): string | null => {
  if (d.state !== 'provided') return null;
  const { amount, frequency } = d.value;
  if (!Number.isFinite(amount)) return null;
  const money = fmtMoney(amount);
  return frequency == null ? money : `${money} ${frequency}`;
};

function grossLabelFor(source: 'derived' | 'recruiter_provided' | null): string {
  if (source === 'derived') return 'Derived weekly gross';
  if (source === 'recruiter_provided') return 'Recruiter weekly gross';
  return 'Weekly gross';
}

function grossValueOrNull(fe: {
  status: string;
  recurringWeeklyGross: number | null;
}): string | null {
  if (typeof fe.recurringWeeklyGross === 'number' && Number.isFinite(fe.recurringWeeklyGross)) {
    return fmtMoney(fe.recurringWeeklyGross);
  }
  if (fe.status === 'conflict') return 'Conflict';
  return null;
}

/* ============================== component =============================== */

export function OpportunityDetail({
  opportunity: o,
  onBack,
  isPro,
  onUpgrade,
  driverProfile,
  onOpenPreferencesForApply,
  resumeApplyToken,
  onResumeApplyConsumed,
}: Props) {
  const canonical = useMemo(
    () => normalizeOpportunity(o as OpportunitySourceRow),
    [o],
  );

  const { saved, save, unsave } = useSavedOpportunities();
  // Phase OD-1 — NEW driver-facing Request Info submission is retired from this
  // page. Only the formal apply classification is read here; request_info
  // backend support, history, and recruiter-side handling are unchanged.
  const { driverApplications } = useOpportunityApplications();
  const [showRefer, setShowRefer] = useState(false);
  const [showApply, setShowApply] = useState(false);

  const isSaved = useMemo(() => saved.some((s) => s.opportunity_id === o.id), [saved, o.id]);
  const formalState = useMemo(
    () => classifyFormalApply(driverApplications as any[], o.id),
    [driverApplications, o.id],
  );

  const consumedTokensRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!resumeApplyToken) return;
    if (consumedTokensRef.current.has(resumeApplyToken)) return;
    if (!driverProfile || driverProfile.profile_completed !== true) return;
    if (formalState.kind !== 'none' && formalState.kind !== 'reapplyable') return;
    consumedTokensRef.current.add(resumeApplyToken);
    setShowApply(true);
    onResumeApplyConsumed?.(resumeApplyToken);
  }, [resumeApplyToken, driverProfile, formalState, onResumeApplyConsumed]);

  const match = driverProfile && driverProfile.profile_completed
    ? calculateOpportunityMatch({
        opportunity: o,
        driverProfile,
        opportunityFinancials: calculateOpportunityFinancials(o),
      })
    : null;

  const handleToggleSave = () => {
    const m = isSaved ? unsave : save;
    m.mutate(o.id, {
      onSuccess: () => toast.success(isSaved ? 'Removed from saved' : 'Saved successfully'),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const profileIncomplete = !driverProfile || !driverProfile.profile_completed;


  const displayTitle = canonical.identity.title;
  const companyName =
    canonical.identity.companyName.state === 'provided'
      ? canonical.identity.companyName.value
      : null;
  const featured = canonical.trust.featured;
  const isVerified = canonical.trust.recruiterVerification === 'approved';
  const employment = canonical.classification.employmentModel;
  const team = canonical.classification.teamConfiguration;
  const pm = canonical.compensation.payModel;
  const rp = canonical.compensation.recurringPay;
  const mileage = canonical.compensation.mileage;
  const fe = canonical.derived.financialEstimate;
  const costBearing =
    employment === 'contractor_1099' ||
    employment === 'owner_operator' ||
    employment === 'lease_purchase';

  const dialogCompanyName = companyName ?? o.company_name;

  const coverage = displayHiringCoverage(canonical);
  const employmentLabel = EMPLOYMENT_LABEL[employment];
  const teamLabel = TEAM_LABEL[team];
  const routeLabel = strOrNull(canonical.classification.routeType);
  const trailerLabel = strOrNull(canonical.classification.trailerType);
  const homeTimeLabel = strOrNull(canonical.operatingTerms.homeTime);
  const payModelLabel = PAY_MODEL_LABEL[pm];
  const grossValue = grossValueOrNull(fe);
  const grossLabel = grossLabelFor(fe.grossSource);

  /* -------------------- section content (or null) -------------------- */

  const overviewContent = strOrNull(canonical.content.description);

  const payKVs: [string, string][] = [];
  if (payModelLabel) payKVs.push(['Pay model', payModelLabel]);
  if (grossValue) payKVs.push([grossLabel, grossValue]);
  if (pm === 'cpm') {
    if (rp.cpm.state === 'provided')
      payKVs.push(['CPM', `$${Number(rp.cpm.value).toFixed(2)}/mi`]);
    const loaded = milesOrNull(mileage.loadedWeeklyMiles);
    if (loaded) payKVs.push(['Loaded weekly miles', loaded]);
  }
  if (pm === 'percentage' && rp.percentage.state === 'provided') {
    const v = rp.percentage.value;
    if (Number.isFinite(v.rate)) payKVs.push(['Percentage rate', `${v.rate}%`]);
    if (v.weeklyRevenueBasis != null)
      payKVs.push(['Weekly revenue basis', `$${Math.round(v.weeklyRevenueBasis).toLocaleString()}`]);
    if (v.basisLabel) payKVs.push(['Percentage basis', v.basisLabel]);
  }
  if (pm === 'flat_weekly') {
    const flat = moneyOrNull(rp.flatWeekly);
    if (flat) payKVs.push(['Flat weekly pay', flat]);
  }
  if (pm === 'salary' && rp.salary.state === 'provided') {
    payKVs.push(['Salary amount', fmtMoney(rp.salary.value.amount)]);
    if (rp.salary.value.frequency)
      payKVs.push(['Salary frequency', rp.salary.value.frequency]);
  }
  if (pm === 'other') {
    const label = strOrNull(rp.otherMethod.label);
    if (label) payKVs.push(['Other pay method', label]);
    const money = moneyOrNull(rp.otherMethod.weeklyGross);
    if (money) payKVs.push(['Other weekly gross', money]);
  }
  const detention = strOrNull(canonical.compensation.accessorialPay.detention);
  const layover = strOrNull(canonical.compensation.accessorialPay.layover);
  if (detention) payKVs.push(['Detention pay', detention]);
  if (layover) payKVs.push(['Layover pay', layover]);

  const mixedComponents =
    pm === 'mixed'
      ? rp.mixedComponents.filter((c) => c.amount.state === 'provided')
      : [];

  // Sign-on bonus renders only when > 0 (contract: positive incentives only,
  // separately labeled from recurring pay).
  const signOn = canonical.compensation.oneTimeIncentives.signOnBonus;
  const signOnAmount =
    signOn.state === 'provided' && signOn.value > 0 ? signOn.value : null;

  const mileageKVs: [string, string, boolean?][] = [];
  const totalMiles = milesOrNull(mileage.totalWeeklyMiles);
  if (totalMiles) mileageKVs.push(['Weekly miles', totalMiles]);
  const loadedMiles = milesOrNull(mileage.loadedWeeklyMiles);
  if (loadedMiles && pm !== 'cpm') mileageKVs.push(['Loaded miles', loadedMiles]);
  const deadheadMi = milesOrNull(mileage.deadheadWeeklyMiles);
  const deadheadWarn =
    mileage.deadheadWeeklyMiles.state === 'provided' &&
    mileage.deadheadWeeklyMiles.value > 0 &&
    mileage.deadheadPaid.state === 'provided' &&
    mileage.deadheadPaid.value === false;
  if (deadheadMi) mileageKVs.push(['Deadhead miles', deadheadMi, deadheadWarn]);
  if (mileage.deadheadPaid.state === 'provided') {
    mileageKVs.push([
      'Deadhead paid?',
      mileage.deadheadPaid.value ? 'Paid' : 'Unpaid',
      mileage.deadheadPaid.value === false,
    ]);
  }

  const hasPaySection =
    payKVs.length > 0 || mixedComponents.length > 0 || signOnAmount != null;

  // Phase OD-2 — hiring coverage, route, trailer, home time, weekly mileage,
  // and the headline pay value are promoted into the decision-first Quick Facts
  // grid, so they are no longer repeated as KVs in the sections below.
  // Pay quick fact reuses an existing displayed value only — never a new
  // computation and never a vague pay-model name.
  const quickPayValue =
    pm === 'cpm' && rp.cpm.state === 'provided'
      ? `$${Number(rp.cpm.value).toFixed(2)}/mi`
      : grossValue;
  const quickFacts: [string, string, typeof MapPin][] = [];
  if (quickPayValue) quickFacts.push(['Pay', quickPayValue, DollarSign]);
  if (totalMiles) quickFacts.push(['Miles / week', totalMiles, Gauge]);
  if (routeLabel) quickFacts.push(['Route', routeLabel, MapPin]);
  if (homeTimeLabel) quickFacts.push(['Home time', homeTimeLabel, Home]);
  if (trailerLabel) quickFacts.push(['Trailer', trailerLabel, Truck]);
  if (coverage) quickFacts.push(['Hiring', coverage, MapPin]);


  const typicalLanes = strOrNull(canonical.content.typicalLanes);
  const hasCoverageSection = typicalLanes != null || mileageKVs.length > 0;

  const lifestyleKVs: [string, string][] = [];
  const forcedDispatch = boolYNOrNull(canonical.operatingTerms.forcedDispatch);
  if (forcedDispatch) lifestyleKVs.push(['Forced dispatch', forcedDispatch]);
  const pets = boolYNOrNull(canonical.operatingTerms.petsAllowed);
  if (pets) lifestyleKVs.push(['Pets allowed', pets]);
  const riders = boolYNOrNull(canonical.operatingTerms.ridersAllowed);
  if (riders) lifestyleKVs.push(['Riders allowed', riders]);
  const equipmentYear = strOrNull(canonical.operatingTerms.equipmentYear);
  if (equipmentYear) lifestyleKVs.push(['Equipment year', equipmentYear]);


  const benefits = strOrNull(canonical.content.actualBenefits);
  const requirements = strOrNull(canonical.content.requirements);

  const costsKVs: [string, string][] = [];
  if (costBearing) {
    const fuel = strOrNull(canonical.costs.fuelPaidBy);
    if (fuel) costsKVs.push(['Fuel paid by', fuel]);
    const ins = recurringOrNull(canonical.costs.insurance);
    if (ins) costsKVs.push(['Insurance', ins]);
    const maint = recurringOrNull(canonical.costs.maintenance);
    if (maint) costsKVs.push(['Maintenance', maint]);
    const otherC = recurringOrNull(canonical.costs.otherRecurringCost);
    if (otherC) costsKVs.push(['Other recurring cost', otherC]);
    if (employment === 'lease_purchase') {
      const lease = recurringOrNull(canonical.costs.lease);
      if (lease) costsKVs.push(['Lease payment', lease]);
    }
    if (
      canonical.costs.escrowRequired.state === 'provided' &&
      canonical.costs.escrowRequired.value === true
    ) {
      costsKVs.push(['Escrow required', 'Yes']);
      const esc = recurringOrNull(canonical.costs.escrowAmount);
      if (esc) costsKVs.push(['Escrow amount', esc]);
    }
  }
  const hasCostsSection = costBearing && costsKVs.length > 0;

  /* --------------------------------- render --------------------------------- */

  return (
    <div className="space-y-5 animate-fade-in">
      <Button
        variant="ghost"
        onClick={onBack}
        className="text-muted-foreground hover:text-foreground -ml-2"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Opportunities
      </Button>

      {/* ============= Top Summary ============= */}
      <Card
        data-testid="opportunity-decision-hero"
        className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5"
      >
        <div className="flex flex-col gap-4">
          {/* Title / company / verified */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl font-black text-foreground leading-tight break-words">
                {displayTitle}
              </h1>
              {isVerified && (
                <Badge
                  variant="outline"
                  className="border-success/40 text-success gap-1 text-xs"
                >
                  <ShieldCheck className="h-3 w-3" aria-hidden /> Verified Recruiter
                </Badge>
              )}
              {featured && (
                <Badge
                  className="bg-primary/15 text-primary border-primary/20 text-xs"
                  variant="secondary"
                >
                  Priority placement
                </Badge>
              )}
            </div>
            {companyName && (
              <p className="text-base font-semibold text-muted-foreground break-words">{companyName}</p>
            )}
            {(employmentLabel || teamLabel) && (
              <div className="flex flex-wrap gap-2 text-xs mt-2">
                {employmentLabel && (
                  <Badge variant="outline" className="gap-1">
                    <Briefcase className="h-3 w-3" aria-hidden /> {employmentLabel}
                  </Badge>
                )}
                {teamLabel && (
                  <Badge variant="outline" className="gap-1">
                    <Users className="h-3 w-3" aria-hidden /> {teamLabel}
                  </Badge>
                )}
              </div>
            )}
          </div>


          {/* Dominant pay headline */}
          {grossValue && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Weekly pay
              </p>
              <p className="text-3xl sm:text-4xl font-black text-primary leading-none whitespace-nowrap">
                {grossValue}
              </p>
              <p className="text-[10px] font-semibold text-muted-foreground mt-1">per week</p>
            </div>
          )}


          {/* Quick Facts — decision-first grid; unpopulated facts are omitted */}
          {quickFacts.length > 0 && (
            <div
              className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3"
              data-testid="opportunity-quick-facts"
            >
              {quickFacts.map(([label, value, Icon]) => (
                <div key={label} className="rounded-xl bg-muted/40 p-3 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Icon className="h-3 w-3 text-primary shrink-0" aria-hidden />
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      {label}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-foreground break-words">{value}</p>
                </div>
              ))}
            </div>
          )}


          {/* Primary actions live in the sticky action bar below to keep them
              always reachable without duplicating buttons on the page. */}
        </div>
      </Card>


      {/* Match Insights — compact secondary panel */}
      {match ? (
        <Card className="p-4 border-primary/25 bg-primary/[0.04]" data-testid="opportunity-match-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" aria-hidden />
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Your Match</h3>
            </div>
            <OpportunityMatchBadge score={match.matchScore} tier={match.matchTier} size="md" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {match.reasons.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                  Why This Matches You
                </p>
                <ul className="space-y-1">
                  {match.reasons.map((r) => (
                    <li key={r} className="flex items-start gap-2 text-xs text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" aria-hidden />
                      <span className="break-words">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {match.warnings.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                  Potential Concerns
                </p>
                <ul className="space-y-1">
                  {match.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-2 text-xs text-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" aria-hidden />
                      <span className="break-words">{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-4 border-border/60 bg-muted/20" data-testid="opportunity-match-panel">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-foreground mb-1">Improve Your Match Insights</h3>
              <p className="text-xs text-muted-foreground break-words">
                Add a few Opportunity Preferences to see how well this opportunity fits your pay goals, route preference, and equipment.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* 1. Opportunity Overview */}
      {overviewContent && (
        <Surface>
          <Section icon={FileText} title="Opportunity Overview">
            <p className="text-sm text-foreground whitespace-pre-line break-words">{overviewContent}</p>
          </Section>
        </Surface>
      )}

      {/* 2 + 3. Pay & Route surface */}
      {(hasPaySection || hasCoverageSection) && (
        <Surface desktopColumns={2}>
          {hasPaySection && (
            <Section icon={DollarSign} title="Pay & Compensation">
              {payKVs.length > 0 && (
                <Grid>
                  {payKVs.map(([label, value]) => (
                    <KV
                      key={label}
                      label={label}
                      value={value}
                      highlight={label === grossLabel}
                    />
                  ))}
                </Grid>
              )}
              {mixedComponents.length > 0 && (
                <div className="mt-3 rounded-lg bg-muted/30 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                    Mixed pay components
                  </p>
                  <ul className="space-y-1">
                    {mixedComponents.map((c, i) => (
                      <li key={i} className="text-sm text-foreground flex justify-between gap-2">
                        <span className="break-words">{c.label || 'Component'}</span>
                        <span className="font-semibold whitespace-nowrap">
                          {c.amount.state === 'provided'
                            ? `${fmtMoney(c.amount.value.amount)}${
                                c.amount.value.frequency ? ` ${c.amount.value.frequency}` : ''
                              }`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {signOnAmount != null && (
                <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center gap-3">
                  <Gift className="h-4 w-4 text-primary shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-primary font-semibold">
                      One-time incentive · separate from weekly pay
                    </p>
                    <p className="text-sm font-bold text-foreground break-words">
                      Sign-on bonus: {fmtMoney(signOnAmount)}
                    </p>
                  </div>
                </div>
              )}
            </Section>
          )}

          {hasCoverageSection && (
            <Section icon={MapPin} title="Hiring Coverage & Route">
              {mileageKVs.length > 0 && (
                <Grid>
                  {mileageKVs.map(([label, value, warn]) => (
                    <KV key={label} label={label} value={value} warn={warn} />
                  ))}
                </Grid>
              )}
              {typicalLanes && (
                <div className={mileageKVs.length > 0 ? 'mt-3' : ''}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                    Typical Lanes
                  </p>
                  <p className="text-sm text-foreground whitespace-pre-line break-words">{typicalLanes}</p>
                </div>
              )}
            </Section>
          )}
        </Surface>
      )}

      {/* 4 + 5 + 6. Lifestyle & Benefits surface */}
      {(lifestyleKVs.length > 0 || benefits || requirements) && (
        <Surface>
          {lifestyleKVs.length > 0 && (
            <Section icon={Home} title="Home Time & Lifestyle">
              <Grid>
                {lifestyleKVs.map(([label, value]) => (
                  <KV key={label} label={label} value={value} />
                ))}
              </Grid>
            </Section>
          )}
          {benefits && (
            <Section icon={ShieldCheck} title="Benefits & Equipment">
              <p className="text-sm text-foreground whitespace-pre-line break-words">{benefits}</p>
            </Section>
          )}
          {requirements && (
            <Section icon={ClipboardList} title="Requirements">
              <p className="text-sm text-foreground whitespace-pre-line break-words">{requirements}</p>
            </Section>
          )}
        </Surface>
      )}

      {/* 7. Costs & Operating Terms (cost-bearing employment only) */}
      {hasCostsSection && (
        <Surface>
          <Section icon={Wallet} title="Costs & Operating Terms">
            <Grid>
              {costsKVs.map(([label, value]) => (
                <KV key={label} label={label} value={value} />
              ))}
            </Grid>
          </Section>
        </Surface>
      )}

      {/* 8. Transparency & Financial Disclosure (secondary, merged surface) */}
      <OpportunityProfitBreakdown canonical={canonical} isPro={isPro} onUpgrade={onUpgrade} compact />


      <div aria-hidden className="h-32 lg:h-28" />

      {/* Sticky decision bar — Apply dominant, everything else secondary */}
      <div className="fixed left-0 right-0 lg:left-[calc(15rem+1.5rem)] lg:right-6 bottom-[calc(72px+env(safe-area-inset-bottom))] lg:bottom-4 px-3 lg:px-0 z-30">
        <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-border/60 bg-card/95 backdrop-blur-md shadow-elevated">
          {profileIncomplete && formalState.kind === 'none' && (
            <div className="flex items-start gap-2 border-b border-border/60 bg-primary/10 px-4 py-2.5 text-xs text-foreground">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden />
              <span className="break-words">
                Complete your Opportunity Preferences to apply and improve your match score.
              </span>
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2.5 p-3">
            <Button
              onClick={() => setShowApply(true)}
              disabled={formalState.kind === 'active' || formalState.kind === 'completed'}
              className="flex-1 sm:flex-[2] whitespace-normal"
              size="lg"
            >
              <Send className="h-4 w-4" />
              {formalState.kind === 'active'
                ? 'Application Submitted'
                : formalState.kind === 'completed'
                  ? 'Hired'
                  : formalState.kind === 'reapplyable'
                    ? 'Apply Again'
                    : profileIncomplete
                      ? 'Complete Preferences to Apply'
                      : 'Apply Now'}
            </Button>
            <Button variant="outline" onClick={handleToggleSave} className="flex-1">
              {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
              {isSaved ? 'Saved' : 'Save'}
            </Button>
            {isPro ? (
              <Button variant="outline" onClick={() => setShowRefer(true)} className="flex-1">
                <UserPlus className="h-4 w-4" /> Refer a Driver
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  toast.message('Driver referrals are a Pro feature.', {
                    description:
                      'Upgrade to Pro to refer drivers to recruiter opportunities and track referral progress.',
                  });
                  onUpgrade();
                }}
                className="flex-1 whitespace-normal"
                aria-label="Refer a Driver — Pro feature"
              >
                <Lock className="h-4 w-4" /> Refer a Driver — Pro
              </Button>
            )}
          </div>
        </div>
      </div>


      <ReferDriverDialog
        open={showRefer && isPro}
        onOpenChange={setShowRefer}
        opportunityId={o.id}
        recruiterId={o.recruiter_id}
        opportunityTitle={displayTitle}
        companyName={dialogCompanyName}
        isPro={isPro}
        onUpgrade={onUpgrade}
      />

      <ApplyNowDialog
        open={showApply}
        onOpenChange={setShowApply}
        opportunityId={o.id}
        opportunityTitle={displayTitle}
        companyName={dialogCompanyName}
        driverProfile={driverProfile ?? null}
        onOpenPreferences={onOpenPreferencesForApply}
      />
    </div>
  );
}

/** Grouped surface — hosts one or more sections inside a single card. */
function Surface({
  children,
  desktopColumns = 1,
}: {
  children: React.ReactNode;
  desktopColumns?: 1 | 2 | 3;
}) {
  // Static class maps only — Tailwind cannot detect dynamically built strings.
  const layout =
    desktopColumns === 2
      ? 'divide-y divide-border/60 lg:grid lg:grid-cols-2 lg:divide-y-0 lg:divide-x'
      : desktopColumns === 3
        ? 'divide-y divide-border/60 lg:grid lg:grid-cols-3 lg:divide-y-0 lg:divide-x'
        : 'divide-y divide-border/60';
  return (
    <Card className={`border-border/60 overflow-hidden ${layout}`}>
      {children}
    </Card>
  );
}


function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof MapPin;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="rounded-lg bg-primary/10 p-1.5">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
        </div>
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}


function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div>;
}

function KV({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">
        {label}
      </p>
      <p
        className={`text-sm font-bold ${
          warn ? 'text-destructive' : highlight ? 'text-primary' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
