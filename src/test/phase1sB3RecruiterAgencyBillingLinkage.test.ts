// Phase 1S-B3 — Recruiter / Agency billing linkage contract.
//
// Source-contract suite. No network, Stripe SDK, Supabase client, timers,
// snapshots, or production DB access. It protects the Phase 1S-B2 identity
// contract across billing:
//   - auth account identity      = user.id / user.email
//   - recruiter business identity = recruiter_profiles.id
//   - agency business identity    = agency_profiles.id
//   - agency billing owner        = agency_profiles.owner_user_id AND an
//                                   active agency_owner membership
//   - email (auth or recruiter_email) is NEVER an ownership, authorization,
//     customer-lookup, or subscription-linkage key.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const RECRUITER_CHECKOUT = read('supabase/functions/create-recruiter-checkout/index.ts');
const RECRUITER_CHECKOUT_SHARED = read('supabase/functions/_shared/recruiter-checkout.ts');
const RECRUITER_PORTAL = read('supabase/functions/recruiter-billing-portal/index.ts');
const AGENCY_CHECKOUT = read('supabase/functions/create-agency-checkout/index.ts');
const AGENCY_CHECKOUT_SHARED = read('supabase/functions/_shared/agency-checkout.ts');
const AGENCY_PORTAL = read('supabase/functions/agency-customer-portal/index.ts');
const WEBHOOK = read('supabase/functions/stripe-webhook/index.ts');
const RESOLVER = read('src/lib/billing/effectiveBusinessEntitlement.ts');
const B3_SELF = read('src/test/phase1sB3RecruiterAgencyBillingLinkage.test.ts');

const squash = (s: string) => s.replace(/\s+/g, ' ');

describe('Phase 1S-B3 — recruiter billing identity linkage', () => {
  it('1. recruiter checkout resolves recruiter_profiles.id from the auth user id', () => {
    const s = squash(RECRUITER_CHECKOUT);
    expect(s).toContain(".from(\"recruiter_profiles\")");
    expect(s).toMatch(/\.select\("id, user_id[^"]*"\) \.eq\("user_id", user\.id\)/);
    // recruiter business identity flows as recruiter.id, not user.id / email.
    expect(s).toContain('_recruiter_id: recruiter.id');
    expect(s).not.toMatch(/\.eq\("recruiter_email"/);
    expect(s).not.toMatch(/customers\.list\(\s*\{\s*email/);
  });

  it('2. recruiter Stripe customer metadata carries both user_id and recruiter_id; lookup is metadata-exact, never email', () => {
    const shared = squash(RECRUITER_CHECKOUT_SHARED);
    expect(shared).toContain('user_id: input.userId');
    expect(shared).toContain('recruiter_id: input.recruiterId');
    expect(shared).toContain('customer.metadata["recruiter_id"] === input.recruiterId');
    expect(shared).toContain('customer.metadata["user_id"] === input.userId');
    expect(shared).toContain('metadata search (never email)'.replace('search (never email)', 'search (never email)'.slice(0, 0)) || '');
    const edge = squash(RECRUITER_CHECKOUT);
    expect(edge).toContain("metadata['recruiter_id']");
    expect(edge).toContain("metadata['user_id']");
    expect(edge).not.toContain("metadata['email']");
    expect(edge).not.toMatch(/customers\.search\(\{ query: `email/);
  });

  it('3. recruiter billing portal resolves recruiter_profiles.id and requires recruiter_id AND user_id', () => {
    const s = squash(RECRUITER_PORTAL);
    expect(s).toContain('.from("recruiter_profiles") .select("id") .eq("user_id", user.id)');
    expect(s).toContain('.from("recruiter_billing_profiles")');
    expect(s).toContain('.eq("recruiter_id", recruiterId) .eq("user_id", user.id)');
    // fail closed when no recruiter business identity exists
    expect(s).toMatch(/if \(!recruiterId\) \{ throw new Error\(/);
    expect(RECRUITER_PORTAL).not.toContain('recruiter_email');
    expect(s).not.toMatch(/\.eq\("email"/);
  });
});

describe('Phase 1S-B3 — agency billing identity linkage', () => {
  it('4. agency checkout requires canonical owner_user_id AND active agency_owner membership before claim/Stripe work', () => {
    const s = squash(AGENCY_CHECKOUT);
    expect(s).toContain('.from("agency_profiles") .select("id, owner_user_id") .eq("id", agencyId)');
    expect(s).toContain('if (!agency || agency.owner_user_id !== user.id)');
    expect(s).toContain('.from("agency_members") .select("id, role, status") .eq("agency_id", agencyId) .eq("member_user_id", user.id)');
    expect(s).toContain("ownerRow.role !== \"agency_owner\"");

    // ownership checks precede claim acquisition and Stripe construction
    const ownerIdx = AGENCY_CHECKOUT.indexOf('agency.owner_user_id !== user.id');
    const memberIdx = AGENCY_CHECKOUT.indexOf('ownerRow.role !== "agency_owner"');
    const claimIdx = AGENCY_CHECKOUT.indexOf('beginBusinessCheckout(');
    const stripeIdx = AGENCY_CHECKOUT.indexOf('new Stripe(stripeKey');
    expect(ownerIdx).toBeGreaterThan(-1);
    expect(memberIdx).toBeGreaterThan(ownerIdx);
    expect(claimIdx).toBeGreaterThan(memberIdx);
    expect(stripeIdx).toBeGreaterThan(memberIdx);
  });

  it('5. agency claim subject is agencyId and Stripe metadata is agency_id + owner_user_id + plan_key; email is contact-only', () => {
    const s = squash(AGENCY_CHECKOUT);
    expect(s).toContain('context: "agency", subjectId: agencyId');
    expect(s).toContain('It is NEVER used to look up or reuse a Stripe customer');
    const shared = squash(AGENCY_CHECKOUT_SHARED);
    expect(shared).toContain('agency_id: input.agencyId');
    expect(shared).toContain('owner_user_id: input.ownerUserId');
    expect(shared).toContain('plan_key: input.planKey');
    expect(shared).not.toMatch(/customers\.list\(\s*\{\s*email/);
    expect(shared).not.toContain("metadata['email']");
  });

  it('6. agency customer portal requires canonical owner + active owner membership before reading agency_entitlements', () => {
    const s = squash(AGENCY_PORTAL);
    expect(s).toContain('.from("agency_profiles") .select("id, owner_user_id") .eq("id", agencyId)');
    expect(s).toContain('if (!agency || agency.owner_user_id !== user.id)');
    expect(s).toContain('.eq("member_user_id", user.id)');
    const ownerIdx = AGENCY_PORTAL.indexOf('agency.owner_user_id !== user.id');
    const memberIdx = AGENCY_PORTAL.indexOf('ownerRow.role !== "agency_owner"');
    const entIdx = AGENCY_PORTAL.indexOf('.from("agency_entitlements")');
    const portalIdx = AGENCY_PORTAL.indexOf('billingPortal.sessions.create');
    expect(ownerIdx).toBeGreaterThan(-1);
    expect(memberIdx).toBeGreaterThan(ownerIdx);
    expect(entIdx).toBeGreaterThan(memberIdx);
    expect(portalIdx).toBeGreaterThan(entIdx);
    expect(AGENCY_PORTAL).not.toContain('recruiter_billing_profiles');
    expect(squash(AGENCY_PORTAL)).not.toMatch(/\.eq\("email"/);
  });
});

describe('Phase 1S-B3 — webhook canonical binding linkage', () => {
  it('7. canonical bindings use recruiter_id and agency_id, never email', () => {
    const s = squash(WEBHOOK);
    expect(s).toContain('context: "recruiter", entity_key: r.recruiter_id');
    expect(s).toContain('context: "agency", entity_key: r.agency_id');
    expect(s).not.toMatch(/\.eq\("stripe_customer_id", email/);
    expect(s).not.toMatch(/\.eq\("recruiter_email"/);
    expect(s).not.toMatch(/customers\.list\(\s*\{\s*email/);
  });

  it('8. recruiter ownership is recruiter_profiles.id -> user_id and initial binding resolves a non-null owner', () => {
    const s = squash(WEBHOOK);
    expect(s).toContain('.from("recruiter_profiles").select("user_id").eq("id", recruiter_id)');
    expect(s).toContain('let ownerUserId: string | null =');
    expect(s).toContain('if (typeof resolved !== "string" || resolved.length === 0) { throw new Error("recruiter owner missing during initial binding"); }');
    expect(s).toContain('ownerUserId = resolved;');
    expect(s).toContain('recruiter_id: entityKey, user_id: ownerUserId,');
    // the legacy no-op assignment that could leave ownerUserId undefined is gone
    expect(s).not.toContain('existing && (existing.user_id = rp.user_id)');
  });

  it('9. webhook agency ownership requires agency_profiles.owner_user_id plus active agency_owner membership', () => {
    const gatewayStart = WEBHOOK.indexOf('async agencyOwnerIs(');
    expect(gatewayStart).toBeGreaterThan(-1);
    const block = squash(WEBHOOK.slice(gatewayStart, gatewayStart + 1600));
    expect(block).toContain('.from("agency_profiles") .select("owner_user_id") .eq("id", agency_id)');
    expect(block).toContain('if (typeof canonicalOwner !== "string" || canonicalOwner.length === 0) return false;');
    expect(block).toContain('if (owner_user_id && owner_user_id !== canonicalOwner) return false;');
    expect(block).toContain('.eq("member_user_id", canonicalOwner) .eq("role", "agency_owner") .eq("status", "active")');
    expect(block).toContain('return !!membership?.member_user_id;');
    expect(block).not.toContain('email');
  });

  it('10. recruiter and agency entitlement writes stay context-separated with no mirroring', () => {
    const start = WEBHOOK.indexOf('async function applyEntitlement(');
    const end = WEBHOOK.indexOf('async function applyRevoke(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = WEBHOOK.slice(start, end);

    const recruiterStart = body.indexOf('if (context === "recruiter")');
    const agencyStart = body.indexOf('// agency');
    expect(recruiterStart).toBeGreaterThan(-1);
    expect(agencyStart).toBeGreaterThan(recruiterStart);

    const recruiterBranch = body.slice(recruiterStart, agencyStart);
    const agencyBranch = body.slice(agencyStart);
    expect(recruiterBranch).toContain('.from("recruiter_billing_profiles").upsert(');
    expect(recruiterBranch).not.toContain('agency_entitlements');
    expect(agencyBranch).toContain('.from("agency_entitlements").upsert(');
    expect(agencyBranch).not.toContain('recruiter_billing_profiles');
  });
});

describe('Phase 1S-B3 — effective entitlement invariants preserved', () => {
  it('11. agency-included recruiter premium stays owner-only and dual paid business entitlement fails closed', () => {
    const s = squash(RESOLVER);
    expect(s).toContain('mapAgencyPlanToIncludedRecruiterTier');
    expect(/isAgencyOwner/.test(RESOLVER)).toBe(true);
    expect(/conflict|fail[- ]?closed|dual/i.test(RESOLVER)).toBe(true);
  });

  it('12. the B3 suite contains no skip/only/todo', () => {
    expect(B3_SELF).not.toMatch(/\b(describe|it|test)\.(skip|only|todo)\b/);
  });
});
