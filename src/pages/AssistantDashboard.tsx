import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { PageNav } from '@/components/layout/PageNav';
import { useActingContext } from '@/hooks/useActingContext';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  ArrowRight,
  ShieldCheck,
  Inbox,
  Truck,
  DollarSign,
  Fuel,
  BarChart3,
  Settings2,
  LayoutDashboard,
  Building2,
} from 'lucide-react';
import {
  PERMISSION_LABELS,
  hasPerm,
  type AssistantPermissionKey,
} from '@/lib/assistantPermissions';
import {
  useMyAssistantAudit,
  useMyPendingAssistantInvites,
  formatAuditAction,
} from '@/hooks/useAssistantAudit';
import { useMyAgency } from '@/hooks/useAgency';
import { MyProfessionalProfileCard } from '@/components/profiles/ProfessionalProfileCard';

export default function AssistantDashboard() {
  const { user } = useAuth();
  const { managedDrivers, isLoadingManagedDrivers, beginActingAs } = useActingContext();
  const navigate = useNavigate();
  const { data: invites } = useMyPendingAssistantInvites();
  const { data: activity } = useMyAssistantAudit(20);
  const { data: agency } = useMyAgency();

  function enter(driverUserId: string, path = '/dashboard') {
    beginActingAs(driverUserId);
    navigate(path);
  }

  if (!user) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 py-8">
          <p>Please sign in to view your assistant dashboard.</p>
        </div>
      </AppShell>
    );
  }

  const pendingCount = invites?.length ?? 0;
  const activeCount = managedDrivers.length;

  return (
    <AppShell>
    <div className="container mx-auto max-w-5xl px-4 py-6 space-y-6">
      <PageNav home={{ label: 'Assistant', to: '/assistant' }} trail={[{ label: 'Assistant Access Center' }]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Assistant Access Center
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Drivers who've invited you appear here. Choose a driver to start managing their
            paperwork — loads, expenses, fuel logs, and reports — within the permissions
            they granted you. This isn't a separate dashboard or analytics workspace.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          data-testid="assistant-switch-workspace"
          onClick={() => navigate('/start')}
        >
          <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" />
          Switch Workspace
        </Button>
      </header>

      {/* Lightweight access summary — intentionally not dashboard-like. */}
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <StatCard icon={<Users className="h-4 w-4" />} label="Approved drivers" value={activeCount} />
        <StatCard icon={<Inbox className="h-4 w-4" />} label="Pending invites" value={pendingCount} />
      </div>

      <MyProfessionalProfileCard context="assistant" />

      {/* Pending invites */}
      {pendingCount > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Pending invitations</h2>
          <div className="rounded-md border divide-y">
            {invites!.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-3 p-3 text-sm"
                data-testid="pending-invite-row"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">Invitation for {inv.invite_email}</p>
                  <p className="text-xs text-muted-foreground">
                    Sent {new Date(inv.invited_at).toLocaleString()}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  Use the invite link the driver sent you
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            For your safety we never auto-accept invitations from this screen. Open the
            secure link the driver shared with you to accept.
          </p>
        </section>
      )}

      {/* Managed drivers */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Managed drivers</h2>
        {isLoadingManagedDrivers ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : managedDrivers.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center space-y-3">
              <p className="font-medium">No approved drivers yet</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Once a driver invites you, their account will appear here. You can help with
                loads, expenses, fuel logs, and reports after they approve your access.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => navigate('/dashboard')}>
                  <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" />
                  Go to my Dashboard
                </Button>
                <Button size="sm" onClick={() => navigate('/agency')}>
                  <Building2 className="mr-1.5 h-3.5 w-3.5" />
                  Create Agency Workspace
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
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
                        <p className="text-xs text-muted-foreground truncate">
                          {d.driver_email}
                        </p>
                        {d.last_active_at && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Last active {new Date(d.last_active_at).toLocaleDateString()}
                          </p>
                        )}
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
                        {perms.slice(0, 5).map((p) => (
                          <Badge
                            key={p}
                            variant="outline"
                            className="text-[11px] font-normal"
                          >
                            {PERMISSION_LABELS[p]}
                          </Badge>
                        ))}
                        {perms.length > 5 && (
                          <Badge variant="outline" className="text-[11px] font-normal">
                            +{perms.length - 5}
                          </Badge>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => enter(d.driver_user_id)}>
                        Start managing
                        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                      {hasPerm(d.permissions, 'view_dashboard') && (
                        <QuickAction
                          icon={<LayoutDashboard className="h-3.5 w-3.5" />}
                          label="Dashboard"
                          onClick={() => enter(d.driver_user_id, '/dashboard')}
                        />
                      )}
                      {hasPerm(d.permissions, 'manage_loads') && (
                        <QuickAction
                          icon={<Truck className="h-3.5 w-3.5" />}
                          label="Add load"
                          onClick={() => enter(d.driver_user_id, '/dashboard?page=loads&new=1')}
                        />
                      )}
                      {hasPerm(d.permissions, 'manage_expenses') && (
                        <QuickAction
                          icon={<DollarSign className="h-3.5 w-3.5" />}
                          label="Add expense"
                          onClick={() =>
                            enter(d.driver_user_id, '/dashboard?page=expenses&new=1')
                          }
                        />
                      )}
                      {hasPerm(d.permissions, 'manage_fuel') && (
                        <QuickAction
                          icon={<Fuel className="h-3.5 w-3.5" />}
                          label="Add fuel"
                          onClick={() =>
                            enter(d.driver_user_id, '/dashboard?page=fuel&new=1')
                          }
                        />
                      )}
                      {hasPerm(d.permissions, 'view_reports') && (
                        <QuickAction
                          icon={<BarChart3 className="h-3.5 w-3.5" />}
                          label="Reports"
                          onClick={() => enter(d.driver_user_id, '/dashboard?page=reports')}
                        />
                      )}
                      {hasPerm(d.permissions, 'manage_settings_limited') && (
                        <QuickAction
                          icon={<Settings2 className="h-3.5 w-3.5" />}
                          label="Limited settings"
                          onClick={() => enter(d.driver_user_id, '/assistant/settings')}
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent activity */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">My recent activity</h2>
        {!activity || activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity yet.</p>
        ) : (
          <div className="rounded-md border divide-y">
            {activity.slice(0, 15).map((a) => (
              <div key={a.id} className="flex items-start gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    <span className="text-muted-foreground">
                      {formatAuditAction(a.action, a.entity_type)}
                    </span>{' '}
                    for <span className="font-medium">{a.driver_email ?? 'driver'}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Assistant → Agency upsell (secondary) */}
      <Card data-testid="assistant-agency-cta" className="border-dashed">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Want to manage multiple drivers as a business?
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Create an Agency Workspace to organize clients, packages, and a team in one
              place. Drivers still individually approve who can act on their account.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate('/agency')}>
            {agency ? 'Open agency workspace' : 'Create Agency Workspace'}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>
    </div>
    </AppShell>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClick}>
      <span className="mr-1.5">{icon}</span>
      {label}
    </Button>
  );
}
