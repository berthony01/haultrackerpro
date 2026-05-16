import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { RecruiterAccessPage } from './RecruiterAccessPage';
import { RecruiterOnboarding } from '../RecruiterOnboarding';
import { RecruiterOpportunityManager } from '../RecruiterOpportunityManager';
import { RecruiterApplicationsDashboard } from '../RecruiterApplicationsDashboard';

const RecruiterReportsPanel = lazy(() =>
  import('@/components/recruiter/RecruiterReportsPanel').then(m => ({ default: m.RecruiterReportsPanel }))
);

type RecruiterView = 'hub' | 'onboarding' | 'manager' | 'applications' | 'reports';

interface Props {
  onBack: () => void;
  initialView?: RecruiterView;
}

export function RecruiterAccessRoute({ onBack, initialView = 'hub' }: Props) {
  const [view, setView] = useState<RecruiterView>(initialView);
  const navigate = useNavigate();

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
  if (view === 'reports') {
    return (
      <Suspense fallback={
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      }>
        <RecruiterReportsPanel
          onBack={() => setView('hub')}
          onUpgrade={() => navigate('/pricing')}
        />
      </Suspense>
    );
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
