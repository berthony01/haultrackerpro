import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DRIVER_PLAN_PRICE_ENV } from '../../supabase/functions/_shared/driver-billing-pure';

// This is a source/config contract check. It never accesses Stripe, Supabase,
// environment secrets, payment APIs, or customer data.
const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function envMap(text: string, constant: string): Record<string, string> {
  const block = text.match(new RegExp('const\\s+' + constant + '[^=]*=\\s*\\{([\\s\\S]*?)\\};'));
  expect(block, `Missing map ${constant}`).not.toBeNull();
  const entries = [...(block?.[1] ?? '').matchAll(/^\s*(\w+):\s*["'](STRIPE_[A-Z_]+)["'],?\s*$/gm)];
  return Object.fromEntries(entries.map(([, key, value]) => [key, value]));
}

const expectedDriver = {
  pro_monthly: 'STRIPE_PRO_MONTHLY_PRICE_ID',
  pro_yearly: 'STRIPE_PRO_YEARLY_PRICE_ID',
};
const expectedRecruiter = {
  starter: 'STRIPE_RECRUITER_STARTER_PRICE_ID',
  growth: 'STRIPE_RECRUITER_GROWTH_PRICE_ID',
  fleet: 'STRIPE_RECRUITER_FLEET_PRICE_ID',
};
const expectedAgency = {
  agency_starter: 'STRIPE_AGENCY_STARTER_PRICE_ID',
  agency_team: 'STRIPE_AGENCY_TEAM_PRICE_ID',
  agency_growth: 'STRIPE_AGENCY_GROWTH_PRICE_ID',
};

describe('Pricing checkout and webhook environment-key parity', () => {
  const driver = source('supabase/functions/create-checkout/index.ts');
  const recruiter = source('supabase/functions/create-recruiter-checkout/index.ts');
  const agency = source('supabase/functions/create-agency-checkout/index.ts');
  const webhook = source('supabase/functions/stripe-webhook/index.ts');

  it('uses the same two driver keys for checkout and webhook routing', () => {
    expect(DRIVER_PLAN_PRICE_ENV).toEqual(expectedDriver);
    expect(driver).toContain('Deno.env.get(DRIVER_PLAN_PRICE_ENV.pro_monthly)');
    expect(driver).toContain('Deno.env.get(DRIVER_PLAN_PRICE_ENV.pro_yearly)');
    for (const envName of Object.values(expectedDriver)) {
      expect(webhook).toContain(`Deno.env.get("${envName}")`);
    }
  });

  it('uses matching recruiter maps on checkout and webhook', () => {
    expect(envMap(recruiter, 'PLAN_TO_ENV')).toEqual(expectedRecruiter);
    expect(envMap(webhook, 'RECRUITER_PLAN_ENV')).toEqual(expectedRecruiter);
    expect(recruiter).toContain('Deno.env.get(PLAN_TO_ENV[plan])');
  });

  it('uses matching agency maps on checkout and webhook', () => {
    expect(envMap(agency, 'AGENCY_PLAN_TO_ENV')).toEqual(expectedAgency);
    expect(envMap(webhook, 'AGENCY_PLAN_ENV')).toEqual(expectedAgency);
    expect(agency).toContain('Deno.env.get(AGENCY_PLAN_TO_ENV[planKey])');
  });

  it('keeps distinct keys for all eight configured recurring prices', () => {
    const keys = [...Object.values(expectedDriver), ...Object.values(expectedRecruiter), ...Object.values(expectedAgency)];
    expect(keys).toHaveLength(8);
    expect(new Set(keys).size).toBe(8);
  });

  it('blocks new recruiter Fleet checkout before reading any Stripe price or creating a session', () => {
    expect(recruiter).toMatch(/PREVIEW_ONLY_RECRUITER_PLANS[^;]*=\s*new Set<[\s\S]*?\(\["fleet"\]\)/);
    const guard = recruiter.indexOf('if (PREVIEW_ONLY_RECRUITER_PLANS.has(plan))');
    const priceLookup = recruiter.indexOf('const priceId = Deno.env.get(PLAN_TO_ENV[plan])');
    const sessionCreation = recruiter.indexOf('stripe.checkout.sessions.create(');
    expect(guard).toBeGreaterThan(0);
    expect(priceLookup).toBeGreaterThan(guard);
    expect(sessionCreation).toBeGreaterThan(priceLookup);
  });
});
