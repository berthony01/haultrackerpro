import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import type { Load } from '@/hooks/useLoads';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: null }) }));
vi.mock('@/hooks/useCostProfile', () => ({
  useCostProfile: () => ({ profile: null }),
  computeCostProfileCPM: () => ({ cpm: 0, warnings: [] }),
}));
vi.mock('@/hooks/useProfitCheck', () => ({ useProfitCheck: () => ({ result: null }) }));
vi.mock('@/components/SmartChips', () => ({ SmartChips: () => null }));
vi.mock('@/components/PasteLoadParser', () => ({ PasteLoadParser: () => null }));
vi.mock('@/components/ScanLoadModal', () => ({ ScanLoadModal: () => null }));
vi.mock('@/components/ProfitCheckCard', () => ({ ProfitCheckCard: () => null }));
vi.mock('@/components/MultiStopEditor', () => ({ MultiStopEditor: () => null }));

import { LoadForm } from '@/components/LoadForm';

afterEach(cleanup);

function mount(total: number | null, loaded = 195.45, dh = 7) {
  const onSubmit = vi.fn();
  const initialData = {
    id: 'test-load', load_date: '2026-10-26', dropoff_date: '2026-10-26',
    pickup_location: 'Dallas, TX', dropoff_location: 'Atlanta, GA',
    loaded_miles: loaded, deadhead_miles: dh, total_miles: total,
    rate_per_mile: 1, wait_fee: 0, detention_fee: 0, other_fees: 0,
    status: 'completed', pay_model: 'loaded_miles_only',
  } as Load;
  const view = render(<LoadForm onSubmit={onSubmit} initialData={initialData} />);
  const totalInput = view.getByLabelText(/Total Miles/) as HTMLInputElement;
  return { ...view, onSubmit, totalInput };
}

describe('LoadForm Total Miles reconciliation', () => {
  it.each([20245, 1, 0, 205, 200])('blocks contradictory explicit total %s without overwriting it', total => {
    const view = mount(total);
    fireEvent.click(view.getByTestId('load-form-submit'));
    expect(view.onSubmit).not.toHaveBeenCalled();
    expect(view.totalInput.value).toBe(String(total));
    // The actionable field error is exercised through actual submit, not source inspection.
    expect(view.getByText(/Total Miles must match loaded \+ deadhead miles within 2 miles/)).toBeTruthy();
    fireEvent.change(view.totalInput, { target: { value: '202.45' } });
    fireEvent.click(view.getByTestId('load-form-submit'));
    expect(view.onSubmit).toHaveBeenCalledTimes(1);
    expect(view.onSubmit.mock.calls[0][0].total_miles).toBe(202.45);
  });

  it.each([201.7, 203.2, 200.45, 204.45, null])('permits total %s within tolerance or absent', total => {
    const view = mount(total);
    fireEvent.click(view.getByTestId('load-form-submit'));
    expect(view.onSubmit).toHaveBeenCalledTimes(1);
    expect(view.onSubmit.mock.calls[0][0].total_miles).toBe(total);
  });

  it('preserves legitimate total-only input', () => {
    const view = mount(700, 0, 0);
    fireEvent.click(view.getByTestId('load-form-submit'));
    expect(view.onSubmit).toHaveBeenCalledTimes(1);
    expect(view.onSubmit.mock.calls[0][0].total_miles).toBe(700);
  });
});