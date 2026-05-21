import { describe, it, expect } from 'vitest';
import {
  isValidISODate,
  isWithinSanityWindow,
  applySourceLoadDate,
  applySourceDropoffDate,
} from '@/lib/sourceDate';

describe('Phase 6C.6 — Source Date Authority', () => {
  const TODAY = '2026-05-21';
  const NOW = new Date('2026-05-21T12:00:00');

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
    it('valid in-window source date overrides today default', () => {
      expect(applySourceLoadDate(TODAY, '2026-04-10', NOW)).toBe('2026-04-10');
    });
    it('missing source date keeps current/default', () => {
      expect(applySourceLoadDate(TODAY, undefined, NOW)).toBe(TODAY);
      expect(applySourceLoadDate(TODAY, null, NOW)).toBe(TODAY);
      expect(applySourceLoadDate(TODAY, '', NOW)).toBe(TODAY);
    });
    it('invalid source date does not overwrite current', () => {
      expect(applySourceLoadDate(TODAY, 'not-a-date', NOW)).toBe(TODAY);
      expect(applySourceLoadDate(TODAY, '2025-13-40', NOW)).toBe(TODAY);
      expect(applySourceLoadDate('2026-03-01', '05/21/2026', NOW)).toBe('2026-03-01');
    });
  });

  describe('applySourceDropoffDate', () => {
    it('valid in-window source dropoff applies', () => {
      expect(applySourceDropoffDate('', '2026-04-12', NOW)).toBe('2026-04-12');
    });
    it('does not invent a dropoff when source missing', () => {
      expect(applySourceDropoffDate('', undefined, NOW)).toBe('');
      expect(applySourceDropoffDate('', '', NOW)).toBe('');
    });
    it('invalid dropoff does not overwrite current', () => {
      expect(applySourceDropoffDate('2026-04-12', 'bogus', NOW)).toBe('2026-04-12');
    });
    it('valid in-window dropoff overrides an existing value (intentional new parse)', () => {
      expect(applySourceDropoffDate('2026-04-12', '2026-04-15', NOW)).toBe('2026-04-15');
    });
  });

  describe('effective date rule remains dropoff_date ?? load_date', () => {
    it('uses dropoff when present, falls back to load_date', () => {
      const load = applySourceLoadDate(TODAY, '2026-04-10', NOW);
      const drop = applySourceDropoffDate('', '2026-04-12', NOW);
      expect((drop || load)).toBe('2026-04-12');

      const dropEmpty = applySourceDropoffDate('', undefined, NOW);
      expect((dropEmpty || load)).toBe('2026-04-10');
    });
  });
});

describe('Phase 6C.8 — Temporal sanity guard', () => {
  const TODAY = '2026-05-21';
  const NOW = new Date('2026-05-21T12:00:00');

  describe('isWithinSanityWindow', () => {
    it('accepts today, recent past, and near future', () => {
      expect(isWithinSanityWindow('2026-05-21', NOW)).toBe(true);
      expect(isWithinSanityWindow('2026-04-01', NOW)).toBe(true); // ~50d ago
      expect(isWithinSanityWindow('2026-06-10', NOW)).toBe(true); // ~20d ahead
    });
    it('rejects dates older than 60 days (AI year hallucination)', () => {
      expect(isWithinSanityWindow('2024-05-17', NOW)).toBe(false);
      expect(isWithinSanityWindow('2026-03-01', NOW)).toBe(false); // ~81d ago
    });
    it('rejects dates further than 30 days in the future', () => {
      expect(isWithinSanityWindow('2026-07-15', NOW)).toBe(false);
      expect(isWithinSanityWindow('2027-01-01', NOW)).toBe(false);
    });
    it('rejects invalid ISO outright', () => {
      expect(isWithinSanityWindow('bogus', NOW)).toBe(false);
    });
  });

  describe('applySourceLoadDate sanity rejection', () => {
    it('rejects 2-year-old hallucinated date and keeps today default', () => {
      // Exact scenario observed in production DB: AI returned 2024-05-17.
      expect(applySourceLoadDate(TODAY, '2024-05-17', NOW)).toBe(TODAY);
    });
    it('rejects far-future date', () => {
      expect(applySourceLoadDate(TODAY, '2030-01-01', NOW)).toBe(TODAY);
    });
    it('still accepts a legitimate recent source date', () => {
      expect(applySourceLoadDate(TODAY, '2026-05-19', NOW)).toBe('2026-05-19');
    });
  });

  describe('applySourceDropoffDate sanity rejection', () => {
    it('rejects 2-year-old hallucinated dropoff', () => {
      expect(applySourceDropoffDate('', '2024-05-17', NOW)).toBe('');
    });
  });
});
