import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: { week_start_day: 'monday', company_name: 'Test Co' } }),
}));
vi.mock('@/hooks/useLoadStops', () => ({ useLoadStops: () => ({ stops: [] }) }));
vi.mock('@/hooks/useFuelLogs', () => ({ useFuelLogs: () => ({ fuelLogs: [] }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 't@t.com', user_metadata: {} } }),
}));

import { ReportsView } from '@/components/ReportsView';

describe('ReportsView active pill state', () => {
  it('only one preset pill is active and "Showing:" label updates after clicking Last Week', () => {
    render(<ReportsView loads={[]} expenses={[]} isPro={false} />);

    // Initially "All Time" is the derived active pill
    const allTime = screen.getByRole('button', { name: 'All Time', pressed: true });
    expect(allTime).toBeInTheDocument();
    expect(screen.getByText(/Showing: All loads/i)).toBeInTheDocument();

    // Click Last Week
    fireEvent.click(screen.getByRole('button', { name: 'Last Week' }));

    const pressed = screen.getAllByRole('button', { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent('Last Week');

    // Showing label updates away from "All loads"
    expect(screen.queryByText(/Showing: All loads/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^Showing: .+ – .+/)).toBeInTheDocument();
  });
});
