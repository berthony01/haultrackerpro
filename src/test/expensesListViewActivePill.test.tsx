import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: { week_start_day: 'monday' } }),
}));
vi.mock('@/components/ParkingExportButton', () => ({ ParkingExportButton: () => null }));
vi.mock('@/components/expenses/ExpensesKpiStrip', () => ({ ExpensesKpiStrip: () => null }));
vi.mock('@/components/expenses/ExpensesTable', () => ({ ExpensesTable: () => null }));

import { ExpensesListView } from '@/components/ExpensesListView';

describe('ExpensesListView active pill state', () => {
  it('only one preset pill has aria-pressed=true after clicking Last Week', () => {
    render(
      <ExpensesListView
        expenses={[]}
        loads={[]}
        onEdit={() => {}}
        onDelete={() => {}}
        isLoading={false}
      />
    );

    // Initial state: only "All" is active
    const allBtn = screen.getByRole('button', { name: 'All', pressed: true });
    expect(allBtn).toBeInTheDocument();

    // Click Last Week
    fireEvent.click(screen.getByRole('button', { name: 'Last Week' }));

    const pressed = screen.getAllByRole('button', { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent('Last Week');
  });
});
