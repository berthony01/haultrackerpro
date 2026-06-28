import { useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export default function AssistantInviteAccept() {
  const { token } = useParams<{ token: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'idle' | 'accepting' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!loading && !user) {
    const next = encodeURIComponent(`/assistant/invite/${token ?? ''}`);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }

  async function accept() {
    if (!token) return;
    setStatus('accepting');
    setError(null);
    try {
      const { error: err } = await (supabase as any).rpc('accept_assistant_invite', { _token: token });
      if (err) throw err;
      setStatus('success');
      await qc.invalidateQueries({ queryKey: ['managed-drivers'] });
      toast({ title: 'Invitation accepted', description: 'You can now manage this driver.' });
    } catch (e: any) {
      const msg = e?.message ?? 'Unable to accept invitation';
      setError(msg);
      setStatus('error');
    }
  }

  useEffect(() => {
    // Auto-attempt on mount once we know the user.
    if (user && token && status === 'idle') {
      void accept();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, token]);

  return (
    <div className="container mx-auto max-w-md px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Driver assistant invitation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'accepting' && <p className="text-sm">Accepting invitation…</p>}
          {status === 'success' && (
            <>
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                <p>You're in. You can now help manage this driver's account.</p>
              </div>
              <Button className="w-full" onClick={() => navigate('/assistant')}>
                Go to assistant dashboard
              </Button>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="flex items-start gap-2 text-sm">
                <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                <p>{error}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Make sure you're signed in with the exact email address the invitation was sent to.
              </p>
              <Button variant="outline" className="w-full" onClick={accept}>Try again</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
