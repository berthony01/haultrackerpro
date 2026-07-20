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
import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { RecruiterAccessPage } from './RecruiterAccessPage';
import { RecruiterOnboarding } from '../RecruiterOnboarding';
import { RecruiterOpportunityManager } from '../RecruiterOpportunityManager';
import { RecruiterApplicationsDashboard } from '../RecruiterApplicationsDashboard';
import {
  resolveRecruiterSubviewForStatus,
  type RecruiterSubview,
} from '@/lib/workspaceAccess';
import type { UserCapabilityStatus } from '@/lib/userCapabilities';

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
  if (
    !recruiterCapabilityStatus ||
    recruiterCapabilityStatus === 'revoked'
  ) {
    return <NeutralPanel label="Recruiter workspace unavailable." />;
  }

  // Re-resolve on every render as a final belt-and-braces check.
  const safeView = useMemoSafe(view, resolveInternal);

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

// Local hook: re-derive safeView cheaply without pulling useMemo import.
function useMemoSafe(
  view: RecruiterSubview,
  resolveInternal: (v: RecruiterSubview) => RecruiterSubview,
): RecruiterSubview {
  return resolveInternal(view);
}
