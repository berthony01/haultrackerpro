/**
 * Phase 8B — Agency Stripe billing tests.
 *
 * These tests lock the static contract between:
 *   - the agency price-env mapping
 *   - the checkout & portal edge functions
 *   - the shared webhook's agency routing
 *   - the Plan & Limits card billing CTAs
 *   - the Pricing page CTA links
 *
 * They run without hitting Stripe/Supabase — they pin file contents and pure
 * helpers so accidental regressions break the build.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ALL_AGENCY_PLAN_KEYS, ASSISTANT_AGENCY_PLANS } from '@/lib/agencyPlans';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('Phase 8B — create-agency-checkout', () => {
  const src = read('supabase/functions/create-agency-checkout/index.ts');

  it('maps every approved agency plan to a STRIPE_AGENCY_*_PRICE_ID env var', () => {
    expect(src).toMatch(/agency_starter:\s*"STRIPE_AGENCY_STARTER_PRICE_ID"/);
    expect(src).toMatch(/agency_team:\s*"STRIPE_AGENCY_TEAM_PRICE_ID"/);
    expect(src).toMatch(/agency_growth:\s*"STRIPE_AGENCY_GROWTH_PRICE_ID"/);
  });

  it('does not hardcode any Stripe price_ id', () => {
    expect(src).not.toMatch(/price_[A-Za-z0-9]{6,}/);
  });

  it('requires Authorization header and validates the JWT in-code', () => {
    expect(src).toMatch(/Authorization/);
    expect(src).toMatch(/supabaseAnon\.auth\.getUser/);
  });

  it('requires the caller to be the agency owner', () => {
    expect(src).toMatch(/role !== "agency_owner"/);
    expect(src).toMatch(/Only the agency owner can manage billing/);
  });

  it('rejects unknown plan keys', () => {
    expect(src).toMatch(/Invalid plan key/);
  });

  it('rejects client-supplied price IDs', () => {
    expect(src).toMatch(/Client-supplied price IDs are not allowed/);
  });

  it('blocks restart while an active/trialing/past_due Stripe sub already exists', () => {
    expect(src).toMatch(/"active",\s*"trialing",\s*"past_due"/);
    expect(src).toMatch(/already has an active billing subscription/);
  });

  it('isolates the agency customer ID on agency_entitlements only', () => {
    expect(src).toMatch(/agency_entitlements/);
    // Must NOT reuse driver subscriptions or recruiter billing tables for
    // customer storage.
    expect(src).not.toMatch(/from\("subscriptions"\)/);
    expect(src).not.toMatch(/from\("recruiter_billing_profiles"\)/);
    expect(src).not.toMatch(/from\("profiles"\)/);
  });

  it('always tags Stripe session + subscription metadata with billing_context="agency"', () => {
    const matches = src.match(/billing_context:\s*"agency"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3); // customer create + session + subscription_data
  });

  it('uses success/cancel URLs under /agency', () => {
    expect(src).toMatch(/\/agency\?billing=success/);
    expect(src).toMatch(/\/agency\?billing=cancelled/);
  });
});

describe('Phase 8B — agency-customer-portal', () => {
  const src = read('supabase/functions/agency-customer-portal/index.ts');

  it('requires Authorization header', () => {
    expect(src).toMatch(/Authorization/);
    expect(src).toMatch(/getUser/);
  });

  it('requires the caller to be the agency owner', () => {
    expect(src).toMatch(/role !== "agency_owner"/);
  });

  it('reads stripe_customer_id only from agency_entitlements', () => {
    expect(src).toMatch(/from\("agency_entitlements"\)/);
    expect(src).not.toMatch(/from\("subscriptions"\)/);
    expect(src).not.toMatch(/from\("recruiter_billing_profiles"\)/);
  });

  it('returns a clear error when agency billing has not started', () => {
    expect(src).toMatch(/billing has not been started/);
  });

  it('returns to /agency', () => {
    expect(src).toMatch(/return_url:\s*`\$\{origin\}\/agency`/);
  });
});

describe('Phase 8B — config.toml registration', () => {
  const cfg = read('supabase/config.toml');
  it('registers create-agency-checkout', () => {
    expect(cfg).toMatch(/\[functions\.create-agency-checkout\]/);
  });
  it('registers agency-customer-portal', () => {
    expect(cfg).toMatch(/\[functions\.agency-customer-portal\]/);
  });
});

describe('Phase 8B — stripe-webhook agency routing', () => {
  const src = read('supabase/functions/stripe-webhook/index.ts');

  it('declares an agency plan → env map', () => {
    expect(src).toMatch(/AGENCY_PLAN_ENV/);
    expect(src).toMatch(/STRIPE_AGENCY_STARTER_PRICE_ID/);
    expect(src).toMatch(/STRIPE_AGENCY_TEAM_PRICE_ID/);
    expect(src).toMatch(/STRIPE_AGENCY_GROWTH_PRICE_ID/);
  });

  it('defines handleAgencySubscription that writes to agency_entitlements with source=stripe', () => {
    expect(src).toMatch(/handleAgencySubscription/);
    expect(src).toMatch(/from\("agency_entitlements"\)/);
    expect(src).toMatch(/source:\s*"stripe"/);
  });

  it('maps Stripe statuses to allowed agency statuses', () => {
    expect(src).toMatch(/mapAgencyStripeStatus/);
    expect(src).toMatch(/case\s+"active":\s*return\s+"active"/);
    expect(src).toMatch(/case\s+"trialing":\s*return\s+"trialing"/);
    expect(src).toMatch(/case\s+"past_due":/);
    expect(src).toMatch(/case\s+"canceled":/);
  });

  it('routes checkout.session.completed agency events BEFORE driver/recruiter branches', () => {
    const i = src.indexOf('checkout.session.completed');
    const agencyIdx = src.indexOf('billingContext === "agency"', i);
    const recruiterIdx = src.indexOf('billingType === "recruiter"', i);
    expect(agencyIdx).toBeGreaterThan(-1);
    expect(recruiterIdx).toBeGreaterThan(-1);
    expect(agencyIdx).toBeLessThan(recruiterIdx);
  });

  it('routes subscription.updated agency events BEFORE driver/recruiter branches', () => {
    const i = src.indexOf('customer.subscription.created');
    const agencyIdx = src.indexOf('isAgencyContext', i);
    const recruiterIdx = src.indexOf('billing_type === "recruiter"', i);
    expect(agencyIdx).toBeGreaterThan(-1);
    expect(recruiterIdx).toBeGreaterThan(-1);
    expect(agencyIdx).toBeLessThan(recruiterIdx);
  });

  it('handles subscription.deleted for agencies via handleAgencySubscriptionDeleted', () => {
    expect(src).toMatch(/handleAgencySubscriptionDeleted/);
  });

  it('agency helper bodies do not touch subscriptions, profiles, or recruiter_billing_profiles', () => {
    // Slice just handleAgencySubscription + handleAgencySubscriptionDeleted,
    // stopping at the next function (`upsertSubscription`) so we don't pick
    // up unrelated driver/recruiter helpers below.
    const a1 = src.indexOf('async function handleAgencySubscription');
    const end = src.indexOf('async function upsertSubscription');
    expect(a1).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(a1);
    const agencyBodies = src.slice(a1, end);
    expect(agencyBodies).not.toMatch(/from\("subscriptions"\)/);
    expect(agencyBodies).not.toMatch(/from\("profiles"\)/);
    expect(agencyBodies).not.toMatch(/from\("recruiter_billing_profiles"\)/);
  });


  it('preserves driver Pro branch (subscriptions table + profiles update)', () => {
    expect(src).toMatch(/from\("subscriptions"\)/);
    expect(src).toMatch(/from\("profiles"\)/);
    expect(src).toMatch(/subscription_status:\s*"pro"/);
  });

  it('preserves recruiter branch (handleRecruiterSubscription + recruiter_billing_profiles)', () => {
    expect(src).toMatch(/handleRecruiterSubscription/);
    expect(src).toMatch(/from\("recruiter_billing_profiles"\)/);
  });

  it('still verifies STRIPE_WEBHOOK_SECRET signature', () => {
    expect(src).toMatch(/STRIPE_WEBHOOK_SECRET/);
    expect(src).toMatch(/constructEventAsync/);
  });

  it('still records events into stripe_webhook_events for idempotency', () => {
    expect(src).toMatch(/from\("stripe_webhook_events"\)/);
    expect(src).toMatch(/23505/); // unique_violation duplicate ack
  });
});

describe('Phase 8B — cancelled blocks new billable mutations (migration)', () => {
  const migrations = fs
    .readdirSync(path.join(process.cwd(), 'supabase/migrations'))
    .map((f) => fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', f), 'utf8'))
    .join('\n');

  it('latest assert_agency_limit raises when status is cancelled', () => {
    const idx = migrations.lastIndexOf('CREATE OR REPLACE FUNCTION public.assert_agency_limit');
    expect(idx).toBeGreaterThan(-1);
    const body = migrations.slice(idx, idx + 3000);
    expect(body).toMatch(/lim\.status\s*=\s*'cancelled'/);
    expect(body).toMatch(/Restart your %/);
  });
});

describe('Phase 8B — Plan & Limits card billing UI', () => {
  const card = read('src/components/agency/AgencyPlanLimitsCard.tsx');

  it('invokes the real create-agency-checkout function', () => {
    expect(card).toMatch(/supabase\.functions\.invoke\(\s*['"]create-agency-checkout['"]/);
  });

  it('invokes the real agency-customer-portal function', () => {
    expect(card).toMatch(/supabase\.functions\.invoke\(\s*['"]agency-customer-portal['"]/);
  });

  it('shows owner-only billing controls', () => {
    expect(card).toMatch(/isOwner/);
    expect(card).toMatch(/Only the agency owner can manage billing/);
  });

  it('renders past_due warning and cancelled warning', () => {
    expect(card).toMatch(/past_due/);
    expect(card).toMatch(/Agency billing is cancelled/);
  });

  it('uses Start / Restart / Manage labels (not fake Pay Now / Subscribe Now)', () => {
    expect(card).toMatch(/Start Agency Billing/);
    expect(card).toMatch(/Restart Billing/);
    expect(card).toMatch(/Manage Billing/);
    expect(card).not.toMatch(/Pay\s*Now/);
    expect(card).not.toMatch(/Subscribe\s*Now/);
  });

  it('sanitizes ?plan= against the approved agency plan keys', () => {
    expect(card).toMatch(/sanitizeAgencyPlanKey/);
    expect(card).toMatch(/ALL_AGENCY_PLAN_KEYS/);
  });
});

describe('Phase 8B — Pricing page CTA routes', () => {
  const src = read('src/pages/Pricing.tsx');

  it('routes the agency plan CTA through /auth?next=/agency?plan= (sanitized server-side)', () => {
    // Source uses a template literal `${encodeURIComponent(`/agency?plan=${p.key}`)}`
    // so we assert the pattern, not the encoded value.
    expect(src).toMatch(
      /\/auth\?next=\$\{encodeURIComponent\(`\/agency\?plan=\$\{p\.key\}`\)\}/,
    );
    // Plan keys themselves come from the centralized agencyPlans module the
    // page iterates over, so we only assert the routing pattern here.
  });





  it('still preserves the outside-payments disclaimer', () => {
    expect(src).toMatch(/OUTSIDE_PAYMENTS_DISCLAIMER/);
    expect(src).toMatch(/outside the platform/);
  });

  it('does not auto-start checkout from the public pricing page', () => {
    expect(src).not.toMatch(/invoke\(\s*['"]create-agency-checkout['"]/);
  });
});

describe('Phase 8B — plan model integrity (no drift since Phase 7)', () => {
  it('still has exactly three agency plans at $29 / $79 / $149', () => {
    expect(ALL_AGENCY_PLAN_KEYS).toEqual(['agency_starter', 'agency_team', 'agency_growth']);
    expect(ASSISTANT_AGENCY_PLANS.agency_starter.monthlyPrice).toBe(29);
    expect(ASSISTANT_AGENCY_PLANS.agency_team.monthlyPrice).toBe(79);
    expect(ASSISTANT_AGENCY_PLANS.agency_growth.monthlyPrice).toBe(149);
  });
});
