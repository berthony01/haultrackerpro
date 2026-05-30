import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MultiStopEditor } from '@/components/MultiStopEditor';

describe('Phase 29A — MultiStopEditor stop_date input', () => {
  it('renders a Stop Date input for each stop and propagates changes', () => {
    const stops = [
      { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup', detention_minutes: null, stop_date: null },
      { stop_order: 2, location: 'Atlanta, GA', stop_type: 'Drop', detention_minutes: null, stop_date: null },
    ];
    const onChange = vi.fn();
    render(<MultiStopEditor stops={stops} onChange={onChange} />);

    const dateInputs = screen.getAllByPlaceholderText('MM/DD/YYYY');
    expect(dateInputs.length).toBe(2);

    fireEvent.change(dateInputs[1], { target: { value: '05/30/2026' } });
    fireEvent.blur(dateInputs[1]);

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall[1].stop_date).toBe('2026-05-30');
  });

  it('marks the Drop row with the "controls reporting" hint', () => {
    const stops = [
      { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup', detention_minutes: null, stop_date: null },
      { stop_order: 2, location: 'Atlanta, GA', stop_type: 'Drop', detention_minutes: null, stop_date: null },
    ];
    render(<MultiStopEditor stops={stops} onChange={() => {}} />);
    expect(screen.getByText(/controls reporting/i)).toBeTruthy();
  });
});
