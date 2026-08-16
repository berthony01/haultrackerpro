import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowRight,
  ArrowLeft,
  Building2,
  Briefcase,
  Users,
  Mail,
  BarChart3,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Ban,
  ShieldCheck,
  PlusCircle,
  HelpCircle,
  
  Truck,
  Eye,
  Edit,
  Sparkles,
  Info,
  Receipt,
} from 'lucide-react';
import { useRecruiterProfile, type RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useRecruiterBilling, RECRUITER_PLAN_LABELS } from '@/hooks/opportunities/useRecruiterBilling';
import { ASSISTANT_AGENCY_PLANS } from '@/lib/agencyPlans';
import type { PaidAgencyPlanKey } from '@/lib/billing/effectiveBusinessEntitlement';

import { useRecruiterOpportunities } from '@/hooks/opportunities/useRecruiterOpportunities';
import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';
import { useUserRole } from '@/hooks/useUserRole';
import { RecruiterBillingPanel } from '../RecruiterBillingPanel';
import {
  describeRecruiterEligibility,
  getRecruiterTrustView,
  type RecruiterTrustView,
} from '@/lib/opportunities/recruiterEligibility';
import { resolveRecruiterReadiness } from '@/lib/opportunities/resolveRecruiterReadiness';
import { RecruiterReadinessDialog } from '../RecruiterReadinessDialog';
import { CarrierSettlementsPanel } from '@/components/settlements/CarrierSettlementsPanel';
// Phase RC-1J-D — owner Team panel, mounted on demand only.
import { RecruiterTeamPanel } from '@/components/recruiter/RecruiterTeamPanel';


// Phase 1F-A.2.2: presentation state derived from the canonical eligibility
// helper — this file MUST NOT reimplement completeness. `active_billing`
// vs `active_no_billing` only alters PREMIUM presentation; posting access
// is decided entirely by canonical eligibility.
type RecruiterState =
  | 'none'
  | 'incomplete'
  | 'suspended'
  | 'active_no_billing'
  | 'active_billing';

function resolveState(
  profile: RecruiterProfile | null,
  hasPremiumAccess: boolean,
  intentRecruiter: boolean,
): { state: RecruiterState; canPost: boolean } {
  const e = describeRecruiterEligibility(profile, { intentRecruiter });
  if (e.state === 'missing_profile') return { state: 'none', canPost: false };
  if (e.state === 'suspended') return { state: 'suspended', canPost: false };
  if (e.state === 'incomplete_profile') return { state: 'incomplete', canPost: false };
  return { state: hasPremiumAccess ? 'active_billing' : 'active_no_billing', canPost: e.canPost };
}


interface Props {
  onBack: () => void;
  onOpenOnboarding: () => void;
  onManage: () => void;
  onApplications: () => void;
}

export function RecruiterAccessPage({ onBack, onOpenOnboarding, onManage, onApplications }: Props) {
  const { profile, isLoading: profileLoading } = useRecruiterProfile();
  const billing = useRecruiterBilling();
  const { isBillingActive, plan, status, isLoading: billingLoading } = billing;
  // Phase 1R-C: premium presentation follows the EFFECTIVE entitlement,
  // which may be an explicit recruiter subscription or agency-included
  // access. Read defensively so narrow legacy mocks keep working.
  const hasPremiumAccess =
    billing.hasEffectivePremiumRecruiterAccess ?? isBillingActive;
  const entitlementSource =
    billing.entitlementSource ??
    (isBillingActive ? 'recruiter_subscription' : 'free_standard');
  const isAgencyIncluded = entitlementSource === 'agency_included';
  const effectiveRecruiterPlan = billing.effectiveRecruiterPlan ?? plan;
  const effectiveAgencyPlan = billing.effectiveAgencyPlan ?? null;
  const canUsePriorityPlacement = billing.canUsePriorityPlacement ?? false;

  const { opportunities, isLoading: oppsLoading } = useRecruiterOpportunities();
  const { recruiterApplications, isLoadingRecruiter } = useOpportunityApplications({ recruiterId: profile?.id ?? undefined });
  const { intentRecruiter } = useUserRole();

  const billingRef = useRef<HTMLDivElement | null>(null);
  const howRef = useRef<HTMLDivElement | null>(null);
  const onboardingRef = useRef<HTMLDivElement | null>(null);
  const settlementsRef = useRef<HTMLDivElement | null>(null);

  const { state, canPost } = resolveState(profile, hasPremiumAccess, !!intentRecruiter);
  const apps = recruiterApplications;

  const snapshot = useMemo(() => {
    const newReq = apps.filter((a) => a.status === 'new').length;
    const contacted = apps.filter((a) =>
      ['contact_requested', 'contacted', 'call_scheduled', 'waiting_documents', 'interviewing', 'offer_sent', 'hired'].includes(a.status),
    ).length;
    const interviews = apps.filter((a) => ['interviewing', 'call_scheduled'].includes(a.status)).length;
    const hired = apps.filter((a) => a.status === 'hired').length;
    const responded = apps.filter((a) => a.status !== 'new').length;
    const responseRate = apps.length > 0 ? Math.round((responded / apps.length) * 100) : 0;
    const activeOpps = opportunities.filter((o) => o.status === 'active').length;
    return {
      activeOpps,
      newReq,
      contacted,
      interviews,
      hired,
      responseRate,
      totalApps: apps.length,
    };
  }, [apps, opportunities]);

  const pipeline = useMemo(() => {
    const count = (s: string | string[]) =>
      apps.filter((a) => (Array.isArray(s) ? s.includes(a.status) : a.status === s)).length;
    return {
      new: count('new'),
      contact: count(['contact_requested', 'contacted']),
      interview: count('interviewing'),
      offer: count('offer_sent'),
      hired: count('hired'),
    };
  }, [apps]);

  const recentPosts = useMemo(() => opportunities.slice(0, 5), [opportunities]);

  // Phase 1F-A.2.2: `canPost` is the canonical eligibility signal derived
  // from describeRecruiterEligibility(). Billing NEVER gates standard posting.
  // Phase 1P-A1: the top-level Post button opens the readiness dialog
  // instead of relying on `postDisabled`; sub-components still consume
  // `canPost` to gate their inline actions.


  // Phase 1P-A1: readiness dialog gates every "Post an Opportunity" click
  // instead of silently disabling the button. The dialog surfaces the exact
  // missing tokens and routes recruiters into onboarding.
  const [readinessOpen, setReadinessOpen] = useState(false);
  // Phase 1T-E1: carrier settlements mount on demand only.
  const [settlementsOpen, setSettlementsOpen] = useState(false);
  // Phase RC-1J-D: owner Team panel mounts on demand only, same low-risk
  // pattern as settlements. Never gated by client plan/capability logic —
  // the server seat-status RPC is authoritative.
  const [teamOpen, setTeamOpen] = useState(false);
  const readiness = resolveRecruiterReadiness(profile);

  const handlePost = () => {
    if (state === 'suspended') {
      setReadinessOpen(true);
      return;
    }
    if (!readiness.ready) {
      setReadinessOpen(true);
      return;
    }
    onManage();
  };


  const scrollTo = (ref: React.RefObject<HTMLDivElement>) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Opening the settlements tool must bring the mounted panel into view and
  // move keyboard focus to it; closing it must not steal focus.
  useEffect(() => {
    if (!settlementsOpen) return;
    const node = settlementsRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    node.focus({ preventScroll: true });
  }, [settlementsOpen]);



  if (profileLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => scrollTo(howRef)}>
            <HelpCircle className="h-4 w-4" /> How It Works
          </Button>
          <Button
            size="sm"
            onClick={handlePost}
            data-testid="post-opportunity-button"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <PlusCircle className="h-4 w-4" /> Post an Opportunity
          </Button>
        </div>
      </div>

      <RecruiterReadinessDialog
        open={readinessOpen}
        onOpenChange={setReadinessOpen}
        profile={profile}
        onReady={onManage}
        actionLabel="Post an Opportunity"
      />



      {/* Page header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
          Recruiter Access
        </h1>
        <p className="text-sm text-muted-foreground">
          Post structured opportunities and connect with professional drivers.
        </p>
      </div>

      {/* Hero command card */}
      <Card className="overflow-hidden border-border/60 bg-gradient-to-br from-card via-card to-primary/10 shadow-primary">
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-0">
          {/* Left: copy + features */}
          <div className="p-6 sm:p-8 space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Recruiter Command Center
            </div>
            <div>
              <h2 className="text-2xl sm:text-4xl font-black tracking-tight text-foreground leading-tight">
                Find reliable drivers. <span className="text-primary">Faster.</span>
              </h2>
              <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-xl">
                HaulTrackerPro helps recruiters post structured opportunities,
                review qualified drivers, and manage your hiring pipeline with clarity and control.
              </p>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <HeroFeature icon={Briefcase} title="Post Opportunities" body="Create structured opportunities in minutes." />
              <HeroFeature icon={Users} title="Review Drivers" body="See Opportunity Preferences, match scores, and request activity." />
              <HeroFeature icon={ShieldCheck} title="Hire with Confidence" body="Manage applications through a structured hiring pipeline." />
            </div>
          </div>

          {/* Right: snapshot */}
          <div className="relative p-6 sm:p-8 bg-gradient-to-br from-background/40 via-background/20 to-primary/10 border-t lg:border-t-0 lg:border-l border-border/60">
            <div className="absolute top-4 right-4 opacity-10 pointer-events-none">
              <Truck className="h-32 w-32 text-primary" strokeWidth={1} />
            </div>
            <div className="relative space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-foreground">Recruiting Snapshot</h3>
                <RecruiterTrustStatus profile={profile} intentRecruiter={!!intentRecruiter} />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <SnapshotStat label="Active Opportunities" value={snapshot.activeOpps} loading={oppsLoading} />
                <SnapshotStat label="New Driver Requests" value={snapshot.newReq} loading={isLoadingRecruiter} />
                <SnapshotStat label="Drivers Contacted" value={snapshot.contacted} loading={isLoadingRecruiter} />
                <SnapshotStat label="Interviews Scheduled" value={snapshot.interviews} loading={isLoadingRecruiter} />
                <SnapshotStat label="Drivers Hired" value={snapshot.hired} loading={isLoadingRecruiter} />
                <SnapshotStat label="Response Rate" value={`${snapshot.responseRate}%`} loading={isLoadingRecruiter} />
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
                Driver interest and hiring outcomes are not guaranteed.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* State-specific status bar */}
      <StateCard
        state={state}
        profile={profile}
        onOpenOnboarding={() => { onboardingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); onOpenOnboarding(); }}
        onChoosePlan={() => scrollTo(billingRef)}
      />

      {/* Onboarding entry (only when missing or rejected) */}
      {(state === 'none' || state === 'incomplete') && (
        <div ref={onboardingRef}>
          <Card className="p-5 border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-foreground mb-1">
                  {state === 'incomplete'
                    ? 'Finish your recruiter profile'
                    : intentRecruiter
                    ? 'Finish Your Recruiter Setup'
                    : 'Add Recruiter Workspace'}
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {state === 'incomplete'
                    ? 'Add your recruiter name, company name, a valid recruiter email, at least one of DOT or MC number, and accept the posting terms. Standard posting unlocks the moment those are saved.'
                    : intentRecruiter
                    ? 'You signed up as a recruiter, but your recruiter profile is not complete yet. Complete the short recruiter profile to start posting.'
                    : 'Add the recruiter workspace to your account. Standard posting unlocks as soon as your profile is complete — no admin approval or paid plan is required.'}
                </p>
                <Button onClick={onOpenOnboarding} data-testid="finish-recruiter-setup-cta">
                  {state === 'incomplete'
                    ? 'Complete Profile'
                    : intentRecruiter
                    ? 'Finish Recruiter Setup'
                    : 'Set Up Recruiter Profile'}{' '}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Approved layout */}
      {(state === 'active_billing' || state === 'active_no_billing') && (
        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
          {/* Left column */}
          <div className="min-w-0 space-y-6">
            <ToolsGrid
              canPost={canPost}
              newRequests={snapshot.newReq}
              onPost={handlePost}
              onManage={onManage}
              onApplications={onApplications}
              settlementsOpen={settlementsOpen}
              onToggleSettlements={() => setSettlementsOpen((v) => !v)}
              teamOpen={teamOpen}
              onToggleTeam={() => setTeamOpen((v) => !v)}
            />

            {settlementsOpen && (
              <div
                ref={settlementsRef}
                tabIndex={-1}
                data-testid="recruiter-settlements-anchor"
                className="scroll-mt-24 outline-none"
              >
                <CarrierSettlementsPanel onManagePlan={() => scrollTo(billingRef)} />
              </div>
            )}

            {teamOpen && profile?.id && (
              <div data-testid="recruiter-team-anchor" className="scroll-mt-24">
                <RecruiterTeamPanel
                  recruiterId={profile.id}
                  companyName={profile.company_name ?? 'Your workspace'}
                  canViewTeam
                  canManageTeam
                  isOwnerActor
                />
              </div>
            )}



            <RecentPosts
              loading={oppsLoading}
              posts={recentPosts}
              onManage={onManage}
              onPost={handlePost}
              canPost={canPost}
            />

            {snapshot.totalApps > 0 && <PipelineSummary pipeline={pipeline} onApplications={onApplications} />}
          </div>

          {/* Right column */}
          <div className="space-y-6">
            <NextSteps
              state={state}
              hasPosts={opportunities.length > 0}
              hasApps={snapshot.totalApps > 0}
              responseRate={snapshot.responseRate}
              onOpenOnboarding={onOpenOnboarding}
              onChoosePlan={() => scrollTo(billingRef)}
              onPost={handlePost}
              onApplications={onApplications}
            />
            <BillingSummary
              loading={billingLoading}
              plan={plan}
              status={status}
              hasPremiumAccess={hasPremiumAccess}
              isAgencyIncluded={isAgencyIncluded}
              effectiveRecruiterPlan={effectiveRecruiterPlan}
              effectiveAgencyPlan={effectiveAgencyPlan}
              canUsePriorityPlacement={canUsePriorityPlacement}
              onManagePlan={() => scrollTo(billingRef)}
            />

          </div>
        </div>
      )}

      {/* Full billing panel (anchor) */}
      {(state === 'active_billing' || state === 'active_no_billing') && (
        <div ref={billingRef} className="scroll-mt-6">
          <RecruiterBillingPanel />
        </div>
      )}

      {/* How it works */}
      <div ref={howRef} className="scroll-mt-6">
        <HowItWorks />
      </div>
    </div>
  );
}

/* ---------------- subcomponents ---------------- */

function HeroFeature({ icon: Icon, title, body }: { icon: typeof Briefcase; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/30 p-3">
      <div className="rounded-lg bg-primary/15 p-1.5 w-fit mb-2">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="text-sm font-bold text-foreground mb-0.5">{title}</p>
      <p className="text-xs text-muted-foreground leading-snug">{body}</p>
    </div>
  );
}

function SnapshotStat({ label, value, loading }: { label: string; value: number | string; loading?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold leading-tight">{label}</p>
      {loading ? (
        <Skeleton className="h-6 w-10 mt-1" />
      ) : (
        <p className="font-mono text-xl font-black text-foreground mt-1 whitespace-nowrap">{value}</p>
      )}
    </div>
  );
}

function StateCard({
  state,
  profile,
  onOpenOnboarding,
  onChoosePlan,
}: {
  state: RecruiterState;
  profile: RecruiterProfile | null;
  onOpenOnboarding: () => void;
  onChoosePlan: () => void;
}) {
  if (state === 'active_billing') return null;

  const cfg =
    state === 'incomplete'
      ? { Icon: AlertTriangle, title: 'Finish your recruiter profile', body: 'Add your recruiter name, company name, a valid recruiter email, and your company type. A DOT or MC number is required for Carrier / Motor Carrier accounts. Then accept the posting terms — standard posting unlocks as soon as your profile is complete.', tone: 'bg-amber-500/10 border-amber-500/30 text-amber-400', cta: { label: 'Complete Profile', onClick: onOpenOnboarding } }
      : state === 'suspended'
      ? { Icon: Ban, title: 'Recruiter Access Suspended', body: 'Please contact support regarding your recruiter account.', tone: 'bg-destructive/10 border-destructive/30 text-destructive', cta: null }
      : state === 'active_no_billing'
      ? { Icon: Sparkles, title: 'Standard posting enabled — post unlimited standard opportunities', body: 'Standard posting is included with your recruiter account. Upgrade only to unlock premium recruiting tools like priority placement, featured visibility, and reports.', tone: 'bg-primary/10 border-primary/30 text-primary', cta: { label: 'See Premium Plans', onClick: onChoosePlan } }
      : null;

  if (!cfg) return null;
  const Icon = cfg.Icon;
  return (
    <Card className={`p-4 border ${cfg.tone}`}>
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{cfg.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{cfg.body}</p>

          {cfg.cta && (
            <Button size="sm" variant="outline" className="mt-3" onClick={cfg.cta.onClick}>
              {cfg.cta.label} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function ToolsGrid({
  canPost,
  newRequests,
  onPost,
  onManage,
  onApplications,
  settlementsOpen,
  onToggleSettlements,
  teamOpen,
  onToggleTeam,
}: {
  canPost: boolean;
  newRequests: number;
  onPost: () => void;
  onManage: () => void;
  onApplications: () => void;
  settlementsOpen: boolean;
  onToggleSettlements: () => void;
  teamOpen: boolean;
  onToggleTeam: () => void;
}) {
  return (
    <Card className="p-5 border-border/60">
      <h3 className="text-base font-bold text-foreground mb-4">Your Recruiting Tools</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <ToolCard
          icon={PlusCircle}
          title="Post an Opportunity"
          body="Reach qualified drivers with a structured opportunity posting."
          cta="Create Post"
          onClick={onPost}
          disabled={!canPost}
          primary
        />
        <ToolCard
          icon={Briefcase}
          title="Manage Opportunities"
          body="Edit, pause, close, or submit your opportunity postings."
          cta="Manage"
          onClick={onManage}
          disabled={!canPost}
        />
        <ToolCard
          icon={Users}
          title="Driver Requests"
          body="Review drivers who requested information."
          cta="View Requests"
          onClick={onApplications}
          disabled={!canPost}
          badge={newRequests > 0 ? `${newRequests} new` : undefined}
        />
        <ToolCard
          icon={Mail}
          title="Contact Requests"
          body="Request contact permission from interested drivers."
          cta="Manage Contact Requests"
          onClick={onApplications}
          disabled={!canPost}
        />
        <ToolCard
          icon={Receipt}
          title="Driver Settlements"
          body="Connect drivers and issue settlement statements for your carrier operation."
          cta={settlementsOpen ? 'Hide Settlements' : 'Open Settlements'}
          onClick={onToggleSettlements}
        />
        <ToolCard
          icon={BarChart3}
          title="Recruiting Analytics"
          body="Track pipeline activity and improve your results."
          cta="View Analytics"
          onClick={onApplications}
          disabled={!canPost}
          comingSoon
        />
      </div>
    </Card>
  );
}

function ToolCard({
  icon: Icon,
  title,
  body,
  cta,
  onClick,
  disabled,
  primary,
  badge,
  comingSoon,
}: {
  icon: typeof Briefcase;
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  badge?: string;
  comingSoon?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 flex flex-col ${primary ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-card'}`}>
      <div className="flex items-start gap-3 mb-2">
        <div className={`rounded-lg p-2 shrink-0 ${primary ? 'bg-primary text-primary-foreground' : 'bg-primary/15 text-primary'}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-foreground">{title}</p>
            {badge && <Badge variant="default" className="text-[10px]">{badge}</Badge>}
            {comingSoon && <Badge variant="outline" className="text-[10px]">Coming Soon</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{body}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant={primary ? 'default' : 'outline'}
        onClick={onClick}
        disabled={disabled}
        className="mt-auto w-full"
      >
        {cta} <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function RecentPosts({
  loading,
  posts,
  onManage,
  onPost,
  canPost,
}: {
  loading: boolean;
  posts: ReturnType<typeof useRecruiterOpportunities>['opportunities'];
  onManage: () => void;
  onPost: () => void;
  canPost: boolean;
}) {
  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-foreground">Recent Opportunity Posts</h3>
        {posts.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onManage}>
            View All <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-8">
          <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
            <Briefcase className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-bold text-foreground mb-1">No opportunities posted yet.</p>
          <p className="text-xs text-muted-foreground mb-4">Get in front of qualified drivers with your first post.</p>
          <Button onClick={onPost} disabled={!canPost}>
            <PlusCircle className="h-4 w-4" /> Create Your First Opportunity
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((o) => (
            <div key={o.id} className="rounded-lg border border-border/60 bg-card/60 p-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="text-sm font-bold text-foreground truncate">{o.title}</p>
                  <Badge variant="outline" className="capitalize text-[10px]">{o.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {[o.hiring_city, o.hiring_state].filter(Boolean).join(', ') || 'Location TBD'}
                  {o.estimated_weekly_gross ? ` · ~$${Number(o.estimated_weekly_gross).toLocaleString()}/wk` : ''}
                  {o.published_at ? ` · ${new Date(o.published_at).toLocaleDateString()}` : ''}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={onManage} title="View">
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={onManage} title="Edit">
                  <Edit className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PipelineSummary({
  pipeline,
  onApplications,
}: {
  pipeline: { new: number; contact: number; interview: number; offer: number; hired: number };
  onApplications: () => void;
}) {
  const items = [
    { label: 'New', value: pipeline.new },
    { label: 'Contact Requested', value: pipeline.contact },
    { label: 'Interviewing', value: pipeline.interview },
    { label: 'Offer Sent', value: pipeline.offer },
    { label: 'Hired', value: pipeline.hired },
  ];
  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-foreground">Pipeline Summary</h3>
        <Button size="sm" variant="ghost" onClick={onApplications}>
          Open Pipeline <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {items.map((i) => (
          <div key={i.label} className="rounded-lg border border-border/60 bg-card/60 p-3 text-center">
            <p className="font-mono text-xl font-black text-foreground">{i.value}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-1 leading-tight">
              {i.label}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function NextSteps({
  state,
  hasPosts,
  hasApps,
  responseRate,
  onOpenOnboarding,
  onChoosePlan,
  onPost,
  onApplications,
}: {
  state: RecruiterState;
  hasPosts: boolean;
  hasApps: boolean;
  responseRate: number;
  onOpenOnboarding: () => void;
  onChoosePlan: () => void;
  onPost: () => void;
  onApplications: () => void;
}) {
  // Phase 1F-A: "Get approved" is no longer a posting prerequisite —
  // it's replaced by "Complete your recruiter profile", which is what
  // actually unlocks standard posting.
  const profileComplete = state === 'active_billing' || state === 'active_no_billing';

  const steps = [
    {
      label: 'Complete recruiter profile',
      done: profileComplete,
      onClick: profileComplete ? undefined : onOpenOnboarding,
    },
    {
      label: 'Post your first opportunity',
      done: hasPosts,
      onClick: hasPosts || !profileComplete ? undefined : onPost,
    },
    {
      label: 'Review driver requests',
      done: hasApps,
      onClick: hasApps && profileComplete ? onApplications : undefined,
    },
    {
      label: 'Improve response rate',
      done: responseRate >= 70 && hasApps,
      onClick: hasApps ? onApplications : undefined,
    },
    {
      label: 'Unlock premium recruiting tools (optional)',
      done: state === 'active_billing',
      onClick: state === 'active_billing' ? undefined : onChoosePlan,
    },
  ];

  return (
    <Card className="p-5 border-border/60">
      <h3 className="text-base font-bold text-foreground mb-4">Next Steps</h3>
      <ul className="space-y-2">
        {steps.map((s) => (
          <li
            key={s.label}
            className={`flex items-center gap-3 rounded-lg border border-border/40 bg-card/40 p-3 ${s.onClick ? 'cursor-pointer hover:border-primary/40' : ''}`}
            onClick={s.onClick}
          >
            {s.done ? (
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            ) : (
              <div className="h-4 w-4 rounded-full border-2 border-border shrink-0" />
            )}
            <span className={`text-sm flex-1 ${s.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
              {s.label}
            </span>
            {s.onClick && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BillingSummary({
  loading,
  plan,
  status,
  hasPremiumAccess,
  isAgencyIncluded,
  effectiveRecruiterPlan,
  effectiveAgencyPlan,
  canUsePriorityPlacement,
  onManagePlan,
}: {
  loading: boolean;
  plan: keyof typeof RECRUITER_PLAN_LABELS;
  status: string;
  hasPremiumAccess: boolean;
  isAgencyIncluded: boolean;
  effectiveRecruiterPlan: keyof typeof RECRUITER_PLAN_LABELS;
  effectiveAgencyPlan: PaidAgencyPlanKey | null;
  canUsePriorityPlacement: boolean;
  onManagePlan: () => void;
}) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!hasPremiumAccess) {
    return (
      <Card className="p-5 border-primary/30 bg-primary/5">
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">Premium recruiting tools (optional)</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3">
              Standard posting is already included with your recruiter account. Upgrade to unlock priority placement, featured visibility, reports, and other premium recruiting tools.
            </p>
            <Button size="sm" onClick={onManagePlan}>See Premium Plans</Button>
          </div>
        </div>
      </Card>
    );
  }
  const priorityPlacement = canUsePriorityPlacement ? 'Included' : 'Upgrade to Growth';

  // Phase 1R-C: agency-included premium recruiter access — no recruiter
  // upgrade or Manage Plan action is offered here.
  if (isAgencyIncluded) {
    const agencyLabel = effectiveAgencyPlan
      ? ASSISTANT_AGENCY_PLANS[effectiveAgencyPlan].label
      : 'Agency plan';
    return (
      <Card className="p-5 border-border/60" data-testid="recruiter-billing-summary-agency-included">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-foreground">Billing</h3>
          <Badge variant="default">Included with agency</Badge>
        </div>
        <div className="space-y-2 text-sm">
          <Row label="Recruiter plan" value={RECRUITER_PLAN_LABELS[effectiveRecruiterPlan]} />
          <Row label="Agency plan" value={agencyLabel} />
          <Row label="Standard posting" value="Unlimited on your recruiter account" />
          <Row
            label="Premium tools"
            value="Included through your agency entitlement"
          />
          <Row label="Priority placement" value={priorityPlacement} />
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-foreground">Billing</h3>
        <Badge variant="default" className="capitalize">{status}</Badge>
      </div>
      <div className="space-y-2 text-sm">
        <Row label="Plan" value={RECRUITER_PLAN_LABELS[plan]} />
        <Row label="Premium status" value={status} />
        <Row label="Standard posting" value="Unlimited on your recruiter account" />
        <Row label="Premium tools" value="Based on your current plan" />
        <Row label="Priority placement" value={priorityPlacement} />
      </div>
      <Button size="sm" variant="outline" className="w-full mt-4" onClick={onManagePlan}>
        Manage Plan <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </Card>
  );
}


function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { n: 1, title: 'Set up your recruiter profile', body: 'Add the recruiter workspace to your account and complete the required recruiter profile fields and posting terms. Standard posting does not require admin approval or a paid plan.' },
    { n: 2, title: 'Post structured opportunities', body: 'Post unlimited standard opportunities as soon as your recruiter profile is complete — drivers see real pay clarity, route info, and your hiring intent.' },
    { n: 3, title: 'Review driver requests', body: 'Approved drivers request info — you review their preferences and activity.' },
    { n: 4, title: 'Request contact permission', body: 'When a driver looks like a fit, request contact permission directly.' },
    { n: 5, title: 'Manage your hiring pipeline', body: 'Move drivers through the structured hiring pipeline with clarity.' },
    { n: 6, title: 'Unlock premium tools (optional)', body: 'Upgrade for priority placement, featured visibility, reports, and other premium recruiting tools.' },
  ];
  return (
    <Card className="p-6 border-border/60">
      <div className="flex items-start gap-3 mb-4">
        <div className="rounded-xl bg-primary/15 p-2">
          <HelpCircle className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="text-base font-bold text-foreground">How Recruiter Access Works</h3>
          <p className="text-xs text-muted-foreground mt-0.5">A trust-first hiring workflow built for professional drivers.</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {steps.map((s) => (
          <div key={s.n} className="rounded-lg border border-border/50 bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="rounded-md bg-primary/15 text-primary font-mono font-black text-xs h-6 w-6 flex items-center justify-center">
                {s.n}
              </div>
              <p className="text-sm font-bold text-foreground">{s.title}</p>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">{s.body}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-4 flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        Driver interest and hiring outcomes are not guaranteed. Paid plans are optional and unlock premium recruiting tools. Admins may still remove posts that violate policy.
      </p>
    </Card>
  );
}

/* ---------------- Phase 1F-A.2.2-R1A exported presentation ---------------- */

/**
 * Visible trust badge shown in the Recruiter Access hero. Renders both the
 * posting-eligibility label and the verification/trust label. When the
 * recruiter is verified it also renders an explicit "Verified Recruiter"
 * affirmation. Pure — derives everything from `getRecruiterTrustView()`.
 */
export function RecruiterTrustStatus({
  profile,
  intentRecruiter,
}: {
  profile: RecruiterProfile | null;
  intentRecruiter?: boolean;
}) {
  const view = getRecruiterTrustView(profile, { intentRecruiter });
  return (
    <div
      className="flex items-center gap-1.5 flex-wrap"
      data-testid="recruiter-trust-status"
      data-state={view.state}
      data-can-post={view.canPost ? 'true' : 'false'}
      data-verified={view.isVerified ? 'true' : 'false'}
    >
      <Badge
        variant={view.canPost ? 'default' : 'outline'}
        className="text-[10px]"
        data-testid="recruiter-posting-label"
      >
        {view.postingLabel}
      </Badge>
      <Badge
        variant={view.verificationBadgeVariant}
        className="text-[10px]"
        data-testid="recruiter-verification-label"
      >
        {view.verificationLabel}
      </Badge>
      {/* Note: verificationLabel above already reads "Verified Recruiter"
        * when approved, so we intentionally do NOT render an additional
        * badge here — that would show the chip twice on the dashboard. */}
    </div>
  );
}

// Phase 1F-A.2.2-R1A.1: the previous test-only `RecruiterAccessControls`
// duplicate surface was removed. Rendered tests must exercise the real
// `RecruiterAccessPage` (with narrow hook mocks) and assert against the
// real Post button, real trust badges (via `RecruiterTrustStatus` above),
// and real ToolCard visibility/enabled state.


