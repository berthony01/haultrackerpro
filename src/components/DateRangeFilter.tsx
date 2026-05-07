import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  startOfQuarter, endOfQuarter, subWeeks, subMonths, subQuarters, subYears, format,
} from 'date-fns';
import { useUserSettings } from '@/hooks/useUserSettings';
import { weekStartDayToNumber } from '@/lib/loadUtils';
import { validateCustomRange } from '@/lib/reportRanges';

interface DateRangeFilterProps {
  onRangeChange: (from?: string, to?: string) => void;
}

export function DateRangeFilter({ onRangeChange }: DateRangeFilterProps) {
  const { settings } = useUserSettings();
  const wso = weekStartDayToNumber(settings?.week_start_day);

  const presets = [
    { label: 'This Week',         getRange: () => ({ from: startOfWeek(new Date(), { weekStartsOn: wso }), to: endOfWeek(new Date(), { weekStartsOn: wso }) }) },
    { label: 'Last Week',         getRange: () => { const d = subWeeks(new Date(), 1); return { from: startOfWeek(d, { weekStartsOn: wso }), to: endOfWeek(d, { weekStartsOn: wso }) }; } },
    { label: 'This Month',        getRange: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }) },
    { label: 'Last Month',        getRange: () => { const d = subMonths(new Date(), 1); return { from: startOfMonth(d), to: endOfMonth(d) }; } },
    { label: 'Current Quarter',   getRange: () => ({ from: startOfQuarter(new Date()), to: endOfQuarter(new Date()) }) },
    { label: 'Previous Quarter',  getRange: () => { const d = subQuarters(new Date(), 1); return { from: startOfQuarter(d), to: endOfQuarter(d) }; } },
    { label: 'Year to Date',      getRange: () => ({ from: startOfYear(new Date()), to: new Date() }) },
    { label: 'Last Year',         getRange: () => { const d = subYears(new Date(), 1); return { from: startOfYear(d), to: endOfYear(d) }; } },
    { label: 'All Time',          getRange: () => ({ from: undefined, to: undefined }) },
  ];

  const [active, setActive] = useState('All Time');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const handlePreset = (label: string, from?: Date, to?: Date) => {
    setActive(label);
    setShowCustom(false);
    setCustomError(null);
    onRangeChange(from ? format(from, 'yyyy-MM-dd') : undefined, to ? format(to, 'yyyy-MM-dd') : undefined);
  };

  const handleCustom = () => {
    const v = validateCustomRange(customFrom, customTo);
    if (!v.valid) {
      setCustomError(v.error ?? 'Invalid date range.');
      return;
    }
    setCustomError(null);
    setActive('Custom');
    onRangeChange(customFrom, customTo);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map(p => {
          const { from, to } = p.getRange();
          const isActive = active === p.label;
          return (
            <Button
              key={p.label}
              variant="ghost"
              size="sm"
              className={`text-xs h-8 rounded-lg font-semibold border ${
                isActive
                  ? 'border-primary/40 bg-primary/15 text-primary hover:bg-primary/20'
                  : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/60'
              }`}
              onClick={() => handlePreset(p.label, from, to)}
            >
              {p.label}
            </Button>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          className={`text-xs h-8 rounded-lg font-semibold border ${
            showCustom
              ? 'border-primary/40 bg-primary/15 text-primary hover:bg-primary/20'
              : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/60'
          }`}
          onClick={() => setShowCustom(!showCustom)}
        >
          Custom Range
        </Button>
      </div>
      {showCustom && (
        <div className="space-y-1.5">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setCustomError(null); }} className="h-9 text-xs rounded-lg" />
            </div>
            <span className="text-xs text-muted-foreground pb-2">to</span>
            <div className="flex-1">
              <Input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setCustomError(null); }} className="h-9 text-xs rounded-lg" />
            </div>
            <Button size="sm" className="h-9 text-xs rounded-lg" onClick={handleCustom}>Apply</Button>
          </div>
          {customError && (
            <p className="text-[11px] text-destructive font-medium">{customError}</p>
          )}
        </div>
      )}
    </div>
  );
}
