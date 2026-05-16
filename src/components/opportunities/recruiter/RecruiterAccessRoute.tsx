import { useState } from 'react';
import { RecruiterAccessPage } from './RecruiterAccessPage';
import { RecruiterOnboarding } from '../RecruiterOnboarding';
import { RecruiterOpportunityManager } from '../RecruiterOpportunityManager';
import { RecruiterApplicationsDashboard } from '../RecruiterApplicationsDashboard';

interface Props {
  onBack: () => void;
}

/**
 * Top-level route wrapper for Recruiter Access. Owns the recruiter sub-views
 * (onboarding, opportunity manager, applications dashboard) so the recruiter
 * command center is a real dashboard destination instead of a nested sub-view
 * of the driver Opportunities page.
 */
export function RecruiterAccessRoute({ onBack }: Props) {
  const [view, setView] = useState<'hub' | 'onboarding' | 'manager' | 'applications'>('hub');

  if (view === 'onboarding') {
    return <RecruiterOnboarding onBack={() => setView('hub')} />;
  }
  if (view === 'manager') {
    return <RecruiterOpportunityManager onBack={() => setView('hub')} />;
  }
  if (view === 'applications') {
    return <RecruiterApplicationsDashboard onBack={() => setView('hub')} />;
  }

  return (
    <RecruiterAccessPage
      onBack={onBack}
      onOpenOnboarding={() => setView('onboarding')}
      onManage={() => setView('manager')}
      onApplications={() => setView('applications')}
    />
  );
}
