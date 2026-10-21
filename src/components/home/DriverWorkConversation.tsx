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

export const FIND_WORK_CONTINUE_LABEL = 'Review/update my work profile';
export const FIND_WORK_PROFILE_ERROR_LINE =
  'We could not load your saved work profile right now, so we will just ask a few questions.';
export const FIND_WORK_NOT_AVAILABLE = 'Find Work is available on driver accounts.';

/** Personal, canonical Driver access only. Never mount profile reads before resolution. */
export default function DriverWorkConversation() {
  const { user, loading: authLoading } = useAuth();
  const { driverWorkspaceAllowed, isLoading, error } = useViewMode();
  const { isActingAsAssistant, isLoadingManagedDrivers } = useActingContext();

  if (authLoading || isLoading || isLoadingManagedDrivers) {
    return <p data-testid="find-work-loading" className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!user || error || driverWorkspaceAllowed !== true || isActingAsAssistant) {
    return <p data-testid="find-work-unavailable" className="text-sm text-muted-foreground">{FIND_WORK_NOT_AVAILABLE}</p>;
  }
  return <ProfileConversation key={user.id} />;
}

function ProfileConversation() {
  const navigate = useNavigate();
  const { profile, isLoading: profileLoading, isError } = useDriverOpportunityProfile();
  const seed = useMemo(() => isError ? {} : mapProfileToIntakeAnswers(profile), [isError, profile]);
  const reuseLabels = useMemo(() => describeProfileReuse(seed), [seed]);
  const hasSeed = reuseLabels.length > 0;

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
      <HomeConversationFlow
        key={hasSeed ? 'seeded' : 'unseeded'}
        amber="hsl(var(--primary))"
        surface="hsl(var(--card))"
        border="hsl(var(--border))"
        textMuted="hsl(var(--muted-foreground))"
        textDim="hsl(var(--muted-foreground))"
        initialAnswers={hasSeed ? seed : undefined}
        profileReuseLabels={hasSeed ? reuseLabels : undefined}
        continueLabel={FIND_WORK_CONTINUE_LABEL}
        onContinue={(answers: IntakeAnswers) => {
          setPendingProfileAnswers(answers);
          navigate(HOME_INTAKE_NEXT_PATH);
        }}
      />
    </>
  );
}
