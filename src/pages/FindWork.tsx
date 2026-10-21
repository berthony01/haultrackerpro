import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DriverWorkConversation from '@/components/home/DriverWorkConversation';

export {
  FIND_WORK_CONTINUE_LABEL,
  FIND_WORK_PROFILE_ERROR_LINE,
  FIND_WORK_NOT_AVAILABLE,
} from '@/components/home/DriverWorkConversation';

export default function FindWork() {
  const navigate = useNavigate();
  useEffect(() => {
    document.body.classList.add('app-shell-active');
    return () => document.body.classList.remove('app-shell-active');
  }, []);

  return (
    <main className="app-shell min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-3xl">
        <Button data-testid="find-work-dashboard" variant="ghost" onClick={() => navigate('/dashboard')} className="mb-6 gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Button>
        <h1 className="mb-2 text-2xl font-bold">Talk to HaulTracker</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Find Work: tell HaulTracker what you are looking for and see real openings. Review your work profile before saving any changes.
        </p>
        <DriverWorkConversation />
      </div>
    </main>
  );
}
