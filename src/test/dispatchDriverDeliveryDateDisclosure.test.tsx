/**
 * Characterization regression for Telegram/dispatcher Delivered status without
 * an actual delivery date. Dispatch UI already labels this as unconfirmed.
 * Driver views must be just as explicit; this does NOT change finance math.
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LoadCard } from '@/components/LoadCard';
import { LoadDetailSheet } from '@/components/LoadDetailSheet';
import type { Load } from '@/hooks/useLoads';

vi.mock('@/components/ui/sheet', () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Sheet: Wrap,
    SheetContent: Wrap,
    SheetHeader: Wrap,
    SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  };
});

afterEach(cleanup);

const fixture = (changes: Partial<Load> = {}): Load => ({
  id: 'dispatch-test-load',
  user_id: 'driver-test',
  status: 'completed',
  carrier_driver_relationship_id: 'company-driver-relationship',
  dispatch_company_name: 'QA Company',
  load_reference: 'QA-DATE-1',
  load_date: '2026-11-01',
  dropoff_date: null,
  actual_delivery_date: null,
  pickup_location: 'Dallas, TX',
  dropoff_location: 'Austin, TX',
  loaded_miles: 100,
  deadhead_miles: 10,
  total_miles: 110,
  rate_per_mile: 2,
  estimated_pay: 200,
  actual_pay_received: null,
  wait_fee: 0,
  detention_fee: 0,
  other_fees: 0,
  payment_status: 'unpaid',
  notes: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...changes,
} as unknown as Load);

const noop = vi.fn();

const card = (load: Load) => render(
  <LoadCard load={load} onEdit={noop} onDelete={noop} onTap={noop} />,
);

const detail = (load: Load) => render(
  <LoadDetailSheet
    load={load}
    open
    onOpenChange={noop}
    onEdit={noop}
    onDelete={noop}
    onUpdate={noop}
    onDuplicate={noop}
  />,
);

describe('Driver disclosure for company dispatch delivery dates', () => {
  it('flags a completed company load with no confirmed actual delivery date on its load card', () => {
    card(fixture());
    expect(screen.getByText('Delivery date unconfirmed')).toBeTruthy();
  });

  it('explains the pickup-date fallback when no scheduled delivery date exists', () => {
    detail(fixture());
    expect(screen.getByText(/Actual delivery date unconfirmed/)).toBeTruthy();
    expect(screen.getByText(/Reports currently use the pickup date until a confirmed date is recorded/)).toBeTruthy();
  });

  it('explains the scheduled-date fallback when only a planned dropoff exists', () => {
    detail(fixture({ dropoff_date: '2026-11-03' }));
    expect(screen.getByText(/Reports currently use the scheduled delivery date until a confirmed date is recorded/)).toBeTruthy();
  });

  it('does not flag company loads with a confirmed actual delivery date', () => {
    const load = fixture({ actual_delivery_date: '2026-11-03' });
    card(load);
    expect(screen.queryByText('Delivery date unconfirmed')).toBeNull();
    cleanup();
    detail(load);
    expect(screen.queryByText(/Actual delivery date unconfirmed/)).toBeNull();
    expect(screen.getByText(/Actual delivery:/)).toBeTruthy();
  });

  it('does not flag ordinary personal loads or unfinished company assignments', () => {
    card(fixture({ carrier_driver_relationship_id: null }));
    expect(screen.queryByText('Delivery date unconfirmed')).toBeNull();
    cleanup();
    card(fixture({ status: 'pending' }));
    expect(screen.queryByText('Delivery date unconfirmed')).toBeNull();
  });
});
