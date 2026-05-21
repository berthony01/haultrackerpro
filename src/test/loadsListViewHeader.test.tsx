import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useLoadStops', () => ({ useLoadStops: () => ({ stops: [] }) }));
vi.mock('@/components/LoadCard', () => ({ LoadCard: () => null, LoadCardSkeleton: () => null }));
vi.mock('@/components/LoadDetailSheet', () => ({ LoadDetailSheet: () => null }));
vi.mock('@/components/DateRangeFilter', () => ({ DateRangeFilter: () => null }));
vi.mock('@/components/loads/LoadsTable', () => ({ LoadsTable: () => null }));

import { LoadsListView } from '@/components/LoadsListView';
import { LoadsKpiStrip } from '@/components/loads/LoadsKpiStrip';

function makeLoad(overrides: Partial<any> = {}): any {
  return {
    id: overrides.id ?? Math.random().toString(),
    user_id: 'u',
    load_date: '2026-05-12',
    dropoff_date: '2026-05-12',
    pickup_location: 'Dallas, TX',
    dropoff_location: 'Atlanta, GA',
    status: 'completed',
    payment_status: 'paid',
    loaded_miles: 100,
    deadhead_miles: 0,
    rate_per_mile: 2,
    gross_revenue: 200,
    estimated_pay: 200,
    actual_pay_received: 200,
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  };
}

const noop = () => {};

describe('LoadsListView header count wording', () => {
  it('shows "X total · Y counted" + "excludes cancelled" when totals differ', () => {
    const loads = [
      makeLoad({ id: '1', status: 'completed' }),
      makeLoad({ id: '2', status: 'completed' }),
      makeLoad({ id: '3', status: 'cancelled' }),
    ];
    render(
      <LoadsListView
        loads={loads}
        onEdit={noop}
        onDelete={noop}
        onUpdate={noop}
        onDuplicate={noop}
        onDateRangeChange={noop}
      />
    );
    expect(screen.getByText(/3 total · 2 counted/)).toBeInTheDocument();
    expect(screen.getByText(/excludes cancelled/)).toBeInTheDocument();
  });

  it('shows single-number wording with no helper when totals match', () => {
    const loads = [makeLoad({ id: '1' }), makeLoad({ id: '2' })];
    render(
      <LoadsListView
        loads={loads}
        onEdit={noop}
        onDelete={noop}
        onUpdate={noop}
        onDuplicate={noop}
        onDateRangeChange={noop}
      />
    );
    expect(screen.getByText(/^2 loads$/)).toBeInTheDocument();
    expect(screen.queryByText(/excludes cancelled/)).toBeNull();
  });
});

describe('LoadsKpiStrip Loads tile tooltip trigger', () => {
  it('exposes an accessible info trigger whose label mentions excludes cancelled', () => {
    render(<LoadsKpiStrip loads={[makeLoad()]} />);
    const trigger = screen.getByRole('button', { name: /excludes cancelled loads/i });
    expect(trigger).toBeInTheDocument();
  });
});
