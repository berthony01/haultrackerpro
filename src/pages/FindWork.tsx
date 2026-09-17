/**
 * HP-4B — authenticated Driver "Find Work" conversation.
 *
 * Reuses the existing homepage conversation, the existing Driver Opportunity
 * Profile read path (own-row RLS), and the existing real teaser preview.
 *
 * Hard rules for this phase:
 *  - READ ONLY. No profile insert/update/delete. No snapshot / sessionStorage
 *    write. No backend, RLS, auth or billing change.
 *  - Employment fields only: identity, contact, visibility, recruiter-contact
 *    consent and every My Trucking financial surface are never read or shown.
 *  - Non-drivers get a neutral not-available state and no profile data.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import HomeConversationFlow from '@/components/home/HomeConversationFlow';
import { useUserRole } from '@/hooks/useUserRole';
import { useDriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';
import { HOME_INTAKE_NEXT_PATH } from '@/lib/home/conversationIntake';
import {
  describeProfileReuse,
  mapProfileToIntakeAnswers,
} from '@/lib/home/profileConversationMerge';

const NAVY_BG = 'hsl(220, 20%, 8%)';
const NAVY_SURFACE = 'hsl(220, 20%, 11%)';
const NAVY_BORDER = 'hsl(220, 16%, 18%)';
const AMBER = 'hsl(25, 95%, 53%)';
const TEXT_MUTED = 'hsl(220, 10%, 65%)';
const TEXT_DIM = 'hsl(220, 10%, 50%)';

export const FIND_WORK_CONTINUE_LABEL = 'Review/update my work profile';
export const FIND_WORK_PROFILE_ERROR_LINE =
  'We could not load your saved work profile right now, so we will just ask a few questions.';
export const FIND_WORK_NOT_AVAILABLE =
  'Find Work is available on driver accounts.';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-10" style={{ background: NAVY_BG }}>
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </main>
  );
}

export default function FindWork() {
  const navigate = useNavigate();
  const { isDriver, isLoading: roleLoading } = useUserRole();
  const { profile, isLoading: profileLoading, isError } = useDriverOpportunityProfile();

  // Non-drivers never reach the seed computation, so no profile value can be
  // rendered for them even though the hook only ever reads the caller's own row.
  const seed = useMemo(
    () => (isDriver && !isError ? mapProfileToIntakeAnswers(profile) : {}),
    [isDriver, isError, profile],
  );
  const reuseLabels = useMemo(() => describeProfileReuse(seed), [seed]);
  const hasSeed = reuseLabels.length > 0;

  if (roleLoading || profileLoading) {
    return (
      <Shell>
        <p data-testid="find-work-loading" style={{ color: TEXT_MUTED }}>
          Loading…
        </p>
      </Shell>
    );
  }

  if (!isDriver) {
    return (
      <Shell>
        <div
          data-testid="find-work-unavailable"
          className="rounded-2xl border p-6"
          style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
        >
          <p className="text-sm" style={{ color: TEXT_MUTED }}>
            {FIND_WORK_NOT_AVAILABLE}
          </p>
          <Button
            data-testid="find-work-dashboard"
            onClick={() => navigate('/dashboard')}
            className="mt-4 gap-2"
            style={{ background: AMBER, color: 'white' }}
          >
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="mb-2 text-2xl font-bold text-white">Find Work</h1>
      <p className="mb-4 text-sm" style={{ color: TEXT_MUTED }}>
        Tell HaulTracker what you are looking for and see real openings. Nothing is saved here.
      </p>

      {isError && (
        <p data-testid="find-work-profile-error" className="mb-3 text-sm" style={{ color: TEXT_DIM }}>
          {FIND_WORK_PROFILE_ERROR_LINE}
        </p>
      )}

      <HomeConversationFlow
        key={hasSeed ? 'seeded' : 'unseeded'}
        amber={AMBER}
        surface={NAVY_SURFACE}
        border={NAVY_BORDER}
        textMuted={TEXT_MUTED}
        textDim={TEXT_DIM}
        initialAnswers={hasSeed ? seed : undefined}
        profileReuseLabels={hasSeed ? reuseLabels : undefined}
        continueLabel={FIND_WORK_CONTINUE_LABEL}
        // Navigation only — no write of any kind happens on continue.
        onContinue={() => navigate(HOME_INTAKE_NEXT_PATH)}
      />
    </Shell>
  );
}
