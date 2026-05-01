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
import { Expense } from '@/hooks/useExpenses';
import { FuelLog } from '@/hooks/useFuelLogs';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useCostProfile, computeCostProfileCPM, profileHasUsableData } from '@/hooks/useCostProfile';
import { formatCurrency, formatNumber, weekStartDayToNumber } from '@/lib/loadUtils';
import { StatCard, StatCardSkeleton } from '@/components/StatCard';
import { WeeklyFocusCard } from '@/components/WeeklyFocusCard';
import { PerformanceTrends } from '@/components/PerformanceTrends';
import { PerformanceCharts } from '@/components/PerformanceCharts';
import { ProfitOverview } from '@/components/ProfitOverview';
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
import { DollarSign, Route, Truck, TrendingUp, TrendingDown, AlertTriangle, MapPin, Plus, ClipboardCheck, FileText, Receipt, Fuel, ParkingCircle } from 'lucide-react';
import { HomeTimeDashboardCard } from '@/components/HomeTimeDashboardCard';
import { DriverIntelligenceCard } from '@/components/DriverIntelligenceCard';
import { useTierUpDetector } from '@/hooks/useTierUpDetector';
import { DriverLeaderboardCard } from '@/components/DriverLeaderboardCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subWeeks, subMonths, parseISO, isWithinInterval, format } from 'date-fns';
import { Shield } from 'lucide-react';


interface DashboardViewProps {
  loads: Load[];
  expenses?: Expense[];
  fuelLogs?: FuelLog[];
  isLoading?: boolean;
  onNavigate?: (page: string, options?: { filter?: string }) => void;
  smartAlerts?: { alerts: any[]; dismissAlert: { mutate: (key: string) => void } };
  isPro?: boolean;
}

type PresetKey = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'custom';

const presets: { key: PresetKey; label: string }[] = [
  { key: 'this_week', label: 'This Week' },
  { key: 'last_week', label: 'Last Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_year', label: 'This Year' },
  { key: 'custom', label: 'Custom' },
];

function getPresetRange(key: PresetKey, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0): { start: Date; end: Date } {
  const now = new Date();
  switch (key) {
    case 'this_week': return { start: startOfWeek(now, { weekStartsOn }), end: endOfWeek(now, { weekStartsOn }) };
    case 'last_week': { const lw = subWeeks(now, 1); return { start: startOfWeek(lw, { weekStartsOn }), end: endOfWeek(lw, { weekStartsOn }) }; }
    case 'this_month': return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'last_month': { const lm = subMonths(now, 1); return { start: startOfMonth(lm), end: endOfMonth(lm) }; }
    case 'this_year': return { start: startOfYear(now), end: endOfYear(now) };
    default: return { start: startOfWeek(now, { weekStartsOn }), end: endOfWeek(now, { weekStartsOn }) };
  }
}

export function DashboardView({ loads, expenses = [], fuelLogs = [], isLoading, onNavigate, smartAlerts, isPro = false }: DashboardViewProps) {
  const { settings } = useUserSettings();
  const { profile: costProfile } = useCostProfile();
  useTierUpDetector();
  
  const weekStartsOn = weekStartDayToNumber(settings?.week_start_day);
  const [activePreset, setActivePreset] = useState<PresetKey>('this_week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const showCustom = activePreset === 'custom';

  const filteredLoads = useMemo(() => {
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

  const estimated = sumExpectedPay(filteredLoads);
  const actual = sumActualPay(filteredLoads);
  const loadedMiles = sumLoadedMiles(filteredLoads);
  const deadheadMiles = sumDeadheadMiles(filteredLoads);

  const paidLoads = filteredLoads.filter(l => l.actual_pay_received != null);
  const missingPayCount = filteredLoads.filter(l => l.actual_pay_received == null).length;
  const paidEstimated = sumExpectedPay(paidLoads);
  const knownDifference = paidLoads.length > 0 ? actual - paidEstimated : null;
  const unpaidEstimated = sumExpectedPay(filteredLoads.filter(l => l.actual_pay_received == null));

  const totalMiles = sumOperatingMiles(filteredLoads);
  const deadheadPct = fleetDeadheadPct(filteredLoads);
  const deadheadColor = deadheadPct < 15 ? 'success' : deadheadPct < 30 ? 'warning' : 'destructive';

  const isLastDayOfPayWeek = new Date().getDay() === ((weekStartsOn + 6) % 7);
  const thisWeekLoadCount = useMemo(() => {
    const now = new Date();
    const ws = startOfWeek(now, { weekStartsOn });
    const we = endOfWeek(now, { weekStartsOn });
    return loads.filter(l => isWithinInterval(parseISO(getEffectiveDate(l)), { start: ws, end: we })).length;
  }, [loads, weekStartsOn]);
  const showCloseoutButton = isLastDayOfPayWeek || thisWeekLoadCount >= 7;

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black font-heading">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your hauling overview</p>
      </div>

      {/* === ZONE 1 · ACTION ZONE === */}
      {/* Quick Actions — primary "log something" entry point */}
      {!isLoading && onNavigate && (
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

      {/* Driver Intelligence — gamified score card with next-tier hint */}
      {!isLoading && <DriverIntelligenceCard isPro={isPro} />}

      {/* === ZONE 2 · COMPETITION ZONE === */}
      {!isLoading && (
        <DriverLeaderboardCard
          limit={5}
          onCustomize={onNavigate ? () => {
            try { sessionStorage.setItem('settings.focusSection', 'public-profile'); } catch {}
            onNavigate('settings');
          } : undefined}
        />
      )}

      {/* === ZONE 3 · ALERTS (urgent only) === */}
      {!isLoading && <TaxReminderBanner settings={settings} isPro={isPro} />}
      {!isLoading && smartAlerts && (
        <SmartAlertsCard
          alerts={smartAlerts.alerts}
          onDismiss={(key) => smartAlerts.dismissAlert.mutate(key)}
          onNavigate={onNavigate ? (p) => onNavigate(p) : undefined}
          onViewAll={onNavigate ? () => onNavigate('alerts') : undefined}
          isPro={isPro}
        />
      )}
      {!isLoading && <WeeklyFocusCard loads={loads} />}

      {/* === ZONE 4 · QUICK SHORTCUTS / SUPPORT === */}
      {!isLoading && (
        <HomeTimeDashboardCard isPro={isPro} onNavigate={onNavigate} />
      )}

      {/* Date Range Filter */}
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
      </div>

      {/* Loading skeletons */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <>
          {/* === ZONE 5 · BUSINESS METRICS === */}
          {/* Profit Overview — promoted to top so Gross / Expenses / Net Profit are
              the first thing the driver sees after the date filter. */}
          <ProfitOverview
            loads={filteredLoads}
            expenses={filteredExpenses}
            onAddExpense={onNavigate ? () => onNavigate('add_expense') : undefined}
          />

          {/* Headline Net Profit + Expenses tiles. Always rendered, even at $0,
              so profit math is visible above the fold. */}
          {(() => {
            const grossForTiles = (() => {
              const paid = filteredLoads.filter(l => l.actual_pay_received != null);
              if (paid.length > 0) {
                return paid.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0)
                  + sumExpectedPay(filteredLoads.filter(l => l.actual_pay_received == null));
              }
              return estimated;
            })();
            const totalExpensesForTiles = filteredExpenses.reduce((s, e) => s + Number(e.amount), 0);
            const netProfitForTiles = grossForTiles - totalExpensesForTiles;

            // Cost Profile projection (only when user has set up a usable profile)
            let projectedNet: number | null = null;
            if (profileHasUsableData(costProfile) && totalMiles > 0) {
              const { cpm } = computeCostProfileCPM(costProfile, totalMiles);
              const variableCost = cpm * totalMiles;
              const daysPer1k = Number(costProfile?.days_per_1000_miles ?? 2.5) || 2.5;
              const days = (totalMiles / 1000) * daysPer1k;
              const perDay = Number(costProfile?.meals_per_day ?? 0) + Number(costProfile?.lodging_per_day ?? 0);
              const dailyCost = days * perDay;
              projectedNet = grossForTiles - variableCost - dailyCost;
            }

            return (
              <div className="grid grid-cols-2 gap-2.5">
                <StatCard
                  label="Net Profit"
                  value={formatCurrency(netProfitForTiles)}
                  icon={netProfitForTiles >= 0 ? TrendingUp : TrendingDown}
                  subtitle={filteredExpenses.length > 0 ? 'Gross − Expenses' : 'Log expenses for true net'}
                  variant={netProfitForTiles >= 0 ? 'success' : 'danger'}
                  size="large"
                />
                <StatCard
                  label="Total Expenses"
                  value={formatCurrency(totalExpensesForTiles)}
                  icon={Receipt}
                  subtitle={`${filteredExpenses.length} logged`}
                  variant="warning"
                  size="large"
                />
                <StatCard label="Est. Earnings" value={formatCurrency(estimated)} icon={DollarSign} />
                <StatCard
                  label="Actual Earnings"
                  value={formatCurrency(actual)}
                  icon={DollarSign}
                  subtitle={paidLoads.length > 0 ? `${paidLoads.length} paid` : 'No payments yet'}
                />
                <StatCard label="Total Loads" value={filteredLoads.length.toString()} icon={Truck} />
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
                  <StatCard
                    label="Projected Net"
                    value={formatCurrency(projectedNet)}
                    icon={projectedNet >= 0 ? TrendingUp : TrendingDown}
                    subtitle="Based on Cost Profile"
                    variant={projectedNet >= 0 ? 'success' : 'danger'}
                  />
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
          <ContributionMarginCard loads={filteredLoads} expenses={filteredExpenses} />

          {/* Fuel Analytics */}
          <FuelAnalyticsCard fuelLogs={fuelLogs} loads={filteredLoads} isPro={isPro} onNavigate={onNavigate} />

          {/* Tax Estimate */}
          <TaxEstimateCard loads={filteredLoads} expenses={filteredExpenses} settings={settings} isPro={isPro} />

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

          {/* Performance Trends */}
          <PerformanceTrends loads={loads} />

          {/* Performance Charts */}
          <PerformanceCharts loads={loads} expenses={expenses} isPro={isPro} />

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
