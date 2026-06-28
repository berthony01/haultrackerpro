import { useDriverAssistantAudit, formatAuditAction } from '@/hooks/useAssistantAudit';
import { Clock } from 'lucide-react';

/**
 * Shown in Driver Settings → Driver Assistants. Lets the driver see what
 * their assistants have been doing on their account.
 */
export function DriverAssistantActivityLog() {
  const { data, isLoading } = useDriverAssistantAudit(100);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading activity…</p>;
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No assistant activity yet. When an assistant accepts your invite and starts working,
        their actions will appear here.
      </p>
    );
  }

  return (
    <div className="rounded-md border divide-y">
      {data.map((r) => (
        <div key={r.id} className="flex items-start gap-3 p-3 text-sm">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate">
              <span className="font-medium">{r.assistant_email ?? 'Assistant'}</span>{' '}
              <span className="text-muted-foreground">
                {formatAuditAction(r.action, r.entity_type)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(r.created_at).toLocaleString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
