import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getTrendSuffix } from '@/components/DashboardView';
import { PremiumKpiCard } from '@/components/premium/PremiumKpiCard';
import { DollarSign } from 'lucide-react';

describe('Dashboard trend suffix mapping', () => {
  it('this_week -> vs previous week', () => {
    expect(getTrendSuffix('this_week')).toBe('vs previous week');
  });
  it('last_week -> vs previous week', () => {
    expect(getTrendSuffix('last_week')).toBe('vs previous week');
  });
  it('this_month -> vs previous month', () => {
    expect(getTrendSuffix('this_month')).toBe('vs previous month');
  });
  it('last_month -> vs previous month', () => {
    expect(getTrendSuffix('last_month')).toBe('vs previous month');
  });
  it('this_year -> vs previous year', () => {
    expect(getTrendSuffix('this_year')).toBe('vs previous year');
  });
  it('custom -> vs previous period', () => {
    expect(getTrendSuffix('custom')).toBe('vs previous period');
  });
});

describe('PremiumKpiCard suffix rendering', () => {
  it('renders Dashboard-supplied suffix when provided (This Week)', () => {
    render(<PremiumKpiCard label="Gross Revenue" value="$100" icon={DollarSign} trendPct={5} trendLabel={getTrendSuffix('this_week')} />);
    expect(screen.getByText('vs previous week')).toBeInTheDocument();
  });
  it('renders previous month suffix for This Month', () => {
    render(<PremiumKpiCard label="Net Profit" value="$100" icon={DollarSign} trendPct={5} trendLabel={getTrendSuffix('this_month')} />);
    expect(screen.getByText('vs previous month')).toBeInTheDocument();
  });
  it('renders previous month for Last Month', () => {
    render(<PremiumKpiCard label="Net Profit" value="$100" icon={DollarSign} trendPct={5} trendLabel={getTrendSuffix('last_month')} />);
    expect(screen.getByText('vs previous month')).toBeInTheDocument();
  });
  it('renders previous period for Custom', () => {
    render(<PremiumKpiCard label="Net Profit" value="$100" icon={DollarSign} trendPct={5} trendLabel={getTrendSuffix('custom')} />);
    expect(screen.getByText('vs previous period')).toBeInTheDocument();
  });
  it('renders previous week for Last Week', () => {
    render(<PremiumKpiCard label="Net Profit" value="$100" icon={DollarSign} trendPct={5} trendLabel={getTrendSuffix('last_week')} />);
    expect(screen.getByText('vs previous week')).toBeInTheDocument();
  });
  it('default behavior unchanged for non-Dashboard consumers (no suffix prop -> "vs last week")', () => {
    render(<PremiumKpiCard label="Gross Revenue" value="$100" icon={DollarSign} trendPct={5} />);
    expect(screen.getByText('vs last week')).toBeInTheDocument();
  });
});
