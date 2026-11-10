/**
 * Pricing role clarity regression. Source and pure config only.
 * No Stripe, database, Telegram, or authenticated workflows.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ASSISTANT_AGENCY_PLANS, ALL_AGENCY_PLAN_KEYS } from '@/lib/agencyPlans';
import { RECRUITER_TIER_ACTIVE_OPPORTUNITY_LIMITS } from '@/lib/recruiterCapabilities';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('Pricing role clarity', () => {
  const pricing = read('src/pages/Pricing.tsx');
  const agencies = read('src/pages/AssistantsAgencies.tsx');

  it('explains company dispatch without inventing a fourth subscription', () => {
    expect(pricing).toContain('Company Dispatch is an authorized company-workspace capability');
    expect(pricing).toContain("another company's loads");
    expect(pricing).toContain("Agency subscriptions do not automatically grant access to a carrier's Dispatch");
    expect(agencies).toContain('Can an agency subscription dispatch loads for another carrier automatically?');
  });

  it('clearly distinguishes free assistant software from the driver Pro prerequisite', () => {
    expect(pricing).toContain('Driver Assistants pay no assistant subscription fee');
    expect(pricing).toContain("the inviting driver's Pro plan and approval");
    expect(ASSISTANT_AGENCY_PLANS.assistant_free.monthlyPrice).toBe(0);
    expect(ASSISTANT_AGENCY_PLANS.assistant_free.publicBullets).toContain(
      'For direct assistance, the inviting driver needs an active Driver Pro plan',
    );
    expect(agencies).toContain('Who pays for direct Driver Assistant access?');
  });

  it('does not add agency plans or change their prices', () => {
    expect(ALL_AGENCY_PLAN_KEYS).toEqual(['agency_starter', 'agency_team', 'agency_growth']);
    expect(ASSISTANT_AGENCY_PLANS.agency_starter.monthlyPrice).toBe(29);
    expect(ASSISTANT_AGENCY_PLANS.agency_team.monthlyPrice).toBe(79);
    expect(ASSISTANT_AGENCY_PLANS.agency_growth.monthlyPrice).toBe(149);
  });

  it('preserves the canonical finite recruiter opportunity limits', () => {
    expect(RECRUITER_TIER_ACTIVE_OPPORTUNITY_LIMITS).toEqual({
      free_verified: 1, starter: 5, growth: 15, fleet: 25,
    });
  });
});
