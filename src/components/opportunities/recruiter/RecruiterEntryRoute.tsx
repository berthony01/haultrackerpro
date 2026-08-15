/**
 * Phase 1J-B2A — Controlled recruiter entry activation route.
 *
 * Replaces the blind `/recruiter` redirect. Adds recruiter capability to
 * the SAME authenticated driver account (never creates a new account).
 *
 * Authorization inputs (only): `useAuth`, `useUserCapabilities`,
 * `useViewMode`. No admin flags, intended_role, localStorage reads,
 * billing/plan hooks, payment providers, recruiter profile existence,
 * or URL parameters participate in authorization.
 *
 * Stale-async isolation: every activation attempt is bound to both the
 * initiating user id AND a per-user generation token. Any completion
 * (success or failure) belonging to a superseded attempt becomes a
 * no-op — it cannot mutate state for the newly authenticated user.
 *
 * Authorized navigation order: automatic recruiter navigation requires
 * validated capability rows that currently authorize recruiter hub
 * access. When they do, a single effect first persists the recruiter
 * view mode, then navigates. There is no render-time `<Navigate>` gated
 * on capability status alone.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserCapabilities } from '@/hooks/useUserCapabilities';
import { useViewMode } from '@/hooks/useViewMode';

function NeutralLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] items-center justify-center p-6 text-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}

function BackToDriverButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate('/dashboard', { replace: true })}
      className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:opacity-90"
    >
      Back to Driver Dashboard
    </button>
  );
}

function BlockedPanel({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div
      role="alert"
      className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center p-6 text-center"
    >
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <BackToDriverButton />
    </div>
  );
}

/**
 * Attempt UI state is single-object, owner-tagged. Every render only
 * exposes error/pending when the owner matches the current user id AND
 * the current generation. A superseded or foreign owner is treated as
 * null/false synchronously — no post-render effect is required to
 * privacy-scrub A's UI before B renders.
 */
type AttemptState = {
  ownerUserId: string;
  ownerGeneration: number;
  pending: boolean;
  error: Error | null;
};

export default function RecruiterEntryRoute() {
  const { user, loading: authLoading } = useAuth();
  const caps = useUserCapabilities();
  const view = useViewMode();
  const navigate = useNavigate();

  const [attempt, setAttempt] = useState<AttemptState | null>(null);

  const userId = user?.id ?? null;
  const recruiterStatus = view.recruiterCapabilityStatus;
  const driverStatus = view.driverCapabilityStatus;
  const capsError = caps.error;
  // Phase RC-1C — staff workspace entry context comes from useViewMode
  // ONLY. This route must never instantiate a second staff hook.
  const staffWorkspaces = view.staffWorkspaces;
  const selectedStaffWorkspace = view.selectedStaffWorkspace;
  const staffSelectionRequired = view.staffSelectionRequired;
  const staffWorkspaceError = view.staffWorkspaceError;
  const selectStaffWorkspace = view.selectStaffWorkspace;
  // Staff discovery must be SETTLED before any activation decision.
  const isLoading = authLoading || caps.isLoading || view.isLoading;

  // Synchronously track the current user id. Every render updates the
  // ref so async completions can compare against the most recent id.
  const currentUserRef = useRef<string | null>(userId);
  currentUserRef.current = userId;

  // Generation token: incremented whenever the authenticated user
  // changes. In-flight attempts capture the generation at start and
  // any completion whose generation is stale becomes a strict no-op.
  const generationRef = useRef(0);
  const lastUserIdRef = useRef<string | null>(userId);
  // Per-generation guard so retry/rerender do not fire duplicate RPCs
  // for the same user session.
  const attemptedGenerationRef = useRef<number>(-1);

  // Mounted guard: after unmount, no completion may mutate state or
  // trigger refetch.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset guards synchronously when the authenticated user id changes.
  // This runs during render (before effects) so the CURRENT render
  // already sees the new generation and never re-fires stale attempts.
  if (lastUserIdRef.current !== userId) {
    lastUserIdRef.current = userId;
    generationRef.current += 1;
    attemptedGenerationRef.current = -1;
  }

  // Owner-scoped visibility. A stored `attempt` owned by A is
  // invisible when the current user is B or when the current
  // generation has advanced.
  const currentGeneration = generationRef.current;
  const attemptVisible =
    attempt !== null &&
    userId !== null &&
    attempt.ownerUserId === userId &&
    attempt.ownerGeneration === currentGeneration;
  const rpcError: Error | null = attemptVisible ? attempt!.error : null;
  const rpcPending: boolean = attemptVisible ? attempt!.pending : false;

  const beginRecruiterSetup = caps.beginRecruiterSetup;
  const refetch = caps.refetch;

  const runActivation = useCallback(async () => {
    const startedUserId = userId;
    if (!startedUserId) return;
    const startedGeneration = generationRef.current;
    if (attemptedGenerationRef.current === startedGeneration) return;
    attemptedGenerationRef.current = startedGeneration;

    const isCurrent = () =>
      mountedRef.current &&
      currentUserRef.current === startedUserId &&
      generationRef.current === startedGeneration;

    const writeOwned = (patch: { pending: boolean; error: Error | null }) => {
      if (!isCurrent()) return;
      setAttempt({
        ownerUserId: startedUserId,
        ownerGeneration: startedGeneration,
        ...patch,
      });
    };

    writeOwned({ pending: true, error: null });

    try {
      await beginRecruiterSetup();
      if (!isCurrent()) return; // stale success: no refetch, no state
      await refetch();
      if (!isCurrent()) return;
      writeOwned({ pending: false, error: null });
    } catch (e) {
      if (!isCurrent()) return; // stale failure: swallow silently
      writeOwned({
        pending: false,
        error: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }, [userId, beginRecruiterSetup, refetch]);

  // Phase RC-1C — a staff membership is an organizational entry path and
  // must SUPPRESS personal recruiter capability creation entirely.
  const staffPathBlocksActivation =
    recruiterStatus === null &&
    (!!staffWorkspaceError ||
      staffSelectionRequired ||
      !!selectedStaffWorkspace ||
      staffWorkspaces.length > 0);

  // Auto-invoke activation only when validated rows prove:
  //   driver.status === 'active' AND recruiter capability absent
  //   AND staff discovery completed successfully with ZERO workspaces.
  // Fail-closed on loading, missing user, capability error, or any
  // other capability shape. Uses the current-user-visible error only.
  const shouldAutoActivate =
    !isLoading &&
    !capsError &&
    !!userId &&
    driverStatus === 'active' &&
    recruiterStatus === null &&
    !staffPathBlocksActivation &&
    rpcError === null;

  useEffect(() => {
    if (!shouldAutoActivate) return;
    if (attemptedGenerationRef.current === generationRef.current) return;
    void runActivation();
  }, [shouldAutoActivate, userId, runActivation]);

  // --------------- Authorized recruiter navigation ---------------
  //
  // The route only enters recruiter workspace when ALL conditions hold
  // against currently validated capability rows:
  //  - authenticated user
  //  - not loading
  //  - no capability error
  //  - recruiterStatus ∈ {setup, active, suspended}
  //  - recruiterHubAllowed === true
  //
  // If eligibility signals are present but hubAllowed is false, we fail
  // closed on this route: neither setViewMode nor navigate is invoked.
  const recruiterHubAllowed = view.recruiterHubAllowed;
  const setViewMode = view.setViewMode;

  const recruiterDestination: string | null =
    recruiterStatus === 'setup'
      ? '/dashboard?page=recruiter-access:onboarding'
      : recruiterStatus === 'active' || recruiterStatus === 'suspended'
        ? '/dashboard?page=recruiter-access'
        // RC-1C: staff entry — hub only, never onboarding, never setup RPC.
        : recruiterStatus === null && selectedStaffWorkspace
          ? '/dashboard?page=recruiter-access'
          : null;

  const mayEnterRecruiter =
    !isLoading &&
    !capsError &&
    !!userId &&
    recruiterHubAllowed &&
    recruiterDestination !== null;

  // Prevent redundant navigation loops for the same user/destination.
  const lastNavigatedRef = useRef<{ userId: string; destination: string } | null>(
    null,
  );

  useEffect(() => {
    if (!mayEnterRecruiter || !recruiterDestination || !userId) return;
    const last = lastNavigatedRef.current;
    if (last && last.userId === userId && last.destination === recruiterDestination) {
      return;
    }
    lastNavigatedRef.current = { userId, destination: recruiterDestination };
    // Order: persist recruiter workspace FIRST, then navigate.
    setViewMode('recruiter');
    navigate(recruiterDestination, { replace: true });
  }, [mayEnterRecruiter, recruiterDestination, userId, setViewMode, navigate]);

  // ---------------- Render ----------------

  if (isLoading) return <NeutralLoading />;
  // Defense in depth: ProtectedRoute normally handles this, but never
  // touch RPC / navigation if we somehow render without a user.
  if (!userId) return <NeutralLoading />;

  if (capsError) {
    return (
      <BlockedPanel
        title="Recruiter access unavailable"
        message="We couldn't verify your account capabilities. Please try again shortly."
      />
    );
  }

  if (recruiterStatus === 'revoked') {
    return (
      <BlockedPanel
        title="Recruiter access is unavailable"
        message="Recruiter access is not available on this account. Your driver workspace is still available."
      />
    );
  }

  // Recruiter capability present in an eligible state.
  if (recruiterDestination !== null) {
    // If hub is not currently authorized, fail closed on this route
    // (no mode change, no navigation). Render neutral preparation UI.
    return <NeutralLoading label="Preparing recruiter workspace…" />;
  }

  // recruiterStatus === null past this point.
  if (driverStatus !== 'active') {
    return (
      <BlockedPanel
        title="Recruiter access unavailable"
        message="Recruiter access requires an active driver account."
      />
    );
  }

  if (rpcError) {
    return (
      <div
        role="alert"
        className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center p-6 text-center"
      >
        <h1 className="text-xl font-semibold">We couldn't set up recruiter access</h1>
        <p className="mt-2 text-sm text-muted-foreground">{rpcError.message}</p>
        <button
          type="button"
          onClick={() => {
            // Allow exactly one additional attempt per click, bound to
            // the CURRENT user/generation. Clear the owned error so
            // shouldAutoActivate is not blocked by the stale error.
            attemptedGenerationRef.current = -1;
            setAttempt(null);
            void runActivation();
          }}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:opacity-90"
        >
          Try Again
        </button>
        <BackToDriverButton />
      </div>
    );
  }

  return (
    <NeutralLoading
      label={rpcPending ? 'Preparing recruiter workspace…' : 'Preparing recruiter workspace…'}
    />
  );
}
