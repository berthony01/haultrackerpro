import { describe, it, expect } from 'vitest';
import { parseLoadText } from '@/lib/parseLoadText';

describe('parseLoadText — mileage detection', () => {
  it('Example 1: bold-unicode trip with no space before mi', () => {
    const r = parseLoadText('🚛 𝗧𝗿𝗶𝗽: 257.10mi');
    expect(r.loaded_miles).toBe('257.10');
  });

  it('Example 2: "DH 25 miles"', () => {
    const r = parseLoadText('DH 25 miles');
    expect(r.deadhead_miles).toBe('25');
  });

  it('Example 3: "Loaded Miles: 300"', () => {
    const r = parseLoadText('Loaded Miles: 300');
    expect(r.loaded_miles).toBe('300');
  });

  it('Example 4: "Trip Miles: 415.5"', () => {
    const r = parseLoadText('Trip Miles: 415.5');
    expect(r.loaded_miles).toBe('415.5');
  });

  it('Example 5: "Deadhead Miles: 42"', () => {
    const r = parseLoadText('Deadhead Miles: 42');
    expect(r.deadhead_miles).toBe('42');
  });

  it('Example 6: "Route miles 222 mi"', () => {
    const r = parseLoadText('Route miles 222 mi');
    expect(r.loaded_miles).toBe('222');
  });

  it('Example 7: "Total miles: 500" used as fallback', () => {
    const r = parseLoadText('Total miles: 500');
    expect(r.loaded_miles).toBe('500');
  });

  it('Trip Miles wins over Total Miles when both present', () => {
    const r = parseLoadText('Total Miles: 999\nTrip Miles: 257.10');
    expect(r.loaded_miles).toBe('257.10');
  });

  it('Deadhead does not get consumed by loaded-miles regex', () => {
    const r = parseLoadText('DH 25 miles\n🚛 Trip: 257.10mi');
    expect(r.deadhead_miles).toBe('25');
    expect(r.loaded_miles).toBe('257.10');
  });

  it('Phase 8 full sample: Trip ID + miles + DH', () => {
    const sample =
      '🗺𝗧𝗿𝗶𝗽 𝗜𝗗 : T-1123J49SR📍1#: 111DF4KFKLoaded - PreloadedSun, Apr 26, 12:00 AM EDT ORH5 515 Douglas St Uxbridge, MA 01569—————————————📍2#: 111DF4KFKLoaded - PreloadedSun, Apr 26, 05:14 AM EDT WNY4 1159 County Route 24 Granville, NY 12832-9438—————————————📍3#: 115PBBXB5Empty - DropSun, Apr 26, 07:47 AM EDT ALB1 1835 Us Route 9 Castleton, NY 12033—————————————DH 25 miles🚛 𝗧𝗿𝗶𝗽: 257.10mi 🕒 Duration: 0d 7h❌Late PU: $1000❌Late DEL: $700❌No Update: $200❌No PU, DEL trailer photos: $200';
    const r = parseLoadText(sample);
    expect(r.trip_id).toBe('T-1123J49SR');
    expect(r.loaded_miles).toBe('257.10');
    expect(r.deadhead_miles).toBe('25');
  });

  it('Variants: Linehaul, Distance, Loaded Mi, Empty Miles, Bobtail, Unpaid', () => {
    expect(parseLoadText('Linehaul Miles: 257.10').loaded_miles).toBe('257.10');
    expect(parseLoadText('Distance: 257.10 mi').loaded_miles).toBe('257.10');
    expect(parseLoadText('Loaded Mi: 257.10').loaded_miles).toBe('257.10');
    expect(parseLoadText('Loaded: 257.10mi').loaded_miles).toBe('257.10');
    expect(parseLoadText('Loaded Distance: 257.10').loaded_miles).toBe('257.10');
    expect(parseLoadText('Empty Miles: 25').deadhead_miles).toBe('25');
    expect(parseLoadText('Bobtail Miles: 25').deadhead_miles).toBe('25');
    expect(parseLoadText('Unpaid Miles: 25').deadhead_miles).toBe('25');
  });
});
