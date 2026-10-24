/** Test-only shell: actual providers, connected components, and generated client. */
import { useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ActingContextProvider, useActingContext } from '@/hooks/useActingContext';
import { useViewMode } from '@/hooks/useViewMode';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { supabase } from '@/integrations/supabase/client';
import DriverJobSearchCard from '@/components/jobSearch/DriverJobSearchCard';
import RecruiterJobSearchCards from '@/components/jobSearch/RecruiterJobSearchCards';
import { setJobSearchCardHandoff } from '@/lib/jobSearch/jobSearchCardHandoff';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function ConnectedShell() {
  const auth = useAuth();
  const acting = useActingContext();
  const view = useViewMode();
  const recruiter = useRecruiterProfile();
  const cache = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [pool, setPool] = useState(false);

  if (!auth.user) {
    return (
      <main className="mx-auto max-w-lg space-y-4 p-5">
        <h1>Isolated test sign-in</h1>
        <form
          className="space-y-4"
          onSubmit={async event => {
            event.preventDefault();
            const result = await auth.signIn(email, password);
            setPassword('');
            setNotice(result.error ? 'Sign-in denied' : 'Signed in');
          }}
        >
          <Label htmlFor="local-email">Email</Label>
          <Input id="local-email" value={email} onChange={event => setEmail(event.target.value)} />
          <Label htmlFor="local-password">Password</Label>
          <Input
            id="local-password"
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
          <Button type="submit">Sign in</Button>
          <p role="status">{notice}</p>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-5">
      <nav className="flex flex-wrap gap-2" aria-label="Isolated test controls">
        <Button
          onClick={async () => {
            await auth.signOut();
            cache.clear();
            setReviewing(false);
            setPool(false);
            setNotice('Signed out');
          }}
        >Sign out</Button>
        <Button
          onClick={async () => {
            const result = await supabase.auth.refreshSession();
            setNotice(result.error ? 'Refresh denied' : 'Session refreshed');
          }}
        >Refresh session</Button>
        <Button onClick={() => void cache.invalidateQueries()}>Refresh authority</Button>
        <Button
          onClick={() => {
            if (!auth.user) return;
            setJobSearchCardHandoff(auth.user.id, {
              state: 'TX',
              cdl_class: 'A',
              years_experience: 5,
              preferred_route_type: 'Regional',
              preferred_home_time: 'Weekly',
            });
            setReviewing(true);
          }}
        >Review my job-search card</Button>
        {view.canSwitch && (
          <Button onClick={() => view.setViewMode(view.effectiveRole === 'driver' ? 'recruiter' : 'driver')}>
            Switch workspace
          </Button>
        )}
        {acting.managedDrivers.map(driver => (
          <Button key={driver.delegate_id} onClick={() => acting.beginActingAs(driver.driver_user_id)}>
            Act for synthetic driver
          </Button>
        ))}
        {acting.isActingAsAssistant && <Button onClick={acting.exitActingAs}>Return to personal account</Button>}
      </nav>
      <p role="status">{notice}</p>
      {reviewing && <DriverJobSearchCard key={auth.user.id} />}
      {recruiter.profile && (
        <>
          <Button onClick={() => setPool(true)}>Open available drivers</Button>
          {pool && <RecruiterJobSearchCards recruiterId={recruiter.profile.id} />}
        </>
      )}
    </main>
  );
}

export default function PhaseHJ1CConnectedCards() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ActingContextProvider>
          <ConnectedShell />
        </ActingContextProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}