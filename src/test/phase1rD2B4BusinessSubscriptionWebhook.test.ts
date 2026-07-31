// Phase 1R-D2-B4 — webhook-driven activation and fail-closed reconciliation
// of the canonical paid business subscription.
//
// Pure Vitest + static source inspection only: no network, no Stripe SDK, no
// Supabase client, no connected database, no fake timers, no snapshots, and
// no focused/skipped/todo tests.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  reconcileBusinessSubscriptionActivation,
  type AgencyEntitlementRowShape,
  type BusinessReconciliationDecision,
  type BusinessReconciliationGateway,
  type BusinessReconciliationInput,
  type RecruiterBillingRowShape,
} from '../../supabase/functions/_shared/business-subscription-reconciliation';
import { TERMINAL_STATUSES } from '../../supabase/functions/_shared/stripe-webhook-identity';
import { mapAgencyPlanToIncludedRecruiterTier } from '@/lib/billing/effectiveBusinessEntitlement';

const ROOT = resolve(__dirname, '../..');
const RECONCILIATION_PATH = resolve(
  ROOT,
  'supabase/functions/_shared/business-subscription-reconciliation.ts',
);
const IDENTITY_PATH = resolve(ROOT, 'supabase/functions/_shared/stripe-webhook-identity.ts');
const WEBHOOK_PATH = resolve(ROOT, 'supabase/functions/stripe-webhook/index.ts');
const TEST_PATH = resolve(ROOT, 'src/test/phase1rD2B4BusinessSubscriptionWebhook.test.ts');

const reconciliationSource = readFileSync(RECONCILIATION_PATH, 'utf8');
/** Comment-stripped view: hygiene markers are proven against real code only. */
const reconciliationCode = reconciliationSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const identitySource = readFileSync(IDENTITY_PATH, 'utf8');
const webhookSource = readFileSync(WEBHOOK_PATH, 'utf8');
const testSource = readFileSync(TEST_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface HarnessOptions {
  ownerUserId?: string | null;
  recruiterRows?: unknown;
  agencyRows?: unknown;
  throwOn?: 'owner' | 'recruiterRows' | 'agencyRows';
}

interface Harness {
  gateway: BusinessReconciliationGateway;
  calls: string[];
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const gateway: BusinessReconciliationGateway = {
    async resolveOwnerUserId(context, entityKey) {
      calls.push(`resolveOwnerUserId:${context}:${entityKey}`);
      if (options.throwOn === 'owner') throw new Error('pg: relation "x" does not exist');
      return options.ownerUserId === undefined ? 'owner-1' : options.ownerUserId;
    },
    async loadRecruiterBillingRows(ownerUserId) {
      calls.push(`loadRecruiterBillingRows:${ownerUserId}`);
      if (options.throwOn === 'recruiterRows') throw new Error('pg: permission denied for table');
      return (options.recruiterRows ?? []) as RecruiterBillingRowShape[];
    },
    async loadOwnedAgencyEntitlementRows(ownerUserId) {
      calls.push(`loadOwnedAgencyEntitlementRows:${ownerUserId}`);
      if (options.throwOn === 'agencyRows') throw new Error('pg: permission denied for table');
      return (options.agencyRows ?? []) as AgencyEntitlementRowShape[];
    },
  };
  return { gateway, calls };
}

function makeInput(
  overrides: Partial<Omit<BusinessReconciliationInput, 'gateway'>>,
  gateway: BusinessReconciliationGateway,
): BusinessReconciliationInput {
  return {
    context: 'recruiter',
    entityKey: 'entity-1',
    eventType: 'customer.subscription.updated',
    incomingStatus: 'active',
    gateway,
    ...overrides,
  };
}

const ALLOW: BusinessReconciliationDecision = { kind: 'allow' };

function agencyRow(over: Partial<AgencyEntitlementRowShape> = {}): AgencyEntitlementRowShape {
  return { agency_id: 'agency-1', plan_key: 'agency_team', status: 'active', source: 'stripe', ...over };
}

function recruiterRow(over: Partial<RecruiterBillingRowShape> = {}): RecruiterBillingRowShape {
  return { recruiter_id: 'recruiter-1', plan: 'growth', status: 'active', ...over };
}

// ---------------------------------------------------------------------------
// 1. Runtime-neutral / static hygiene
// ---------------------------------------------------------------------------

describe('Phase 1R-D2-B4 — pure module hygiene', () => {
  it('contains no Deno, Supabase, Stripe, URL-import, env, timer, or network usage', () => {
    const forbidden = [
      'Deno.',
      '@supabase/supabase-js',
      'createClient',
      'from "stripe',
      'esm.sh',
      'deno.land',
      'https://',
      'process.env',
      'Date.now(',
      'new Date(',
      'setTimeout',
      'setInterval',
      'fetch(',
      'localStorage',
      'sessionStorage',
      'react',
    ];
    for (const marker of forbidden) {
      expect(reconciliationCode.includes(marker), `forbidden marker: ${marker}`).toBe(false);
    }
  });

  it('performs no writes and imports only the identity module', () => {
    for (const marker of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      expect(reconciliationCode.includes(marker)).toBe(false);
    }
    const imports: string[] = reconciliationCode.match(/from\s+"([^"]+)"/g) ?? [];
    expect(imports.every((line) => line.includes('./stripe-webhook-identity.ts'))).toBe(true);

  });

  it('exports the exact required concepts', () => {
    expect(typeof reconcileBusinessSubscriptionActivation).toBe('function');
    for (const name of [
      'BusinessReconciliationGateway',
      'BusinessReconciliationInput',
      'BusinessReconciliationDecision',
      'reconcileBusinessSubscriptionActivation',
    ]) {
      expect(reconciliationSource.includes(name)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2–3. Driver bypass and terminal revocation
// ---------------------------------------------------------------------------

describe('Phase 1R-D2-B4 — bypass paths', () => {
  it('driver context allows with zero gateway calls', async () => {
    const h = makeHarness({ agencyRows: [agencyRow()] });
    const decision = await reconcileBusinessSubscriptionActivation(
      makeInput({ context: 'driver', entityKey: 'user-1' }, h.gateway),
    );
    expect(decision).toEqual(ALLOW);
    expect(h.calls).toEqual([]);
  });

  it('customer.subscription.deleted allows with zero opposing-row reads', async () => {
    for (const context of ['recruiter', 'agency'] as const) {
      const h = makeHarness({ agencyRows: [agencyRow()], recruiterRows: [recruiterRow()] });
      const decision = await reconcileBusinessSubscriptionActivation(
        makeInput(
          { context, eventType: 'customer.subscription.deleted', incomingStatus: 'active' },
          h.gateway,
        ),
      );
      expect(decision).toEqual(ALLOW);
      expect(h.calls).toEqual([]);
    }
  });

  it('every TERMINAL_STATUSES status allows with zero opposing-row reads', async () => {
    expect(TERMINAL_STATUSES.size).toBeGreaterThan(0);
    for (const status of TERMINAL_STATUSES) {
      for (const context of ['recruiter', 'agency'] as const) {
        const h = makeHarness({ agencyRows: [agencyRow()], recruiterRows: [recruiterRow()] });
        const decision = await reconcileBusinessSubscriptionActivation(
          makeInput({ context, incomingStatus: status }, h.gateway),
        );
        expect(decision, `status ${status} / ${context}`).toEqual(ALLOW);
        expect(h.calls).toEqual([]);
      }
    }
  });

  it('non-billing-maintaining, non-terminal statuses allow without reads', async () => {
    for (const status of ['incomplete', 'paused', 'unknown_status', null]) {
      const h = makeHarness({ agencyRows: [agencyRow()] });
      const decision = await reconcileBusinessSubscriptionActivation(
        makeInput({ context: 'recruiter', incomingStatus: status }, h.gateway),
      );
      expect(decision, `status ${String(status)}`).toEqual(ALLOW);
      expect(h.calls).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 4–7. Recruiter activation vs owned agency entitlements
// ---------------------------------------------------------------------------

describe('Phase 1R-D2-B4 — recruiter activation vs agency rows', () => {
  const guardedStatuses = ['active', 'trialing', 'past_due'] as const; // trial-allowlist: Stripe subscription status literal, not user-facing copy

  it('allows when the owner holds no agency entitlement row', async () => {
    for (const status of guardedStatuses) {
      const h = makeHarness({ agencyRows: [] });
      const decision = await reconcileBusinessSubscriptionActivation(
        makeInput({ context: 'recruiter', incomingStatus: status }, h.gateway),
      );
      expect(decision).toEqual(ALLOW);
      expect(h.calls).toEqual([
        'resolveOwnerUserId:recruiter:entity-1',
        'loadOwnedAgencyEntitlementRows:owner-1',
      ]);
    }
  });

  it('blocks on active, trialing, and stripe past_due agency rows', async () => { // trial-allowlist: Stripe subscription status literal, not user-facing copy
    const blocking = [
      agencyRow({ status: 'active' }),
      agencyRow({ status: 'trialing' }), // trial-allowlist: Stripe subscription status literal, not user-facing copy
      agencyRow({ status: 'past_due', source: 'stripe' }),
      agencyRow({ status: 'active', source: 'manual' }),
      agencyRow({ status: 'active', source: 'admin_seed' }),
    ];
    for (const row of blocking) {
      const h = makeHarness({ agencyRows: [row] });
      const decision = await reconcileBusinessSubscriptionActivation(
        makeInput({ context: 'recruiter' }, h.gateway),
      );
      expect(decision, JSON.stringify(row)).toEqual({
        kind: 'reject',
        reason: 'opposing_business_subscription_active',
      });
    }
  });

  it('allows manual_beta and cancelled agency rows', async () => {
    for (const status of ['manual_beta', 'cancelled']) {
      const h = makeHarness({ agencyRows: [agencyRow({ status })] });
      const decision = await reconcileBusinessSubscriptionActivation(
        makeInput({ context: 'recruiter' }, h.gateway),
      );
      expect(decision, status).toEqual(ALLOW);
    }
  });

  it('fails unknown for malformed plan_key, source, status, and non-stripe past_due', async () => {
    const malformed: unknown[] = [
      agencyRow({ plan_key: 'assistant_free' }),
      agencyRow({ plan_key: null }),
      agencyRow({ plan_key: '' }),
      agencyRow({ source: 'legacy_import' }),
      agencyRow({ source: null }),
      agencyRow({ status: 'incomplete' }),
      agencyRow({ status: null }),
      agencyRow({ status: '' }),
      agencyRow({ status: 'past_due', source: 'manual' }),
      agencyRow({ status: 'past_due', source: 'admin_seed' }),
      null,
      'not-a-row',
      42,
      [],
    ];
    for (const row of malformed) {
      const h = makeHarness({ agencyRows: [row] });
      const decision = await reconcileBusinessSubscriptionActivation(
        makeInput({ context: 'recruiter' }, h.gateway),
      );
      expect(decision, JSON.stringify(row)).toEqual({
        kind: 'reject',
        reason: 'opposing_business_state_unknown',
      });
    }
  });

  it('fails unknown when the agency row loader throws, without leaking error text', async () => {
    const h = makeHarness({ throwOn: 'agencyRows' });
    const decision = await reconcileBusinessSubscriptionActivation(
      makeInput({ context: 'recruiter' }, h.gateway),
    );
    expect(decision).toEqual({ kind: 'reject', reason: 'opposing_business_state_unknown' });
    expect(JSON.stringify(decision)).not.toContain('permission denied');
  });
});

// ---------------------------------------------------------------------------
// 8–11. Agency activation vs recruiter billing rows
// ---------------------------------------------------------------------------

describe('Phase 1R-D2-B4 — agency activation vs recruiter rows', () => {
  it('allows when the owner holds no recruiter billing row', async () => {
    const h = makeHarness({ recruiterRows: [] });
    const decision = await reconcileBusinessSubscriptionActivation(
      makeInput({ context: 'agency' }, h.gateway),
    );
    expect(decision).toEqual(ALLOW);
    expect(h.calls).toEqual([
      'resolveOwnerUserId:agency:entity-1',
      'loadRecruiterBillingRows:owner-1',
    ]);
  });

  it('blocks paid recruiter rows in every blocking status', async () => {
    const blocking = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']; // trial-allowlist: Stripe subscription status literal, not user-facing copy
    for (const plan of ['starter', 'growth', 'fleet']) {
      for (const status of blocking) {
        const h = makeHarness({ recruiterRows: [recruiterRow({ plan, status })] });
        const decision = await reconcileBusinessSubscriptionActivation(
          makeInput({ context: 'agency' }, h.gateway),
        );
        expect(decision, `${plan}/${status}`).toEqual({
          kind: 'reject',
          reason: 'opposing_business_subscription_active',
        });
      }
    }
  });

  it('allows well-formed canceled, incomplete_expired, and inactive recruiter rows', async () => {
    for (const status of ['canceled', 'incomplete_expired', 'inactive']) {
      const h = makeHarness({ recruiterRows: [recruiterRow({ plan: 'growth', status })] });
      const decision = await reconcileBusinessSubscriptionActivation(
        makeInput({ context: 'agency' }, h.gateway),
      );
      expect(decision, status).toEqual(ALLOW);
    }
  });

  it('allows the canonical revoked recruiter row: plan none with a terminal status', async () => {
    // Phase 1R-D2-B4-R2 — the webhook revoke writer sets plan "none" alongside a
    // terminal status. That canonical row must never block a later agency
    // activation the B2 checkout state machine already permitted.
    for (const status of ['canceled', 'incomplete_expired', 'inactive']) {
      const h = makeHarness({ recruiterRows: [recruiterRow({ plan: 'none', status })] });
      const decision = await reconcileBusinessSubscriptionActivation(
        makeInput({ context: 'agency' }, h.gateway),
      );
      expect(decision, `none/${status}`).toEqual(ALLOW);
    }
  });

  it('fails unknown for plan none paired with a live or recoverable status', async () => {
    // A non-paid plan carrying a live/recoverable status is contradictory state.
    const contradictory = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']; // trial-allowlist: Stripe subscription status literal, not user-facing copy
    for (const status of contradictory) {
      const h = makeHarness({ recruiterRows: [recruiterRow({ plan: 'none', status })] });
      const decision = await reconcileBusinessSubscriptionActivation(
        makeInput({ context: 'agency' }, h.gateway),
      );
      expect(decision, `none/${status}`).toEqual({
        kind: 'reject',
        reason: 'opposing_business_state_unknown',
      });
    }
  });

  it('fails unknown for null/empty/unknown status, unknown or missing plan, and malformed rows', async () => {
    const malformed: unknown[] = [
      recruiterRow({ status: null }),
      recruiterRow({ status: '' }),
      recruiterRow({ status: 'weird_status' }),
      recruiterRow({ plan: 'enterprise' }),
      recruiterRow({ plan: null }),
      recruiterRow({ plan: '' }),
      // An unrecognized plan such as `enterprise` stays unknown even when its
      // status is one of the otherwise benign non-billing statuses.
      recruiterRow({ plan: 'enterprise', status: 'canceled' }),
      recruiterRow({ plan: 'enterprise', status: 'incomplete_expired' }),
      recruiterRow({ plan: 'enterprise', status: 'inactive' }),
      // Plan none is recognized as non-paid, but an absent or unrecognized
      // status is still unresolvable and fails closed.
      recruiterRow({ plan: 'none', status: null }),
      recruiterRow({ plan: 'none', status: '' }),
      recruiterRow({ plan: 'none', status: 'weird_status' }),
      null,
      'not-a-row',
      7,
      [],
    ];

    for (const row of malformed) {
      const h = makeHarness({ recruiterRows: [row] });
      const decision = await reconcileBusinessSubscriptionActivation(
        makeInput({ context: 'agency' }, h.gateway),
      );
      expect(decision, JSON.stringify(row)).toEqual({
        kind: 'reject',
        reason: 'opposing_business_state_unknown',
      });
    }
  });

  it('fails unknown when the recruiter row loader throws, without leaking error text', async () => {
    const h = makeHarness({ throwOn: 'recruiterRows' });
    const decision = await reconcileBusinessSubscriptionActivation(
      makeInput({ context: 'agency' }, h.gateway),
    );
    expect(decision).toEqual({ kind: 'reject', reason: 'opposing_business_state_unknown' });
    expect(JSON.stringify(decision)).not.toContain('permission denied');
  });
});

// ---------------------------------------------------------------------------
// 12–14. Precedence, owner resolution, determinism
// ---------------------------------------------------------------------------

describe('Phase 1R-D2-B4 — precedence, owner resolution, determinism', () => {
  it('applies unknown > active > allow setwise for recruiter activation', async () => {
    const benign = agencyRow({ status: 'cancelled' });
    const active = agencyRow({ status: 'active' });
    const unknown = agencyRow({ source: 'legacy_import' });

    const allowCase = makeHarness({ agencyRows: [benign, benign] });
    expect(
      await reconcileBusinessSubscriptionActivation(makeInput({ context: 'recruiter' }, allowCase.gateway)),
    ).toEqual(ALLOW);

    const activeCase = makeHarness({ agencyRows: [benign, active] });
    expect(
      await reconcileBusinessSubscriptionActivation(makeInput({ context: 'recruiter' }, activeCase.gateway)),
    ).toEqual({ kind: 'reject', reason: 'opposing_business_subscription_active' });

    for (const rows of [[active, unknown], [unknown, active], [benign, active, unknown]]) {
      const h = makeHarness({ agencyRows: rows });
      expect(
        await reconcileBusinessSubscriptionActivation(makeInput({ context: 'recruiter' }, h.gateway)),
      ).toEqual({ kind: 'reject', reason: 'opposing_business_state_unknown' });
    }
  });

  it('applies unknown > active > allow setwise for agency activation', async () => {
    const benign = recruiterRow({ plan: 'growth', status: 'canceled' });
    const active = recruiterRow({ plan: 'fleet', status: 'active' });
    const unknown = recruiterRow({ plan: 'mystery', status: 'active' });

    const allowCase = makeHarness({ recruiterRows: [benign, benign] });
    expect(
      await reconcileBusinessSubscriptionActivation(makeInput({ context: 'agency' }, allowCase.gateway)),
    ).toEqual(ALLOW);

    const activeCase = makeHarness({ recruiterRows: [benign, active] });
    expect(
      await reconcileBusinessSubscriptionActivation(makeInput({ context: 'agency' }, activeCase.gateway)),
    ).toEqual({ kind: 'reject', reason: 'opposing_business_subscription_active' });

    for (const rows of [[active, unknown], [unknown, active], [benign, active, unknown]]) {
      const h = makeHarness({ recruiterRows: rows });
      expect(
        await reconcileBusinessSubscriptionActivation(makeInput({ context: 'agency' }, h.gateway)),
      ).toEqual({ kind: 'reject', reason: 'opposing_business_state_unknown' });
    }
  });

  it('ranks a revoked none row benign and a contradictory none row above an active paid row', async () => {
    const active = recruiterRow({ plan: 'fleet', status: 'active' });
    const revokedNone = recruiterRow({
      recruiter_id: 'recruiter-2',
      plan: 'none',
      status: 'canceled',
    });
    const contradictoryNone = recruiterRow({
      recruiter_id: 'recruiter-3',
      plan: 'none',
      status: 'active',
    });

    // The canonical revoked row is benign and does not block on its own.
    const alone = makeHarness({ recruiterRows: [revokedNone] });
    expect(
      await reconcileBusinessSubscriptionActivation(makeInput({ context: 'agency' }, alone.gateway)),
    ).toEqual(ALLOW);

    // Two revoked rows are still benign setwise.
    const pair = makeHarness({ recruiterRows: [revokedNone, revokedNone] });
    expect(
      await reconcileBusinessSubscriptionActivation(makeInput({ context: 'agency' }, pair.gateway)),
    ).toEqual(ALLOW);

    // A revoked row alongside a genuinely active paid row yields active, not unknown.
    for (const rows of [[active, revokedNone], [revokedNone, active]]) {
      const h = makeHarness({ recruiterRows: rows });
      expect(
        await reconcileBusinessSubscriptionActivation(makeInput({ context: 'agency' }, h.gateway)),
      ).toEqual({ kind: 'reject', reason: 'opposing_business_subscription_active' });
    }

    // A contradictory none row is unknown alone.
    const contradictoryAlone = makeHarness({ recruiterRows: [contradictoryNone] });
    expect(
      await reconcileBusinessSubscriptionActivation(
        makeInput({ context: 'agency' }, contradictoryAlone.gateway),
      ),
    ).toEqual({ kind: 'reject', reason: 'opposing_business_state_unknown' });

    // And it outranks a separate valid active paid row in both orders.
    for (const rows of [[active, contradictoryNone], [contradictoryNone, active]]) {
      const h = makeHarness({ recruiterRows: rows });
      expect(
        await reconcileBusinessSubscriptionActivation(makeInput({ context: 'agency' }, h.gateway)),
      ).toEqual({ kind: 'reject', reason: 'opposing_business_state_unknown' });
    }
  });


  it('returns business_owner_unresolved when owner resolution yields nothing', async () => {
    for (const ownerUserId of [null, '']) {
      for (const context of ['recruiter', 'agency'] as const) {
        const h = makeHarness({ ownerUserId });
        const decision = await reconcileBusinessSubscriptionActivation(
          makeInput({ context }, h.gateway),
        );
        expect(decision).toEqual({ kind: 'reject', reason: 'business_owner_unresolved' });
        expect(h.calls).toEqual([`resolveOwnerUserId:${context}:entity-1`]);
      }
    }
  });

  it('returns opposing_business_state_unknown when owner resolution throws', async () => {
    const h = makeHarness({ throwOn: 'owner' });
    const decision = await reconcileBusinessSubscriptionActivation(
      makeInput({ context: 'recruiter' }, h.gateway),
    );
    expect(decision).toEqual({ kind: 'reject', reason: 'opposing_business_state_unknown' });
    expect(JSON.stringify(decision)).not.toContain('does not exist');
  });

  it('never mutates its input and is deterministically deep-equal across runs', async () => {
    const h = makeHarness({ agencyRows: [agencyRow({ status: 'active' })] });
    const input = makeInput({ context: 'recruiter' }, h.gateway);
    const before = JSON.stringify({ ...input, gateway: undefined });

    const first = await reconcileBusinessSubscriptionActivation(input);
    const second = await reconcileBusinessSubscriptionActivation(input);

    expect(JSON.stringify({ ...input, gateway: undefined })).toBe(before);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

// ---------------------------------------------------------------------------
// 15–18, 20–22. Webhook source proofs
// ---------------------------------------------------------------------------

describe('Phase 1R-D2-B4 — webhook integration source proofs', () => {
  const processorStart = webhookSource.indexOf('export async function processValidatedSubscriptionEvent');
  const processorEnd = webhookSource.indexOf('async function applyEntitlement');
  const processorBody = webhookSource.slice(processorStart, processorEnd);

  it('locates the processor body', () => {
    expect(processorStart).toBeGreaterThan(-1);
    expect(processorEnd).toBeGreaterThan(processorStart);
  });

  it('validates identity before reconciliation, and reconciles before applyEntitlement', () => {
    const validate = processorBody.indexOf('await validateWebhookIdentity(');
    const reconcile = processorBody.indexOf('await reconcileBusinessSubscriptionActivation(');
    const apply = processorBody.indexOf('await applyEntitlement(');
    expect(validate).toBeGreaterThan(-1);
    expect(reconcile).toBeGreaterThan(validate);
    expect(apply).toBeGreaterThan(reconcile);
  });

  it('applies revoke before any reconciliation call', () => {
    const revoke = processorBody.indexOf('await applyRevoke(');
    const reconcile = processorBody.indexOf('await reconcileBusinessSubscriptionActivation(');
    expect(revoke).toBeGreaterThan(-1);
    expect(revoke).toBeLessThan(reconcile);
    expect(processorBody.slice(0, revoke)).not.toContain('reconcileBusinessSubscriptionActivation(');
  });

  it('returns the reject shape without mutating entitlement tables on reconciliation reject', () => {
    const rejectStart = processorBody.indexOf("if (reconciliation.kind === 'reject')") >= 0
      ? processorBody.indexOf("if (reconciliation.kind === 'reject')")
      : processorBody.indexOf('if (reconciliation.kind === "reject")');
    expect(rejectStart).toBeGreaterThan(-1);
    const rejectBlock = processorBody.slice(rejectStart, processorBody.indexOf('await applyEntitlement('));
    expect(rejectBlock).toContain('ok: false');
    expect(rejectBlock).toContain('reason: reconciliation.reason');
    for (const marker of ['.upsert(', '.update(', '.insert(', '.delete(', '.rpc(']) {
      expect(rejectBlock.includes(marker), marker).toBe(false);
    }
  });

  it('reconciliation gateway builder is read-only', () => {
    const start = webhookSource.indexOf('function buildBusinessReconciliationGateway(');
    expect(start).toBeGreaterThan(-1);
    const end = webhookSource.indexOf('function metadataFromMap(', start);
    expect(end).toBeGreaterThan(start);
    const body = webhookSource.slice(start, end);
    expect(body).toContain('.select(');
    for (const marker of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      expect(body.includes(marker), marker).toBe(false);
    }
    expect(body).toContain('recruiter_profiles');
    expect(body).toContain('agency_profiles');
    expect(body).toContain('agency_members');
    expect(body).toContain('owner_user_id');
    expect(body).not.toContain('"email"');
    expect(body).not.toContain('.eq("email"');
    expect(body).toContain('recruiter_id, plan, status');
    expect(body).toContain('agency_id, plan_key, status, source');
  });

  it('agency entitlement mutation still writes source: "stripe" and never mirrors into recruiter billing', () => {
    const applyStart = webhookSource.indexOf('async function applyEntitlement(');
    const applyEnd = webhookSource.indexOf('async function applyRevoke(');
    const applyBody = webhookSource.slice(applyStart, applyEnd);
    const agencyBlock = applyBody.slice(applyBody.indexOf('from("agency_entitlements")'));
    expect(agencyBlock).toContain('source: "stripe"');
    expect(agencyBlock).not.toContain('recruiter_billing_profiles');
    expect(agencyBlock).not.toContain('agency_starter');
    expect(agencyBlock).not.toContain('agency_team');
    expect(agencyBlock).not.toContain('agency_growth');
  });

  it('recruiter activation writes only recruiter_billing_profiles', () => {
    const applyBody = webhookSource.slice(
      webhookSource.indexOf('async function applyEntitlement('),
      webhookSource.indexOf('async function applyRevoke('),
    );
    const recruiterBlock = applyBody.slice(
      applyBody.indexOf('if (context === "recruiter")'),
      applyBody.indexOf('// agency'),
    );
    expect(recruiterBlock).toContain('from("recruiter_billing_profiles").upsert');
    expect(recruiterBlock).not.toContain('agency_entitlements');
  });

  it('configured Stripe price stays authoritative and metadata plan is never trusted', () => {
    expect(webhookSource).toContain('decision.resolvedPrice');
    expect(identitySource).toContain('resolvedPrice');
    expect(identitySource).toContain('never trusted for entitlement');
    const applyBody = webhookSource.slice(
      webhookSource.indexOf('async function applyEntitlement('),
      webhookSource.indexOf('async function applyRevoke('),
    );
    expect(applyBody).not.toContain('meta.plan_key');
    expect(applyBody).not.toContain('metadata.plan_key');
  });

  it('the reconciliation gateway is constructed per request beside identity gateway and price resolver', () => {
    expect(webhookSource).toContain('const priceResolver = buildPriceResolver();');
    expect(webhookSource).toContain('const gateway = buildGateway(supabaseClient);');
    expect(webhookSource).toContain(
      'const reconciliationGateway = buildBusinessReconciliationGateway(supabaseClient);',
    );
    expect(webhookSource).toContain('reconciliationGateway: BusinessReconciliationGateway;');
  });

  it('logs only stable reason/context/event_type on reconciliation reject', () => {
    const logStart = processorBody.indexOf('Rejected — business subscription reconciliation');
    expect(logStart).toBeGreaterThan(-1);
    const logBlock = processorBody.slice(logStart, logStart + 260);
    expect(logBlock).toContain('reason: reconciliation.reason');
    expect(logBlock).toContain('context: decision.context');
    expect(logBlock).toContain('event_type: eventType');
    expect(logBlock).not.toContain('error.message');
    expect(logBlock).not.toContain('stripe_customer_id');
  });
});

// ---------------------------------------------------------------------------
// 19, 21, 23. Contract vocabulary and test-suite hygiene
// ---------------------------------------------------------------------------

describe('Phase 1R-D2-B4 — contract vocabulary', () => {
  it('preserves the exact agency included-tier map via the existing frontend resolver', () => {
    expect(mapAgencyPlanToIncludedRecruiterTier('agency_starter')).toBe('starter');
    expect(mapAgencyPlanToIncludedRecruiterTier('agency_team')).toBe('growth');
    expect(mapAgencyPlanToIncludedRecruiterTier('agency_growth')).toBe('fleet');
  });

  it('declares the stable rejection reason vocabulary in stripe-webhook-identity.ts', () => {
    for (const reason of [
      'business_owner_unresolved',
      'opposing_business_subscription_active',
      'opposing_business_state_unknown',
    ]) {
      expect(identitySource).toContain(`| "${reason}"`);
    }
  });

  it('leaves the identity decision matrix and TERMINAL_STATUSES untouched', () => {
    expect(identitySource).toContain('export const TERMINAL_STATUSES');
    expect([...TERMINAL_STATUSES].sort()).toEqual(['canceled', 'incomplete_expired', 'unpaid']);
  });

  it('matches the canonical revoke writer, which sets recruiter plan none', () => {
    // Phase 1R-D2-B4-R2 compatibility contract, proven statically: the webhook
    // revoke writer stamps recruiter_billing_profiles.plan = "none" alongside a
    // terminal status, so the reconciliation guard must recognize plan "none" as
    // the canonical non-paid recruiter plan rather than an arbitrary unknown.
    const revokeStart = webhookSource.indexOf('recruiter_billing_profiles").update({');
    expect(revokeStart).toBeGreaterThan(-1);
    const revokeBlock = webhookSource.slice(revokeStart, revokeStart + 200);
    expect(revokeBlock).toContain('plan: "none"');
    expect(revokeBlock).toContain('status:');

    expect(reconciliationCode).toContain('if (plan === "none")');
    expect(reconciliationCode).toContain(
      'return NON_BILLING_RECRUITER_STATUSES.has(status) ? "allow" : "unknown";',
    );
  });

  it('contains no focused, skipped, or deferred tests', () => {
    const dot = '.';
    for (const marker of [
      `it${dot}only`,
      `describe${dot}only`,
      `it${dot}skip`,
      `describe${dot}skip`,
      `it${dot}todo`,
      `test${dot}only`,
    ]) {
      expect(testSource.includes(marker), marker).toBe(false);
    }
  });
});
