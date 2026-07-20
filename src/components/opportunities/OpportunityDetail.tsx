import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
} from 'lucide-react';
import { toast } from 'sonner';
import type { Opportunity } from '@/hooks/opportunities/useOpportunities';
import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';
import { useSavedOpportunities } from '@/hooks/opportunities/useSavedOpportunities';
import type { DriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';
import { Info, UserPlus } from 'lucide-react';
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

const fmtMoney = (v: number | null | undefined) =>
  v == null ? '—' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtMiles = (v: number | null | undefined) =>
  v == null ? '—' : `${Math.round(Number(v)).toLocaleString()} mi`;

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

  const { saved, save, unsave } = useSavedOpportunities();
  const { driverApplications, createApplication } = useOpportunityApplications();
  const [submitting, setSubmitting] = useState(false);
  const [showRefer, setShowRefer] = useState(false);
  const [showApply, setShowApply] = useState(false);

  const isSaved = useMemo(() => saved.some((s) => s.opportunity_id === o.id), [saved, o.id]);
  const formalState = useMemo(
    () => classifyFormalApply(driverApplications as any[], o.id),
    [driverApplications, o.id]
  );
  const requestInfoState = useMemo(
    () => classifyRequestInfo(driverApplications as any[], o.id),
    [driverApplications, o.id]
  );

  // One-shot Apply Now resume after Opportunity Preferences completion.
  const consumedTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!resumeApplyToken) return;
    if (consumedTokenRef.current === resumeApplyToken) return;
    if (!driverProfile || !driverProfile.profile_completed) return;
    if (formalState.kind !== 'none' && formalState.kind !== 'reapplyable') return;
    consumedTokenRef.current = resumeApplyToken;
    setShowApply(true);
    onResumeApplyConsumed?.(resumeApplyToken);
  }, [resumeApplyToken, driverProfile, formalState, onResumeApplyConsumed]);


  const location = [o.hiring_city, o.hiring_state].filter(Boolean).join(', ') || 'Multiple states';

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
    // Phase 28C: only send the snapshot matching the driver's contact_preference,
    // and only when consent is on. DB trigger is the final authority.
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
      }
    );
  };


  return (
    <div className="space-y-5 animate-fade-in">
      <Button variant="ghost" onClick={onBack} className="text-muted-foreground hover:text-foreground -ml-2">
        <ArrowLeft className="h-4 w-4" /> Back to Opportunities
      </Button>

      {/* Header */}
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h1 className="text-2xl font-black text-foreground">{o.title}</h1>
          {o.featured && <Badge className="bg-primary/15 text-primary border-primary/20" variant="secondary">Featured</Badge>}
          <Badge variant="outline" className="border-success/40 text-success gap-1">
            <ShieldCheck className="h-3 w-3" /> Approved Opportunity
          </Badge>
        </div>
        <p className="text-base font-semibold text-muted-foreground mb-3">{o.company_name}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1 text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {location}</span>
          {o.driver_type && <Badge variant="outline">{o.driver_type}</Badge>}
          {o.route_type && <Badge variant="outline">{o.route_type}</Badge>}
          {o.trailer_type && <Badge variant="outline">{o.trailer_type}</Badge>}
          {o.home_time && <Badge variant="outline">{o.home_time}</Badge>}
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
              We couldn't pull strong signals from this opportunity. Review the pay and deduction details below.
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

      {/* Pay breakdown */}
      <Section icon={DollarSign} title="Pay Breakdown">
        <Grid>
          <KV label="Pay model" value={o.pay_model || '—'} />
          <KV label="CPM" value={o.cpm != null ? `$${o.cpm}/mi` : '—'} />
          <KV label="Percentage" value={o.percentage_pay != null ? `${o.percentage_pay}%` : '—'} />
          <KV label="Flat weekly" value={fmtMoney(o.flat_weekly_pay)} />
          <KV label="Est. weekly gross" value={fmtMoney(o.estimated_weekly_gross)} highlight />
          <KV label="Sign-on bonus" value={fmtMoney(o.sign_on_bonus)} />
        </Grid>
      </Section>

      {/* Mileage / Deadhead */}
      <Section icon={Gauge} title="Mileage & Deadhead">
        <Grid>
          <KV label="Weekly miles" value={fmtMiles(o.estimated_weekly_miles)} />
          <KV label="Loaded miles" value={fmtMiles(o.estimated_loaded_miles)} />
          <KV label="Deadhead miles" value={fmtMiles(o.estimated_deadhead_miles)} />
          <KV
            label="Deadhead paid?"
            value={o.deadhead_paid === true ? 'Yes' : o.deadhead_paid === false ? 'No' : 'Not disclosed'}
            warn={o.deadhead_paid === false}
          />
        </Grid>
      </Section>

      {/* Profit Intelligence */}
      <OpportunityProfitBreakdown opportunity={o} isPro={isPro} onUpgrade={onUpgrade} />

      {/* Pro: deduction details */}
      {isPro && (
        <Section icon={CheckCircle2} title="Deduction Details">
          <Grid>
            <KV label="Fuel paid by" value={o.fuel_paid_by || '—'} />
            <KV label="Lease payment" value={fmtMoney(o.lease_payment)} />
            <KV label="Insurance deductions" value={fmtMoney(o.insurance_deductions)} />
            <KV label="Maintenance deductions" value={fmtMoney(o.maintenance_deductions)} />
            <KV label="Other deductions" value={fmtMoney(o.other_deductions)} />
            <KV
              label="Escrow"
              value={o.escrow_required ? `Required • ${fmtMoney(o.escrow_amount)}` : 'Not required'}
              warn={!!o.escrow_required}
            />
          </Grid>
        </Section>
      )}

      {/* Lifestyle */}
      <Section icon={Home} title="Home Time & Lifestyle">
        <Grid>
          <KV label="Home time" value={o.home_time || '—'} />
          <KV label="Forced dispatch" value={o.forced_dispatch == null ? '—' : o.forced_dispatch ? 'Yes' : 'No'} />
          <KV label="Pets allowed" value={o.pets_allowed == null ? '—' : o.pets_allowed ? 'Yes' : 'No'} />
          <KV label="Riders allowed" value={o.riders_allowed == null ? '—' : o.riders_allowed ? 'Yes' : 'No'} />
        </Grid>
      </Section>

      {/* Benefits */}
      {o.benefits && (
        <Section icon={ShieldCheck} title="Benefits">
          <p className="text-sm text-muted-foreground whitespace-pre-line">{o.benefits}</p>
        </Section>
      )}

      {/* Description */}
      {o.description && (
        <Section icon={Truck} title="About this Opportunity">
          <p className="text-sm text-muted-foreground whitespace-pre-line">{o.description}</p>
        </Section>
      )}

      {/* Spacer so fixed action bar doesn't cover content (mobile + desktop) */}
      <div aria-hidden className="h-32 lg:h-28" />

      {/* Action bar: fixed above BottomNav on mobile, fixed within main column on desktop */}
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
        opportunityTitle={o.title}
        companyName={o.company_name}
        isPro={isPro}
        onUpgrade={onUpgrade}
      />

      <ApplyNowDialog
        open={showApply}
        onOpenChange={setShowApply}
        opportunityId={o.id}
        opportunityTitle={o.title}
        companyName={o.company_name}
        driverProfile={driverProfile ?? null}
        onOpenPreferences={onOpenPreferencesForApply}
      />
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof MapPin; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-center gap-2 mb-4">
        <div className="rounded-lg bg-primary/10 p-1.5"><Icon className="h-4 w-4 text-primary" /></div>
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </Card>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div>;
}

function KV({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">{label}</p>
      <p className={`text-sm font-bold ${warn ? 'text-destructive' : highlight ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  );
}
