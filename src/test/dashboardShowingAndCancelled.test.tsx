import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  startOfWeek, endOfWeek, format, subWeeks,
} from 'date-fns';
import { getShowingLabel, getCancelledFootnote } from '@/components/DashboardView';

const FIXED_NOW = new Date(2026, 4, 21); // May 21, 2026 (Thu)

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe('Dashboard getShowingLabel', () => {
  it('(a) This Week → Mon–Sun of current week (weekStartsOn=1)', () => {
    const label = getShowingLabel('this_week', 1, undefined, undefined, FIXED_NOW);
    const s = startOfWeek(FIXED_NOW, { weekStartsOn: 1 });
    const e = endOfWeek(FIXED_NOW, { weekStartsOn: 1 });
    expect(label).toBe(`Showing: ${format(s, 'MMM d, yyyy')} - ${format(e, 'MMM d, yyyy')}`);
    expect(label).toMatch(/^Showing: /);
  });

  it('(b) Last Week with weekStartsOn=1 today=May 21, 2026 → May 11 - May 17, 2026', () => {
    const label = getShowingLabel('last_week', 1, undefined, undefined, FIXED_NOW);
    expect(label).toBe('Showing: May 11, 2026 - May 17, 2026');
  });

  it('(c) This Month → contains May and 2026', () => {
    const label = getShowingLabel('this_month', 0, undefined, undefined, FIXED_NOW);
    expect(label).toContain('Showing:');
    expect(label).toContain('May');
    expect(label).toContain('2026');
  });

  it('(d) This Year → Jan 1, 2026 - Dec 31, 2026', () => {
    const label = getShowingLabel('this_year', 0, undefined, undefined, FIXED_NOW);
    expect(label).toBe('Showing: Jan 1, 2026 - Dec 31, 2026');
  });

  it('(e) Custom with picked start/end renders both dates', () => {
    const label = getShowingLabel('custom', 0, '2026-03-04', '2026-04-09', FIXED_NOW);
    expect(label).toBe('Showing: Mar 4, 2026 - Apr 9, 2026');
  });

  it('also covers: Last Month → previous month start/end', () => {
    // Sanity: April 2026
    const label = getShowingLabel('last_month', 0, undefined, undefined, FIXED_NOW);
    // subWeeks not used here; just structural check
    expect(label).toBe('Showing: Apr 1, 2026 - Apr 30, 2026');
    // silence unused import lint
    void subWeeks;
  });
});

describe('Dashboard getCancelledFootnote', () => {
  it('(f) N=1 → singular "cancelled load excluded"', () => {
    expect(getCancelledFootnote(1)).toBe('1 cancelled load excluded');
  });
  it('(g) N=2 → plural "cancelled loads excluded"', () => {
    expect(getCancelledFootnote(2)).toBe('2 cancelled loads excluded');
  });
  it('(h) N=0 → null (hidden)', () => {
    expect(getCancelledFootnote(0)).toBeNull();
  });
});

describe('Dashboard footnote renders conditionally (RTL)', () => {
  function Footnote({ n }: { n: number }) {
    const f = getCancelledFootnote(n);
    return f ? <p data-testid="footnote">{f}</p> : null;
  }
  it('renders singular for N=1', () => {
    render(<Footnote n={1} />);
    expect(screen.getByTestId('footnote').textContent).toBe('1 cancelled load excluded');
  });
  it('renders plural for N=2', () => {
    render(<Footnote n={2} />);
    expect(screen.getByTestId('footnote').textContent).toBe('2 cancelled loads excluded');
  });
  it('renders nothing for N=0', () => {
    render(<Footnote n={0} />);
    expect(screen.queryByTestId('footnote')).toBeNull();
  });
});
