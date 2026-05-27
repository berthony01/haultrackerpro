import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter,
  startOfYear, endOfYear, subWeeks, subMonths, subQuarters, subYears, format, parseISO, isValid,
  differenceInCalendarDays, addDays, subDays,
} from 'date-fns';


export type RangePresetKey =
  | 'this_week' | 'last_week'
  | 'this_month' | 'last_month'
  | 'this_quarter' | 'last_quarter'
  | 'ytd' | 'last_year'
  | 'custom';

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  label: string;
  key: RangePresetKey;
}

export function getPresetRange(
  key: Exclude<RangePresetKey, 'custom'>,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0,
): DateRange {
  const now = new Date();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (key) {
    case 'this_week':    return { key, label: 'This Week',       from: fmt(startOfWeek(now, { weekStartsOn })), to: fmt(endOfWeek(now, { weekStartsOn })) };
    case 'last_week': {
      const lw = subWeeks(now, 1);
      return { key, label: 'Last Week', from: fmt(startOfWeek(lw, { weekStartsOn })), to: fmt(endOfWeek(lw, { weekStartsOn })) };
    }
    case 'this_month':   return { key, label: 'This Month',      from: fmt(startOfMonth(now)),    to: fmt(endOfMonth(now)) };
    case 'last_month': {
      const lm = subMonths(now, 1);
      return { key, label: 'Last Month', from: fmt(startOfMonth(lm)), to: fmt(endOfMonth(lm)) };
    }
    case 'this_quarter': return { key, label: 'Current Quarter', from: fmt(startOfQuarter(now)),  to: fmt(endOfQuarter(now)) };
    case 'last_quarter': {
      const lq = subQuarters(now, 1);
      return { key, label: 'Previous Quarter', from: fmt(startOfQuarter(lq)), to: fmt(endOfQuarter(lq)) };
    }
    case 'ytd':          return { key, label: 'Year to Date',    from: fmt(startOfYear(now)),     to: fmt(now) };
    case 'last_year': {
      const ly = subYears(now, 1);
      return { key, label: 'Last Year', from: fmt(startOfYear(ly)), to: fmt(endOfYear(ly)) };
    }
  }
}

export interface CustomRangeValidation {
  valid: boolean;
  error?: string;
}

export function validateCustomRange(from: string, to: string): CustomRangeValidation {
  if (!from || !to) return { valid: false, error: 'Select both a start and end date.' };
  const f = parseISO(from);
  const t = parseISO(to);
  if (!isValid(f) || !isValid(t)) return { valid: false, error: 'Invalid date.' };
  if (f > t) return { valid: false, error: 'Start date must be on or before end date.' };
  return { valid: true };
}

export function buildCustomRange(from: string, to: string): DateRange {
  return { key: 'custom', label: 'Custom Range', from, to };
}

export function rangeFilenamePart(r: DateRange): string {
  return `${r.from}-to-${r.to}`;
}

// ── Phase 23: shared helpers consumed by Dashboard / Loads / Reports ───────

/** Inclusive YYYY-MM-DD string compare. Timezone-safe. */
export function isDateInRange(
  dateStr: string,
  range: { from?: string; to?: string },
): boolean {
  if (!dateStr) return false;
  if (range.from && dateStr < range.from) return false;
  if (range.to && dateStr > range.to) return false;
  return true;
}

/** Human "Showing: …" label used by the date-range filter footer. */
export function formatShowingRange(range: { from?: string; to?: string }): string | null {
  const f = range.from ? parseISO(range.from) : null;
  const t = range.to ? parseISO(range.to) : null;
  if (f && isValid(f) && t && isValid(t)) {
    return `Showing: ${format(f, 'MMM d, yyyy')} – ${format(t, 'MMM d, yyyy')}`;
  }
  if (!range.from && !range.to) return 'Showing: All loads';
  return null;
}

/**
 * Returns the previous comparison range for the given preset.
 * - this_week → last week    last_week → 2 weeks ago
 * - this_month → last month  last_month → 2 months ago
 * - this_quarter → last quarter (etc.)
 * - ytd → same span ending one year ago
 * - last_year → year before
 * - custom → equal-length window immediately before `from`
 */
export function getPreviousComparisonRange(
  key: RangePresetKey,
  range: DateRange,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0,
): DateRange | null {
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  const shift = (preset: Exclude<RangePresetKey, 'custom'>): DateRange => {
    // Re-anchor the preset one period in the past by passing a shifted "now".
    const now = new Date();
    const back = (() => {
      switch (preset) {
        case 'this_week':    return subWeeks(now, 1);
        case 'last_week':    return subWeeks(now, 2);
        case 'this_month':   return subMonths(now, 1);
        case 'last_month':   return subMonths(now, 2);
        case 'this_quarter': return subQuarters(now, 1);
        case 'last_quarter': return subQuarters(now, 2);
        case 'ytd':          return subYears(now, 1);
        case 'last_year':    return subYears(now, 1);
      }
    })();
    switch (preset) {
      case 'this_week':
      case 'last_week':
        return { key: preset, label: 'Previous Period', from: fmt(startOfWeek(back, { weekStartsOn })), to: fmt(endOfWeek(back, { weekStartsOn })) };
      case 'this_month':
      case 'last_month':
        return { key: preset, label: 'Previous Period', from: fmt(startOfMonth(back)), to: fmt(endOfMonth(back)) };
      case 'this_quarter':
      case 'last_quarter':
        return { key: preset, label: 'Previous Period', from: fmt(startOfQuarter(back)), to: fmt(endOfQuarter(back)) };
      case 'ytd':
        return { key: preset, label: 'Previous Period', from: fmt(startOfYear(back)), to: fmt(back) };
      case 'last_year':
        return { key: preset, label: 'Previous Period', from: fmt(startOfYear(back)), to: fmt(endOfYear(back)) };
    }
  };
  if (key !== 'custom') return shift(key);
  // Custom: equal-length window immediately before `from`.
  if (!range.from || !range.to) return null;
  const f = parseISO(range.from);
  const t = parseISO(range.to);
  if (!isValid(f) || !isValid(t)) return null;
  const days = differenceInCalendarDays(t, f);
  const newTo = subDays(f, 1);
  const newFrom = subDays(newTo, days);
  return { key: 'custom', label: 'Previous Period', from: fmt(newFrom), to: fmt(newTo) };
}

