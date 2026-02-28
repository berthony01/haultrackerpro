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
  if (!isPro) {
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
            <Badge variant="outline" className="text-[10px] gap-1 border-primary/30 text-primary">
              <Lock className="h-2.5 w-2.5" /> Pro
            </Badge>
          </div>
          <div className="rounded-xl bg-muted/50 p-4 text-center">
            <Lock className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm font-semibold text-muted-foreground">Unlock Smart Alerts</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Get notified about low RPM, high deadhead, missing payments, and more.
            </p>
            <Button size="sm" className="mt-3 rounded-xl text-xs" disabled>
              Upgrade to Pro
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (alerts.length === 0) return null;

  const visible = alerts.slice(0, 3);
  const remaining = alerts.length - 3;

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
          {alerts.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {alerts.length}
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
