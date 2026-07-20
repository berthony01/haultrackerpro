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

export default function RecruiterEntryRoute() {
  const { user, loading: authLoading } = useAuth();
  const caps = useUserCapabilities();
  const view = useViewMode();
  const navigate = useNavigate();

  const [rpcError, setRpcError] = useState<Error | null>(null);
  const [rpcPending, setRpcPending] = useState(false);

  const userId = user?.id ?? null;
  const recruiterStatus = view.recruiterCapabilityStatus;
  const driverStatus = view.driverCapabilityStatus;
  const capsError = caps.error;
  const isLoading = authLoading || caps.isLoading;

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

  // Reset guards and mutation state whenever the authenticated user id
  // changes. This must run before any effect that could fire an RPC.
  if (lastUserIdRef.current !== userId) {
    lastUserIdRef.current = userId;
    generationRef.current += 1;
    attemptedGenerationRef.current = -1;
    // Reset render-visible state synchronously via setState in a
    // useEffect below; refs above are safe to mutate during render.
  }

  useEffect(() => {
    // Whenever userId changes, drop any stale error/pending from a
    // previous user so B never inherits A's UI. Effect runs post-render
    // and is bound to userId.
    setRpcError(null);
    setRpcPending(false);
  }, [userId]);

  const beginRecruiterSetup = caps.beginRecruiterSetup;
  const refetch = caps.refetch;

  const runActivation = useCallback(async () => {
    const startedUserId = userId;
    if (!startedUserId) return;
    const startedGeneration = generationRef.current;
    if (attemptedGenerationRef.current === startedGeneration) return;
    attemptedGenerationRef.current = startedGeneration;

    const isCurrent = () =>
      currentUserRef.current === startedUserId &&
      generationRef.current === startedGeneration;

    // Only touch state if this attempt is still current.
    if (isCurrent()) {
      setRpcPending(true);
      setRpcError(null);
    }

    try {
      await beginRecruiterSetup();
      if (!isCurrent()) return; // stale success: no refetch, no state
      await refetch();
      if (!isCurrent()) return;
      setRpcPending(false);
    } catch (e) {
      if (!isCurrent()) return; // stale failure: swallow silently
      setRpcError(e instanceof Error ? e : new Error(String(e)));
      setRpcPending(false);
    }
  }, [userId, beginRecruiterSetup, refetch]);

  // Auto-invoke activation only when validated rows prove:
  //   driver.status === 'active' AND recruiter capability absent.
  // Fail-closed on loading, missing user, capability error, or any
  // other capability shape.
  const shouldAutoActivate =
    !isLoading &&
    !capsError &&
    !!userId &&
    driverStatus === 'active' &&
    recruiterStatus === null &&
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
            // the CURRENT user/generation.
            attemptedGenerationRef.current = -1;
            setRpcError(null);
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
