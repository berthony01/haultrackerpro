import { describe, it, expect } from 'vitest';
import { splitBenefits, joinBenefits } from '@/lib/opportunities/benefitsFormat';

describe('benefitsFormat round-trip', () => {
  it('returns empty parts for empty input', () => {
    expect(splitBenefits('')).toEqual({ typical_lanes: '', requirements: '' });
    expect(splitBenefits(null)).toEqual({ typical_lanes: '', requirements: '' });
  });

  it('treats legacy unmarked text as requirements only', () => {
    const legacy = '1 year OTR experience, clean MVR';
    expect(splitBenefits(legacy)).toEqual({ typical_lanes: '', requirements: legacy });
  });

  it('round-trips lanes + requirements through join/split', () => {
    const parts = {
      typical_lanes: 'Dallas, TX → Houston, TX\nMidwest → Southeast',
      requirements: '1 year OTR\nClass A CDL',
    };
    const stored = joinBenefits(parts);
    expect(stored).toContain('Typical Lanes:');
    expect(stored).toContain('Requirements:');
    expect(splitBenefits(stored)).toEqual(parts);
  });

  it('omits sections with empty text on join', () => {
    expect(joinBenefits({ typical_lanes: '', requirements: 'Reqs' }))
      .toBe('Requirements:\nReqs');
    expect(joinBenefits({ typical_lanes: 'L', requirements: '' }))
      .toBe('Typical Lanes:\nL');
    expect(joinBenefits({ typical_lanes: '', requirements: '' })).toBe('');
  });

  it('splits a lanes-only stored value', () => {
    const stored = 'Typical Lanes:\nDallas → Houston';
    expect(splitBenefits(stored)).toEqual({
      typical_lanes: 'Dallas → Houston',
      requirements: '',
    });
  });
});
