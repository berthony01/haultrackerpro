/**
 * Phase 1J-B2A — Controlled recruiter entry activation route.
 *
 * Replaces the blind `/recruiter` redirect. Adds recruiter capability to
 * the SAME authenticated driver account (never creates a new account).
 *
 * Authorization inputs (only): `useAuth`, `useUserCapabilities`,
 * `useViewMode`. NO admin, intended_role, localStorage, billing, Stripe,
 * plan, recruiter profile existence, or URL parameters.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
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

  const [rpcError, setRpcError] = useState<Error | null>(null);
  const [rpcPending, setRpcPending] = useState(false);
  // Attempt guard bound to the current user id so a rerender does not
  // fire a second RPC and a user change does not carry over the guard.
  const attemptedRef = useRef<string | null>(null);

  const userId = user?.id ?? null;
  const recruiterStatus = view.recruiterCapabilityStatus;
  const driverStatus = view.driverCapabilityStatus;
  const capsError = caps.error;
  const isLoading = authLoading || caps.isLoading;

  // Reset attempt state whenever the authenticated user id changes.
  useEffect(() => {
    if (attemptedRef.current !== null && attemptedRef.current !== userId) {
      attemptedRef.current = null;
      setRpcError(null);
      setRpcPending(false);
    }
  }, [userId]);

  const beginRecruiterSetup = caps.beginRecruiterSetup;
  const refetch = caps.refetch;

  const runActivation = useCallback(async () => {
    if (!userId) return;
    if (attemptedRef.current === userId) return;
    attemptedRef.current = userId;
    setRpcPending(true);
    setRpcError(null);
    try {
      await beginRecruiterSetup();
      // Never authorize from the mutation's returned status — wait for
      // validated capability rows.
      await refetch();
    } catch (e) {
      setRpcError(e instanceof Error ? e : new Error(String(e)));
    } finally {
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
    if (attemptedRef.current === userId) return;
    void runActivation();
  }, [shouldAutoActivate, userId, runActivation]);

  // Persist recruiter workspace only when validated capability rows
  // currently authorize recruiter hub access. `setViewMode` itself also
  // re-validates against the trusted view — this is defense in depth.
  const recruiterHubAllowed = view.recruiterHubAllowed;
  const setViewMode = view.setViewMode;
  useEffect(() => {
    if (!recruiterHubAllowed) return;
    if (
      recruiterStatus === 'setup' ||
      recruiterStatus === 'active' ||
      recruiterStatus === 'suspended'
    ) {
      setViewMode('recruiter');
    }
  }, [recruiterHubAllowed, recruiterStatus, setViewMode]);

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

  if (recruiterStatus === 'setup') {
    return <Navigate to="/dashboard?page=recruiter-access:onboarding" replace />;
  }
  if (recruiterStatus === 'active' || recruiterStatus === 'suspended') {
    return <Navigate to="/dashboard?page=recruiter-access" replace />;
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
            // Allow exactly one additional attempt per click.
            attemptedRef.current = null;
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
