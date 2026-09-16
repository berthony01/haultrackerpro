import { describe, expect, it } from 'vitest';
import {
  evaluateKnownOpportunityQualification,
  normalizeCdlClass,
  normalizeEndorsementCode,
  SUPPORTED_ENDORSEMENT_CODES,
} from '@/lib/opportunities/opportunityQualification';

/**
 * Phase CF-1C-A — pure structured qualification evaluator contract.
 */
describe('CF-1C-A structured qualification evaluator', () => {
  it('1) returns no_structured_criteria when the opportunity declares none', () => {
    const r = evaluateKnownOpportunityQualification({}, { years_experience: 5, cdl_class: 'A' });
    expect(r.status).toBe('no_structured_criteria');
    expect(r.evaluated).toHaveLength(0);
    expect(r.manualReviewRequired).toBe(false);
  });

  it('1b) empty required_endorsements array is not a structured criterion', () => {
    const r = evaluateKnownOpportunityQualification({ required_endorsements: [] }, {});
    expect(r.status).toBe('no_structured_criteria');
  });

  it('2) experience meets the minimum', () => {
    const r = evaluateKnownOpportunityQualification(
      { min_years_experience: 2 },
      { years_experience: 3 },
    );
    expect(r.status).toBe('meets_known_criteria');
    expect(r.met.map((c) => c.key)).toEqual(['experience']);
  });

  it('3) experience below the minimum fails', () => {
    const r = evaluateKnownOpportunityQualification(
      { min_years_experience: '2' },
      { years_experience: 1 },
    );
    expect(r.status).toBe('does_not_meet_known_criteria');
    expect(r.failed.map((c) => c.key)).toEqual(['experience']);
  });

  it('3b) experience exactly equal to the minimum passes', () => {
    const r = evaluateKnownOpportunityQualification(
      { min_years_experience: 2 },
      { years_experience: '2' },
    );
    expect(r.status).toBe('meets_known_criteria');
  });

  it('4) missing driver experience is unknown, never assumed', () => {
    for (const years of [null, undefined, '']) {
      const r = evaluateKnownOpportunityQualification(
        { min_years_experience: 2 },
        { years_experience: years as never },
      );
      expect(r.status).toBe('needs_driver_information');
      expect(r.unknown.map((c) => c.key)).toEqual(['experience']);
    }
  });

  it('5) invalid numeric experience is handled fail-closed as unknown', () => {
    for (const bad of ['about five', Number.NaN, 'N/A', {}]) {
      const r = evaluateKnownOpportunityQualification(
        { min_years_experience: 2 },
        { years_experience: bad as never },
      );
      expect(r.status).toBe('needs_driver_information');
      expect(r.met).toHaveLength(0);
      expect(r.failed).toHaveLength(0);
    }
  });

  it('6) CDL class normalization handles labeled and raw values', () => {
    expect(normalizeCdlClass('A')).toBe('A');
    expect(normalizeCdlClass('Class A')).toBe('A');
    expect(normalizeCdlClass('class b')).toBe('B');
    expect(normalizeCdlClass('CDL C')).toBe('C');
    expect(normalizeCdlClass('Class D')).toBeNull();
    expect(normalizeCdlClass(null)).toBeNull();
    expect(normalizeCdlClass(7 as never)).toBeNull();
  });

  it('7) CDL hierarchy: A covers A/B/C, B covers B/C not A, C covers C only', () => {
    const table: Array<[string, string, 'met' | 'failed']> = [
      ['Class A', 'A', 'met'],
      ['Class A', 'B', 'met'],
      ['Class A', 'C', 'met'],
      ['Class B', 'A', 'failed'],
      ['Class B', 'B', 'met'],
      ['Class B', 'C', 'met'],
      ['Class C', 'A', 'failed'],
      ['Class C', 'B', 'failed'],
      ['Class C', 'C', 'met'],
    ];
    for (const [driverClass, requiredClass, outcome] of table) {
      const r = evaluateKnownOpportunityQualification(
        { required_cdl_class: requiredClass },
        { cdl_class: driverClass },
      );
      expect(r.evaluated[0]).toMatchObject({ key: 'cdl_class', outcome });
      expect(r.status).toBe(
        outcome === 'met' ? 'meets_known_criteria' : 'does_not_meet_known_criteria',
      );
    }
  });

  it('8) missing or unrecognized driver CDL class is unknown', () => {
    for (const cls of [null, undefined, '', 'Class Z']) {
      const r = evaluateKnownOpportunityQualification(
        { required_cdl_class: 'A' },
        { cdl_class: cls as never },
      );
      expect(r.status).toBe('needs_driver_information');
      expect(r.unknown.map((c) => c.key)).toEqual(['cdl_class']);
    }
  });

  it('9) endorsement normalization covers existing Driver Work Profile labels', () => {
    expect(normalizeEndorsementCode('H (Hazmat)')).toBe('H');
    expect(normalizeEndorsementCode('N (Tanker)')).toBe('N');
    expect(normalizeEndorsementCode('X (Hazmat+Tanker)')).toBe('X');
    expect(normalizeEndorsementCode('T (Doubles/Triples)')).toBe('T');
    expect(normalizeEndorsementCode('P (Passenger)')).toBe('P');
    expect(normalizeEndorsementCode('S (School Bus)')).toBe('S');
    for (const code of SUPPORTED_ENDORSEMENT_CODES) {
      expect(normalizeEndorsementCode(code)).toBe(code);
      expect(normalizeEndorsementCode(code.toLowerCase())).toBe(code);
    }
    expect(normalizeEndorsementCode('Hazmat')).toBeNull();
    expect(normalizeEndorsementCode('Z')).toBeNull();
    expect(normalizeEndorsementCode(null)).toBeNull();
  });

  it('10) X satisfies H and N as well as X', () => {
    for (const required of [['H'], ['N'], ['X'], ['H', 'N']]) {
      const r = evaluateKnownOpportunityQualification(
        { required_endorsements: required },
        { endorsements: ['X (Hazmat+Tanker)'] },
      );
      expect(r.status).toBe('meets_known_criteria');
    }
  });

  it('11) H + N without X does not satisfy a required X', () => {
    const r = evaluateKnownOpportunityQualification(
      { required_endorsements: ['X'] },
      { endorsements: ['H (Hazmat)', 'N (Tanker)'] },
    );
    expect(r.status).toBe('does_not_meet_known_criteria');
    expect(r.failed[0].detail).toContain('X');
  });

  it('12) every required endorsement must be satisfied', () => {
    const r = evaluateKnownOpportunityQualification(
      { required_endorsements: ['H', 'T'] },
      { endorsements: ['H (Hazmat)'] },
    );
    expect(r.status).toBe('does_not_meet_known_criteria');
    const ok = evaluateKnownOpportunityQualification(
      { required_endorsements: ['H', 'T'] },
      { endorsements: ['H (Hazmat)', 'T (Doubles/Triples)'] },
    );
    expect(ok.status).toBe('meets_known_criteria');
  });

  it('13) empty driver endorsement array fails; null/undefined is unknown', () => {
    const empty = evaluateKnownOpportunityQualification(
      { required_endorsements: ['H'] },
      { endorsements: [] },
    );
    expect(empty.status).toBe('does_not_meet_known_criteria');

    for (const value of [null, undefined]) {
      const r = evaluateKnownOpportunityQualification(
        { required_endorsements: ['H'] },
        { endorsements: value as never },
      );
      expect(r.status).toBe('needs_driver_information');
    }
  });

  it('14) precedence: any failure outranks unknown, unknown outranks pass', () => {
    const failureWins = evaluateKnownOpportunityQualification(
      { min_years_experience: 5, required_cdl_class: 'A', required_endorsements: ['H'] },
      { years_experience: 1, cdl_class: null, endorsements: ['H (Hazmat)'] },
    );
    expect(failureWins.status).toBe('does_not_meet_known_criteria');
    expect(failureWins.failed).toHaveLength(1);
    expect(failureWins.unknown).toHaveLength(1);
    expect(failureWins.met).toHaveLength(1);

    const unknownWins = evaluateKnownOpportunityQualification(
      { min_years_experience: 1, required_cdl_class: 'A' },
      { years_experience: 4, cdl_class: null },
    );
    expect(unknownWins.status).toBe('needs_driver_information');

    const allPass = evaluateKnownOpportunityQualification(
      { min_years_experience: 1, required_cdl_class: 'B', required_endorsements: ['N'] },
      { years_experience: 4, cdl_class: 'Class A', endorsements: ['X (Hazmat+Tanker)'] },
    );
    expect(allPass.status).toBe('meets_known_criteria');
  });

  it('15) nonblank free-text requirements set manualReviewRequired without changing status', () => {
    const base = { min_years_experience: 1, requirements: '  Clean MVR, must pass road test  ' };
    const r = evaluateKnownOpportunityQualification(base, { years_experience: 4 });
    expect(r.manualReviewRequired).toBe(true);
    expect(r.status).toBe('meets_known_criteria');

    const blank = evaluateKnownOpportunityQualification(
      { min_years_experience: 1, requirements: '   ' },
      { years_experience: 4 },
    );
    expect(blank.manualReviewRequired).toBe(false);
    expect(blank.status).toBe('meets_known_criteria');

    const noStructured = evaluateKnownOpportunityQualification(
      { requirements: 'Call for details' },
      {},
    );
    expect(noStructured.manualReviewRequired).toBe(true);
    expect(noStructured.status).toBe('no_structured_criteria');
  });

  it('16) input arrays and objects are not mutated', () => {
    const required = ['H', 'N'];
    const held = ['X (Hazmat+Tanker)'];
    const opportunity = { required_endorsements: required, min_years_experience: 2 };
    const driver = { endorsements: held, years_experience: 3 };
    evaluateKnownOpportunityQualification(opportunity, driver);
    expect(required).toEqual(['H', 'N']);
    expect(held).toEqual(['X (Hazmat+Tanker)']);
    expect(opportunity).toEqual({ required_endorsements: required, min_years_experience: 2 });
    expect(driver).toEqual({ endorsements: held, years_experience: 3 });
  });

  it('17) null/undefined inputs fail closed to no_structured_criteria', () => {
    expect(evaluateKnownOpportunityQualification(null, null).status).toBe('no_structured_criteria');
    expect(evaluateKnownOpportunityQualification(undefined, undefined).status).toBe(
      'no_structured_criteria',
    );
  });

  it('18) never uses pay, route, trailer, home time, or fit score', () => {
    const r = evaluateKnownOpportunityQualification(
      {
        min_years_experience: 1,
        // extra fields must be ignored entirely
        cpm: 0.75,
        route_type: 'OTR',
        trailer_type: 'Reefer',
        matchScore: 99,
      } as never,
      { years_experience: 2 },
    );
    expect(r.evaluated.map((c) => c.key)).toEqual(['experience']);
  });
});
