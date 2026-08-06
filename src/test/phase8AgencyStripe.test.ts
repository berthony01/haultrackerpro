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

describe('Phase 8B / 1R-D2-B3 — create-agency-checkout', () => {
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
    expect(src).toMatch(/startsWith\("Bearer "\)/);
  });

  it('requires the caller to be an active agency owner', () => {
    expect(src).toMatch(/role !== "agency_owner"/);
    expect(src).toMatch(/status !== "active"/);
    expect(src).toMatch(/Only the agency owner can manage billing/);
  });

  it('rejects unknown plan keys', () => {
    expect(src).toMatch(/isAgencyPlanKey/);
    expect(src).toMatch(/Invalid plan key/);
  });

  it('rejects client-supplied price IDs', () => {
    expect(src).toMatch(/Client-supplied price IDs are not allowed/);
  });

  // --- Phase 1R-D2-B3 atomic coordinator contracts ------------------------

  it('delegates to the pure agency checkout orchestrator', () => {
    expect(src).toMatch(/from\s+"\.\.\/_shared\/agency-checkout\.ts"/);
    expect(src).toContain('runAgencyCheckout(');
  });

  it('imports the atomic business checkout coordinator and removes the retired edge guard', () => {
    expect(src).toMatch(/from\s+"\.\.\/_shared\/business-checkout-claim\.ts"/);
    for (const symbol of [
      'createBusinessCheckoutClaimStore',
      'beginBusinessCheckout',
      'completeBusinessCheckout',
      'releaseBusinessCheckout',
    ]) {
      expect(src).toContain(symbol);
    }
    expect(src).not.toContain('business-checkout-guard.ts');
    expect(src).not.toContain('evaluateAgencyCheckoutCrossContext');
    // The PostgreSQL claim state machine is the sole cross-context authority;
    // the agency edge no longer reads recruiter billing state directly.
    expect(src).not.toContain('from("recruiter_profiles")');
    expect(src).not.toContain('from("recruiter_billing_profiles")');
  });

  it('acquires the atomic claim after owner validation and before Stripe or orchestrator work', () => {
    const beginIdx = src.indexOf('await beginBusinessCheckout(');
    expect(beginIdx).toBeGreaterThan(-1);
    for (const before of [
      'if (!isAgencyPlanKey(planKey))',
      'from("agency_profiles")',
      'from("agency_members")',
      'ownerRow.role !== "agency_owner"',
      'if (!isAllowedAgencyOrigin(reqOrigin))',
    ]) {
      const idx = src.indexOf(before);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeLessThan(beginIdx);
    }
    for (const after of [
      'new Stripe(stripeKey',
      'buildAgencyDeps(stripe',
      'await runAgencyCheckout(',
    ]) {
      const idx = src.indexOf(after);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeGreaterThan(beginIdx);
    }
    const claimInput = src.slice(beginIdx, beginIdx + 400);
    expect(claimInput).toContain('userId: user.id');
    expect(claimInput).toContain('context: "agency"');
    expect(claimInput).toContain('subjectId: agencyId');
    expect(claimInput).toContain('planKey');
  });

  it('returns the stable cross-context codes', () => {
    expect(src).toContain('"recruiter_subscription_exists"');
    expect(src).toContain('"opposing_entitlement_unknown"');
  });

  it('rejects non-allowlisted origins strictly with no production fallback', () => {
    expect(src).toContain('isAllowedAgencyOrigin');
    expect(src).toMatch(/code:\s*"invalid_origin"/);
    // The old permissive fallback must be gone.
    expect(src).not.toMatch(/\?\s*reqOrigin\s*:\s*"https:\/\/haultrackerpro\.com"/);
    expect(src).not.toMatch(/ALLOWED_ORIGINS\.has\(reqOrigin\)\s*\?/);
  });

  it('passes idempotency keys and explicit expiry through the Stripe adapter', () => {
    expect(src).toMatch(/stripe\.customers\.create\(\s*\{[\s\S]*?\},\s*\{\s*idempotencyKey\s*\}/);
    expect(src).toMatch(/expires_at:\s*expiresAt/);
    expect(src).toMatch(/stripe\.checkout\.sessions\.create\([\s\S]*?\{\s*idempotencyKey\s*\}/);
  });

  it('paginates subscriptions and Checkout Sessions exhaustively', () => {
    expect(src).toMatch(/stripe\.subscriptions\.list\(/);
    expect(src).toMatch(/stripe\.checkout\.sessions\.list\(/);
    const hasMore = src.match(/if\s*\(!page\.has_more\)\s*break;/g) ?? [];
    expect(hasMore.length).toBeGreaterThanOrEqual(2);
    const startingAfter = src.match(/starting_after:\s*startingAfter/g) ?? [];
    expect(startingAfter.length).toBeGreaterThanOrEqual(2);
  });

  it('never queries Stripe customers by email', () => {
    expect(src).not.toMatch(/customers\.list\(/);
    expect(src).not.toMatch(/email:\s*user\.email/);
    expect(src).toMatch(/metadata\['agency_id'\]/);
    expect(src).toMatch(/metadata\['owner_user_id'\]/);
  });

  it('contains no raw exception logging or raw error responses', () => {
    expect(src).not.toMatch(/\be\.message\b/);
    expect(src).not.toMatch(/\bString\(\s*e\s*\)/);
    expect(src).not.toMatch(/\.stack\b/);
    expect(src).not.toMatch(/log\("ERROR"/);
    expect(src).not.toMatch(/json\(\{\s*error:/);
    expect(src).toContain('log("request_failed"');
  });

  it('persists only stripe_customer_id + updated_at to agency_entitlements', () => {
    const saveIdx = src.indexOf('async saveCustomerId');
    expect(saveIdx).toBeGreaterThan(-1);
    const body = src.slice(saveIdx, saveIdx + 900);
    expect(body).toContain('stripe_customer_id: customerId');
    expect(body).toContain('updated_at:');
    expect(body).not.toMatch(/plan_key:/);
    expect(body).not.toMatch(/status:/);
    expect(body).not.toMatch(/stripe_subscription_id:/);
  });

  it('isolates the agency customer ID on agency_entitlements only', () => {
    expect(src).toMatch(/agency_entitlements/);
    // Must NOT reuse driver subscriptions for customer storage.
    expect(src).not.toMatch(/from\("subscriptions"\)/);
    expect(src).not.toMatch(/from\("profiles"\)/);
  });

  it('always tags Stripe session + subscription metadata with billing_context="agency"', () => {
    const shared = read('supabase/functions/_shared/agency-checkout.ts');
    expect(shared).toMatch(/billing_context:\s*"agency"/);
    expect(shared).toMatch(/billing_type:\s*"agency"/);
    expect(shared).toMatch(/agency_id:\s*input\.agencyId/);
    expect(shared).toMatch(/owner_user_id:\s*input\.ownerUserId/);
    expect(shared).toMatch(/plan_key:\s*input\.planKey/);
    // The adapter forwards the same metadata to session + subscription_data.
    expect(src).toMatch(/subscription_data:\s*\{\s*metadata\s*\}/);
  });

  it('uses success/cancel URLs under /agency', () => {
    const shared = read('supabase/functions/_shared/agency-checkout.ts');
    expect(shared).toMatch(/\/agency\?billing=success/);
    expect(shared).toMatch(/\/agency\?billing=cancelled/);
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
    expect(src).toMatch(/case\s+"trialing":\s*return\s+"trialing"/);  // trial-allowlist: Stripe subscription status
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

describe('Phase 8B / 1S-A2 — cancelled blocks new billable mutations (SQL)', () => {
  // The Phase 1S-A2 candidate carries the latest definition; production
  // migrations carry the previous one. Read both so the assertion tracks the
  // newest authored definition.
  const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
  const candidatesDir = path.join(process.cwd(), 'supabase/migration-candidates');
  const allSql = [migrationsDir, candidatesDir]
    .flatMap((dir) =>
      fs
        .readdirSync(dir)
        .sort()
        .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')),
    )
    .join('\n');

  it('latest assert_agency_limit blocks when status is cancelled', () => {
    const idx = allSql.lastIndexOf('CREATE OR REPLACE FUNCTION public.assert_agency_limit');
    expect(idx).toBeGreaterThan(-1);
    const body = allSql.slice(idx, idx + 3000);
    expect(body).toMatch(/lim\.status\s*=\s*'cancelled'/);
    // Phase 1S-A2 replaced the "Restart your %" wording with copy that is
    // truthful for never-started billing too.
    expect(body).toMatch(/Agency billing is not active\./);
    expect(body).toMatch(/Start or restart your %/);
    expect(body).not.toMatch(/Agency billing is cancelled\. Restart your %/);
    expect(body).toMatch(/ERRCODE = 'P0001'/);
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

  // --- Phase 1S-A2 never-started vs previously-cancelled ------------------

  it('derives billingNeverStarted from cancelled status with no Stripe identity', () => {
    expect(card).toContain('billingNeverStarted');
    const idx = card.indexOf('const billingNeverStarted');
    expect(idx).toBeGreaterThan(-1);
    const decl = card.slice(idx, idx + 260);
    expect(decl).toMatch(/entitlement\.status === 'cancelled'/);
    expect(decl).toMatch(/!entitlement\.stripeCustomerId/);
    expect(decl).toMatch(/!entitlement\.stripeSubscriptionId/);
  });

  it('shows a "Not active" badge when billing was never started', () => {
    expect(card).toMatch(/billingNeverStarted[\s\S]{0,160}Not active/);
  });

  it('says billing has not started and names the blocked actions', () => {
    expect(card).toMatch(/Agency billing has not been started/);
    expect(card).toMatch(/agency members/);
    expect(card).toMatch(/driver clients/);
    expect(card).toMatch(/service packages/);
  });

  it('uses Start (never started) vs Restart (previously cancelled) CTAs', () => {
    expect(card).toContain('previouslyCancelled');
    expect(card).toMatch(
      /previouslyCancelled\s*\?\s*`Restart Billing —[\s\S]{0,120}`Start Agency Billing —/,
    );
  });

  it('shows explicit grandfathered beta copy only for manual_beta rows', () => {
    expect(card).toMatch(/const isGrandfatheredBeta\s*=\s*entitlement\.status === 'manual_beta'/);
    expect(card).toMatch(/Grandfathered beta workspace/);
    expect(card).not.toMatch(/your agency workspace is open at Agency Starter limits/i);
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

  // --- Phase 1R-D1 safe client contracts ----------------------------------

  it('imports the safe agency checkout parser and exact URL validator', () => {
    expect(card).toMatch(/from\s+'@\/lib\/agencyCheckoutMessages'/);
    expect(card).toContain('parseAgencyCheckoutError');
    expect(card).toContain('isSafeAgencyStripeCheckoutUrl');
  });

  it('redirects only through the exact Stripe Checkout URL validator', () => {
    expect(card).toMatch(/if\s*\(isSafeAgencyStripeCheckoutUrl\(data\?\.url\)\)/);
  });

  it('never displays raw server content in the checkout handler', () => {
    const start = card.indexOf('const startCheckout');
    const end = card.indexOf('const openPortal');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = card.slice(start, end);
    expect(handler).not.toMatch(/e\?\.message/);
    expect(handler).not.toMatch(/data\?\.error/);
    expect(handler).not.toMatch(/new Error\(/);
  });

  it('guards against duplicate checkout clicks with a single busy state', () => {
    expect(card).toContain('if (busy) return;');
    expect(card).toMatch(/disabled=\{busy\}/);
  });

  it('leaves the portal flow unchanged in this phase', () => {
    expect(card).toMatch(/supabase\.functions\.invoke\(\s*['\"]agency-customer-portal['\"]/);
  });
});

describe('Phase 1R-D1 — safe agency checkout client messages', () => {
  const src = read('src/lib/agencyCheckoutMessages.ts');

  it('parses Supabase FunctionsError context JSON safely', () => {
    expect(src).toContain('context');
    expect(src).toContain('json()');
    expect(src).toContain('parseAgencyCheckoutError');
  });

  it('uses exact-host Stripe Checkout validation, never suffix matching', () => {
    expect(src).toContain("u.hostname.toLowerCase() === 'checkout.stripe.com'");
    expect(src).not.toMatch(/endsWith\(\s*['\"]\.?stripe\.com/);
  });

  it('defines the required cross-context and subscription messages verbatim', () => {
    expect(src).toContain(
      'You already have recruiter premium billing. Manage or end that subscription before starting agency billing.',
    );
    expect(src).toContain(
      'We could not safely confirm your existing business billing. Please contact support.',
    );
    expect(src).toContain(
      'Agency billing already exists. Use Manage Billing to review it.',
    );
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
