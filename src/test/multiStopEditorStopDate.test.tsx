import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MultiStopEditor } from '@/components/MultiStopEditor';

describe('Phase 29A — MultiStopEditor stop_date input', () => {
  it('renders a Stop Date input for each stop', () => {
    const stops = [
      { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup', detention_minutes: null, stop_date: null },
      { stop_order: 2, location: 'Atlanta, GA', stop_type: 'Drop', detention_minutes: null, stop_date: null },
    ];
    render(<MultiStopEditor stops={stops} onChange={() => {}} />);
    const dateButtons = screen.getAllByText('MM/DD/YYYY');
    expect(dateButtons.length).toBe(2);
  });

  it('marks the Drop row with the "controls reporting" hint', () => {
    const stops = [
      { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup', detention_minutes: null, stop_date: null },
      { stop_order: 2, location: 'Atlanta, GA', stop_type: 'Drop', detention_minutes: null, stop_date: null },
    ];
    render(<MultiStopEditor stops={stops} onChange={() => {}} />);
    expect(screen.getByText(/controls reporting/i)).toBeTruthy();
  });

  it('shows existing stop_date as MM/DD/YYYY label on the button', () => {
    const stops = [
      { stop_order: 1, location: 'Dallas, TX', stop_type: 'Drop', detention_minutes: null, stop_date: '2026-05-30' },
    ];
    render(<MultiStopEditor stops={stops} onChange={() => {}} />);
    expect(screen.getByText('05/30/2026')).toBeTruthy();
  });
});
