import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileSignature, ArrowRight } from 'lucide-react';
import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useContractsPipeline, matchesRecruiterFilter, matchesDriverFilter } from '@/hooks/contracts/useContractsPipeline';
import { useRecruiterBilling } from '@/hooks/opportunities/useRecruiterBilling';

interface Props {
  role: 'driver' | 'recruiter';
  onOpen: () => void;
}

/**
 * Compact dashboard card that surfaces pending contract actions for the active
 * role. Renders nothing when there is nothing to act on (the page is busy
 * enough already).
 */
export function ContractActionsCard({ role, onOpen }: Props) {
  if (role === 'driver') return <DriverCard onOpen={onOpen} />;
  return <RecruiterCard onOpen={onOpen} />;
}

function DriverCard({ onOpen }: { onOpen: () => void }) {
  const { driverApplications } = useOpportunityApplications();
  const apps = driverApplications as any[];
  const appIds = useMemo(() => apps.map((a) => a.id), [apps]);
  const { pipeline, isLoading } = useContractsPipeline(appIds);

  const counts = useMemo(() => {
    let needsReview = 0;
    let readyToSign = 0;
    for (const a of apps) {
      const p = pipeline.get(a.id);
      if (!p) continue;
      if (matchesDriverFilter(p, 'needs_review')) needsReview++;
      // Approved but not yet signed → ready to sign.
      if (p.status === 'approved' && !p.hasDriverSignature) readyToSign++;
    }
    return { needsReview, readyToSign };
  }, [apps, pipeline]);

  if (isLoading) return null;
  if (counts.needsReview === 0 && counts.readyToSign === 0) return null;

  const lines: string[] = [];
  if (counts.needsReview > 0) lines.push(`${counts.needsReview} contract${counts.needsReview === 1 ? '' : 's'} need your review`);
  if (counts.readyToSign > 0) lines.push(`${counts.readyToSign} contract${counts.readyToSign === 1 ? '' : 's'} waiting for signature`);

  return (
    <Card className="p-4 border-primary/30 bg-primary/5 mb-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/15 p-2 shrink-0">
          <FileSignature className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-foreground mb-1">Contract actions pending</h3>
          <ul className="text-xs text-muted-foreground space-y-0.5 mb-3">
            {lines.map((l) => <li key={l}>• {l}</li>)}
          </ul>
          <Button size="sm" onClick={onOpen}>
            Review Contracts <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function RecruiterCard({ onOpen }: { onOpen: () => void }) {
  const { profile } = useRecruiterProfile();
  const { recruiterApplications } = useOpportunityApplications({ recruiterId: profile?.id });
  const apps = recruiterApplications as any[];
  const appIds = useMemo(() => apps.map((a) => a.id), [apps]);
  const { pipeline, isLoading } = useContractsPipeline(appIds);

  const counts = useMemo(() => {
    let awaitingUpload = 0;
    let awaitingDriver = 0;
    let blocked = 0;
    for (const a of apps) {
      const p = pipeline.get(a.id);
      if (!p) continue;
      if (matchesRecruiterFilter(p, 'awaiting_upload', a.status)) awaitingUpload++;
      if (matchesRecruiterFilter(p, 'needs_driver_review', a.status)) awaitingDriver++;
      if (matchesRecruiterFilter(p, 'blocked', a.status)) blocked++;
    }
    return { awaitingUpload, awaitingDriver, blocked };
  }, [apps, pipeline]);

  if (isLoading) return null;
  const total = counts.awaitingUpload + counts.awaitingDriver + counts.blocked;
  if (total === 0) return null;

  const lines: string[] = [];
  if (counts.awaitingUpload > 0) lines.push(`${counts.awaitingUpload} application${counts.awaitingUpload === 1 ? '' : 's'} waiting on contract upload`);
  if (counts.awaitingDriver > 0) lines.push(`${counts.awaitingDriver} contract${counts.awaitingDriver === 1 ? '' : 's'} waiting for driver approval`);
  if (counts.blocked > 0) lines.push(`${counts.blocked} hire${counts.blocked === 1 ? '' : 's'} blocked by contract approval`);

  return (
    <Card className="p-4 border-primary/30 bg-primary/5 mb-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/15 p-2 shrink-0">
          <FileSignature className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-foreground mb-1">Contract actions pending</h3>
          <ul className="text-xs text-muted-foreground space-y-0.5 mb-3">
            {lines.map((l) => <li key={l}>• {l}</li>)}
          </ul>
          <Button size="sm" onClick={onOpen}>
            Manage Contracts <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
