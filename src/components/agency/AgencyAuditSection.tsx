import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { History } from 'lucide-react';
import { useAgencyAudit, formatAgencyAuditAction } from '@/hooks/useAgencyWorkflow';

export function AgencyAuditSection({ agencyId }: { agencyId: string }) {
  const { data: rows, isLoading } = useAgencyAudit(agencyId, 50);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          Agency activity log
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !rows || rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="divide-y border rounded-md text-sm">
            {rows.map((r) => (
              <div key={r.id} className="p-3">
                <p>{formatAgencyAuditAction(r.action, r.entity_type)}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
