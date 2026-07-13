// Phase 1C — canonical billing identity validator tests.
//
// These tests drive the pure validator in
// supabase/functions/_shared/stripe-webhook-identity.ts directly. Each
// case constructs an in-memory gateway snapshot, calls the validator, and
// asserts (a) the decision kind / reason and (b) that the snapshot is
// byte-equal after rejection (i.e. the pure validator never touches state
// and rejections carry no side effects).

import { describe, it, expect } from "vitest";
import {
  validateWebhookIdentity,
  type CanonicalBinding,
  type PriceResolver,
  type ResolvedPrice,
  type WebhookDataGateway,
  type WebhookMetadata,
  type WebhookEventType,
  type IdentityDecision,
} from "../../supabase/functions/_shared/stripe-webhook-identity.ts";

// -- Price map used by every test ------------------------------------------
const PRICE_DRIVER_MONTHLY = "price_driver_monthly";
const PRICE_DRIVER_YEARLY  = "price_driver_yearly";
const PRICE_RECRUITER      = "price_recruiter_starter";
const PRICE_AGENCY         = "price_agency_starter";
const PRICE_UNKNOWN        = "price_unknown_legacy";

const resolvePrice: PriceResolver = (id): ResolvedPrice | null => {
  if (id === PRICE_DRIVER_MONTHLY) return { context: "driver", planKey: "pro_monthly" };
  if (id === PRICE_DRIVER_YEARLY)  return { context: "driver", planKey: "pro_yearly" };
  if (id === PRICE_RECRUITER)      return { context: "recruiter", planKey: "starter" };
  if (id === PRICE_AGENCY)         return { context: "agency", planKey: "agency_starter" };
  return null;
};

// -- In-memory gateway snapshot --------------------------------------------
interface Snapshot {
  drivers:    Map<string, CanonicalBinding>;
  recruiters: Map<string, CanonicalBinding>;
  agencies:   Map<string, CanonicalBinding>;
  recruiterOwners: Map<string, string>;             // recruiter_id -> user_id
  agencyOwners:    Map<string, string | null>;      // agency_id -> owner user_id or null (no owner)
  driverUsers:     Set<string>;
}

function snap(): Snapshot {
  return {
    drivers: new Map(), recruiters: new Map(), agencies: new Map(),
    recruiterOwners: new Map(), agencyOwners: new Map(), driverUsers: new Set(),
  };
}

function cloneSnap(s: Snapshot): Snapshot {
  return {
    drivers:    new Map(Array.from(s.drivers,    ([k, v]) => [k, { ...v }])),
    recruiters: new Map(Array.from(s.recruiters, ([k, v]) => [k, { ...v }])),
    agencies:   new Map(Array.from(s.agencies,   ([k, v]) => [k, { ...v }])),
    recruiterOwners: new Map(s.recruiterOwners),
    agencyOwners:    new Map(s.agencyOwners),
    driverUsers:     new Set(s.driverUsers),
  };
}

function makeGateway(s: Snapshot): WebhookDataGateway {
  const all = (): CanonicalBinding[] => [
    ...Array.from(s.drivers.values()),
    ...Array.from(s.recruiters.values()),
    ...Array.from(s.agencies.values()),
  ];
  return {
    async findByCustomerId(cid) { return all().filter((b) => b.stripe_customer_id === cid); },
    async findBySubscriptionId(sid) { return all().filter((b) => b.stripe_subscription_id === sid); },
    async loadCanonical(ctx, key) {
      const m = ctx === "driver" ? s.drivers : ctx === "recruiter" ? s.recruiters : s.agencies;
      return m.get(key) ?? null;
    },
    async recruiterOwnerIs(rid, uid) { return s.recruiterOwners.get(rid) === uid; },
    async agencyOwnerIs(aid, oid) {
      const real = s.agencyOwners.get(aid);
      if (real === undefined) return false;
      if (real === null) return false;
      if (oid && oid !== real) return false;
      return true;
    },
    async driverExists(uid) { return s.driverUsers.has(uid); },
  };
}

function meta(overrides: Partial<WebhookMetadata> = {}): WebhookMetadata {
  return {
    declaredContext: null, user_id: null, recruiter_id: null, agency_id: null,
    owner_user_id: null, plan_key: null, ...overrides,
  };
}

async function decide(
  s: Snapshot,
  overrides: {
    eventType?: WebhookEventType;
    customer: string;
    subscription?: string | null;
    status?: string | null;
    price?: string;
    metadata?: WebhookMetadata;
  },
): Promise<IdentityDecision> {
  return validateWebhookIdentity({
    eventType: overrides.eventType ?? "customer.subscription.updated",
    incomingCustomerId: overrides.customer,
    incomingSubscriptionId: overrides.subscription ?? "sub_incoming",
    incomingStatus: overrides.status ?? "active",
    priceId: overrides.price ?? PRICE_RECRUITER,
    metadata: overrides.metadata ?? meta(),
    resolvePrice,
    gateway: makeGateway(s),
  });
}

// ============================================================
// Recruiter
// ============================================================
describe("Phase 1C — recruiter canonical identity", () => {
  function baseSnap(): Snapshot {
    const s = snap();
    s.recruiterOwners.set("rec_B", "user_B");
    s.recruiterOwners.set("rec_C", "user_C");
    s.recruiters.set("rec_B", {
      context: "recruiter", entity_key: "rec_B",
      stripe_customer_id: "cus_B_canonical", stripe_subscription_id: "sub_B_canonical",
      status: "active",
    });
    return s;
  }

  it("1: matching canonical customer succeeds", async () => {
    const d = await decide(baseSnap(), {
      customer: "cus_B_canonical", subscription: "sub_B_canonical",
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_B", user_id: "user_B" }),
    });
    expect(d.kind).toBe("allow_existing_binding");
  });

  it("2/3/4/5: mismatched canonical customer is rejected; snapshot unchanged", async () => {
    const s = baseSnap();
    const before = cloneSnap(s);
    const d = await decide(s, {
      customer: "cus_ATTACKER", subscription: "sub_ATTACKER",
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_B", user_id: "user_B" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "customer_mismatch" });
    expect(s.recruiters.get("rec_B")).toEqual(before.recruiters.get("rec_B"));
  });

  it("6: metadata naming another user under a recruiter is rejected", async () => {
    const s = baseSnap();
    const d = await decide(s, {
      customer: "cus_B_canonical", subscription: "sub_B_canonical",
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_B", user_id: "user_ATTACKER" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "target_relationship_mismatch" });
  });

  it("7: customer assigned to another recruiter is rejected as collision", async () => {
    const s = baseSnap();
    // rec_C already owns cus_B_canonical in the same context
    s.recruiters.set("rec_C", {
      context: "recruiter", entity_key: "rec_C",
      stripe_customer_id: "cus_B_canonical", stripe_subscription_id: "sub_C",
      status: "active",
    });
    const d = await decide(s, {
      customer: "cus_B_canonical", subscription: "sub_new",
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_B", user_id: "user_B" }),
    });
    // The multi-binding lookup by customer collapses to cross-context collision.
    expect(d.kind).toBe("reject");
    expect((d as { reason: string }).reason).toBe("cross_context_customer_collision");
  });

  it("8/9: driver or agency customer is rejected for recruiter event", async () => {
    const s = baseSnap();
    s.driverUsers.add("user_D");
    s.drivers.set("user_D", {
      context: "driver", entity_key: "user_D",
      stripe_customer_id: "cus_shared", stripe_subscription_id: "sub_D",
      status: "active",
    });
    const d1 = await decide(s, {
      customer: "cus_shared", subscription: "sub_new",
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_B", user_id: "user_B" }),
    });
    expect(d1.kind).toBe("reject");
    s.drivers.delete("user_D");
    s.agencyOwners.set("ag_1", "user_A");
    s.agencies.set("ag_1", {
      context: "agency", entity_key: "ag_1",
      stripe_customer_id: "cus_shared", stripe_subscription_id: "sub_A",
      status: "active",
    });
    const d2 = await decide(s, {
      customer: "cus_shared", subscription: "sub_new2",
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_B", user_id: "user_B" }),
    });
    expect(d2.kind).toBe("reject");
  });

  it("10: subscription mismatch on update is rejected", async () => {
    const s = baseSnap();
    const d = await decide(s, {
      eventType: "customer.subscription.updated",
      customer: "cus_B_canonical", subscription: "sub_DIFFERENT",
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_B", user_id: "user_B" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "subscription_mismatch" });
  });

  it("11: subscription mismatch on deletion does not clear canonical", async () => {
    const s = baseSnap();
    const before = cloneSnap(s);
    const d = await decide(s, {
      eventType: "customer.subscription.deleted",
      customer: "cus_B_canonical", subscription: "sub_DIFFERENT", status: "canceled",
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_B", user_id: "user_B" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "subscription_mismatch" });
    expect(s.recruiters.get("rec_B")).toEqual(before.recruiters.get("rec_B"));
  });

  it("12: valid null initial binding succeeds only after full validation", async () => {
    const s = snap();
    s.recruiterOwners.set("rec_NEW", "user_NEW");
    const d = await decide(s, {
      eventType: "checkout.session.completed",
      customer: "cus_NEW", subscription: "sub_NEW", price: PRICE_RECRUITER,
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_NEW", user_id: "user_NEW" }),
    });
    expect(d.kind).toBe("allow_initial_binding");
  });
});

// ============================================================
// Agency
// ============================================================
describe("Phase 1C — agency canonical identity", () => {
  function baseSnap(): Snapshot {
    const s = snap();
    s.agencyOwners.set("ag_1", "user_owner1");
    s.agencyOwners.set("ag_2", "user_owner2");
    s.agencies.set("ag_1", {
      context: "agency", entity_key: "ag_1",
      stripe_customer_id: "cus_ag1", stripe_subscription_id: "sub_ag1",
      status: "active",
    });
    return s;
  }

  it("13: matching canonical customer succeeds", async () => {
    const d = await decide(baseSnap(), {
      customer: "cus_ag1", subscription: "sub_ag1", price: PRICE_AGENCY,
      metadata: meta({ declaredContext: "agency", agency_id: "ag_1", owner_user_id: "user_owner1" }),
    });
    expect(d.kind).toBe("allow_existing_binding");
  });

  it("14: mismatched customer is rejected without mutation", async () => {
    const s = baseSnap();
    const before = cloneSnap(s);
    const d = await decide(s, {
      customer: "cus_ATTACKER", subscription: "sub_ATTACKER", price: PRICE_AGENCY,
      metadata: meta({ declaredContext: "agency", agency_id: "ag_1", owner_user_id: "user_owner1" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "customer_mismatch" });
    expect(s.agencies.get("ag_1")).toEqual(before.agencies.get("ag_1"));
  });

  it("15: invalid agency owner relationship is rejected", async () => {
    const s = baseSnap();
    s.agencyOwners.set("ag_orphan", null); // no owner
    const d = await decide(s, {
      customer: "cus_new", subscription: "sub_new", price: PRICE_AGENCY,
      metadata: meta({ declaredContext: "agency", agency_id: "ag_orphan", owner_user_id: "user_x" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "target_relationship_mismatch" });
  });

  it("16: customer assigned to another agency is rejected", async () => {
    const s = baseSnap();
    s.agencies.set("ag_2", {
      context: "agency", entity_key: "ag_2",
      stripe_customer_id: "cus_ag1", stripe_subscription_id: "sub_ag2",
      status: "active",
    });
    const d = await decide(s, {
      customer: "cus_ag1", subscription: "sub_new", price: PRICE_AGENCY,
      metadata: meta({ declaredContext: "agency", agency_id: "ag_2", owner_user_id: "user_owner2" }),
    });
    expect(d.kind).toBe("reject");
  });

  it("17: driver or recruiter customer is rejected for agency event", async () => {
    const s = baseSnap();
    s.recruiterOwners.set("rec_r", "user_r");
    s.recruiters.set("rec_r", {
      context: "recruiter", entity_key: "rec_r",
      stripe_customer_id: "cus_shared", stripe_subscription_id: "sub_r",
      status: "active",
    });
    const d = await decide(s, {
      customer: "cus_shared", subscription: "sub_new", price: PRICE_AGENCY,
      metadata: meta({ declaredContext: "agency", agency_id: "ag_1", owner_user_id: "user_owner1" }),
    });
    expect(d.kind).toBe("reject");
  });

  it("18: subscription mismatch is rejected", async () => {
    const s = baseSnap();
    const d = await decide(s, {
      customer: "cus_ag1", subscription: "sub_DIFFERENT", price: PRICE_AGENCY,
      metadata: meta({ declaredContext: "agency", agency_id: "ag_1", owner_user_id: "user_owner1" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "subscription_mismatch" });
  });

  it("19: valid null initial binding succeeds only after full validation", async () => {
    const s = snap();
    s.agencyOwners.set("ag_new", "user_new_owner");
    const d = await decide(s, {
      eventType: "checkout.session.completed",
      customer: "cus_ag_new", subscription: "sub_ag_new", price: PRICE_AGENCY,
      metadata: meta({ declaredContext: "agency", agency_id: "ag_new", owner_user_id: "user_new_owner" }),
    });
    expect(d.kind).toBe("allow_initial_binding");
  });
});

// ============================================================
// Driver
// ============================================================
describe("Phase 1C — driver canonical identity", () => {
  function baseSnap(): Snapshot {
    const s = snap();
    s.driverUsers.add("user_D");
    s.drivers.set("user_D", {
      context: "driver", entity_key: "user_D",
      stripe_customer_id: "cus_D", stripe_subscription_id: "sub_D",
      status: "active",
    });
    return s;
  }

  it("20: matching canonical driver customer succeeds", async () => {
    const d = await decide(baseSnap(), {
      customer: "cus_D", subscription: "sub_D", price: PRICE_DRIVER_MONTHLY,
      metadata: meta({ declaredContext: "driver", user_id: "user_D" }),
    });
    expect(d.kind).toBe("allow_existing_binding");
  });

  it("21: mismatched customer is rejected", async () => {
    const d = await decide(baseSnap(), {
      customer: "cus_OTHER", subscription: "sub_OTHER", price: PRICE_DRIVER_MONTHLY,
      metadata: meta({ declaredContext: "driver", user_id: "user_D" }),
    });
    expect(d.kind).toBe("reject");
  });

  it("22: recruiter or agency customer is rejected", async () => {
    const s = baseSnap();
    s.recruiterOwners.set("rec_x", "user_x");
    s.recruiters.set("rec_x", {
      context: "recruiter", entity_key: "rec_x",
      stripe_customer_id: "cus_R", stripe_subscription_id: "sub_R",
      status: "active",
    });
    const d = await decide(s, {
      customer: "cus_R", subscription: "sub_new", price: PRICE_DRIVER_MONTHLY,
      metadata: meta({ declaredContext: "driver", user_id: "user_D" }),
    });
    expect(d.kind).toBe("reject");
  });

  it("23: subscription mismatch is rejected", async () => {
    const d = await decide(baseSnap(), {
      customer: "cus_D", subscription: "sub_OTHER", price: PRICE_DRIVER_MONTHLY,
      metadata: meta({ declaredContext: "driver", user_id: "user_D" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "subscription_mismatch" });
  });

  it("24: unknown price grants no Pro (rejected as unknown_price_context)", async () => {
    const s = snap();
    s.driverUsers.add("user_NEW");
    const d = await decide(s, {
      eventType: "customer.subscription.created",
      customer: "cus_NEW", subscription: "sub_NEW", price: PRICE_UNKNOWN,
      metadata: meta({ declaredContext: "driver", user_id: "user_NEW" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "unknown_price_context" });
  });

  it("25: recruiter price grants no driver Pro", async () => {
    const s = snap();
    s.driverUsers.add("user_NEW");
    const d = await decide(s, {
      eventType: "customer.subscription.created",
      customer: "cus_NEW", subscription: "sub_NEW", price: PRICE_RECRUITER,
      metadata: meta({ declaredContext: "driver", user_id: "user_NEW" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "metadata_context_conflict" });
  });

  it("26: agency price grants no driver Pro", async () => {
    const s = snap();
    s.driverUsers.add("user_NEW");
    const d = await decide(s, {
      eventType: "customer.subscription.created",
      customer: "cus_NEW", subscription: "sub_NEW", price: PRICE_AGENCY,
      metadata: meta({ declaredContext: "driver", user_id: "user_NEW" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "metadata_context_conflict" });
  });

  it("revocation for exact match works even when price is now unknown (legacy price)", async () => {
    const d = await decide(baseSnap(), {
      eventType: "customer.subscription.deleted",
      customer: "cus_D", subscription: "sub_D", status: "canceled", price: PRICE_UNKNOWN,
      metadata: meta({ declaredContext: "driver", user_id: "user_D" }),
    });
    expect(d.kind).toBe("allow_revoke");
  });
});

// ============================================================
// DEF-04 exact exploit regression
// ============================================================
describe("Phase 1C — DEF-04 exact exploit regression", () => {
  it("27: signed recruiter event with unrelated customer is rejected; canonical unchanged", async () => {
    const s = snap();
    s.recruiterOwners.set("rec_B", "user_B");
    // Recruiter B already has a canonical binding (from a legitimate prior checkout).
    s.recruiters.set("rec_B", {
      context: "recruiter", entity_key: "rec_B",
      stripe_customer_id: "cus_B_canonical",
      stripe_subscription_id: "sub_B_canonical",
      status: "active",
    });
    const before = cloneSnap(s);
    // Attacker crafts an event with valid Recruiter B metadata but an
    // unrelated Stripe customer (never belonged to Recruiter B).
    const d = await decide(s, {
      eventType: "customer.subscription.updated",
      customer: "cus_UNRELATED", subscription: "sub_UNRELATED",
      status: "active", price: PRICE_RECRUITER,
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_B", user_id: "user_B", plan_key: "growth" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "customer_mismatch" });
    // Snapshot byte-equal after rejection:
    expect(s.recruiters.get("rec_B")).toEqual(before.recruiters.get("rec_B"));
    expect(Array.from(s.drivers.entries())).toEqual([]);
    expect(Array.from(s.agencies.entries())).toEqual([]);
  });
});

// ============================================================
// Cross-context
// ============================================================
describe("Phase 1C — cross-context rules", () => {
  it("28: metadata context vs price context disagreement is rejected", async () => {
    const s = snap();
    s.recruiterOwners.set("rec_X", "user_X");
    const d = await decide(s, {
      eventType: "customer.subscription.created",
      customer: "cus_X", subscription: "sub_X", price: PRICE_AGENCY,
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_X", user_id: "user_X" }),
    });
    expect(d).toEqual({ kind: "reject", reason: "metadata_context_conflict" });
  });

  it("29: one event cannot mutate more than one billing context (collision reject)", async () => {
    const s = snap();
    s.driverUsers.add("user_D");
    s.drivers.set("user_D", {
      context: "driver", entity_key: "user_D",
      stripe_customer_id: "cus_shared", stripe_subscription_id: "sub_D",
      status: "active",
    });
    s.recruiterOwners.set("rec_R", "user_R");
    s.recruiters.set("rec_R", {
      context: "recruiter", entity_key: "rec_R",
      stripe_customer_id: "cus_shared", stripe_subscription_id: "sub_R",
      status: "active",
    });
    const d = await decide(s, {
      customer: "cus_shared", subscription: "sub_new", price: PRICE_RECRUITER,
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_R", user_id: "user_R" }),
    });
    expect(d.kind).toBe("reject");
    expect((d as { reason: string }).reason).toBe("cross_context_customer_collision");
  });

  it("30: every rejected event causes zero snapshot changes", async () => {
    const s = snap();
    s.recruiterOwners.set("rec_B", "user_B");
    s.recruiters.set("rec_B", {
      context: "recruiter", entity_key: "rec_B",
      stripe_customer_id: "cus_B", stripe_subscription_id: "sub_B", status: "active",
    });
    const before = JSON.stringify({
      d: Array.from(s.drivers.entries()),
      r: Array.from(s.recruiters.entries()),
      a: Array.from(s.agencies.entries()),
    });
    // Fire a mismatched event
    await decide(s, {
      customer: "cus_ATTACKER", subscription: "sub_ATTACKER", price: PRICE_RECRUITER,
      metadata: meta({ declaredContext: "recruiter", recruiter_id: "rec_B", user_id: "user_B" }),
    });
    const after = JSON.stringify({
      d: Array.from(s.drivers.entries()),
      r: Array.from(s.recruiters.entries()),
      a: Array.from(s.agencies.entries()),
    });
    expect(after).toBe(before);
  });
});
