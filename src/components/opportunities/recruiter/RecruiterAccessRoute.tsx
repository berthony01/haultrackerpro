import { useState, useEffect } from 'react';
import { RecruiterAccessPage } from './RecruiterAccessPage';
import { RecruiterOnboarding } from '../RecruiterOnboarding';
import { RecruiterOpportunityManager } from '../RecruiterOpportunityManager';
import { RecruiterApplicationsDashboard } from '../RecruiterApplicationsDashboard';

type RecruiterView = 'hub' | 'onboarding' | 'manager' | 'applications';

interface Props {
  onBack: () => void;
  initialView?: RecruiterView;
}

export function RecruiterAccessRoute({ onBack, initialView = 'hub' }: Props) {
  const [view, setView] = useState<RecruiterView>(initialView);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

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
