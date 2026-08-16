/**
 * Phase 1J-B2B — Recruiter access subview shell with capability-authorized
 * defense-in-depth.
 *
 * Every subview mount and every internal callback is resolved through
 * the pure `resolveRecruiterSubviewForStatus` policy using capability
 * status + operations-allowed props passed by Index. This route no
 * longer trusts `initialView` alone. Loading / error / unresolved / hub
 * disallowed / revoked / missing all render a neutral panel — no
 * RecruiterAccessPage, Onboarding, Manager, Applications, or Reports
 * child mounts in those states.
 *
 * Authorization inputs (only): capability status + hub/ops flags from
 * Index. No useUserRole, admin, billing, plan, recruiter profile,
 * localStorage, sessionStorage, or URL parsing participates here.
 */
import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { RecruiterAccessPage } from './RecruiterAccessPage';
import { RecruiterOnboarding } from '../RecruiterOnboarding';
import {
  RecruiterOpportunityManager,
  RecruiterStaffOpportunityManager,
} from '../RecruiterOpportunityManager';
import { useRecruiterStaffPermissions } from '@/hooks/recruiter/useRecruiterStaffPermissions';
import { RecruiterApplicationsDashboard } from '../RecruiterApplicationsDashboard';
import { RecruiterStaffApplicationsDashboard } from '../RecruiterStaffApplicationsDashboard';
import { RecruiterStaffReferralsPanel } from '../RecruiterStaffReferralsPanel';
import { RecruiterStaffContractsView } from '@/components/contracts/RecruiterStaffContractsView';
import { RecruiterStaffReportsPanel } from '@/components/recruiter/RecruiterStaffReportsPanel';
import { RecruiterStaffSettlementsPanel } from '@/components/settlements/RecruiterStaffSettlementsPanel';




import {
  resolveRecruiterSubviewForStatus,
  type RecruiterSubview,
} from '@/lib/workspaceAccess';
import type { UserCapabilityStatus } from '@/lib/userCapabilities';
import type { RecruiterStaffWorkspace } from '@/lib/recruiterStaffWorkspaceResolution';

const RecruiterReportsPanel = lazy(() =>
  import('@/components/recruiter/RecruiterReportsPanel').then(m => ({ default: m.RecruiterReportsPanel }))
);

interface Props {
  onBack: () => void;
  initialView?: RecruiterSubview;
  /** Capability + workspace props from Index. When absent the route
   *  fails closed (renders neutral state, never mounts children). */
  recruiterCapabilityStatus?: UserCapabilityStatus | null;
  recruiterHubAllowed?: boolean;
  recruiterOperationsAllowed?: boolean;
  workspaceLoading?: boolean;
  workspaceError?: unknown;
  /** Phase RC-1C — shell status + staff entry context. */
  recruiterWorkspaceStatus?: UserCapabilityStatus | null;
  recruiterAccessKind?: 'capability' | 'staff' | null;
  selectedStaffWorkspace?: RecruiterStaffWorkspace | null;
  onChangeStaffWorkspace?: () => void;
}

/**
 * Phase RC-1C / RC-1D — STAFF workspace home.
 *
 * Safe entry context plus, in RC-1D, a single permission-gated entry point
 * into the staff opportunity manager. Mounts NO owner recruiter child and NO
 * billing/profile/application/contract/settlement hook.
 */
function StaffWorkspaceRoute({
  workspace,
  onChangeStaffWorkspace,
}: {
  workspace: RecruiterStaffWorkspace;
  onChangeStaffWorkspace?: () => void;
}) {
  const perms = useRecruiterStaffPermissions(workspace.recruiterId);
  const [staffView, setStaffView] = useState<
    | 'home'
    | 'opportunities'
    | 'applications'
    | 'referrals'
    | 'contracts'
    | 'reports'
    | 'settlements'
    | 'team'
  >('home');



  const roleLabel =
    workspace.memberRole === 'recruiter_admin' ? 'Workspace Admin' : 'Workspace Staff';

  // Fail closed: loading or error never mounts the manager.
  const canOpenOpportunities =
    !perms.isLoading && !perms.error && perms.canViewOpportunities;
  // Phase RC-1E — applications entry point, same fail-closed contract.
  const canOpenApplications =
    !perms.isLoading && !perms.error && perms.canViewApplications;
  // Phase RC-1F — referrals entry point, same fail-closed contract.
  const canOpenReferrals =
    !perms.isLoading &&
    !perms.error &&
    (perms.canViewReferrals || perms.canManageReferralTerms);
  // Phase RC-1G — contracts entry point, same fail-closed contract.
  // `contracts_manage` does NOT open the surface on its own.
  const canOpenContracts =
    !perms.isLoading && !perms.error && perms.canViewContracts;
  // Phase RC-1H — reports entry point, same fail-closed contract.
  // `reports_export` does NOT open the surface on its own.
  const canOpenReports =
    !perms.isLoading && !perms.error && perms.canViewReports;
  // Phase RC-1I — settlements entry point, same fail-closed contract.
  // `settlements_prepare` / `settlements_finalize` do NOT open the surface
  // on their own.
  const canOpenSettlements =
    !perms.isLoading && !perms.error && perms.canViewSettlements;
  // Phase RC-1J-D — team entry point, same fail-closed contract.
  // `team_manage` does NOT open the surface on its own.
  const canOpenTeam =
    !perms.isLoading && !perms.error && perms.canViewTeam;




  if (staffView === 'opportunities' && canOpenOpportunities) {
    return (
      <RecruiterStaffOpportunityManager
        recruiterId={workspace.recruiterId}
        companyName={workspace.companyName}
        permissions={{
          canViewOpportunities: perms.canViewOpportunities,
          canCreateOpportunities: perms.canCreateOpportunities,
          canEditOpportunities: perms.canEditOpportunities,
          canChangeOpportunityStatus: perms.canChangeOpportunityStatus,
          canDeleteOpportunities: perms.canDeleteOpportunities,
        }}
        onBack={() => setStaffView('home')}
      />
    );
  }

  if (staffView === 'applications' && canOpenApplications) {
    return (
      <RecruiterStaffApplicationsDashboard
        recruiterId={workspace.recruiterId}
        companyName={workspace.companyName}
        canViewApplications={perms.canViewApplications}
        canManageApplicationStatus={perms.canManageApplicationStatus}
        canRequestApplicationContact={perms.canRequestApplicationContact}
        onBack={() => setStaffView('home')}
      />
    );
  }

  if (staffView === 'referrals' && canOpenReferrals) {
    return (
      <RecruiterStaffReferralsPanel
        recruiterId={workspace.recruiterId}
        companyName={workspace.companyName}
        canViewReferrals={perms.canViewReferrals}
        canManageReferralStatus={perms.canManageReferralStatus}
        canManageReferralTerms={perms.canManageReferralTerms}
        onBack={() => setStaffView('home')}
      />
    );
  }

  if (staffView === 'contracts' && canOpenContracts) {
    return (
      <RecruiterStaffContractsView
        recruiterId={workspace.recruiterId}
        companyName={workspace.companyName}
        canViewContracts={perms.canViewContracts}
        canManageContracts={perms.canManageContracts}
        onBack={() => setStaffView('home')}
      />
    );
  }

  if (staffView === 'reports' && canOpenReports) {
    return (
      <RecruiterStaffReportsPanel
        recruiterId={workspace.recruiterId}
        companyName={workspace.companyName}
        canViewReports={perms.canViewReports}
        canExportReports={perms.canExportReports}
        onBack={() => setStaffView('home')}
      />
    );
  }

  if (staffView === 'settlements' && canOpenSettlements) {
    return (
      <RecruiterStaffSettlementsPanel
        recruiterId={workspace.recruiterId}
        companyName={workspace.companyName}
        canViewSettlements={perms.canViewSettlements}
        canPrepareSettlements={perms.canPrepareSettlements}
        canFinalizeSettlements={perms.canFinalizeSettlements}
        onBack={() => setStaffView('home')}
      />
    );
  }

  if (staffView === 'team' && canOpenTeam) {
    return (
      <RecruiterTeamPanel
        recruiterId={workspace.recruiterId}
        companyName={workspace.companyName}
        canViewTeam={perms.canViewTeam}
        canManageTeam={perms.canManageTeam}
        isOwnerActor={false}
        actorPermissions={perms.permissions}
        onBack={() => setStaffView('home')}
      />
    );
  }







  return (
    <div
      data-testid="recruiter-staff-workspace-home"
      className="mx-auto w-full max-w-2xl px-1 py-8"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        Recruiter Workspace
      </p>
      <h1 className="mt-1 text-2xl font-black tracking-tight text-foreground break-words">
        {workspace.companyName}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground break-words">
        {workspace.recruiterName} · {roleLabel}
      </p>
      <div className="mt-6 rounded-xl border border-border/60 bg-card/60 p-4">
        <p className="text-sm text-foreground">Your workspace connection is active.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Recruiter tools are permission-controlled. Only the areas your workspace owner
          granted are available to you.
        </p>
        {canOpenOpportunities && (
          <button
            type="button"
            onClick={() => setStaffView('opportunities')}
            data-testid="staff-open-opportunities"
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Manage Opportunities
          </button>
        )}
        {canOpenApplications && (
          <button
            type="button"
            onClick={() => setStaffView('applications')}
            data-testid="staff-open-applications"
            className="mt-4 ml-0 inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:ml-3"
          >
            Manage Applications
          </button>
        )}
        {canOpenReferrals && (
          <button
            type="button"
            onClick={() => setStaffView('referrals')}
            data-testid="staff-open-referrals"
            className="mt-4 ml-0 inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:ml-3"
          >
            Manage Referrals
          </button>
        )}
        {canOpenContracts && (
          <button
            type="button"
            onClick={() => setStaffView('contracts')}
            data-testid="staff-open-contracts"
            className="mt-4 ml-0 inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:ml-3"
          >
            Manage Contracts
          </button>
        )}
        {canOpenReports && (
          <button
            type="button"
            onClick={() => setStaffView('reports')}
            data-testid="staff-open-reports"
            className="mt-4 ml-0 inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:ml-3"
          >
            Manage Reports
          </button>
        )}
        {canOpenSettlements && (
          <button
            type="button"
            onClick={() => setStaffView('settlements')}
            data-testid="staff-open-settlements"
            className="mt-4 ml-0 inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:ml-3"
          >
            Manage Settlements
          </button>
        )}



      </div>
      {onChangeStaffWorkspace && (
        <button
          type="button"
          onClick={onChangeStaffWorkspace}
          className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-md border border-border/60 px-4 py-2 text-sm font-semibold text-foreground hover:border-primary/60"
        >
          Change recruiter workspace
        </button>
      )}
    </div>
  );
}



function NeutralPanel({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="recruiter-access-neutral"
      className="flex min-h-[40vh] items-center justify-center py-12 text-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}

export function RecruiterAccessRoute({
  onBack,
  initialView = 'hub',
  recruiterCapabilityStatus = null,
  recruiterHubAllowed = false,
  recruiterOperationsAllowed = false,
  workspaceLoading = false,
  workspaceError = null,
  recruiterAccessKind = null,
  selectedStaffWorkspace = null,
  onChangeStaffWorkspace,
}: Props) {
  const navigate = useNavigate();

  // Resolved current subview. Every mutation runs through
  // resolveInternal() so callbacks cannot escape the status policy.
  const resolveInternal = useCallback(
    (requested: RecruiterSubview | null | undefined): RecruiterSubview => {
      if (!recruiterHubAllowed) return 'hub';
      // Adversarial active-without-operations collapses operational
      // requests to hub even though the status resolver would preserve them.
      if (
        recruiterCapabilityStatus === 'active' &&
        !recruiterOperationsAllowed
      ) {
        return 'hub';
      }
      return (
        resolveRecruiterSubviewForStatus(
          recruiterCapabilityStatus,
          requested ?? 'hub',
        ) ?? 'hub'
      );
    },
    [recruiterCapabilityStatus, recruiterHubAllowed, recruiterOperationsAllowed],
  );

  const [view, setView] = useState<RecruiterSubview>(() =>
    resolveInternal(initialView),
  );

  // Reconcile whenever inputs change — the ONLY authorized mounting path.
  useEffect(() => {
    setView(prev => {
      const safe = resolveInternal(initialView);
      return safe !== prev ? safe : prev;
    });
  }, [initialView, resolveInternal]);

  const setViewSafe = useCallback(
    (requested: RecruiterSubview) => {
      setView(resolveInternal(requested));
    },
    [resolveInternal],
  );

  // Fail-closed render gates.
  if (workspaceLoading) {
    return <NeutralPanel label="Loading…" />;
  }
  if (workspaceError) {
    return <NeutralPanel label="Recruiter workspace unavailable." />;
  }
  if (!recruiterHubAllowed) {
    return <NeutralPanel label="Recruiter workspace unavailable." />;
  }

  // Phase RC-1C — STAFF mode. Returns BEFORE any owner operational child
  // can mount; every requested subview collapses to this neutral home.
  if (recruiterAccessKind === 'staff') {
    if (!selectedStaffWorkspace || recruiterCapabilityStatus) {
      return <NeutralPanel label="Recruiter workspace unavailable." />;
    }
    return (
      <StaffWorkspaceRoute
        workspace={selectedStaffWorkspace}
        onChangeStaffWorkspace={onChangeStaffWorkspace}
      />
    );
  }
  if (
    !recruiterCapabilityStatus ||
    recruiterCapabilityStatus === 'revoked'
  ) {
    return <NeutralPanel label="Recruiter workspace unavailable." />;
  }

  // Belt-and-braces: re-resolve against the current status on every render.
  const safeView = resolveInternal(view);

  if (safeView === 'onboarding') {
    return <RecruiterOnboarding onBack={() => setViewSafe('hub')} />;
  }
  if (safeView === 'manager') {
    return <RecruiterOpportunityManager onBack={() => setViewSafe('hub')} />;
  }
  if (safeView === 'applications') {
    return <RecruiterApplicationsDashboard onBack={() => setViewSafe('hub')} />;
  }
  if (safeView === 'reports') {
    return (
      <Suspense fallback={
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      }>
        <RecruiterReportsPanel
          onBack={() => setViewSafe('hub')}
          onUpgrade={() => navigate('/pricing')}
        />
      </Suspense>
    );
  }

  return (
    <RecruiterAccessPage
      onBack={onBack}
      onOpenOnboarding={() => setViewSafe('onboarding')}
      onManage={() => setViewSafe('manager')}
      onApplications={() => setViewSafe('applications')}
    />
  );
}
