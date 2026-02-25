import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { getCurrentWeekLoads } from '@/lib/loadUtils';
import { AlertTriangle, Calendar, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SmartRemindersProps {
  loads: Load[];
  onNavigate: (page: string, options?: { filter?: string }) => void;
  onDismiss: (key: string) => void;
  dismissed: Set<string>;
}

export function SmartReminders({ loads, onNavigate, onDismiss, dismissed }: SmartRemindersProps) {
  const unpaidCount = useMemo(() => 
    loads.filter(l => l.actual_pay_received == null && l.status !== 'cancelled').length,
    [loads]
  );

  const isSunday = new Date().getDay() === 0;
  const weekLoads = useMemo(() => getCurrentWeekLoads(loads), [loads]);
  const showCloseoutReminder = isSunday && weekLoads.length > 0;

  const banners: { key: string; icon: React.ReactNode; text: string; action?: () => void; actionLabel?: string; color: string }[] = [];

  if (unpaidCount > 0 && !dismissed.has('unpaid')) {
    banners.push({
      key: 'unpaid',
      icon: <AlertTriangle className="h-4 w-4" />,
      text: `You have ${unpaidCount} unpaid load${unpaidCount > 1 ? 's' : ''}.`,
      action: () => onNavigate('loads', { filter: 'missing_pay' }),
      actionLabel: 'Review',
      color: 'bg-warning/10 text-warning border-warning/20',
    });
  }

  if (showCloseoutReminder && !dismissed.has('closeout')) {
    banners.push({
      key: 'closeout',
      icon: <Calendar className="h-4 w-4" />,
      text: "Don't forget to close out your week.",
      action: () => onNavigate('closeout'),
      actionLabel: 'Close Out',
      color: 'bg-primary/10 text-primary border-primary/20',
    });
  }

  if (banners.length === 0) return null;

  return (
    <div className="space-y-2">
      {banners.map(b => (
        <div key={b.key} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm ${b.color}`}>
          {b.icon}
          <span className="flex-1 font-medium text-xs">{b.text}</span>
          {b.action && (
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={b.action}>
              {b.actionLabel}
            </Button>
          )}
          <button onClick={() => onDismiss(b.key)} className="opacity-60 hover:opacity-100">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
