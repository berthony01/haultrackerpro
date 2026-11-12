import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DollarSign } from 'lucide-react';
import { computeTrendPct } from '@/components/DashboardView';
import { PremiumKpiCard } from '@/components/premium/PremiumKpiCard';
import { summarizeLoads } from '@/lib/financialCalculations';
import type { Load } from '@/hooks/useLoads';

afterEach(cleanup);

describe('Driver dashboard zero-baseline trend presentation', () => {
  it('omits a fabricated -100% when both current and prior completed-load counts are zero', () => {
    const previousWeek = [{ status: 'cancelled' }] as Load[];
    const currentWeek: Load[] = [];
    const prev = summarizeLoads(previousWeek);
    const current = summarizeLoads(currentWeek);
    expect(prev.loadCount).toBe(0);
    expect(current.loadCount).toBe(0);
    const pct = computeTrendPct(current.loadCount, prev.loadCount);
    expect(pct).toBeNull();
    render(<PremiumKpiCard label="Loads Completed" value="0" icon={DollarSign} trendPct={pct} trendLabel="vs previous week" />);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('Loads Completed: 0');
    expect(screen.queryByText('-100%')).toBeNull();
    expect(screen.queryByText('vs previous week')).toBeNull();
  });

  it('omits a fabricated revenue decline for two periods with no completed revenue', () => {
    const prev = summarizeLoads([{ status: 'pending' }] as Load[]);
    const current = summarizeLoads([] as Load[]);
    expect(prev.grossRevenue).toBe(0);
    expect(current.grossRevenue).toBe(0);
    const pct = computeTrendPct(current.grossRevenue, prev.grossRevenue);
    expect(pct).toBeNull();
    render(<PremiumKpiCard label="Gross Revenue" value="$0.00" icon={DollarSign} trendPct={pct} trendLabel="vs previous week" />);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('Gross Revenue: $0.00');
    expect(screen.queryByText('-100%')).toBeNull();
  });

  it('still displays a legitimate -100% decline when previous completed revenue was positive', () => {
    const pct = computeTrendPct(0, 200);
    expect(pct).toBe(-100);
    render(<PremiumKpiCard label="Gross Revenue" value="$0.00" icon={DollarSign} trendPct={pct} trendLabel="vs previous week" />);
    expect(screen.getByText('-100%')).toBeTruthy();
  });
});
