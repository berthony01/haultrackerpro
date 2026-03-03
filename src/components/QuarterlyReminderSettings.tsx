import { useState, useEffect } from 'react';
import { UserSettings } from '@/hooks/useUserSettings';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CalendarClock, Download, Crown, Lock } from 'lucide-react';
import { downloadIcsFile, getQuarterlyDueDates } from '@/lib/taxCalendar';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface QuarterlyReminderSettingsProps {
  settings: UserSettings | null;
  onSave: (updates: { tax_reminders_enabled: boolean; tax_reminder_offsets: number[] }) => void;
  isPending: boolean;
  isPro?: boolean;
}

const OFFSET_OPTIONS = [
  { value: 14, label: '14 days before' },
  { value: 7, label: '7 days before' },
  { value: 1, label: '1 day before' },
  { value: 0, label: 'On due date' },
];

export function QuarterlyReminderSettings({ settings, onSave, isPending, isPro = false }: QuarterlyReminderSettingsProps) {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(false);
  const [offsets, setOffsets] = useState<number[]>([14, 7, 1, 0]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (settings && !initialized) {
      setEnabled(settings.tax_reminders_enabled ?? false);
      const saved = (settings as any).tax_reminder_offsets;
      if (Array.isArray(saved) && saved.length > 0) {
        setOffsets(saved);
      }
      setInitialized(true);
    }
  }, [settings, initialized]);

  const toggleOffset = (val: number) => {
    setOffsets(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  };

  const year = new Date().getFullYear();
  const dueDates = getQuarterlyDueDates(year);

  return (
    <Card className="shadow-card">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" /> Quarterly Estimated Tax Reminders
          </p>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <div className="space-y-4 animate-fade-in">
            {/* Upcoming due dates */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold">Upcoming Due Dates</p>
              <div className="grid grid-cols-2 gap-2">
                {dueDates.map(dd => (
                  <div key={dd.quarter} className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                    <span className="font-bold text-foreground">{dd.quarter}</span> — {format(dd.date, 'MMM d, yyyy')}
                  </div>
                ))}
              </div>
            </div>

            {/* Reminder offsets */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Remind Me</Label>
              <div className="space-y-2">
                {OFFSET_OPTIONS.map(opt => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <Checkbox
                      checked={offsets.includes(opt.value)}
                      onCheckedChange={() => toggleOffset(opt.value)}
                    />
                    <Label className="text-sm font-normal cursor-pointer">{opt.label}</Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Calendar download */}
            <Button
              variant="outline"
              className="w-full h-11 rounded-xl font-bold gap-2"
              onClick={() => downloadIcsFile(year)}
            >
              <Download className="h-4 w-4" /> Download Quarterly Tax Calendar
            </Button>

            {/* Disclaimer */}
            <p className="text-[9px] text-muted-foreground/50">
              Based on standard IRS quarterly schedule. Actual deadlines may vary. Consult a tax professional.
            </p>
          </div>
        )}

        <Button
          className="w-full h-11 rounded-xl font-bold active:scale-[0.98] transition-transform"
          onClick={() => onSave({ tax_reminders_enabled: enabled, tax_reminder_offsets: offsets })}
          disabled={isPending}
        >
          {isPending ? 'Saving...' : 'Save Reminder Settings'}
        </Button>
      </CardContent>
    </Card>
  );
}
