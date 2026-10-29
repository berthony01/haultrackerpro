import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContributionMarginCard } from '@/components/ContributionMarginCard';
import { summarizeFinancialPeriod } from '@/lib/financialCalculations';
import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';

const state = vi.hoisted(() => ({ loads: [] as Load[], cpm: undefined as number | undefined, loading: false }));
vi.mock('@/hooks/useLoads', () => ({ useLoads: () => ({ loads: state.loads, isLoading: state.loading }) }));
vi.mock('@/hooks/usePersonalIntelligence', () => ({ usePersonalIntelligence: () => ({ lanes: [], brokers: [], operatingMetrics: { rolling_cost_per_mile: state.cpm } }) }));
vi.mock('@/components/SEOHead', () => ({ default: () => null }));
vi.mock('@/components/RelatedGuidesSection', () => ({ default: () => null }));
vi.mock('@/lib/analytics', () => ({ trackCalculatorUsed: vi.fn() }));
import { WeeklyPulseCard } from '@/components/WeeklyPulseCard';
import LoadProfitCalculator from '@/pages/tools/LoadProfitCalculator';
import TruckingLoadProfitCalculator from '@/pages/TruckingLoadProfitCalculator';

const load = (over: Partial<Load> = {}): Load => ({
  id: 'fixture', user_id: 'driver', load_date: '2026-10-21', dropoff_date: null,
  loaded_miles: 100, deadhead_miles: 20, total_miles: 120,
  estimated_pay: 200, actual_pay_received: null, rate_per_mile: 2,
  status: 'completed', ...over,
} as Load);
const expense = (amount: number, category: string, expense_type?: 'fixed' | 'variable'): Expense => ({
  id: category, user_id: 'driver', expense_date: '2026-10-21', amount, category, expense_type,
} as Expense);
const cash = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
function rowValue(label: string) {
  const nearest = screen.getByText(label).closest('div.flex');
  return (label === 'Contribution Margin' ? nearest?.parentElement : nearest)?.textContent;
}
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });
beforeEach(() => { state.loads = []; state.cpm = undefined; state.loading = false; });

describe('F2 contribution margin recorded-period parity', () => {
  it.each([
    ['logs only', [], [{ total_cost: 50 }], 50],
    ['expense only', [expense(50, 'Fuel')], [], 50],
    ['both', [expense(900, 'Fuel', 'fixed')], [{ total_cost: 50 }], 50],
    ['fuel always variable', [expense(50, 'Fuel', 'fixed')], [], 50],
  ] as const)('%s: canonical fuel is variable and single counted', (_name, fuelExpenses, logs, fuelCost) => {
    const loads = [load({ actual_pay_received: 150 }), load({ id: 'legacy', status: null }),
      ...['pending', 'en_route', 'cancelled'].map(status => load({ status, estimated_pay: 9999 }))];
    const expenses = [...fuelExpenses, expense(100, 'Insurance', 'fixed'), expense(25, 'Tolls')];
    const summary = summarizeFinancialPeriod(loads, expenses, [...logs]);
    render(<ContributionMarginCard loads={loads} expenses={expenses} fuelLogs={[...logs]} />);
    expect(summary.grossRevenue).toBe(350);
    expect(summary.netProfit).toBe(175);
    expect(rowValue('Gross Revenue')).toContain(cash(summary.grossRevenue));
    expect(rowValue('− Variable Costs')).toContain(cash(fuelCost + 25));
    expect(rowValue('− Fixed Overhead')).toContain(cash(100));
    expect(rowValue('Contribution Margin')).toContain(cash(275));
    expect(rowValue('Net Profit')).toContain(cash(summary.netProfit));
    expect(screen.getByText('$1.15/mi')).toBeInTheDocument();
  });
  it('preserves recorded negative expense adjustments and canonical reconciliation', () => {
    const expenses = [expense(-10, 'Insurance', 'fixed'), expense(50, 'Tolls')];
    const summary = summarizeFinancialPeriod([load()], expenses);
    render(<ContributionMarginCard loads={[load()]} expenses={expenses} />);
    expect(summary.expensesTotal).toBe(40);
    expect(rowValue('− Fixed Overhead')).toContain(cash(-10));
    expect(rowValue('Contribution Margin')).toContain(cash(150));
    expect(rowValue('Net Profit')).toContain(cash(160));
  });
  it('does not earn revenue from only operational or cancelled loads', () => {
    const { container } = render(<ContributionMarginCard loads={['pending', 'en_route', 'cancelled'].map(status => load({ status }))} expenses={[expense(50, 'Fuel')]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('keeps zero-mile net valid without division by zero', () => {
    render(<ContributionMarginCard loads={[load({ loaded_miles: 0, deadhead_miles: 0, total_miles: 0 })]} expenses={[expense(50, 'Fuel')]} />);
    expect(rowValue('Net Profit')).toContain(cash(150));
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });
});

describe('F2 public calculator interaction', () => {
  it('withholds the first calculator result until fuel MPG is corrected', () => {
    render(<MemoryRouter><LoadProfitCalculator /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('500'), { target: { value: '1000' } });
    fireEvent.change(screen.getByPlaceholderText('2.50'), { target: { value: '3' } });
    fireEvent.change(screen.getByPlaceholderText('3.50'), { target: { value: '4' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('$3,000.00')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('6.5'), { target: { value: '10' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('$3,000.00')).toBeInTheDocument();
    expect(screen.getByText('−$400.00')).toBeInTheDocument();
    expect(screen.getAllByText('$2,600.00')).toHaveLength(2);
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '-1' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('$3,000.00')).not.toBeInTheDocument();
  });
  it('preserves the second calculator example and clears stale results after input edits', () => {
    render(<MemoryRouter><TruckingLoadProfitCalculator /></MemoryRouter>);
    for (const [placeholder, value] of [['e.g. 3200', '3200'], ['e.g. 1200', '1200'], ['e.g. 1.50', '1.5'], ['e.g. 400', '400'], ['e.g. 100', '100']]) {
      fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(screen.getByText('$2,300.00')).toBeInTheDocument();
    expect(screen.getByText('$900.00')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('e.g. 100'), { target: { value: '-1' } });
    expect(screen.queryByText('$900.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('$900.00')).not.toBeInTheDocument();
  });
});

describe('F2 weekly pulse earned income versus estimated costs', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T12:00:00'));
    state.loads = [load({ actual_pay_received: 150 }), load({ status: null }),
      ...['pending', 'en_route', 'cancelled'].map(status => load({ status, actual_pay_received: 9999 })),
      load({ load_date: '2026-10-26', actual_pay_received: 9999 })];
  });
  it.each([undefined, 0, -1, NaN, Infinity])('does not mistake unknown/invalid CPM %s for zero actual expenses', cpm => {
    state.cpm = cpm;
    render(<MemoryRouter><WeeklyPulseCard isPro /></MemoryRouter>);
    expect(screen.getByText('$350.00')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
  it('uses realized income and operating miles from completed/legacy loads for a labeled estimate', () => {
    state.cpm = 0.5;
    render(<MemoryRouter><WeeklyPulseCard isPro /></MemoryRouter>);
    expect(screen.getByText('$350.00')).toBeInTheDocument();
    expect(screen.getByText('$230.00')).toBeInTheDocument();
    expect(screen.getByText('65.7%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('$350.00')).not.toBeInTheDocument();
    expect(localStorage.getItem('weekly_pulse_dismissed_2026-W44')).toBe('1');
  });
  it('does not expose financial totals without Pro access', () => {
    render(<MemoryRouter><WeeklyPulseCard isPro={false} /></MemoryRouter>);
    expect(screen.queryByText('$350.00')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unlock Weekly Pulse/ })).toBeInTheDocument();
  });
  it('shows no pulse when there are only incomplete loads and no recommendations', () => {
    state.loads = ['pending', 'en_route', 'cancelled'].map(status => load({ status }));
    const { container } = render(<MemoryRouter><WeeklyPulseCard isPro /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});