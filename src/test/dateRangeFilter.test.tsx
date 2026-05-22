import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  startOfQuarter, endOfQuarter, subWeeks, subMonths, subQuarters, subYears, format,
} from 'date-fns';

vi.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: { week_start_day: 'monday' } }),
}));

import { DateRangeFilter } from '@/components/DateRangeFilter';

const wso = 1 as const;
const now = new Date();
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

const PRESETS: Array<{ label: string; from?: string; to?: string }> = [
  { label: 'This Week', from: ymd(startOfWeek(now, { weekStartsOn: wso })), to: ymd(endOfWeek(now, { weekStartsOn: wso })) },
  { label: 'Last Week', from: ymd(startOfWeek(subWeeks(now, 1), { weekStartsOn: wso })), to: ymd(endOfWeek(subWeeks(now, 1), { weekStartsOn: wso })) },
  { label: 'This Month', from: ymd(startOfMonth(now)), to: ymd(endOfMonth(now)) },
  { label: 'Last Month', from: ymd(startOfMonth(subMonths(now, 1))), to: ymd(endOfMonth(subMonths(now, 1))) },
  { label: 'Current Quarter', from: ymd(startOfQuarter(now)), to: ymd(endOfQuarter(now)) },
  { label: 'Previous Quarter', from: ymd(startOfQuarter(subQuarters(now, 1))), to: ymd(endOfQuarter(subQuarters(now, 1))) },
  { label: 'Year to Date', from: ymd(startOfYear(now)), to: ymd(now) },
  { label: 'Last Year', from: ymd(startOfYear(subYears(now, 1))), to: ymd(endOfYear(subYears(now, 1))) },
  { label: 'All Time', from: undefined, to: undefined },
];

describe('DateRangeFilter', () => {
  it('renders all expected preset pills plus Custom Range', () => {
    render(<DateRangeFilter onRangeChange={() => {}} />);
    for (const p of PRESETS) {
      expect(screen.getByRole('button', { name: p.label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Custom Range' })).toBeInTheDocument();
  });

  it('drives aria-pressed entirely from currentRange — exactly one pill active per preset', () => {
    for (const p of PRESETS) {
      const { unmount } = render(
        <DateRangeFilter onRangeChange={() => {}} currentRange={{ from: p.from, to: p.to }} />
      );
      const pressed = screen.getAllByRole('button', { pressed: true });
      expect(pressed).toHaveLength(1);
      expect(pressed[0]).toHaveTextContent(p.label);
      unmount();
    }
  });

  it('marks Custom pill pressed when currentRange does not match any preset', () => {
    render(
      <DateRangeFilter onRangeChange={() => {}} currentRange={{ from: '2020-01-02', to: '2020-01-15' }} />
    );
    const pressed = screen.getAllByRole('button', { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent('Custom Range');
  });

  it('clicking a preset calls onRangeChange with that preset’s yyyy-MM-dd strings', () => {
    const onRangeChange = vi.fn();
    render(<DateRangeFilter onRangeChange={onRangeChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Last Week' }));
    const lw = PRESETS.find(p => p.label === 'Last Week')!;
    expect(onRangeChange).toHaveBeenCalledWith(lw.from, lw.to);
  });

  it('clicking All Time calls onRangeChange with (undefined, undefined)', () => {
    const onRangeChange = vi.fn();
    render(<DateRangeFilter onRangeChange={onRangeChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'All Time' }));
    expect(onRangeChange).toHaveBeenCalledWith(undefined, undefined);
  });

  it('keyboard activation (Enter and Space) triggers onRangeChange', async () => {
    const onRangeChange = vi.fn();
    const user = userEvent.setup();
    render(<DateRangeFilter onRangeChange={onRangeChange} />);

    const btn = screen.getByRole('button', { name: 'This Month' });
    btn.focus();
    expect(btn).toHaveFocus();
    await user.keyboard('{Enter}');
    const tm = PRESETS.find(p => p.label === 'This Month')!;
    expect(onRangeChange).toHaveBeenCalledWith(tm.from, tm.to);

    onRangeChange.mockClear();
    const btn2 = screen.getByRole('button', { name: 'This Week' });
    btn2.focus();
    await user.keyboard(' ');
    const tw = PRESETS.find(p => p.label === 'This Week')!;
    expect(onRangeChange).toHaveBeenCalledWith(tw.from, tw.to);
  });

  it('custom-range path emits raw YYYY-MM-DD strings exactly as typed (no Date conversion)', () => {
    const onRangeChange = vi.fn();
    render(<DateRangeFilter onRangeChange={onRangeChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Custom Range' }));

    const inputs = document.querySelectorAll('input[type="date"]');
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0], { target: { value: '2026-05-11' } });
    fireEvent.change(inputs[1], { target: { value: '2026-05-17' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onRangeChange).toHaveBeenCalledWith('2026-05-11', '2026-05-17');
    // Strict: arguments are raw strings, not Date objects
    const [from, to] = onRangeChange.mock.calls[0];
    expect(typeof from).toBe('string');
    expect(typeof to).toBe('string');
  });

  it('accessibility: each preset button has accessible name matching its visible label and uses aria-pressed', () => {
    render(
      <DateRangeFilter
        onRangeChange={() => {}}
        currentRange={{ from: PRESETS[1].from, to: PRESETS[1].to }} // Last Week
      />
    );
    for (const p of PRESETS) {
      const btn = screen.getByRole('button', { name: p.label });
      expect(btn).toHaveAttribute('aria-pressed');
      expect(btn).toHaveAccessibleName(p.label);
    }
    const activeBtn = screen.getByRole('button', { name: 'Last Week' });
    expect(activeBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
