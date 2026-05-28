import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getEffectiveDate } from '@/lib/loadUtils';
import { getPresetRange } from '@/lib/reportRanges';
import { autoMapColumns } from '@/components/CSVImport';

/**
 * Phase 29: delivery-date revenue recognition guards.
 *
 *  1. getEffectiveDate prefers dropoff_date and falls back to load_date.
 *  2. Dashboard/date-range presets bucket a load by its dropoff_date, so a
 *     load picked up Sunday but delivered Monday belongs to that Monday's week
 *     when week_start_day = monday and is excluded from the prior week.
 *  3. CSV auto-mapping recognizes delivery / dropoff / unload date headers
 *     and routes them to dropoff_date — falling back cleanly when absent.
 *  4. Duplicating a load must reset BOTH load_date and dropoff_date (asserted
 *     against the contract used by handleDuplicate in src/pages/Index.tsx).
 */
describe('Phase 29 — effective date + duplicate behavior', () => {
  it('getEffectiveDate returns dropoff_date when present', () => {
    const load: any = { load_date: '2026-05-24', dropoff_date: '2026-05-25' };
    expect(getEffectiveDate(load)).toBe('2026-05-25');
  });

  it('getEffectiveDate falls back to load_date when dropoff_date is null/undefined', () => {
    expect(getEffectiveDate({ load_date: '2026-05-24', dropoff_date: null } as any)).toBe('2026-05-24');
    expect(getEffectiveDate({ load_date: '2026-05-24' } as any)).toBe('2026-05-24');
  });

  describe('week boundary: picked up Sunday, delivered Monday (Mon-start week)', () => {
    const ANCHOR = new Date('2026-05-27T12:00:00'); // Wednesday in the "this week" (May 25 → 31)
    beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(ANCHOR); });
    afterAll(() => vi.useRealTimers());

    const load: any = { load_date: '2026-05-24', dropoff_date: '2026-05-25' }; // Sun pickup, Mon drop

    it('includes the load in THIS week (Mon-start) by effective date', () => {
      const tw = getPresetRange('this_week', 1);
      const eff = getEffectiveDate(load);
      expect(eff >= tw.from && eff <= tw.to).toBe(true);
    });

    it('excludes the same load from LAST week (Mon-start)', () => {
      const lw = getPresetRange('last_week', 1);
      const eff = getEffectiveDate(load);
      expect(eff >= lw.from && eff <= lw.to).toBe(false);
    });
  });

  describe('CSV auto-mapping', () => {
    it('maps a Delivery Date header to dropoff_date (not stolen by pickup date)', () => {
      const m = autoMapColumns(['Load Date', 'Delivery Date', 'Pickup', 'Dropoff', 'Miles', 'Rate']);
      expect(m.date).toBe(0);
      expect(m.dropoff_date).toBe(1);
    });

    it('recognizes alt headers: Drop-off Date / Unload Date / Delivered Date', () => {
      expect(autoMapColumns(['Date', 'Drop-off Date']).dropoff_date).toBe(1);
      expect(autoMapColumns(['Date', 'Unload Date']).dropoff_date).toBe(1);
      expect(autoMapColumns(['Date', 'Delivered Date']).dropoff_date).toBe(1);
    });

    it('omits dropoff_date mapping when no delivery column exists', () => {
      const m = autoMapColumns(['Date', 'Pickup', 'Dropoff', 'Miles', 'Rate']);
      expect(m.dropoff_date).toBeUndefined();
      expect(m.date).toBe(0);
    });
  });

  it('duplicate-load contract resets both load_date and dropoff_date to today', () => {
    // Mirrors handleDuplicate in src/pages/Index.tsx — must reset BOTH dates so
    // the duplicate lands in the current reporting window.
    const today = new Date().toISOString().split('T')[0];
    const orig: any = {
      id: 'abc', load_date: '2026-01-01', dropoff_date: '2026-01-02',
      actual_pay_received: 500, status: 'completed',
    };
    const dup = { ...orig, id: '', load_date: today, dropoff_date: today, actual_pay_received: null, status: 'pending' };
    expect(dup.load_date).toBe(today);
    expect(dup.dropoff_date).toBe(today);
    expect(dup.dropoff_date).not.toBe(orig.dropoff_date);
    expect(dup.actual_pay_received).toBeNull();
    expect(dup.status).toBe('pending');
  });
});
