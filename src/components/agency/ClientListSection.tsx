import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users } from 'lucide-react';
import { useAgencyClients } from '@/hooks/useAgencyWorkflow';

export function ClientListSection({ agencyId }: { agencyId: string }) {
  const { data: clients, isLoading } = useAgencyClients(agencyId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Active clients
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !clients || clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active clients yet. Once a driver approves a delegation request, they'll appear
            here.
          </p>
        ) : (
          <div className="divide-y border rounded-md">
            {clients.map((c) => (
              <div
                key={c.delegation_id}
                className="flex items-center justify-between p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {c.driver_name || c.driver_email || c.driver_user_id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    Assistant: {c.member_email}
                    {c.package_name ? ` · ${c.package_name}` : ''}
                  </p>
                </div>
                {c.last_activity_at && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    Last activity {new Date(c.last_activity_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
