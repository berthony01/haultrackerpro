import { useNavigate } from 'react-router-dom';
import { useActingContext } from '@/hooks/useActingContext';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, ArrowRight, ShieldCheck } from 'lucide-react';
import { PERMISSION_LABELS, type AssistantPermissionKey } from '@/lib/assistantPermissions';

export default function AssistantDashboard() {
  const { user } = useAuth();
  const { managedDrivers, isLoadingManagedDrivers, beginActingAs } = useActingContext();
  const navigate = useNavigate();

  function enter(driverUserId: string) {
    beginActingAs(driverUserId);
    navigate('/dashboard');
  }

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p>Please sign in to view your assistant dashboard.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          Assistant dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Drivers who have invited you to help manage their account. Pick a driver to start
          entering their loads, expenses, fuel, and receipts. You can switch back to your own
          account at any time.
        </p>
      </header>

      {isLoadingManagedDrivers ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : managedDrivers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <p className="font-medium">No active driver invitations.</p>
            <p className="text-sm text-muted-foreground">
              When a driver invites you and you accept, they'll appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {managedDrivers.map((d) => {
            const perms = Object.keys(d.permissions ?? {}).filter(
              (k) => (d.permissions as any)[k],
            ) as AssistantPermissionKey[];
            return (
              <Card key={d.delegate_id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">
                        {d.driver_name || d.driver_email}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground truncate">{d.driver_email}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      <ShieldCheck className="mr-1 h-3 w-3" />
                      Active
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {perms.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {perms.slice(0, 4).map((p) => (
                        <Badge key={p} variant="outline" className="text-xs font-normal">
                          {PERMISSION_LABELS[p]}
                        </Badge>
                      ))}
                      {perms.length > 4 && (
                        <Badge variant="outline" className="text-xs font-normal">
                          +{perms.length - 4} more
                        </Badge>
                      )}
                    </div>
                  )}
                  <Button className="w-full" onClick={() => enter(d.driver_user_id)}>
                    Start managing
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
