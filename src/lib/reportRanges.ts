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
