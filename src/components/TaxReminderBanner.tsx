import { useState, useMemo } from 'react';
import { UserSettings } from '@/hooks/useUserSettings';
import { getActiveReminders } from '@/lib/taxCalendar';
import { formatCurrency } from '@/lib/loadUtils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CalendarClock, X } from 'lucide-react';
import { format } from 'date-fns';

interface TaxReminderBannerProps {
  settings: UserSettings | null;
  estimatedTaxSetAside?: number | null;
  onViewTaxSummary?: () => void;
  isPro?: boolean;
}

export function TaxReminderBanner({ settings, estimatedTaxSetAside, onViewTaxSummary, isPro = false }: TaxReminderBannerProps) {
  const [dismissedDates, setDismissedDates] = useState<string[]>([]);

  const reminders = useMemo(() => {
    if (!settings?.tax_reminders_enabled) return [];
    const offsets: number[] = (settings as any).tax_reminder_offsets ?? [14, 7, 1, 0];
    if (offsets.length === 0) return [];
    const year = new Date().getFullYear();
    return getActiveReminders(offsets, year);
  }, [settings]);

  const visibleReminders = reminders.filter(
    r => !dismissedDates.includes(r.date.toISOString())
  );

  if (visibleReminders.length === 0 || !isPro) return null;

  return (
    <div className="space-y-2">
      {visibleReminders.map(reminder => (
        <Alert key={reminder.quarter} className="border-warning/30 bg-warning/5 relative">
          <CalendarClock className="h-4 w-4 text-warning" />
          <AlertTitle className="text-sm font-bold pr-8">
            Quarterly Estimated Tax Due on {format(reminder.date, 'MMMM d')}
          </AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            {estimatedTaxSetAside != null && estimatedTaxSetAside > 0 ? (
              <>Recommended set-aside: <span className="font-bold font-mono text-foreground">{formatCurrency(estimatedTaxSetAside)}</span></>
            ) : (
              <>Don't forget your quarterly estimated tax payment.</>
            )}
          </AlertDescription>
          <div className="flex gap-2 mt-2">
            {onViewTaxSummary && (
              <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={onViewTaxSummary}>
                View Tax Summary
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs rounded-lg"
              onClick={() => setDismissedDates(prev => [...prev, reminder.date.toISOString()])}
            >
              Dismiss
            </Button>
          </div>
          <button
            className="absolute top-3 right-3 text-muted-foreground/50 hover:text-foreground transition-colors"
            onClick={() => setDismissedDates(prev => [...prev, reminder.date.toISOString()])}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Alert>
      ))}
    </div>
  );
}
