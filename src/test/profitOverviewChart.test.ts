import { describe, it, expect } from 'vitest';
import { computeDailyNetProfit } from '@/components/premium/ProfitOverviewChart';

describe('computeDailyNetProfit (Profit Overview per-day)', () => {
  it('returns -80 when revenue=0 and expenses=80', () => {
    expect(computeDailyNetProfit(0, 80)).toBe(-80);
  });

  it('returns 70 when revenue=100 and expenses=30', () => {
    expect(computeDailyNetProfit(100, 30)).toBe(70);
  });
});
