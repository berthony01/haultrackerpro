// Phase 1L-F2B-P2 — canonical driver-facing detail adoption.
//
// This component is now a strict consumer of the Phase 1L-F1 canonical view
// model. It calls `normalizeOpportunity(source)` exactly once per render and
// renders identity, classification, hiring area, compensation, mileage,
// operating terms, and content directly from canonical disclosures. Every
// displayed disclosure honors the three-state model (provided / not_disclosed
// / not_applicable) so zero, false, and "unspecified" are never collapsed to
// a legacy dash. The Phase 1L-F1 Listing Transparency Score replaces the
// legacy Profit Clarity Score inside `OpportunityProfitBreakdown`.
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
import {
  classifyFormalApply,
  classifyRequestInfo,
  submissionErrorMessage,
} from '@/lib/opportunities/applicationSubmission';
import {
  normalizeOpportunity,
  type OpportunitySourceRow,
  type Disclosure,
  type CanonicalPayModel,
  type CanonicalEmploymentModel,
  type CanonicalRecurringAmount,
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
  unknown: 'Not disclosed',
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

const fmtMilesDisc = (d: Disclosure<number>): string => {
  if (d.state === 'provided') return `${Math.round(d.value).toLocaleString()} mi`;
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Not disclosed';
};

const fmtStrDisc = (d: Disclosure<string>): string => {
  if (d.state === 'provided') return d.value;
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Not disclosed';
};

const fmtDeadheadPaid = (d: Disclosure<boolean>): string => {
  if (d.state === 'provided') return d.value ? 'Paid' : 'Unpaid';
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Not disclosed';
};

const fmtBoolYN = (d: Disclosure<boolean>): string => {
  if (d.state === 'provided') return d.value ? 'Yes' : 'No';
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Not disclosed';
};

const fmtRecurring = (d: Disclosure<CanonicalRecurringAmount>): string => {
  if (d.state === 'provided') {
    const { amount, frequency } = d.value;
    if (!Number.isFinite(amount)) return 'Not disclosed';
    const money = `$${Math.round(amount).toLocaleString()}`;
    if (frequency == null) return money;
    return `${money} ${frequency}`;
  }
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Not disclosed';
};

const fmtMoneyDisc = (d: Disclosure<number>): string => {
  if (d.state === 'provided') return `$${Math.round(d.value).toLocaleString()}`;
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Not disclosed';
};

function grossLabel(source: 'derived' | 'recruiter_provided' | null): string {
  if (source === 'derived') return 'Derived weekly gross';
  if (source === 'recruiter_provided') return 'Recruiter weekly gross';
  return 'Weekly gross';
}

function grossValue(fe: { status: string; recurringWeeklyGross: number | null }): string {
  if (typeof fe.recurringWeeklyGross === 'number' && Number.isFinite(fe.recurringWeeklyGross)) {
    return `$${Math.round(fe.recurringWeeklyGross).toLocaleString()}`;
  }
  if (fe.status === 'not_applicable') return 'Not applicable';
  if (fe.status === 'incomplete' || fe.status === 'conflict') return 'Incomplete';
  return 'Not disclosed';
}

function companyDisplay(d: Disclosure<string>): string {
  if (d.state === 'provided') return d.value;
  if (d.state === 'not_applicable') return 'Not applicable';
  return 'Company not disclosed';
}

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
  const { driverApplications, createApplication } = useOpportunityApplications();
  const [submitting, setSubmitting] = useState(false);
  const [showRefer, setShowRefer] = useState(false);
  const [showApply, setShowApply] = useState(false);

  const isSaved = useMemo(() => saved.some((s) => s.opportunity_id === o.id), [saved, o.id]);
  const formalState = useMemo(
    () => classifyFormalApply(driverApplications as any[], o.id),
    [driverApplications, o.id],
  );
  const requestInfoState = useMemo(
    () => classifyRequestInfo(driverApplications as any[], o.id),
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

  const handleRequestInfo = async () => {
    if (requestInfoState.exists) return;
    setSubmitting(true);
    const consent = !!driverProfile?.allow_verified_recruiter_contact;
    const pref = driverProfile?.contact_preference ?? 'in_app';
    const phoneSnap = consent && pref === 'phone' ? (driverProfile?.phone ?? null) : null;
    const emailSnap = consent && pref === 'email' ? (driverProfile?.email ?? null) : null;
    createApplication.mutate(
      {
        opportunity_id: o.id,
        recruiter_id: o.recruiter_id,
        application_type: 'request_info',
        driver_profile_id: driverProfile?.id ?? null,
        preferred_contact_method: pref,
        driver_phone_snapshot: phoneSnap,
        driver_email_snapshot: emailSnap,
        message: "I'm interested in learning more about this opportunity.",
      },
      {
        onSuccess: () => {
          toast.success('Request sent to recruiter');
          setSubmitting(false);
        },
        onError: (e: Error) => {
          toast.error(submissionErrorMessage(e));
          setSubmitting(false);
        },
      },
    );
  };

  const displayTitle = canonical.identity.title;
  const displayCompany = companyDisplay(canonical.identity.companyName);
  const featured = canonical.trust.featured;
  const isVerified = canonical.trust.recruiterVerification === 'approved';
  const employment = canonical.classification.employmentModel;
  const team = canonical.classification.teamConfiguration;
  const pm = canonical.compensation.payModel;
  const rp = canonical.compensation.recurringPay;
  const mileage = canonical.compensation.mileage;

  const deadheadWarn =
    mileage.deadheadWeeklyMiles.state === 'provided' &&
    mileage.deadheadWeeklyMiles.value > 0 &&
    mileage.deadheadPaid.state === 'provided' &&
    mileage.deadheadPaid.value === false;

  const dialogCompanyName =
    canonical.identity.companyName.state === 'provided'
      ? canonical.identity.companyName.value
      : o.company_name;

  return (
    <div className="space-y-5 animate-fade-in">
      <Button variant="ghost" onClick={onBack} className="text-muted-foreground hover:text-foreground -ml-2">
        <ArrowLeft className="h-4 w-4" /> Back to Opportunities
      </Button>

      {/* Header */}
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h1 className="text-2xl font-black text-foreground">{displayTitle}</h1>
          {featured && (
            <Badge className="bg-primary/15 text-primary border-primary/20" variant="secondary">
              Priority placement
            </Badge>
          )}
          {isVerified && (
            <Badge variant="outline" className="border-success/40 text-success gap-1">
              <ShieldCheck className="h-3 w-3" /> Verified Recruiter
            </Badge>
          )}
        </div>
        <p className="text-base font-semibold text-muted-foreground mb-3">{displayCompany}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> {canonical.hiringArea.displayLabel}
          </span>
          <Badge variant="outline">{EMPLOYMENT_LABEL[employment]}</Badge>
          <Badge variant="outline">{TEAM_LABEL[team]}</Badge>
          <Badge variant="outline">{fmtStrDisc(canonical.classification.routeType)}</Badge>
          <Badge variant="outline">{fmtStrDisc(canonical.classification.trailerType)}</Badge>
          <Badge variant="outline">{fmtStrDisc(canonical.operatingTerms.homeTime)}</Badge>
        </div>
      </Card>

      {/* Match Insights */}
      {match ? (
        <Card className="p-5 border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-primary/15 p-1.5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </div>
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Your Match</h3>
            </div>
            <OpportunityMatchBadge score={match.matchScore} tier={match.matchTier} size="md" />
          </div>
          {match.reasons.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Why This Matches You
              </p>
              <ul className="space-y-1.5">
                {match.reasons.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-sm text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {match.warnings.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Potential Concerns
              </p>
              <ul className="space-y-1.5">
                {match.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2 text-sm text-foreground">
                    <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {match.reasons.length === 0 && match.warnings.length === 0 && (
            <p className="text-sm text-muted-foreground">
              We couldn't pull strong signals from this opportunity. Review the pay and disclosure details below.
            </p>
          )}
        </Card>
      ) : (
        <Card className="p-5 border-border/60 bg-muted/20">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-foreground mb-1">Improve Your Match Insights</h3>
              <p className="text-sm text-muted-foreground">
                Add a few Opportunity Preferences to see how well this opportunity fits your pay goals, route preference, and equipment.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Canonical Pay Breakdown */}
      <Section icon={DollarSign} title="Pay Breakdown">
        <Grid>
          <KV label="Pay model" value={PAY_MODEL_LABEL[pm]} />
          <KV
            label={grossLabel(canonical.derived.financialEstimate.grossSource)}
            value={grossValue(canonical.derived.financialEstimate)}
            highlight
          />
          {pm === 'cpm' && (
            <>
              <KV
                label="CPM"
                value={
                  rp.cpm.state === 'provided'
                    ? `$${Number(rp.cpm.value).toFixed(2)}/mi`
                    : rp.cpm.state === 'not_applicable'
                    ? 'Not applicable'
                    : 'Not disclosed'
                }
              />
              <KV label="Loaded weekly miles" value={fmtMilesDisc(mileage.loadedWeeklyMiles)} />
            </>
          )}
          {pm === 'percentage' && (
            <>
              <KV
                label="Percentage rate"
                value={
                  rp.percentage.state === 'provided'
                    ? `${rp.percentage.value.rate}%`
                    : rp.percentage.state === 'not_applicable'
                    ? 'Not applicable'
                    : 'Not disclosed'
                }
              />
              <KV
                label="Weekly revenue basis"
                value={
                  rp.percentage.state === 'provided' &&
                  rp.percentage.value.weeklyRevenueBasis != null
                    ? `$${Math.round(rp.percentage.value.weeklyRevenueBasis).toLocaleString()}`
                    : 'Not disclosed'
                }
              />
              <KV
                label="Percentage basis"
                value={
                  rp.percentage.state === 'provided' && rp.percentage.value.basisLabel
                    ? rp.percentage.value.basisLabel
                    : 'Not disclosed'
                }
              />
            </>
          )}
          {pm === 'flat_weekly' && (
            <KV label="Flat weekly pay" value={fmtMoneyDisc(rp.flatWeekly)} />
          )}
          {pm === 'salary' && (
            <>
              <KV
                label="Salary amount"
                value={
                  rp.salary.state === 'provided'
                    ? `$${Math.round(rp.salary.value.amount).toLocaleString()}`
                    : rp.salary.state === 'not_applicable'
                    ? 'Not applicable'
                    : 'Not disclosed'
                }
              />
              <KV
                label="Salary frequency"
                value={
                  rp.salary.state === 'provided' && rp.salary.value.frequency
                    ? rp.salary.value.frequency
                    : 'Not disclosed'
                }
              />
            </>
          )}
          {pm === 'mixed' && (
            <div className="col-span-2 sm:col-span-3 rounded-lg bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Mixed pay components
              </p>
              {rp.mixedComponents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not disclosed</p>
              ) : (
                <ul className="space-y-1">
                  {rp.mixedComponents.map((c, i) => (
                    <li key={i} className="text-sm text-foreground flex justify-between gap-2">
                      <span>{c.label || 'Component'}</span>
                      <span className="font-semibold">{fmtRecurring(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {pm === 'other' && (
            <>
              <KV label="Other pay method" value={fmtStrDisc(rp.otherMethod.label)} />
              <KV label="Other weekly gross" value={fmtMoneyDisc(rp.otherMethod.weeklyGross)} />
            </>
          )}
          <KV label="Detention pay" value={fmtStrDisc(canonical.compensation.accessorialPay.detention)} />
          <KV label="Layover pay" value={fmtStrDisc(canonical.compensation.accessorialPay.layover)} />
        </Grid>
      </Section>

      {/* One-Time Incentives */}
      <Section icon={Gift} title="One-Time Incentives">
        <Grid>
          <KV
            label="Sign-on bonus"
            value={fmtMoneyDisc(canonical.compensation.oneTimeIncentives.signOnBonus)}
          />
        </Grid>
      </Section>

      {/* Mileage & Deadhead */}
      <Section icon={Gauge} title="Mileage & Deadhead">
        <Grid>
          <KV label="Weekly miles" value={fmtMilesDisc(mileage.totalWeeklyMiles)} />
          <KV label="Loaded miles" value={fmtMilesDisc(mileage.loadedWeeklyMiles)} />
          <KV
            label="Deadhead miles"
            value={fmtMilesDisc(mileage.deadheadWeeklyMiles)}
            warn={deadheadWarn}
          />
          <KV
            label="Deadhead paid?"
            value={fmtDeadheadPaid(mileage.deadheadPaid)}
            warn={
              mileage.deadheadPaid.state === 'provided' &&
              mileage.deadheadPaid.value === false
            }
          />
        </Grid>
      </Section>

      {/* Listing Transparency + Financial Disclosure */}
      <OpportunityProfitBreakdown canonical={canonical} isPro={isPro} onUpgrade={onUpgrade} />

      {/* Home Time & Lifestyle */}
      <Section icon={Home} title="Home Time & Lifestyle">
        <Grid>
          <KV label="Home time" value={fmtStrDisc(canonical.operatingTerms.homeTime)} />
          <KV label="Forced dispatch" value={fmtBoolYN(canonical.operatingTerms.forcedDispatch)} />
          <KV label="Pets allowed" value={fmtBoolYN(canonical.operatingTerms.petsAllowed)} />
          <KV label="Riders allowed" value={fmtBoolYN(canonical.operatingTerms.ridersAllowed)} />
          <KV label="Equipment year" value={fmtStrDisc(canonical.operatingTerms.equipmentYear)} />
        </Grid>
      </Section>

      {/* Benefits / Lanes / Requirements / Description — always visible with disclosure fallbacks */}
      <Section icon={ShieldCheck} title="Benefits">
        <p className="text-sm text-muted-foreground whitespace-pre-line">
          {fmtStrDisc(canonical.content.actualBenefits)}
        </p>
      </Section>
      <Section icon={Truck} title="Typical Lanes">
        <p className="text-sm text-muted-foreground whitespace-pre-line">
          {fmtStrDisc(canonical.content.typicalLanes)}
        </p>
      </Section>
      <Section icon={ClipboardList} title="Requirements">
        <p className="text-sm text-muted-foreground whitespace-pre-line">
          {fmtStrDisc(canonical.content.requirements)}
        </p>
      </Section>
      <Section icon={FileText} title="About this Opportunity">
        <p className="text-sm text-muted-foreground whitespace-pre-line">
          {fmtStrDisc(canonical.content.description)}
        </p>
      </Section>

      <div aria-hidden className="h-32 lg:h-28" />

      <div className="fixed left-0 right-0 lg:left-[calc(15rem+1.5rem)] lg:right-6 bottom-[calc(72px+env(safe-area-inset-bottom))] lg:bottom-4 px-3 lg:px-0 z-30 space-y-2">
        {profileIncomplete && formalState.kind === 'none' && (
          <div className="flex items-start gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3 text-xs text-foreground backdrop-blur-md">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <span>Complete your Opportunity Preferences to apply and improve your match score.</span>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 bg-card/90 backdrop-blur-md p-3 rounded-xl border border-border/60 shadow-lg">
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
              className="flex-1"
              aria-label="Refer a Driver — Pro feature"
            >
              <Lock className="h-4 w-4" /> Refer a Driver — Pro
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleRequestInfo}
            disabled={requestInfoState.exists || submitting}
            className="flex-1"
          >
            <Send className="h-4 w-4" />
            {requestInfoState.exists ? 'Info Requested' : submitting ? 'Sending…' : 'Request Info'}
          </Button>
          <Button
            onClick={() => setShowApply(true)}
            disabled={formalState.kind === 'active' || formalState.kind === 'completed'}
            className="flex-1"
          >
            <Send className="h-4 w-4" />
            {formalState.kind === 'active'
              ? 'Application Submitted'
              : formalState.kind === 'completed'
              ? 'Hired'
              : formalState.kind === 'reapplyable'
              ? 'Apply Again'
              : 'Apply Now'}
          </Button>
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
    <Card className="p-5 border-border/60">
      <div className="flex items-center gap-2 mb-4">
        <div className="rounded-lg bg-primary/10 p-1.5">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </Card>
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
