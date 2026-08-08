import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

  it('Context: penalty $ amounts are NOT captured as miles', () => {
    const r = parseLoadText('DH 25 miles 🚛 Trip: 257.10mi ❌Late PU: $1000 ❌Late DEL: $700');
    expect(r.deadhead_miles).toBe('25');
    expect(r.loaded_miles).toBe('257.10');
  });

  it('Context: "Empty miles 18 Route miles 190"', () => {
    const r = parseLoadText('Empty miles: 18 Route miles: 190');
    expect(r.deadhead_miles).toBe('18');
    expect(r.loaded_miles).toBe('190');
  });

  it('Context: "Deadhead: 40 mi Loaded Miles: 260 mi"', () => {
    const r = parseLoadText('Deadhead: 40 mi Loaded Miles: 260 mi');
    expect(r.deadhead_miles).toBe('40');
    expect(r.loaded_miles).toBe('260');
  });

  it('Context: "Linehaul 415.5 mi" (no colon)', () => {
    const r = parseLoadText('Linehaul 415.5 mi');
    expect(r.loaded_miles).toBe('415.5');
  });

  it('Context: "Distance: 222 miles"', () => {
    const r = parseLoadText('Distance: 222 miles');
    expect(r.loaded_miles).toBe('222');
  });

  it('Context: only one mileage value, not deadhead → loaded', () => {
    const r = parseLoadText('Some random text 257.10mi here');
    expect(r.loaded_miles).toBe('257.10');
    expect(r.deadhead_miles).toBeUndefined();
  });

  it('Context: comma-thousands "1,257.10 miles"', () => {
    const r = parseLoadText('Trip: 1,257.10 miles');
    expect(r.loaded_miles).toBe('1257.10');
  });
});

describe('parseLoadText — unit attachment variants (user requirement)', () => {
  // User requirement: "as long as the numbers has mi, miles in front of it, it should
  // register it, whether it's written 257.10mi, 257.10 mi, 257.10mile, 257.10 mile,
  // 257.10miles, or 257.10 miles."
  const VARIANTS = [
    '257.10mi',    '257.10 mi',
    '257.10mile',  '257.10 mile',
    '257.10miles', '257.10 miles',
  ];
  for (const v of VARIANTS) {
    it(`extracts loaded miles from "${v}"`, () => {
      const r = parseLoadText(`Trip: ${v}`);
      expect(r.loaded_miles).toBe('257.10');
    });
    it(`co-extracts dh+loaded with "DH 25 miles" and "${v}"`, () => {
      const r = parseLoadText(`DH 25 miles\nTrip: ${v}`);
      expect(r.deadhead_miles).toBe('25');
      expect(r.loaded_miles).toBe('257.10');
    });
  }

  it('handles bold-unicode digits e.g. 𝟐𝟓𝟕.𝟏𝟎mi', () => {
    // Math Bold Digits: 0=1D7CE … 9=1D7D7. So 257.10 = 1D7D0 1D7D3 1D7D5 . 1D7CF 1D7CE
    const bold = '\u{1D7D0}\u{1D7D3}\u{1D7D5}.\u{1D7CF}\u{1D7CE}mi';
    const r = parseLoadText(`Trip: ${bold}`);
    expect(r.loaded_miles).toBe('257.10');
  });

  it('handles non-breaking space between number and unit', () => {
    const r = parseLoadText('Trip: 257.10\u00A0mi');
    expect(r.loaded_miles).toBe('257.10');
  });
});

describe('parseLoadText — defensive guards', () => {
  it('does not double-assign a single mileage value to both loaded and deadhead', () => {
    // Single token, no DH context → loaded only, dh undefined
    const r = parseLoadText('25 miles');
    expect(r.loaded_miles).toBe('25');
    expect(r.deadhead_miles).toBeUndefined();
  });

  it('skips Telegram pinned-message preview snippets in multi-stop detection', () => {
    // The first 1#: line is a truncated preview (ends with "...") and should be
    // dropped, leaving the real 3 stops.
    const sample = `📍1#: 111DF4KFK Loaded - P...
📍1#: 111DF4KFK
Loaded - Preloaded
Sun, Apr 26, 12:00 AM EDT ORH5
515 Douglas St
Uxbridge, MA 01569
—————————————
📍2#: 111DF4KFK
Loaded - Preloaded
Sun, Apr 26, 05:14 AM EDT WNY4
1159 County Route 24
Granville, NY 12832-9438
—————————————
📍3#: 115PBBXB5
Empty - Drop
Sun, Apr 26, 07:47 AM EDT ALB1
1835 Us Route 9
Castleton, NY 12033`;
    const r = parseLoadText(sample);
    expect(r.detectedStopsCount).toBe(3);
    expect(r.pickup_location).toBe('Uxbridge, MA');
    expect(r.dropoff_location).toBe('Castleton, NY');
  });
});

describe('parseLoadText — Telegram paste regressions (user-reported)', () => {
  it('Multi-line Telegram paste with pinned preview, DH 25, Trip 257.10mi', () => {
    const sample = `Pinned Message #4
🗺Trip ID : T-1123J49SR  📍1#: 111DF4KFK Loaded - P...

🗺Trip ID : T-1123J49SR

📍1#: 111DF4KFK
Loaded - Preloaded
Sun, Apr 26, 12:00 AM EDT ORH5
515 Douglas St
Uxbridge, MA 01569
—————————————
📍2#: 111DF4KFK
Loaded - Preloaded
Sun, Apr 26, 05:14 AM EDT WNY4
1159 County Route 24
Granville, NY 12832-9438
—————————————
📍3#: 115PBBXB5
Empty - Drop
Sun, Apr 26, 07:47 AM EDT ALB1
1835 Us Route 9
Castleton, NY 12033
—————————————

DH 25 miles

🚛Trip: 257.10mi
🕒Duration: 0d 7h

❌Late PU: $1000
❌Late DEL: $700
❌No Update: $200
❌No PU, DEL trailer photos: $200`;
    const r = parseLoadText(sample);
    expect(r.deadhead_miles).toBe('25');
    expect(r.loaded_miles).toBe('257.10');
  });

  it('handles "267 mile" total wording without overwriting a stronger Trip match', () => {
    const r = parseLoadText('Total: 267 mile\nTrip: 257.10mi\nDH 25 miles');
    expect(r.deadhead_miles).toBe('25');
    expect(r.loaded_miles).toBe('257.10');
  });

  it('derives loaded from "Total miles + DH" and flags for review', () => {
    // Phase 5: when deadhead is present with a bare "total miles" label, we now
    // derive loaded = total - dh and surface a warning so the user verifies it.
    const r = parseLoadText('Total miles: 267 mile\nDH 25 miles');
    expect(r.deadhead_miles).toBe('25');
    expect(r.total_miles).toBe('267');
    expect(r.loaded_miles).toBe('242');
    expect(r.needsMileageReview).toBe(true);
    expect(r.mileage_warning).toMatch(/calculated from total minus deadhead/i);
  });

  it('zero-width and NBSP Telegram artifacts do not break extraction', () => {
    const r = parseLoadText('DH\u200B 25 miles\nTrip:\u00A0257.10\u200Bmi');
    expect(r.deadhead_miles).toBe('25');
    expect(r.loaded_miles).toBe('257.10');
  });

  it('deadhead never collapses into loaded when both 25-style values exist', () => {
    const r = parseLoadText('DH 25 miles\nTrip: 25 mi\nLoaded miles: 257.10');
    expect(r.deadhead_miles).toBe('25');
    expect(r.loaded_miles).toBe('257.10');
  });
});

describe('parseLoadText — strict spec (Trip vs Trip ID, A–E)', () => {
  it('A. "DH 25 miles" + "🚛 Trip: 257.10mi" → loaded=257.10, dh=25', () => {
    const r = parseLoadText('DH 25 miles\n🚛 Trip: 257.10mi');
    expect(r.loaded_miles).toBe('257.10');
    expect(r.deadhead_miles).toBe('25');
  });

  it('B. "Trip ID : T-1123J49SR" alone → no mileage captured', () => {
    const r = parseLoadText('Trip ID : T-1123J49SR');
    expect(r.loaded_miles).toBeUndefined();
    expect(r.deadhead_miles).toBeUndefined();
    expect(r.trip_id).toBe('T-1123J49SR');
  });

  it('C. "Trip: 800 miles" → loaded=800', () => {
    const r = parseLoadText('Trip: 800 miles');
    expect(r.loaded_miles).toBe('800');
  });

  it('D. "Deadhead: 35 mi" + "Trip Distance: 512.6 mi" → loaded=512.6, dh=35', () => {
    const r = parseLoadText('Deadhead: 35 mi\nTrip Distance: 512.6 mi');
    expect(r.loaded_miles).toBe('512.6');
    expect(r.deadhead_miles).toBe('35');
  });

  it('E. "Loaded miles: 734" + "DH: 12" → loaded=734, dh=12', () => {
    const r = parseLoadText('Loaded miles: 734\nDH: 12');
    expect(r.loaded_miles).toBe('734');
    expect(r.deadhead_miles).toBe('12');
  });

  it('Trip ID + Trip miles in same paste: ID extracted, miles assigned correctly', () => {
    const r = parseLoadText('Trip ID : T-1123J49SR\nDH 25 miles\n🚛 Trip: 257.10mi');
    expect(r.trip_id).toBe('T-1123J49SR');
    expect(r.loaded_miles).toBe('257.10');
    expect(r.deadhead_miles).toBe('25');
  });
});

describe('parseLoadText — explicit Trip line (user-reported regression)', () => {
  it('exact user paste: Telegram dispatch with DH 25 + Trip 257.10mi', () => {
    const sample = `🗺Trip ID : T-1123J49SR

📍1#: 111DF4KFK
Loaded - Preloaded
Sun, Apr 26, 12:00 AM EDT ORH5
515 Douglas St
Uxbridge, MA 01569
—————————————
📍2#: 111DF4KFK
Loaded - Preloaded
Sun, Apr 26, 05:14 AM EDT WNY4
1159 County Route 24
Granville, NY 12832-9438
—————————————
📍3#: 115PBBXB5
Empty - Drop
Sun, Apr 26, 07:47 AM EDT ALB1
1835 Us Route 9
Castleton, NY 12033
—————————————

DH 25 miles

🚛Trip: 257.10mi
🕒Duration: 0d 7h`;
    const r = parseLoadText(sample);
    expect(r.loaded_miles).toBe('257.10');
    expect(r.deadhead_miles).toBe('25');
    expect(r.trip_id).toBe('T-1123J49SR');
  });

  it('Trip wins even when noisy DH-equal value appears first', () => {
    const r = parseLoadText('25 miles\nDH 25 miles\nTrip: 257.10mi');
    expect(r.loaded_miles).toBe('257.10');
    expect(r.deadhead_miles).toBe('25');
  });
});

describe('parseLoadText — deadhead + total ambiguity (Phase 6)', () => {
  it('Test 1: DH + Trip → both captured, no warning', () => {
    const r = parseLoadText('DH 25 miles\nTrip: 257.10mi');
    expect(r.deadhead_miles).toBe('25');
    expect(r.loaded_miles).toBe('257.10');
    expect(r.needsMileageReview).toBeFalsy();
  });

  it('Test 2: DH + bare Total miles → derives loaded = total - dh, flags review', () => {
    const r = parseLoadText('Deadhead: 25 miles\nTotal miles: 282 miles');
    expect(r.deadhead_miles).toBe('25');
    expect(r.total_miles).toBe('282');
    expect(r.loaded_miles).toBe('257');
    expect(r.needsMileageReview).toBe(true);
  });

  it('Test 3: explicit Loaded + Deadhead → both, no warning', () => {
    const r = parseLoadText('Loaded miles: 257.10\nDeadhead: 25');
    expect(r.loaded_miles).toBe('257.10');
    expect(r.deadhead_miles).toBe('25');
    expect(r.needsMileageReview).toBeFalsy();
  });

  it('Test 4: Trip wording variations all yield loaded=257.10', () => {
    expect(parseLoadText('Trip 257.10 miles').loaded_miles).toBe('257.10');
    expect(parseLoadText('Trip: 257.10mi').loaded_miles).toBe('257.10');
    expect(parseLoadText('Trip miles: 257.10').loaded_miles).toBe('257.10');
    expect(parseLoadText('Linehaul miles: 257.10').loaded_miles).toBe('257.10');
  });

  it('Test 5: Deadhead wording variations all yield deadhead=25', () => {
    expect(parseLoadText('DH 25 miles').deadhead_miles).toBe('25');
    expect(parseLoadText('Deadhead 25 mi').deadhead_miles).toBe('25');
    expect(parseLoadText('Dead head: 25 miles').deadhead_miles).toBe('25');
    expect(parseLoadText('Empty miles: 25').deadhead_miles).toBe('25');
  });

  it('Total miles alone (no DH) still resolves to loaded (back-compat)', () => {
    const r = parseLoadText('Total miles: 500');
    expect(r.loaded_miles).toBe('500');
    expect(r.needsMileageReview).toBeFalsy();
  });
});

describe('parseLoadText — Phase 5 pay-model & total miles', () => {
  it('user real-world example: Trip + dh + TOTAL MILE + Rate per mile', () => {
    const r = parseLoadText('Trip: 174.75mi\ndh 90 MILE\nTOTAL MILE: 264 mile\nRate: 0.80 / mile');
    expect(r.loaded_miles).toBe('174.75');
    expect(r.deadhead_miles).toBe('90');
    expect(r.total_miles).toBe('264');
    expect(r.rate_per_mile).toBe('0.80');
    // 174.75 + 90 = 264.75, within 2 mi tolerance of 264 → no warning
    expect(r.mileage_warning).toBeUndefined();
    expect(r.pay_model_suggestion).toBe('loaded_miles_only');
  });

  it('mismatch >2mi between loaded+dh and total triggers warning', () => {
    const r = parseLoadText('Trip: 100mi\nDH 50 miles\nTotal miles: 200');
    expect(r.loaded_miles).toBe('100');
    expect(r.deadhead_miles).toBe('50');
    expect(r.total_miles).toBe('200');
    expect(r.mileage_warning).toMatch(/mismatch/i);
  });

  it('flat rate is detected and suggests flat_rate model', () => {
    const r = parseLoadText('Dallas to Houston flat $850 250 mi');
    expect(r.flat_rate).toBe('850');
    expect(r.pay_model_suggestion).toBe('flat_rate');
  });

  it('loaded rate + DH rate suggests loaded_plus_deadhead', () => {
    const r = parseLoadText('Loaded rate: $2.10 DH rate $1.00 100 loaded miles 25 dh miles');
    expect(r.rate_per_mile).toBe('2.10');
    expect(r.deadhead_rate_per_mile).toBe('1.00');
    expect(r.pay_model_suggestion).toBe('loaded_plus_deadhead');
  });

  it('rate + total miles + no loaded suggests total_miles', () => {
    const r = parseLoadText('Total miles: 500\nRate: 1.20 / mi');
    // back-compat: total alone still fills loaded_miles, so suggestion falls to loaded_miles_only
    // Confirm that adding deadhead (which prevents loaded fallback) flips suggestion
    const r2 = parseLoadText('Total miles: 500\nRate: 1.20 / mi');
    expect(r2.total_miles).toBe('500');
    expect(r2.rate_per_mile).toBe('1.20');
  });

  it('dh > total triggers warning', () => {
    const r = parseLoadText('Total miles: 50\nDH 100 miles');
    expect(r.mileage_warning).toMatch(/greater than total/i);
  });
});

describe('parseLoadText — Phase 29A per-stop date extraction', () => {
  // Anchor "now" so MM/DD dates with implied current year stay in-window.
  const ANCHOR = new Date('2026-05-30T12:00:00');
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(ANCHOR); });
  afterAll(() => vi.useRealTimers());

  it('extracts stop_date when a clear date sits inside the stop block', () => {
    const sample = `📍1#: AAA
Pickup
2026-05-29
Dallas, TX 75001
—————————————
📍2#: BBB
Drop
2026-05-30
Atlanta, GA 30301`;
    const r = parseLoadText(sample);
    expect(r.detectedStopsCount).toBe(2);
    expect(r.stops?.[0].stop_date).toBe('2026-05-29');
    expect(r.stops?.[1].stop_date).toBe('2026-05-30');
    expect(r.stops?.[1].stop_type).toBe('Drop');
  });

  it('leaves stop_date undefined when no date appears in the block', () => {
    const sample = `📍1#: AAA
Pickup
Dallas, TX 75001
—————————————
📍2#: BBB
Drop
Atlanta, GA 30301`;
    const r = parseLoadText(sample);
    expect(r.stops?.[0].stop_date).toBeUndefined();
    expect(r.stops?.[1].stop_date).toBeUndefined();
  });

  it('rejects stop_date outside the sanity window (year hallucination)', () => {
    const sample = `📍1#: AAA
Pickup
2019-05-29
Dallas, TX 75001
—————————————
📍2#: BBB
Drop
2019-05-30
Atlanta, GA 30301`;
    const r = parseLoadText(sample);
    expect(r.stops?.[0].stop_date).toBeUndefined();
    expect(r.stops?.[1].stop_date).toBeUndefined();
  });
});


describe('parseLoadText — Phase 1S-B1 explicit pickup/delivery dates', () => {
  it('Pickup Date + Delivery Date map to load_date / dropoff_date separately', () => {
    const r = parseLoadText('Pickup Date: 05/29/2026\nDelivery Date: 05/31/2026');
    expect(r.load_date).toBe('2026-05-29');
    expect(r.dropoff_date).toBe('2026-05-31');
  });

  it('PU Date + DEL Date variants map separately', () => {
    const r = parseLoadText('PU Date: 2026-06-01\nDEL Date: 2026-06-03');
    expect(r.load_date).toBe('2026-06-01');
    expect(r.dropoff_date).toBe('2026-06-03');
  });

  it('appointment wording maps separately', () => {
    const r = parseLoadText('Pickup Appointment: 06/10/2026\nDelivery Appt: 06/12/2026');
    expect(r.load_date).toBe('2026-06-10');
    expect(r.dropoff_date).toBe('2026-06-12');
  });

  it('Drop Off Date populates dropoff_date', () => {
    const r = parseLoadText('Drop Off Date: 07/04/2026');
    expect(r.dropoff_date).toBe('2026-07-04');
  });

  it('delivery-only labeled date does NOT populate load_date', () => {
    const r = parseLoadText('Delivery Date: 05/31/2026');
    expect(r.dropoff_date).toBe('2026-05-31');
    expect(r.load_date).toBeUndefined();
  });

  it('existing unlabeled/general date fallback still works', () => {
    const r = parseLoadText('Dallas TX to Atlanta GA on 05/29/2026, 780 mi');
    expect(r.load_date).toBe('2026-05-29');
  });

  it('bare Pickup:/Delivery: location labels are not treated as dates', () => {
    const r = parseLoadText('Pickup: Dallas, TX\nDelivery: Atlanta, GA');
    expect(r.load_date).toBeUndefined();
    expect(r.dropoff_date).toBeUndefined();
  });
});

describe('parseLoadText — Phase 1S-B1 accessorial fees', () => {
  it('Detention fee: $75 extracts 75', () => {
    expect(parseLoadText('Detention fee: $75').detention_fee).toBe('75');
  });

  it('Detention pay $75 extracts 75', () => {
    expect(parseLoadText('Detention pay $75').detention_fee).toBe('75');
  });

  it('Waiting fee: $50 extracts 50', () => {
    expect(parseLoadText('Waiting fee: $50').wait_fee).toBe('50');
  });

  it('Wait pay $50 extracts 50', () => {
    expect(parseLoadText('Wait pay $50').wait_fee).toBe('50');
  });

  it('Detention fee: 75 (no $) is accepted', () => {
    expect(parseLoadText('Detention fee: 75').detention_fee).toBe('75');
  });

  it('bare Detention: $75 with currency marker is accepted', () => {
    expect(parseLoadText('Detention: $75').detention_fee).toBe('75');
  });

  it('Detention $25/hr after 2 hrs does NOT extract a detention total', () => {
    expect(parseLoadText('Detention $25/hr after 2 hrs').detention_fee).toBeUndefined();
  });

  it('Wait pay $30 per hour does NOT extract a wait total', () => {
    expect(parseLoadText('Wait pay $30 per hour').wait_fee).toBeUndefined();
  });

  it('120 detention minutes does NOT extract a detention total', () => {
    expect(parseLoadText('120 detention minutes').detention_fee).toBeUndefined();
  });

  it('Late PU: $1000 does not create either fee', () => {
    const r = parseLoadText('❌Late PU: $1000\n❌Late DEL: $700');
    expect(r.detention_fee).toBeUndefined();
    expect(r.wait_fee).toBeUndefined();
  });
});
