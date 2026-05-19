import { describe, it, expect } from 'vitest';
import { SCHEDULE_C_MAP, getScheduleCLine, groupByScheduleC } from '@/lib/scheduleCMapping';

describe('scheduleCMapping — Truck Payment guidance', () => {
  it('does not state the full truck payment is deductible as depreciation/Section 179', () => {
    const entry = SCHEDULE_C_MAP['Truck Payment'];
    expect(entry).toBeDefined();
    // Old misleading description was exactly "Depreciation / Section 179".
    expect(entry.description).not.toBe('Depreciation / Section 179');
    expect(entry.description.toLowerCase()).toMatch(/review|principal|interest|loan/);
  });

  it('exposes a cautionary note covering principal, interest, depreciation, lease, and professional review', () => {
    const note = (SCHEDULE_C_MAP['Truck Payment'].note ?? '').toLowerCase();
    expect(note).toContain('principal');
    expect(note).toContain('interest');
    expect(note).toMatch(/depreciation|section 179/);
    expect(note).toContain('lease');
    expect(note).toMatch(/tax professional|professional/);
  });

  it('keeps Lease Payment on Line 20a (vehicles/equipment lease)', () => {
    expect(SCHEDULE_C_MAP['Lease Payment'].line).toBe('20a');
  });

  it('preserves existing mappings for unrelated categories', () => {
    expect(getScheduleCLine('Fuel').line).toBe('9');
    expect(getScheduleCLine('Maintenance').line).toBe('21');
    expect(getScheduleCLine('Insurance').line).toBe('15');
    expect(getScheduleCLine('Meals').line).toBe('24b');
    expect(getScheduleCLine('Unknown Category').line).toBe('27a');
  });

  it('groupByScheduleC totals are unchanged by the Truck Payment description update', () => {
    const groups = groupByScheduleC([
      { category: 'Truck Payment', amount: 2000 },
      { category: 'Fuel', amount: 500 },
    ]);
    const line13 = groups.find(g => g.line === '13');
    expect(line13?.total).toBe(2000);
    const line9 = groups.find(g => g.line === '9');
    expect(line9?.total).toBe(500);
  });
});
