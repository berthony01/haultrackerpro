import { useState, useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { getEffectiveDate } from '@/lib/loadUtils';
import {
  sumExpectedPay,
  sumActualPay,
  sumLoadedMiles,
  sumDeadheadMiles,
  sumOperatingMiles,
  fleetDeadheadPct,
} from '@/lib/loadMetrics';
import { excludeCancelled, summarizeLoads, applyFuelLogPolicy, FINANCIAL_TOOLTIPS } from '@/lib/financialCalculations';
import { Expense } from '@/hooks/useExpenses';
import { FuelLog } from '@/hooks/useFuelLogs';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useCostProfile, computeCostProfileCPM, profileHasUsableData } from '@/hooks/useCostProfile';
import { formatCurrency, formatNumber, weekStartDayToNumber } from '@/lib/loadUtils';
import { StatCard, StatCardSkeleton } from '@/components/StatCard';
import { WeeklyFocusCard } from '@/components/WeeklyFocusCard';
// PerformanceTrends + PerformanceCharts removed (duplicated by premium ProfitOverviewChart)
// ProfitOverview removed (duplicated by premium ProfitOverviewChart + KPI row)
import { ProInsightCard } from '@/components/ProInsightCard';
import { TaxEstimateCard } from '@/components/TaxEstimateCard';
import { ProTimeSavedCard } from '@/components/ProTimeSavedCard';
import { TaxReminderBanner } from '@/components/TaxReminderBanner';
import { SmartAlertsCard } from '@/components/SmartAlertsCard';
import { FuelAnalyticsCard } from '@/components/FuelAnalyticsCard';
import { SmartLoadAdvisor } from '@/components/SmartLoadAdvisor';
import { ContributionMarginCard } from '@/components/ContributionMarginCard';
import { PersonalIntelligenceBlocks } from '@/components/PersonalIntelligenceBlocks';
import { WeeklyPulseCard } from '@/components/WeeklyPulseCard';
import { DollarSign, Route, Truck, TrendingUp, TrendingDown, AlertTriangle, MapPin, Plus, ClipboardCheck, FileText, Receipt, Fuel, ParkingCircle, Gauge } from 'lucide-react';
import { HomeTimeDashboardCard } from '@/components/HomeTimeDashboardCard';
import { DriverIntelligenceCard } from '@/components/DriverIntelligenceCard';
import { useTierUpDetector } from '@/hooks/useTierUpDetector';
import { DriverLeaderboardCard } from '@/components/DriverLeaderboardCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { startOfWeek, endOfWeek, startOfYear, endOfYear, parseISO, isWithinInterval, isValid, format } from 'date-fns';
import {
  getPresetRange as getSharedPresetRange,
  getPreviousComparisonRange,
  isDateInRange,
  type RangePresetKey,
} from '@/lib/reportRanges';
import { Shield } from 'lucide-react';
import { PremiumKpiCard } from '@/components/premium/PremiumKpiCard';
import { ProfitOverviewChart } from '@/components/premium/ProfitOverviewChart';
import { DriverScoreGauge } from '@/components/premium/DriverScoreGauge';
import { RecentLoadsPanel } from '@/components/premium/RecentLoadsPanel';
import { ExpenseDonut } from '@/components/premium/ExpenseDonut';
import { ProfitByLoadTable } from '@/components/premium/ProfitByLoadTable';
import { DashboardFooterCTA } from '@/components/premium/DashboardFooterCTA';
import { useDriverScorecard } from '@/hooks/useDriverScorecard';
import { RecommendedOpportunityCard } from '@/components/opportunities/RecommendedOpportunityCard';


interface DashboardViewProps {
  loads: Load[];
  expenses?: Expense[];
  fuelLogs?: FuelLog[];
  isLoading?: boolean;
  onNavigate?: (page: string, options?: { filter?: string }) => void;
  smartAlerts?: { alerts: any[]; dismissAlert: { mutate: (key: string) => void } };
  isPro?: boolean;
  /**
   * Phase DA-1 — safe settings of the account the dashboard belongs to. When an
   * assistant is acting for a driver this MUST be the managed driver's narrow
   * report settings, never the signed-in assistant's own settings.
   */
  settingsOverride?: Partial<Record<string, any>> | null;
  /** Phase 1N-B — when true (and onNavigate is present), render the driver
   *  "Recommended Opportunity" card between the primary dashboard grid and
   *  the ProfitByLoadTable. Default false so existing standalone consumers
   *  of DashboardView don't unexpectedly mount opportunity data hooks. */
  showRecommendedOpportunity?: boolean;
  /**
   * Phase DA-1 — true when a direct Driver Assistant is acting for a managed
   * driver. Suppresses widgets/controls bound to the SIGNED-IN user's own
   * personal driver state (home time, leaderboard, personal intelligence,
   * tier-up, reminders, closeout, add/action controls).
   */
  isAssistantView?: boolean;

}

type PresetKey = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'all' | 'custom';

const presets: { key: PresetKey; label: string }[] = [
  { key: 'this_week', label: 'This Week' },
  { key: 'last_week', label: 'Last Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_year', label: 'This Year' },
  { key: 'all', label: 'All Time' },
  { key: 'custom', label: 'Custom' },
];

// Map dashboard preset keys to reportRanges keys where they overlap. The
// dashboard exposes `this_year`, `all`, `custom` which the shared helper does
// not — those stay handled locally below.
const SHARED_KEY: Partial<Record<PresetKey, Exclude<RangePresetKey, 'custom'>>> = {
  this_week: 'this_week',
  last_week: 'last_week',
  this_month: 'this_month',
  last_month: 'last_month',
};

function getPresetRange(key: PresetKey, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0): { start: Date; end: Date } {
  const shared = SHARED_KEY[key];
  if (shared) {
    const r = getSharedPresetRange(shared, weekStartsOn);
    // Helper returns YYYY-MM-DD; widen end to 23:59:59.999 so isWithinInterval
    // remains inclusive of timestamped dates (defensive — getEffectiveDate
    // currently returns date-only).
    return { start: parseISO(r.from), end: parseISO(`${r.to}T23:59:59.999`) };
  }
  // Dashboard-only keys (this_year + default fallback) — reportRanges has no
  // matching preset, so keep the math local.
  const now = new Date();
  if (key === 'this_year') return { start: startOfYear(now), end: endOfYear(now) };
  return { start: startOfWeek(now, { weekStartsOn }), end: endOfWeek(now, { weekStartsOn }) };
}

export function getTrendSuffix(key: PresetKey): string {
  switch (key) {
    case 'this_week':
    case 'last_week': return 'vs previous week';
    case 'this_month':
    case 'last_month': return 'vs previous month';
    case 'this_year': return 'vs previous year';
    case 'all': return '';
    case 'custom': return 'vs previous period';
  }
}

/**
 * Null-safe / divide-by-zero-safe trend percentage for KPI chips.
 * Returns null (chip hidden) when:
 *  - curr or prev is null/undefined/non-finite
 *  - prev === 0 (cannot compute % from a zero baseline)
 * Otherwise returns (curr - prev) / |prev| * 100.
 */
export function computeTrendPct(
  curr: number | null | undefined,
  prev: number | null | undefined,
): number | null {
  if (curr == null || prev == null) return null;
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  if (prev === 0) return null;
  const result = ((curr - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(result)) return null;
  return result;
}

/**
 * Build the "Showing: …" label for the Dashboard date-range pills.
 * Mirrors the Loads-page wording (`MMM d, yyyy` start/end via date-fns `format`).
 * Returns null for Custom when both dates are blank.
 */
export function getShowingLabel(
  key: PresetKey,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date(),
): string | null {
  const fmt = (d: Date) => format(d, 'MMM d, yyyy');
  if (key === 'all') return 'Showing: All Time';
  if (key === 'custom') {
    const f = customFrom ? parseISO(customFrom) : null;
    const t = customTo ? parseISO(customTo) : null;
    if (f && t && isValid(f) && isValid(t)) return `Showing: ${fmt(f)} - ${fmt(t)}`;
    return null;
  }
  let start: Date; let end: Date;
  const shared = SHARED_KEY[key];
  if (shared) {
    // Delegate the four shared keys to reportRanges so DateRangeFilter and
    // DashboardView always agree on the underlying calendar window.
    const r = getSharedPresetRange(shared, weekStartsOn);
    start = parseISO(r.from);
    end = parseISO(r.to);
  } else if (key === 'this_year') {
    // Dashboard-only key — reportRanges has no 'this_year' preset.
    start = startOfYear(now); end = endOfYear(now);
  } else {
    return null;
  }
  return `Showing: ${fmt(start)} - ${fmt(end)}`;
}

/**
 * Cancelled-loads footnote shown below the Dashboard KPI strip.
 * Returns null when N <= 0 so callers can render conditionally.
 */
export function getCancelledFootnote(n: number): string | null {
  if (!n || n <= 0) return null;
  return `${n} cancelled load${n === 1 ? '' : 's'} excluded`;
}


/**
 * Phase DA-1 — `useTierUpDetector` reads/writes the SIGNED-IN user's own
 * gamification state. It must never run while an assistant is viewing a
 * managed driver's dashboard, so it lives in a self-only child component
 * that is simply not mounted in assistant mode (hooks stay unconditional).
 */
export function SelfTierUpDetector() {
  useTierUpDetector();
  return null;
}

export function DashboardView({ loads, expenses = [], fuelLogs = [], isLoading, onNavigate, smartAlerts, isPro = false, settingsOverride = null, showRecommendedOpportunity = false, isAssistantView = false }: DashboardViewProps) {
  const { settings: ownSettings } = useUserSettings();
  // Phase DA-1 — managed-driver safe settings win whenever provided.
  const settings: any = settingsOverride ?? ownSettings;

  const { profile: costProfile } = useCostProfile();
  const showPersonalWidgets = !isAssistantView;

  
  const weekStartsOn = weekStartDayToNumber(settings?.week_start_day);
  const [activePreset, setActivePreset] = useState<PresetKey>('this_week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const trendSuffix = getTrendSuffix(activePreset);

  const showCustom = activePreset === 'custom';

  const filteredLoads = useMemo(() => {
    if (activePreset === 'all') return loads;
    if (activePreset === 'custom') {
      return loads.filter(l => {
        const d = getEffectiveDate(l);
        if (customFrom && d < customFrom) return false;
        if (customTo && d > customTo) return false;
        return true;
      });
    }
    const { start, end } = getPresetRange(activePreset, weekStartsOn);
    return loads.filter(l => {
      const d = parseISO(getEffectiveDate(l));
      return isWithinInterval(d, { start, end });
    });
  }, [loads, activePreset, customFrom, customTo, weekStartsOn]);

  const filteredExpenses = useMemo(() => {
    if (activePreset === 'all') return expenses;
    if (activePreset === 'custom') {
      return expenses.filter(e => {
        const d = e.expense_date;
        if (customFrom && d < customFrom) return false;
        if (customTo && d > customTo) return false;
        return true;
      });
    }
    const { start, end } = getPresetRange(activePreset, weekStartsOn);
    return expenses.filter(e => {
      const d = parseISO(e.expense_date);
      return isWithinInterval(d, { start, end });
    });
  }, [expenses, activePreset, customFrom, customTo, weekStartsOn]);

  const filteredFuelLogs = useMemo(() => {
    if (activePreset === 'all') return fuelLogs;
    if (activePreset === 'custom') {
      return fuelLogs.filter(f => {
        const d = f.date;
        if (customFrom && d < customFrom) return false;
        if (customTo && d > customTo) return false;
        return true;
      });
    }
    const { start, end } = getPresetRange(activePreset, weekStartsOn);
    return fuelLogs.filter(f => {
      const d = parseISO(f.date);
      return isWithinInterval(d, { start, end });
    });
  }, [fuelLogs, activePreset, customFrom, customTo, weekStartsOn]);

  // Apply the shared fuel double-count policy so Dashboard net profit /
  // Net RPM / Cost-per-Mile match Reports & exports when both Fuel Logs and
  // Fuel-category expenses exist.
  const fuelPolicy = useMemo(
    () => applyFuelLogPolicy(filteredExpenses, filteredFuelLogs),
    [filteredExpenses, filteredFuelLogs],
  );

  // Canonical financial summary (cancelled loads automatically excluded).
  // Feed `expensesForMath` so summarizeLoads doesn't double-count fuel.
  const summary = useMemo(
    () => summarizeLoads(filteredLoads, fuelPolicy.expensesForMath),
    [filteredLoads, fuelPolicy.expensesForMath],
  );


  const estimated = summary.estimatedPay;
  const actual = summary.actualPay;
  const loadedMiles = summary.loadedMiles;
  const deadheadMiles = summary.deadheadMiles;

  const activeLoads = useMemo(() => excludeCancelled(filteredLoads), [filteredLoads]);
  const paidLoads = activeLoads.filter(l => l.actual_pay_received != null);
  const missingPayCount = summary.pendingPaymentCount;
  const paidEstimated = sumExpectedPay(paidLoads);
  const knownDifference = paidLoads.length > 0 ? actual - paidEstimated : null;
  const unpaidEstimated = summary.pendingPaymentEstimated;

  const totalMiles = summary.totalMiles;
  const deadheadPct = summary.deadheadPct;
  const deadheadColor = deadheadPct < 15 ? 'success' : deadheadPct < 30 ? 'warning' : 'destructive';

  const isLastDayOfPayWeek = new Date().getDay() === ((weekStartsOn + 6) % 7);
  const thisWeekLoadCount = useMemo(() => {
    // Delegate the week window to reportRanges so it matches DateRangeFilter.
    const r = getSharedPresetRange('this_week', weekStartsOn);
    return loads.filter(l => isDateInRange(getEffectiveDate(l), { from: r.from, to: r.to })).length;
  }, [loads, weekStartsOn]);
  const showCloseoutButton = isLastDayOfPayWeek || thisWeekLoadCount >= 7;

  // ---- Premium hero KPI metrics + week-over-week trends ----
  // Driver-facing Gross Revenue uses actual when present, else expected.
  // Cancelled loads are excluded by summarizeLoads (above).
  // Net Profit / Net RPM include Fuel Logs via the shared fuel double-count
  // policy so Dashboard agrees with Reports & exports.
  const grossRevenue = summary.grossRevenue;
  const totalExpensesAmt = fuelPolicy.combinedExpensesTotal;
  const netProfit = grossRevenue - totalExpensesAmt;
  const netRPM = summary.totalMiles > 0 ? netProfit / summary.totalMiles : 0;


  // Previous comparison range — matches the selected preset (not always last week).
  // - this_week → previous calendar week
  // - last_week → week before last
  // - this_month → previous calendar month
  // - last_month → month before last
  // - this_year → previous calendar year
  // - custom → equal-length prior period immediately before customFrom (null if range invalid)
  const prevRange = useMemo<{ start: Date; end: Date } | null>(() => {
    const shared = SHARED_KEY[activePreset];
    if (shared) {
      // Shared keys delegate to reportRanges so dashboard trends use the
      // same previous-period math as future report comparisons.
      const cur = getSharedPresetRange(shared, weekStartsOn);
      const prev = getPreviousComparisonRange(shared, cur, weekStartsOn);
      if (!prev) return null;
      return { start: parseISO(prev.from), end: parseISO(`${prev.to}T23:59:59.999`) };
    }
    if (activePreset === 'custom') {
      if (!customFrom || !customTo) return null;
      const s = parseISO(customFrom);
      const e = parseISO(customTo);
      if (!isValid(s) || !isValid(e) || e < s) return null;
      const prev = getPreviousComparisonRange(
        'custom',
        { key: 'custom', label: 'Custom', from: customFrom, to: customTo },
        weekStartsOn,
      );
      if (!prev) return null;
      return { start: parseISO(prev.from), end: parseISO(`${prev.to}T23:59:59.999`) };
    }
    if (activePreset === 'this_year') {
      // Dashboard-only key — reportRanges has no 'this_year' preset, so the
      // previous-year window stays local.
      const now = new Date();
      const ly = new Date(now.getFullYear() - 1, 0, 1);
      return { start: startOfYear(ly), end: endOfYear(ly) };
    }
    return null;
  }, [activePreset, weekStartsOn, customFrom, customTo]);
  const prevLoads = useMemo(() => {
    if (!prevRange) return [] as Load[];
    return loads.filter(l => {
      const d = parseISO(getEffectiveDate(l));
      return isWithinInterval(d, prevRange);
    });
  }, [loads, prevRange]);
  const prevExpenses = useMemo(() => {
    if (!prevRange) return [] as Expense[];
    return expenses.filter(e => {
      const d = parseISO(e.expense_date);
      return isWithinInterval(d, prevRange);
    });
  }, [expenses, prevRange]);
  const prevFuelLogs = useMemo(() => {
    if (!prevRange) return [] as FuelLog[];
    return fuelLogs.filter(f => {
      const d = parseISO(f.date);
      return isWithinInterval(d, prevRange);
    });
  }, [fuelLogs, prevRange]);
  const prevFuelPolicy = useMemo(
    () => applyFuelLogPolicy(prevExpenses, prevFuelLogs),
    [prevExpenses, prevFuelLogs],
  );
  const prevSummary = useMemo(
    () => summarizeLoads(prevLoads, prevFuelPolicy.expensesForMath),
    [prevLoads, prevFuelPolicy.expensesForMath],
  );
  const prevGross = prevSummary.grossRevenue;
  const prevNet = prevGross - prevFuelPolicy.combinedExpensesTotal;
  const prevPpm = prevSummary.totalMiles > 0 ? prevNet / prevSummary.totalMiles : 0;
  const pct = computeTrendPct;
  const trendRevenue = pct(grossRevenue, prevGross);
  const trendNet = pct(netProfit, prevNet);
  const trendPpm = pct(netRPM, prevPpm);
  const trendLoads = pct(summary.loadCount, prevSummary.loadCount);


  const scorecard = useDriverScorecard(loads, expenses, settings?.week_start_day);

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black font-heading">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your hauling overview</p>
      </div>

      {/* Date Range Filter — moved above premium hero so it scopes the new charts */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {presets.map(p => (
            <Button
              key={p.key}
              variant={activePreset === p.key ? 'default' : 'outline'}
              size="sm"
              className={`text-xs h-8 px-3 rounded-xl active:scale-95 transition-all duration-200 ${activePreset === p.key ? 'shadow-primary' : ''}`}
              onClick={() => setActivePreset(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {showCustom && (
          <div className="flex gap-2 items-center animate-fade-in">
            <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-9 text-xs flex-1 rounded-xl" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-9 text-xs flex-1 rounded-xl" />
          </div>
        )}
        {(() => {
          const label = getShowingLabel(activePreset, weekStartsOn, customFrom, customTo);
          return label ? (
            <p className="text-[11px] text-muted-foreground font-medium pl-0.5">{label}</p>
          ) : null;
        })()}
      </div>

      {/* === PREMIUM ANALYTICS HERO === */}
      {!isLoading && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <TooltipProvider>
              <Tooltip><TooltipTrigger asChild><div data-testid="dashboard-gross-revenue" data-value={grossRevenue}><PremiumKpiCard label="Gross Revenue" value={formatCurrency(grossRevenue)} icon={DollarSign} trendPct={trendRevenue} trendLabel={trendSuffix} delay={0} /></div></TooltipTrigger><TooltipContent side="bottom" className="max-w-[260px] text-xs">{FINANCIAL_TOOLTIPS.grossRevenue}</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><div data-testid="dashboard-net-profit" data-value={netProfit}><PremiumKpiCard label="Net Profit" value={formatCurrency(netProfit)} icon={TrendingUp} trendPct={trendNet} trendLabel={trendSuffix} delay={0.05} /></div></TooltipTrigger><TooltipContent side="bottom" className="max-w-[260px] text-xs">{FINANCIAL_TOOLTIPS.netProfit}</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><div data-testid="dashboard-net-rpm" data-value={netRPM}><PremiumKpiCard label="Net RPM" value={formatCurrency(netRPM)} icon={Route} trendPct={trendPpm} trendLabel={trendSuffix} delay={0.1} /></div></TooltipTrigger><TooltipContent side="bottom" className="max-w-[260px] text-xs">{FINANCIAL_TOOLTIPS.netRPM}</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><div><PremiumKpiCard label="Loads Completed" value={summary.loadCount.toString()} icon={Truck} trendPct={trendLoads} trendLabel={trendSuffix} delay={0.15} /></div></TooltipTrigger><TooltipContent side="bottom" className="max-w-[260px] text-xs">Active loads in this period (cancelled excluded).{summary.cancelledCount > 0 ? ` ${summary.cancelledCount} cancelled load${summary.cancelledCount === 1 ? '' : 's'} not counted.` : ''}</TooltipContent></Tooltip>
            </TooltipProvider>
          </div>

          {/* Hidden E2E fixture — exposes the full KPI set with stable testids.
              Visually hidden (no UI change). Used by tests/e2e/driver-journey.spec.ts. */}
          <div data-testid="dashboard-metrics" className="sr-only" aria-hidden="true">
            <span data-testid="dashboard-gross-revenue-v" data-value={grossRevenue} />
            <span data-testid="dashboard-total-expenses" data-value={totalExpensesAmt} />
            <span data-testid="dashboard-net-profit-v" data-value={netProfit} />
            <span data-testid="dashboard-net-rpm-v" data-value={netRPM} />
            <span data-testid="dashboard-loaded-miles" data-value={loadedMiles} />
            <span data-testid="dashboard-operating-miles" data-value={totalMiles} />
            <span data-testid="dashboard-loaded-rpm" data-value={loadedMiles > 0 ? grossRevenue / loadedMiles : 0} />
            <span data-testid="dashboard-effective-rpm" data-value={totalMiles > 0 ? grossRevenue / totalMiles : 0} />
          </div>

          {(() => {
            const footnote = getCancelledFootnote(summary.cancelledCount);
            return footnote ? (
              <p className="text-[11px] text-muted-foreground -mt-2">{footnote}</p>
            ) : null;
          })()}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <ProfitOverviewChart loads={filteredLoads} expenses={filteredExpenses} fuelLogs={filteredFuelLogs} />
              <ExpenseDonut expenses={filteredExpenses} />
            </div>
            <div className="space-y-4">
              <DriverScoreGauge
                score={scorecard.totalScore}
                tier={scorecard.tier}
                percentileLabel={scorecard.totalScore >= 80 ? 'Top 14% of drivers' : scorecard.totalScore >= 60 ? 'Top 35% of drivers' : 'Keep going!'}
              />
              <RecentLoadsPanel loads={filteredLoads} onViewAll={onNavigate ? () => onNavigate('loads') : undefined} />
            </div>
          </div>

          {showRecommendedOpportunity && onNavigate && (
            <RecommendedOpportunityCard onNavigate={onNavigate} />
          )}

          <ProfitByLoadTable loads={filteredLoads} expenses={filteredExpenses} onViewAll={onNavigate ? () => onNavigate('loads') : undefined} />

          {showPersonalWidgets && <DashboardFooterCTA onClick={onNavigate ? () => onNavigate('add') : undefined} />}
        </>
      )}

      {/* === ZONE 1 · ACTION ZONE === */}
      {!isLoading && showPersonalWidgets && onNavigate && (
        <div className="grid grid-cols-4 gap-2">
          <Button
            variant="outline"
            className="h-11 gap-1 rounded-xl border-primary/20 text-primary font-bold text-xs active:scale-95 transition-all px-1"
            onClick={() => onNavigate('add_expense')}
          >
            <Receipt className="h-4 w-4 shrink-0" />
            Expense
          </Button>
          <Button
            variant="outline"
            className="h-11 gap-1 rounded-xl border-primary/20 text-primary font-bold text-xs active:scale-95 transition-all px-1"
            onClick={() => onNavigate('add')}
          >
            <Truck className="h-4 w-4 shrink-0" />
            Load
          </Button>
          <Button
            variant="outline"
            className="h-11 gap-1 rounded-xl border-primary/20 text-primary font-bold text-xs active:scale-95 transition-all px-1"
            onClick={() => onNavigate('add_fuel')}
          >
            <Fuel className="h-4 w-4 shrink-0" />
            Fuel
          </Button>
          <Button
            variant="outline"
            className="h-11 gap-1 rounded-xl border-primary/20 text-primary font-bold text-xs active:scale-95 transition-all px-1"
            onClick={() => onNavigate('parking')}
          >
            <ParkingCircle className="h-4 w-4 shrink-0" />
            Parking
          </Button>
        </div>
      )}

      {/* Driver Intelligence */}
      {!isLoading && showPersonalWidgets && <DriverIntelligenceCard isPro={isPro} />}

      {/* === ZONE 2 · COMPETITION === */}
      {!isLoading && showPersonalWidgets && (
        <DriverLeaderboardCard
          limit={5}
          onCustomize={onNavigate ? () => {
            try { sessionStorage.setItem('settings.focusSection', 'public-profile'); } catch {}
            onNavigate('settings');
          } : undefined}
        />
      )}

      {/* === ZONE 3 · ALERTS === */}
      {!isLoading && showPersonalWidgets && <TaxReminderBanner settings={settings} isPro={isPro} />}
      {!isLoading && showPersonalWidgets && smartAlerts && (
        <SmartAlertsCard
          alerts={smartAlerts.alerts}
          onDismiss={(key) => smartAlerts.dismissAlert.mutate(key)}
          onNavigate={onNavigate ? (p) => onNavigate(p) : undefined}
          onViewAll={onNavigate ? () => onNavigate('alerts') : undefined}
          isPro={isPro}
        />
      )}
      {!isLoading && <WeeklyFocusCard loads={loads} />}

      {/* === ZONE 4 · QUICK SHORTCUTS === */}
      {!isLoading && showPersonalWidgets && (
        <HomeTimeDashboardCard isPro={isPro} onNavigate={onNavigate} />
      )}


      {/* Loading skeletons */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <>
          {/* === ZONE 5 · BUSINESS METRICS (secondary tiles, non-duplicated) === */}
          {(() => {
            // Cost Profile projection (only when user has set up a usable profile)
            let projectedNet: number | null = null;
            let projectedWarnings: string[] = [];
            if (profileHasUsableData(costProfile) && totalMiles > 0) {
              const grossForProj = (() => {
                const paid = activeLoads.filter(l => l.actual_pay_received != null);
                if (paid.length > 0) {
                  return paid.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0)
                    + sumExpectedPay(activeLoads.filter(l => l.actual_pay_received == null));
                }
                return estimated;
              })();
              const { cpm, warnings } = computeCostProfileCPM(costProfile, totalMiles);
              projectedWarnings = warnings;
              // cpm already includes the per-day share (meals + lodging amortized over miles),
              // so do NOT subtract a separate dailyCost — that would double-count it.
              const variableCost = cpm * totalMiles;
              projectedNet = cpm > 0 ? grossForProj - variableCost : null;
            }
            const missingMiles = projectedWarnings.includes('fixed_missing_monthly_miles');

            return (
              <div className="grid grid-cols-2 gap-2.5">
                <StatCard label="Est. Earnings" value={formatCurrency(estimated)} icon={DollarSign} />
                <StatCard
                  label="Actual Earnings"
                  value={formatCurrency(actual)}
                  icon={DollarSign}
                  subtitle={paidLoads.length > 0 ? `${paidLoads.length} paid` : 'No payments yet'}
                />
                <StatCard label="Loaded Miles" value={formatNumber(loadedMiles)} icon={Route} />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <StatCard
                          label="Deadhead %"
                          value={`${deadheadPct.toFixed(1)}%`}
                          icon={MapPin}
                          subtitle={`${formatNumber(deadheadMiles)} mi`}
                          variant={deadheadColor === 'success' ? 'success' : deadheadColor === 'warning' ? 'warning' : 'danger'}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs">High deadhead reduces profit.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {projectedNet != null ? (
                  missingMiles ? (
                    <div
                      className="cursor-pointer active:scale-95 transition-transform"
                      onClick={() => onNavigate?.('settings')}
                    >
                      <StatCard
                        label="Projected Net"
                        value={formatCurrency(projectedNet)}
                        icon={projectedNet >= 0 ? TrendingUp : TrendingDown}
                        subtitle="Fixed costs not applied — set monthly miles"
                        variant="warning"
                      />
                    </div>
                  ) : (
                    <StatCard
                      label="Projected Net"
                      value={formatCurrency(projectedNet)}
                      icon={projectedNet >= 0 ? TrendingUp : TrendingDown}
                      subtitle="Based on Cost Profile"
                      variant={projectedNet >= 0 ? 'success' : 'danger'}
                    />
                  )
                ) : missingMiles ? (
                  <div
                    className="cursor-pointer active:scale-95 transition-transform"
                    onClick={() => onNavigate?.('settings')}
                  >
                    <StatCard
                      label="Projected Net"
                      value="Set miles"
                      icon={AlertTriangle}
                      subtitle="Fixed costs not applied"
                      variant="warning"
                    />
                  </div>
                ) : (
                  <div
                    className="cursor-pointer active:scale-95 transition-transform"
                    onClick={() => onNavigate?.('settings')}
                  >
                    <StatCard
                      label="Projected Net"
                      value="Set up"
                      icon={TrendingUp}
                      subtitle="Add Cost Profile"
                    />
                  </div>
                )}
                {knownDifference != null && (
                  <StatCard
                    label="Known Difference"
                    value={`${knownDifference >= 0 ? '+' : ''}${formatCurrency(knownDifference)}`}
                    icon={knownDifference >= 0 ? TrendingUp : TrendingDown}
                    subtitle={knownDifference >= 0 ? 'Overpaid' : 'Underpaid'}
                    variant={knownDifference >= 0 ? 'success' : 'danger'}
                  />
                )}
                {missingPayCount > 0 && (
                  <div
                    className="cursor-pointer active:scale-95 transition-transform"
                    onClick={() => onNavigate?.('loads', { filter: 'missing_pay' })}
                  >
                    <StatCard
                      label="Pending Payment"
                      value={formatCurrency(unpaidEstimated)}
                      icon={AlertTriangle}
                      subtitle={`${missingPayCount} load${missingPayCount > 1 ? 's' : ''} — tap to review`}
                      variant="warning"
                    />
                  </div>
                )}
              </div>
            );
          })()}

          {/* Cost Breakdown: Fixed vs Variable + Contribution Margin */}
          <ContributionMarginCard loads={activeLoads} expenses={filteredExpenses} />


          {/* Fuel Analytics */}
          <FuelAnalyticsCard fuelLogs={fuelLogs} loads={activeLoads} isPro={isPro} onNavigate={onNavigate} />

          {/* Tax Estimate */}
          <TaxEstimateCard loads={activeLoads} expenses={filteredExpenses} settings={settings} isPro={isPro} />

          {/* Finalize Weekly Summary Button */}
          {(showCloseoutButton || true) && onNavigate && (
            <Button
              variant="outline"
              className="w-full h-12 gap-2 rounded-xl border-primary/30 text-primary font-bold active:scale-95 transition-all duration-200"
              onClick={() => onNavigate('closeout')}
            >
              <ClipboardCheck className="h-5 w-5" /> Finalize Weekly Summary
            </Button>
          )}

          {/* View Reports */}
          {onNavigate && (
            <Button
              variant="outline"
              className="w-full h-12 gap-2 rounded-xl border-primary/30 text-primary font-bold active:scale-95 transition-all duration-200"
              onClick={() => onNavigate('reports')}
            >
              <FileText className="h-5 w-5" /> View Reports
            </Button>
          )}

          {/* === ZONE 6 · INSIGHTS (AI + trends) === */}
          {/* Weekly Pulse — promoted: Mon/Tue recap of last week + top recommendations */}
          <WeeklyPulseCard isPro={isPro} />

          {/* Personal Intelligence — promoted: best/weakest lanes, broker reliability, margin leaks */}
          <PersonalIntelligenceBlocks isPro={isPro} />

          {/* Smart Load Advisor — promoted */}
          <SmartLoadAdvisor loads={loads} expenses={expenses} isPro={isPro} />

          {/* Personalized Pro Insight — free users only */}
          <ProInsightCard
            loads={loads}
            expenses={expenses}
            isPro={isPro}

            onNavigate={onNavigate ? (p) => onNavigate(p) : undefined}
          />

          {/* Pro Time Saved */}
          <ProTimeSavedCard isPro={isPro} weekStartsOn={weekStartsOn} />

          {/* PerformanceTrends + PerformanceCharts removed — superseded by premium ProfitOverviewChart above */}

          {/* Last Updated */}
          {loads.length > 0 && (
            <p className="text-[10px] text-muted-foreground/50 text-center">
              Last updated: {format(
                new Date(Math.max(...loads.map(l => new Date(l.updated_at).getTime()))),
                'MMM d, h:mm a'
              )}
            </p>
          )}

          {/* Disclaimer + Confidence footer */}
          <div className="text-center space-y-1.5 py-2">
            <p className="text-[10px] text-muted-foreground/50">
              HaulTrackerPro provides tracking tools only. Always verify financial and tax information.
            </p>
            <div className="flex items-center justify-center gap-1.5">
              <Shield className="h-3 w-3 text-muted-foreground/40" />
              <p className="text-[10px] text-muted-foreground/40">Your data is securely stored and private.</p>
            </div>
          </div>

          {/* Empty State */}
          {!isLoading && filteredLoads.length === 0 && (
            <Card className="border-dashed border-2 border-muted-foreground/20 shadow-card">
              <CardContent className="py-14 text-center">
                <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-5 mb-5">
                  <Truck className="h-12 w-12 text-muted-foreground/30" />
                </div>
                <p className="font-bold text-lg">No loads for this period</p>
                <p className="text-sm text-muted-foreground mt-1.5 mb-5 leading-relaxed">
                  You haven't logged any loads for this date range.<br />
                  Start tracking to see your earnings here.
                </p>
                {onNavigate && (
                  <Button className="gap-2 rounded-xl shadow-primary active:scale-95 transition-all duration-200" onClick={() => onNavigate('add')}>
                    <Plus className="h-4 w-4" /> Log Your First Load
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
