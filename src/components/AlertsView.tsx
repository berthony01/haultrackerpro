import { SmartAlert, AlertSeverity } from '@/hooks/useSmartAlerts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, AlertCircle, Info, X, ArrowLeft, Bell, ChevronRight, Filter } from 'lucide-react';
import { useState } from 'react';

interface AlertsViewProps {
  alerts: SmartAlert[];
  onDismiss: (dedupeKey: string) => void;
  onNavigate?: (page: string) => void;
  onBack: () => void;
}

const severityConfig: Record<AlertSeverity, { icon: typeof AlertTriangle; color: string; bg: string; label: string }> = {
  critical: { icon: AlertTriangle, color: 'text-destructive', bg: 'bg-destructive/10', label: 'Critical' },
  warning: { icon: AlertCircle, color: 'text-warning', bg: 'bg-warning/10', label: 'Warning' },
  info: { icon: Info, color: 'text-primary', bg: 'bg-primary/10', label: 'Info' },
};

export function AlertsView({ alerts, onDismiss, onNavigate, onBack }: AlertsViewProps) {
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all');

  const filtered = severityFilter === 'all' ? alerts : alerts.filter(a => a.severity === severityFilter);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-black font-heading">Smart Alerts</h1>
          <p className="text-sm text-muted-foreground">{alerts.length} active alert{alerts.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Severity Filter */}
      <div className="flex gap-1.5">
        {(['all', 'critical', 'warning', 'info'] as const).map(sev => (
          <Button
            key={sev}
            variant={severityFilter === sev ? 'default' : 'outline'}
            size="sm"
            className={`text-xs h-8 px-3 rounded-xl ${severityFilter === sev ? 'shadow-primary' : ''}`}
            onClick={() => setSeverityFilter(sev)}
          >
            {sev === 'all' ? 'All' : severityConfig[sev].label}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20 shadow-card">
          <CardContent className="py-12 text-center">
            <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-5 mb-4">
              <Bell className="h-10 w-10 text-muted-foreground/30" />
            </div>
            <p className="font-bold text-lg">No Active Alerts</p>
            <p className="text-sm text-muted-foreground mt-1">
              {severityFilter !== 'all' ? 'No alerts match this filter.' : 'Everything looks good! Keep hauling.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(alert => {
            const config = severityConfig[alert.severity];
            const Icon = config.icon;
            return (
              <Card key={alert.dedupeKey} className="shadow-card animate-fade-in">
                <CardContent className="p-0">
                  <div className={`rounded-xl ${config.bg} p-4 flex gap-3 items-start`}>
                    <Icon className={`h-5 w-5 ${config.color} shrink-0 mt-0.5`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Badge variant="outline" className={`text-[9px] mb-1 ${config.color} border-current/20`}>
                            {config.label}
                          </Badge>
                          <p className="text-sm font-bold leading-tight">{alert.title}</p>
                        </div>
                        <button
                          onClick={() => onDismiss(alert.dedupeKey)}
                          className="shrink-0 rounded-lg p-1 hover:bg-background/50 transition-colors"
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{alert.message}</p>
                      {alert.ctaLabel && alert.ctaRoute && onNavigate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`mt-2 h-7 px-2 text-[11px] font-bold ${config.color} rounded-lg gap-1`}
                          onClick={() => onNavigate(alert.ctaRoute!)}
                        >
                          {alert.ctaLabel} <ChevronRight className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
