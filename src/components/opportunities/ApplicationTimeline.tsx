import { useApplicationEvents } from '@/hooks/opportunities/useApplicationEvents';
import { EVENT_LABEL } from '@/lib/opportunities/applicationStatus';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Clock,
  Eye,
  PhoneCall,
  CalendarCheck,
  FileText,
  Briefcase,
  CheckCircle2,
  XCircle,
  ArrowRight,
  MessageSquare,
} from 'lucide-react';

const ICON_BY_TYPE: Record<string, any> = {
  application_created: ArrowRight,
  viewed: Eye,
  contact_requested: PhoneCall,
  contacted: PhoneCall,
  call_scheduled: CalendarCheck,
  waiting_documents: FileText,
  interviewing: Briefcase,
  offer_sent: Briefcase,
  hired: CheckCircle2,
  rejected: XCircle,
  withdrawn: XCircle,
  driver_still_interested: MessageSquare,
  driver_request_callback: PhoneCall,
  driver_need_more_info: MessageSquare,
  driver_not_interested: XCircle,
  contact_request_created: PhoneCall,
  contact_request_approved: CheckCircle2,
  contact_request_declined: XCircle,
  contact_request_expired: Clock,
};

function fmt(d: string) {
  try {
    return new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function ApplicationTimeline({ applicationId }: { applicationId: string }) {
  const { data: events = [], isLoading, isError } = useApplicationEvents(applicationId);

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (isError) {
    return <p className="text-xs text-muted-foreground">Unable to load activity.</p>;
  }
  if (!events.length) {
    return <p className="text-xs text-muted-foreground">No activity yet.</p>;
  }

  return (
    <ol className="relative ml-2 border-l border-border/60 pl-4 space-y-3">
      {events.map((e) => {
        const Icon = ICON_BY_TYPE[e.event_type] ?? Clock;
        const label = EVENT_LABEL[e.event_type] ?? e.event_type.replace(/_/g, ' ');
        const note = typeof e.metadata?.note === 'string' ? e.metadata.note : null;
        return (
          <li key={e.id} className="relative">
            <span className="absolute -left-[22px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-muted border border-border/60">
              <Icon className="h-2.5 w-2.5 text-muted-foreground" />
            </span>
            <p className="text-xs font-semibold text-foreground">{label}</p>
            <p className="text-[10px] text-muted-foreground">{fmt(e.created_at)}</p>
            {note && (
              <p className="mt-1 text-xs text-foreground/80 italic">“{note}”</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
