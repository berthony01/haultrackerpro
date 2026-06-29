import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Bell } from 'lucide-react';
import { useNotificationPreferences, type NotificationPreferences } from '@/hooks/useNotifications';

const DEFAULTS: Pick<
  NotificationPreferences,
  'in_app_enabled' | 'email_enabled' | 'application_events' | 'contact_request_events' | 'contract_events' | 'recruiter_status_events' | 'assistant_events' | 'agency_events'
> = {
  in_app_enabled: true,
  email_enabled: true,
  application_events: true,
  contact_request_events: true,
  contract_events: true,
  recruiter_status_events: true,
  assistant_events: true,
  agency_events: true,
};

export function NotificationPreferencesPanel() {
  const { preferences, isLoading, upsert } = useNotificationPreferences();
  const p = preferences ?? { ...DEFAULTS };

  const Row = ({
    id,
    label,
    description,
    checked,
    onChange,
    disabled,
  }: {
    id: string;
    label: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
  }) => (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-semibold text-foreground">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled || isLoading || upsert.isPending}
      />
    </div>
  );

  return (
    <Card className="p-5 space-y-1 border-border/60">
      <div className="flex items-center gap-2 mb-2">
        <Bell className="h-4 w-4 text-primary" />
        <h3 className="text-base font-bold text-foreground">Notifications</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Control which in-app notifications you receive. Turn off a category to silence those alerts.
      </p>

      <div className="divide-y divide-border/60">
        <Row
          id="np-in-app"
          label="In-app notifications"
          description="Master switch for the bell in the header."
          checked={p.in_app_enabled}
          onChange={(v) => upsert.mutate({ in_app_enabled: v })}
        />
        <Row
          id="np-applications"
          label="Application updates"
          description="New applications, status changes."
          checked={p.application_events}
          onChange={(v) => upsert.mutate({ application_events: v })}
          disabled={!p.in_app_enabled}
        />
        <Row
          id="np-contact"
          label="Contact requests"
          description="Recruiter contact requests and driver responses."
          checked={p.contact_request_events}
          onChange={(v) => upsert.mutate({ contact_request_events: v })}
          disabled={!p.in_app_enabled}
        />
        <Row
          id="np-contracts"
          label="Contracts"
          description="Uploads, approvals, change requests, and signatures."
          checked={p.contract_events}
          onChange={(v) => upsert.mutate({ contract_events: v })}
          disabled={!p.in_app_enabled}
        />
        <Row
          id="np-recruiter"
          label="Recruiter & opportunity status"
          description="Recruiter profile and opportunity review decisions."
          checked={p.recruiter_status_events}
          onChange={(v) => upsert.mutate({ recruiter_status_events: v })}
          disabled={!p.in_app_enabled}
        />
        <Row
          id="np-assistant"
          label="Assistant activity"
          description="Invitations, acceptances, and access changes for assistants."
          checked={p.assistant_events}
          onChange={(v) => upsert.mutate({ assistant_events: v })}
          disabled={!p.in_app_enabled}
        />
        <Row
          id="np-agency"
          label="Agency workflow"
          description="Client requests, delegation decisions, and work-item updates."
          checked={p.agency_events}
          onChange={(v) => upsert.mutate({ agency_events: v })}
          disabled={!p.in_app_enabled}
        />
      </div>
    </Card>
  );
}
