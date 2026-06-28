import { Badge } from '@/components/ui/badge';
import { useMyAgencyRequests } from '@/hooks/useAgencyWorkflow';
import { Building2 } from 'lucide-react';

/**
 * Driver-facing list of agency service requests the signed-in driver has
 * submitted. Uses list_my_agency_client_requests (RLS-scoped to auth.uid()).
 * Other drivers' requests are never exposed.
 */
export function MyAgencyRequestsSection() {
  const { data, isLoading } = useMyAgencyRequests();

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Your agency requests</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Requests you've submitted to back-office agencies. Submitting a request
        does not grant any access to your account — an agency must separately
        ask, and you must approve, before anyone can help manage it.
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You haven't submitted any agency requests yet.
        </p>
      ) : (
        <div className="rounded-md border divide-y">
          {data.map((r) => (
            <div key={r.id} className="p-3 space-y-1 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{r.agency_name}</div>
                <Badge variant="outline">{statusLabel(r.status)}</Badge>
              </div>
              {r.package_name && (
                <div className="text-xs text-muted-foreground">
                  Package: {r.package_name}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Submitted {new Date(r.created_at).toLocaleDateString()}
                {r.decided_at && (
                  <> · Decided {new Date(r.decided_at).toLocaleDateString()}</>
                )}
              </div>
              {r.message && (
                <p className="text-xs text-muted-foreground italic">"{r.message}"</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case 'pending':
      return 'Awaiting agency';
    case 'approved':
      return 'Approved by agency';
    case 'declined':
      return 'Declined';
    case 'cancelled':
      return 'Cancelled';
    case 'converted_to_client':
      return 'Active client';
    default:
      return s;
  }
}
