import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useDriverDecideDelegation,
  useMyPendingDelegations,
} from '@/hooks/useAgencyWorkflow';
import {
  ASSISTANT_FORBIDDEN_AREAS,
  ASSISTANT_PERMISSION_KEYS,
  PERMISSION_LABELS,
} from '@/lib/assistantPermissions';

/**
 * Driver-facing page where the driver explicitly approves or declines a
 * pending agency delegation. Only after approval does the assigned agency
 * member gain access through the existing driver_assistants flow.
 */
export default function DriverDelegationApprovals() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { data: rows, isLoading } = useMyPendingDelegations();
  const decide = useDriverDecideDelegation();
  const { toast } = useToast();

  if (loading) return null;
  if (!user) {
    return (
      <AppShell>
        <div className="container mx-auto max-w-md px-4 py-8">
          <p>Please sign in.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
    <div className="container mx-auto max-w-2xl px-4 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Agency approvals
        </h1>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You have no pending agency approval requests.
        </p>
      ) : (
        rows.map((r) => (
          <Card key={r.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {r.agency_name} wants {r.member_email} to manage your account
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {r.package_name && (
                <p>
                  Package: <span className="font-medium">{r.package_name}</span>
                </p>
              )}
              <div>
                <p className="font-medium mb-1">What they're asking to do:</p>
                <ul className="list-disc pl-5 space-y-1">
                  {ASSISTANT_PERMISSION_KEYS.filter(
                    (k) => r.requested_permissions?.[k],
                  ).map((k) => (
                    <li key={k}>{PERMISSION_LABELS[k]}</li>
                  ))}
                  {ASSISTANT_PERMISSION_KEYS.every((k) => !r.requested_permissions?.[k]) && (
                    <li>No permissions selected — they will only get view access if you approve.</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="font-medium mb-1">What they cannot do:</p>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                  {ASSISTANT_FORBIDDEN_AREAS.map((a) => (
                    <li key={a}>{a.replace(/_/g, ' ')}</li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={async () => {
                    try {
                      await decide.mutateAsync({ id: r.id, approve: true });
                      toast({
                        title: 'Approved',
                        description: `${r.member_email} can now help manage your account.`,
                      });
                    } catch (e: any) {
                      toast({
                        title: 'Error',
                        description: e?.message,
                        variant: 'destructive',
                      });
                    }
                  }}
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await decide.mutateAsync({ id: r.id, approve: false });
                      toast({ title: 'Declined' });
                    } catch (e: any) {
                      toast({
                        title: 'Error',
                        description: e?.message,
                        variant: 'destructive',
                      });
                    }
                  }}
                >
                  Decline
                </Button>
                <Badge variant="outline" className="ml-auto">
                  Requested {new Date(r.created_at).toLocaleDateString()}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
    </AppShell>
  );
}
