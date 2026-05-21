import { describe, it, expect } from 'vitest';
import {
  isValidISODate,
  applySourceLoadDate,
  applySourceDropoffDate,
} from '@/lib/sourceDate';

describe('Phase 6C.6 — Source Date Authority', () => {
  const TODAY = '2026-05-21';

  describe('isValidISODate', () => {
    it('accepts well-formed YYYY-MM-DD', () => {
      expect(isValidISODate('2026-05-21')).toBe(true);
      expect(isValidISODate('2024-02-29')).toBe(true); // leap day
    });
    it('rejects invalid calendar dates', () => {
      expect(isValidISODate('2025-02-29')).toBe(false);
      expect(isValidISODate('2025-13-01')).toBe(false);
      expect(isValidISODate('2025-00-10')).toBe(false);
    });
    it('rejects wrong shapes and non-strings', () => {
      expect(isValidISODate('05/21/2026')).toBe(false);
      expect(isValidISODate('2026-5-21')).toBe(false);
      expect(isValidISODate('')).toBe(false);
      expect(isValidISODate(undefined)).toBe(false);
      expect(isValidISODate(null)).toBe(false);
      expect(isValidISODate(20260521)).toBe(false);
    });
  });

  describe('applySourceLoadDate (paste & OCR)', () => {
    it('valid source date overrides today default', () => {
      expect(applySourceLoadDate(TODAY, '2026-04-10')).toBe('2026-04-10');
    });
    it('missing source date keeps current/default', () => {
      expect(applySourceLoadDate(TODAY, undefined)).toBe(TODAY);
      expect(applySourceLoadDate(TODAY, null)).toBe(TODAY);
      expect(applySourceLoadDate(TODAY, '')).toBe(TODAY);
    });
    it('invalid source date does not overwrite current', () => {
      expect(applySourceLoadDate(TODAY, 'not-a-date')).toBe(TODAY);
      expect(applySourceLoadDate(TODAY, '2025-13-40')).toBe(TODAY);
      expect(applySourceLoadDate('2026-03-01', '05/21/2026')).toBe('2026-03-01');
    });
    it('preserves a manually edited current when source missing', () => {
      expect(applySourceLoadDate('2026-01-15', undefined)).toBe('2026-01-15');
    });
  });

  describe('applySourceDropoffDate', () => {
    it('valid source dropoff applies', () => {
      expect(applySourceDropoffDate('', '2026-04-12')).toBe('2026-04-12');
    });
    it('does not invent a dropoff when source missing', () => {
      expect(applySourceDropoffDate('', undefined)).toBe('');
      expect(applySourceDropoffDate('', '')).toBe('');
    });
    it('invalid dropoff does not overwrite current', () => {
      expect(applySourceDropoffDate('2026-04-12', 'bogus')).toBe('2026-04-12');
    });
    it('valid dropoff overrides an existing value (intentional new parse)', () => {
      expect(applySourceDropoffDate('2026-04-12', '2026-04-15')).toBe('2026-04-15');
    });
  });

  describe('effective date rule remains dropoff_date ?? load_date', () => {
    it('uses dropoff when present, falls back to load_date', () => {
      const load = applySourceLoadDate(TODAY, '2026-04-10');
      const drop = applySourceDropoffDate('', '2026-04-12');
      const effective = drop || load;
      expect(effective).toBe('2026-04-12');

      const dropEmpty = applySourceDropoffDate('', undefined);
      const effective2 = dropEmpty || load;
      expect(effective2).toBe('2026-04-10');
    });
  });
});
