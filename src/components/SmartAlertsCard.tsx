import { SmartAlert, AlertSeverity } from '@/hooks/useSmartAlerts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, AlertCircle, Info, X, Bell, ChevronRight, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface SmartAlertsCardProps {
  alerts: SmartAlert[];
  onDismiss: (dedupeKey: string) => void;
  onNavigate?: (page: string) => void;
  onViewAll?: () => void;
  isPro?: boolean;
}

const severityConfig: Record<AlertSeverity, { icon: typeof AlertTriangle; color: string; bg: string; badge: string }> = {
  critical: {
    icon: AlertTriangle,
    color: 'text-destructive',
    bg: 'bg-destructive/10',
    badge: 'bg-destructive/15 text-destructive border-destructive/20',
  },
  warning: {
    icon: AlertCircle,
    color: 'text-warning',
    bg: 'bg-warning/10',
    badge: 'bg-warning/15 text-warning border-warning/20',
  },
  info: {
    icon: Info,
    color: 'text-primary',
    bg: 'bg-primary/10',
    badge: 'bg-primary/15 text-primary border-primary/20',
  },
};

export function SmartAlertsCard({ alerts, onDismiss, onNavigate, onViewAll, isPro = false }: SmartAlertsCardProps) {
  if (alerts.length === 0) return null;

  const basicAlerts = alerts.filter(a => a.tier === 'basic');
  const advancedAlerts = alerts.filter(a => a.tier === 'advanced');
  const visibleAlerts = isPro ? alerts : basicAlerts;
  const visible = visibleAlerts.slice(0, 3);
  const remaining = visibleAlerts.length - 3;
  const hasLockedAlerts = !isPro && advancedAlerts.length > 0;

  if (visibleAlerts.length === 0 && !hasLockedAlerts) return null;

  return (
    <Card className="shadow-card overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary/10 p-1.5">
              <Bell className="h-4 w-4 text-primary" />
            </div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Smart Alerts</p>
          </div>
          {visibleAlerts.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {visibleAlerts.length}
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          {visible.map(alert => {
            const config = severityConfig[alert.severity];
            const Icon = config.icon;
            return (
              <div key={alert.dedupeKey} className={`rounded-xl ${config.bg} p-3 flex gap-3 items-start animate-fade-in`}>
                <Icon className={`h-4 w-4 ${config.color} shrink-0 mt-0.5`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold leading-tight">{alert.title}</p>
                    <button
                      onClick={() => onDismiss(alert.dedupeKey)}
                      className="shrink-0 rounded-lg p-0.5 hover:bg-background/50 transition-colors"
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{alert.message}</p>
                  {alert.ctaLabel && alert.ctaRoute && onNavigate && (
                    <button
                      onClick={() => onNavigate(alert.ctaRoute!)}
                      className={`text-[10px] font-bold ${config.color} mt-1.5 flex items-center gap-0.5 hover:underline`}
                    >
                      {alert.ctaLabel} <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Locked preview for advanced alerts (free users) */}
          {hasLockedAlerts && (
            <div className="rounded-xl bg-muted/50 p-3 flex gap-3 items-start opacity-70">
              <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold leading-tight text-muted-foreground">
                    {advancedAlerts.length} Advanced Alert{advancedAlerts.length > 1 ? 's' : ''}
                  </p>
                  <Badge variant="outline" className="text-[9px] gap-0.5 border-primary/30 text-primary">
                    <Lock className="h-2 w-2" /> Pro
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-relaxed">
                  Unlock advanced performance insights with Pro.
                </p>
                <Button size="sm" className="mt-1.5 rounded-xl text-[10px] h-6 px-2" disabled>
                  Upgrade to Pro
                </Button>
              </div>
            </div>
          )}
        </div>

        {(remaining > 0 || onViewAll) && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2 text-xs text-muted-foreground h-8 rounded-xl"
            onClick={onViewAll}
          >
            {remaining > 0 ? `View ${remaining} more alert${remaining > 1 ? 's' : ''}` : 'View All Alerts'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
