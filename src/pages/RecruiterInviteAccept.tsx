/**
 * Phase RC-1J-D — recruiter workspace invitation acceptance.
 *
 * Mirrors the proven AssistantInviteAccept pattern: pre-auth redirect that
 * preserves the exact route, one automatic acceptance attempt per mount, and
 * a generic safe error. Uses the existing RC-1A RPC unchanged — no new DB
 * function, no workspace data disclosed before acceptance.
 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type AcceptRpc = (
  fn: 'accept_recruiter_member_invite',
  args: { _token: string },
) => PromiseLike<{ data: unknown; error: unknown }>;

const callAcceptInvite = supabase.rpc.bind(supabase) as unknown as AcceptRpc;

export default function RecruiterInviteAccept() {
  const { token } = useParams<{ token: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'idle' | 'accepting' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (!user || !token || status !== 'idle') return;
    let cancelled = false;
    setStatus('accepting');
    void (async () => {
      let ok = false;
      try {
        const resp = await callAcceptInvite('accept_recruiter_member_invite', { _token: token });
        ok = !resp.error;
      } catch {
        ok = false;
      }
      if (cancelled) return;
      setStatus(ok ? 'success' : 'error');
    })();
    return () => {
      cancelled = true;
    };
  }, [user, token, status]);

  if (!loading && !user) {
    const next = encodeURIComponent(`/recruiter/invite/${token ?? ''}`);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }

  return (
    <div className="container mx-auto max-w-md px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Recruiter workspace invitation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(status === 'idle' || status === 'accepting') && (
            <p className="text-sm">Accepting invitation…</p>
          )}
          {status === 'success' && (
            <>
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
                <p>Your workspace membership is accepted.</p>
              </div>
              <Button className="w-full" onClick={() => navigate('/recruiter')}>
                Go to recruiter workspace
              </Button>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="flex items-start gap-2 text-sm">
                <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
                <p>This invitation could not be accepted.</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Make sure you're signed in with the exact email address the invitation was sent
                to.
              </p>
              <Button variant="outline" className="w-full" onClick={() => setStatus('idle')}>
                Try again
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
