import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  startOfQuarter, endOfQuarter, subWeeks, subMonths, subQuarters, subYears, format,
  parseISO, isValid,
} from 'date-fns';
import { useUserSettings } from '@/hooks/useUserSettings';
import { weekStartDayToNumber } from '@/lib/loadUtils';
import { validateCustomRange } from '@/lib/reportRanges';

interface DateRangeFilterProps {
  onRangeChange: (from?: string, to?: string) => void;
  /**
   * Authoritative applied range from the parent. When provided, the visible
   * active preset chip and "Showing: …" label are derived from this — the
   * filter holds no independent applied state of its own.
   */
  currentRange?: { from?: string; to?: string };
}

/** Local-safe ISO (yyyy-MM-dd) → Date. Returns null on invalid input. */
function safeParseISO(iso?: string): Date | null {
  if (!iso) return null;
  const d = parseISO(iso);
  return isValid(d) ? d : null;
}

export function DateRangeFilter({ onRangeChange, currentRange }: DateRangeFilterProps) {
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
    { label: 'All Time',          getRange: () => ({ from: undefined as Date | undefined, to: undefined as Date | undefined }) },
  ];

  // Custom-range input state is purely local UI scratch — not applied state.
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  // Derive the active preset label from the parent's authoritative range.
  // Falls back to 'All Time' (both undefined) or 'Custom' (both defined, no match).
  const fromISO = currentRange?.from;
  const toISO = currentRange?.to;
  const activeLabel = (() => {
    if (!fromISO && !toISO) return 'All Time';
    for (const p of presets) {
      const r = p.getRange();
      const pFrom = r.from ? format(r.from, 'yyyy-MM-dd') : undefined;
      const pTo = r.to ? format(r.to, 'yyyy-MM-dd') : undefined;
      if (pFrom === fromISO && pTo === toISO) return p.label;
    }
    return 'Custom';
  })();

  const handlePreset = (label: string, from?: Date, to?: Date) => {
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
    onRangeChange(customFrom, customTo);
  };

  // Derive the "Showing: …" label safely from the parent's range.
  const fromDate = safeParseISO(fromISO);
  const toDate = safeParseISO(toISO);
  const rangeLabel = fromDate && toDate
    ? `Showing: ${format(fromDate, 'MMM d, yyyy')} – ${format(toDate, 'MMM d, yyyy')}`
    : (!fromISO && !toISO) ? 'Showing: All loads' : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map(p => {
          const { from, to } = p.getRange();
          const isActive = activeLabel === p.label;
          return (
            <Button
              key={p.label}
              variant="ghost"
              size="sm"
              aria-pressed={isActive}
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
          aria-pressed={showCustom || activeLabel === 'Custom'}
          className={`text-xs h-8 rounded-lg font-semibold border ${
            showCustom || activeLabel === 'Custom'
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
      {rangeLabel && (
        <p className="text-[11px] text-muted-foreground font-medium pl-0.5">{rangeLabel}</p>
      )}
    </div>
  );
}
