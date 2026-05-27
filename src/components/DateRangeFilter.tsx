import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUserSettings } from '@/hooks/useUserSettings';
import { weekStartDayToNumber } from '@/lib/loadUtils';
import {
  getPresetRange,
  formatShowingRange,
  validateCustomRange,
  type RangePresetKey,
} from '@/lib/reportRanges';

interface DateRangeFilterProps {
  onRangeChange: (from?: string, to?: string) => void;
  /**
   * Authoritative applied range from the parent. When provided, the visible
   * active preset chip and "Showing: …" label are derived from this — the
   * filter holds no independent applied state of its own.
   */
  currentRange?: { from?: string; to?: string };
}

// Local sentinel for the "All Time" pill — reportRanges has no preset for it
// because "all time" simply emits (undefined, undefined) downstream.
type PresetSlot =
  | { label: string; key: Exclude<RangePresetKey, 'custom'> }
  | { label: 'All Time'; key: 'all_time' };

const PRESET_SLOTS: PresetSlot[] = [
  { label: 'This Week',        key: 'this_week' },
  { label: 'Last Week',        key: 'last_week' },
  { label: 'This Month',       key: 'this_month' },
  { label: 'Last Month',       key: 'last_month' },
  { label: 'Current Quarter',  key: 'this_quarter' },
  { label: 'Previous Quarter', key: 'last_quarter' },
  { label: 'Year to Date',     key: 'ytd' },
  { label: 'Last Year',        key: 'last_year' },
  { label: 'All Time',         key: 'all_time' },
];

export function DateRangeFilter({ onRangeChange, currentRange }: DateRangeFilterProps) {
  const { settings } = useUserSettings();
  const wso = weekStartDayToNumber(settings?.week_start_day);

  // Resolve each slot to its concrete YYYY-MM-DD range via the shared helper.
  // 'all_time' is dashboard-style: no range, emits (undefined, undefined).
  const resolved = PRESET_SLOTS.map(slot => {
    if (slot.key === 'all_time') {
      return { label: slot.label, from: undefined as string | undefined, to: undefined as string | undefined };
    }
    const r = getPresetRange(slot.key, wso);
    return { label: slot.label, from: r.from, to: r.to };
  });

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
    for (const p of resolved) {
      if (p.from === fromISO && p.to === toISO) return p.label;
    }
    return 'Custom';
  })();

  const handlePreset = (from?: string, to?: string) => {
    setShowCustom(false);
    setCustomError(null);
    onRangeChange(from, to);
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

  // Derive the "Showing: …" label via the shared helper.
  const rangeLabel = formatShowingRange({ from: fromISO, to: toISO });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {resolved.map(p => {
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
              onClick={() => handlePreset(p.from, p.to)}
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
