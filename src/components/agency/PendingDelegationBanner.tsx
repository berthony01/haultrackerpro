import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useMyPendingDelegations } from '@/hooks/useAgencyWorkflow';

/**
 * Global thin banner notifying a driver that an agency is waiting for their
 * approval. Tap navigates to the secure approval page.
 */
export function PendingDelegationBanner() {
  const { data } = useMyPendingDelegations();
  if (!data || data.length === 0) return null;
  const n = data.length;
  return (
    <Link
      to="/driver/agency-approvals"
      className="block bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-sm hover:bg-amber-500/20"
    >
      <span className="inline-flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-amber-600" />
        {n === 1
          ? 'An agency is requesting your approval to help manage your account.'
          : `${n} agencies are requesting your approval to help manage your account.`}
        <span className="underline">Review</span>
      </span>
    </Link>
  );
}
