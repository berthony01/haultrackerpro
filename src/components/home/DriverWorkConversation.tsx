import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import HomeConversationFlow from '@/components/home/HomeConversationFlow';
import { useAuth } from '@/hooks/useAuth';
import { useViewMode } from '@/hooks/useViewMode';
import { useActingContext } from '@/hooks/useActingContext';
import { useDriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';
import { HOME_INTAKE_NEXT_PATH, type IntakeAnswers } from '@/lib/home/conversationIntake';
import { describeProfileReuse, mapProfileToIntakeAnswers } from '@/lib/home/profileConversationMerge';
import { setPendingProfileAnswers } from '@/lib/home/pendingProfileHandoff';
import { clearJobSearchCardHandoff, setJobSearchCardHandoff, JOB_SEARCH_CARD_PATH } from '@/lib/jobSearch/jobSearchCardHandoff';
import { useEffect, useRef, useState } from 'react';
import { useWorkConversationDraftStore } from '@/components/home/WorkConversationDraftProvider';
import type { ConversationDraftAdapter } from '@/components/home/HomeConversationFlow';

export const FIND_WORK_CONTINUE_LABEL = 'Review/update my work profile';
export const FIND_WORK_PROFILE_ERROR_LINE =
  'We could not load your saved work profile right now, so we will just ask a few questions.';
export const FIND_WORK_NOT_AVAILABLE = 'Find Work is available on driver accounts.';
export const FIND_WORK_CONTINUITY_NOTE =
  'Progress stays while you browse in this tab. Refreshing or signing out clears it.';
export const FIND_WORK_START_OVER_NOTE =
  'Start over clears this conversation only. Your saved work profile is not changed.';

/** Personal, canonical Driver access only. Never mount profile reads before resolution. */
export default function DriverWorkConversation({ theme }: { theme?: 'light' | 'dark' } = {}) {
  const { user, loading: authLoading } = useAuth();
  const { driverWorkspaceAllowed, isLoading, error } = useViewMode();
  const { isActingAsAssistant, isLoadingManagedDrivers } = useActingContext();
  const draftStore = useWorkConversationDraftStore();
  // Definitive invalid outer gates clear the retained personal-driver draft.
  if (draftStore && !authLoading && !isLoading && !isLoadingManagedDrivers &&
      (!user || error || driverWorkspaceAllowed !== true || isActingAsAssistant)) {
    draftStore.clear();
  }
  useEffect(() => {
    if (authLoading || isLoading || error || isLoadingManagedDrivers || !user || driverWorkspaceAllowed !== true || isActingAsAssistant) clearJobSearchCardHandoff();
  }, [user?.id, authLoading, isLoading, error, isLoadingManagedDrivers, driverWorkspaceAllowed, isActingAsAssistant]);

  if (authLoading || isLoading || isLoadingManagedDrivers) {
    return <p data-testid="find-work-loading" className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!user || error || driverWorkspaceAllowed !== true || isActingAsAssistant) {
    return <p data-testid="find-work-unavailable" className="text-sm text-muted-foreground">{FIND_WORK_NOT_AVAILABLE}</p>;
  }
  return <ProfileConversation key={user.id} theme={theme} />;
}

function ProfileConversation({ theme }: { theme?: 'light' | 'dark' }) {
  const navigate = useNavigate();
  const { user, session } = useAuth();
  const liveOwner = useRef(user?.id);
  liveOwner.current = user?.id;
  const { profile, isLoading: profileLoading, isError } = useDriverOpportunityProfile();
  const seed = useMemo(() => isError ? {} : mapProfileToIntakeAnswers(profile), [isError, profile]);
  const reuseLabels = useMemo(() => describeProfileReuse(seed), [seed]);
  const hasSeed = reuseLabels.length > 0;
  const draftStore = useWorkConversationDraftStore();
  const ownerId = user?.id ?? '';
  // Canonical seed fingerprint: a changed saved profile invalidates a retained flow.
  const fingerprint = useMemo(() => JSON.stringify({ e: isError, s: hasSeed ? seed : null }), [isError, hasSeed, seed]);
  // One epoch-bound lease per mount. An invalidation while mounted permanently
  // retires it; only a fresh remount under valid identity obtains a new lease.
  const [lease] = useState(() => (draftStore && ownerId ? draftStore.lease(ownerId) : null));
  const draftAdapter = useMemo<ConversationDraftAdapter | undefined>(() => {
    if (!lease || !ownerId) return undefined;
    const ok = () => liveOwner.current === ownerId && session?.user.id === ownerId;
    return {
      read: () => (ok() ? lease.read(fingerprint) : null),
      write: (snap) => { if (ok()) lease.write(fingerprint, snap); },
    };
  }, [lease, ownerId, fingerprint, session?.user.id]);

  if (profileLoading) {
    return <p data-testid="find-work-loading" className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <>
      {isError && (
        <p data-testid="find-work-profile-error" className="mb-3 text-sm text-muted-foreground">
          {FIND_WORK_PROFILE_ERROR_LINE}
        </p>
      )}
      {draftAdapter && (
        <p data-testid="find-work-continuity-note" className="mb-3 text-xs text-muted-foreground">
          {FIND_WORK_CONTINUITY_NOTE} {FIND_WORK_START_OVER_NOTE}
        </p>
      )}
      <HomeConversationFlow
        key={fingerprint}
        theme={theme}
        draftAdapter={draftAdapter}
        amber="hsl(var(--primary))"
        surface="hsl(var(--card))"
        border="hsl(var(--border))"
        textMuted="hsl(var(--muted-foreground))"
        textDim="hsl(var(--muted-foreground))"
        initialAnswers={hasSeed ? seed : undefined}
        profileReuseLabels={hasSeed ? reuseLabels : undefined}
        continueLabel={FIND_WORK_CONTINUE_LABEL}
        onReviewJobSearchCard={(answers) => {
          if (!user || session?.user.id !== user.id || liveOwner.current !== user.id) return;
          setJobSearchCardHandoff(user.id, answers);
          navigate(JOB_SEARCH_CARD_PATH);
        }}
        onContinue={(answers: IntakeAnswers) => {
          if (!user || session?.user.id !== user.id || liveOwner.current !== user.id) return;
          setPendingProfileAnswers(user.id, answers);
          navigate(HOME_INTAKE_NEXT_PATH);
        }}
      />
    </>
  );
}
