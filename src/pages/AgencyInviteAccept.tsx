import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAgencyMutations } from '@/hooks/useAgency';
import { useToast } from '@/hooks/use-toast';

export default function AgencyInviteAccept() {
  const { token } = useParams<{ token: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { accept } = useAgencyMutations();
  const { toast } = useToast();
  const [status, setStatus] = useState<'idle' | 'accepting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    if (loading) return;
    if (!user) {
      navigate(`/auth?next=${encodeURIComponent(`/agency/invite/${token}`)}`, { replace: true });
    }
  }, [token, user, loading, navigate]);

  async function onAccept() {
    if (!token) return;
    setStatus('accepting');
    try {
      await accept.mutateAsync(token);
      setStatus('done');
      toast({ title: 'Joined agency' });
      setTimeout(() => navigate('/agency', { replace: true }), 500);
    } catch (e: any) {
      setStatus('error');
      setError(e?.message ?? 'Could not accept invite');
    }
  }

  if (!user) return null;

  return (
    <div className="container mx-auto max-w-md px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accept agency invitation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You've been invited to join an agency on HaulTrackerPro. Joining doesn't give you
            access to any driver's data — driver delegation stays explicit.
          </p>
          {status === 'error' && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <Button onClick={onAccept} disabled={status === 'accepting' || status === 'done'}>
            {status === 'done' ? 'Joined' : 'Accept invitation'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
