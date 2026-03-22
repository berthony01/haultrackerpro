/**
 * AI Weekly Summary Generator
 * Generates a natural language summary of weekly performance.
 * Template-based — no LLM needed. Runs client-side, costs nothing.
 */

import { Load } from '@/hooks/useLoads';
import { getEffectiveDate, formatCurrency } from '@/lib/loadUtils';
import { parseISO, startOfWeek, endOfWeek, subWeeks, isWithinInterval } from 'date-fns';

interface WeeklySummaryInput {
  weekLoads: Load[];
  allLoads: Load[];
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function generateWeeklySummary({ weekLoads, allLoads, weekStartsOn }: WeeklySummaryInput): string[] {
  if (weekLoads.length === 0) return ['No loads logged this week. Log your loads to get a weekly performance summary.'];

  const sentences: string[] = [];
  const now = new Date();

  // This week metrics
  const twRevenue = weekLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const twMiles = weekLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const twDH = weekLoads.reduce((s, l) => s + Number(l.deadhead_miles), 0);
  const twTotalMiles = twMiles + twDH;
  const twDHPct = twTotalMiles > 0 ? (twDH / twTotalMiles) * 100 : 0;
  const twRPM = twMiles > 0 ? twRevenue / twMiles : 0;

  // Last week metrics for comparison
  const lwStart = startOfWeek(subWeeks(now, 1), { weekStartsOn });
  const lwEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn });
  const lwLoads = allLoads.filter(l => isWithinInterval(parseISO(getEffectiveDate(l)), { start: lwStart, end: lwEnd }));
  const lwRevenue = lwLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const lwMiles = lwLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const lwRPM = lwMiles > 0 ? lwRevenue / lwMiles : 0;

  // Opening sentence
  sentences.push(
    `You completed ${weekLoads.length} load${weekLoads.length > 1 ? 's' : ''} this week, earning an estimated ${formatCurrency(twRevenue)} across ${twMiles.toLocaleString()} loaded miles.`
  );

  // RPM comparison
  if (twRPM > 0) {
    if (lwLoads.length > 0 && lwRPM > 0) {
      const rpmChange = ((twRPM - lwRPM) / lwRPM) * 100;
      if (rpmChange > 5) {
        sentences.push(`Your rate per mile improved to $${twRPM.toFixed(2)}/mi — up ${rpmChange.toFixed(0)}% from last week. Great work negotiating better loads.`);
      } else if (rpmChange < -5) {
        sentences.push(`Your RPM dipped to $${twRPM.toFixed(2)}/mi, down ${Math.abs(rpmChange).toFixed(0)}% from last week ($${lwRPM.toFixed(2)}/mi). Consider targeting higher-paying lanes.`);
      } else {
        sentences.push(`Your RPM held steady at $${twRPM.toFixed(2)}/mi, consistent with last week.`);
      }
    } else {
      sentences.push(`Your average rate was $${twRPM.toFixed(2)} per loaded mile.`);
    }
  }

  // Deadhead analysis
  if (twDHPct > 25) {
    sentences.push(`Deadhead was ${twDHPct.toFixed(0)}% this week — that's high. Try to find loads closer to your drop-off points to cut empty miles.`);
  } else if (twDHPct < 10 && twDH > 0) {
    sentences.push(`Only ${twDHPct.toFixed(0)}% deadhead this week — excellent efficiency on empty miles.`);
  }

  // Revenue comparison
  if (lwLoads.length > 0 && lwRevenue > 0) {
    const revChange = twRevenue - lwRevenue;
    if (revChange > 100) {
      sentences.push(`Revenue is up ${formatCurrency(revChange)} compared to last week. Keep the momentum going.`);
    } else if (revChange < -100) {
      sentences.push(`Revenue is down ${formatCurrency(Math.abs(revChange))} from last week. A slow week, or time to pick up an extra load.`);
    }
  }

  // Best load highlight
  if (weekLoads.length >= 2) {
    const best = weekLoads.reduce((a, b) => {
      const aRPM = Number(a.loaded_miles) > 0 ? Number(a.estimated_pay ?? 0) / Number(a.loaded_miles) : 0;
      const bRPM = Number(b.loaded_miles) > 0 ? Number(b.estimated_pay ?? 0) / Number(b.loaded_miles) : 0;
      return bRPM > aRPM ? b : a;
    });
    const bestRPM = Number(best.loaded_miles) > 0 ? Number(best.estimated_pay ?? 0) / Number(best.loaded_miles) : 0;
    if (bestRPM > 0) {
      sentences.push(`Your best load was ${best.pickup_location} → ${best.dropoff_location} at $${bestRPM.toFixed(2)}/mi. Look for more runs on that lane.`);
    }
  }

  // Unpaid loads
  const unpaid = weekLoads.filter(l => l.actual_pay_received == null && l.status !== 'cancelled');
  if (unpaid.length > 0) {
    sentences.push(`Don't forget: ${unpaid.length} load${unpaid.length > 1 ? 's are' : ' is'} still awaiting payment entry.`);
  }

  return sentences;
}
