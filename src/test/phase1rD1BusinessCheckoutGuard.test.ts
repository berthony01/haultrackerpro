// Phase 1R-D1 — cross-context business checkout guard matrix.
//
// Directly imports the pure guard from
// supabase/functions/_shared/business-checkout-guard.ts. No Deno, Stripe,
// Supabase, network, or clock.

import { describe, expect, it } from "vitest";

import {
  CROSS_CONTEXT_MESSAGES,
  evaluateAgencyCheckoutCrossContext,
  evaluateRecruiterCheckoutCrossContext,
  isCrossContextBlock,
  isRecognizedAgencyPlanKey,
  isRecognizedAgencySource,
  isRecognizedAgencyStatus,
  isRecognizedRecruiterPlan,
  RECOGNIZED_AGENCY_PLAN_KEYS,
  RECOGNIZED_AGENCY_SOURCES,
  RECRUITER_ALLOWING_STATUSES,
  RECRUITER_BLOCKING_STATUSES,
  type AgencyEntitlementFacts,
  type CrossContextDecision,
  type RecruiterBillingFacts,
} from "../../supabase/functions/_shared/business-checkout-guard";

/** Narrow a decision to its blocking member, or fail loudly. */
function blocked(d: CrossContextDecision) {
  if (!isCrossContextBlock(d)) throw new Error("expected a blocking decision");
  return d;
}

const AGENCY_SOURCES = ["stripe", "manual", "admin_seed"] as const;

function agencyFacts(
  over: Partial<AgencyEntitlementFacts> = {},
): AgencyEntitlementFacts {
  return {
    hasRow: true,
    planKey: "agency_team",
    status: "active",
    source: "stripe",
    hasActiveOwnerMembership: true,
    ...over,
  };
}

function recruiterFacts(
  over: Partial<RecruiterBillingFacts> = {},
): RecruiterBillingFacts {
  return { hasRow: true, plan: "growth", status: "active", ...over };
}

describe("Phase 1R-D1 — vocabulary", () => {
  it("recognizes exactly three agency plans", () => {
    expect(RECOGNIZED_AGENCY_PLAN_KEYS).toEqual([
      "agency_starter",
      "agency_team",
      "agency_growth",
    ]);
  });

  it("recognizes exactly three agency sources", () => {
    expect(RECOGNIZED_AGENCY_SOURCES).toEqual(["stripe", "manual", "admin_seed"]);
  });

  it("validators reject unknown values", () => {
    expect(isRecognizedAgencyPlanKey("agency_team")).toBe(true);
    expect(isRecognizedAgencyPlanKey("agency_ultra")).toBe(false);
    expect(isRecognizedAgencySource("stripe")).toBe(true);
    expect(isRecognizedAgencySource("paypal")).toBe(false);
    expect(isRecognizedAgencyStatus("manual_beta")).toBe(true);
    expect(isRecognizedAgencyStatus("weird")).toBe(false);
    expect(isRecognizedRecruiterPlan("fleet")).toBe(true);
    expect(isRecognizedRecruiterPlan("enterprise")).toBe(false);
  });

  it("recruiter blocking/allowing status sets are disjoint and closed", () => {
    for (const s of RECRUITER_BLOCKING_STATUSES) {
      expect(RECRUITER_ALLOWING_STATUSES).not.toContain(s);
    }
    expect([...RECRUITER_BLOCKING_STATUSES].sort()).toEqual(
      [
        "active",
        "incomplete",
        "past_due",
        "paused",
        "trialing", // trial-allowlist: Stripe subscription status literal
        "unpaid",
      ].sort(),
    );
  });
});

describe("Phase 1R-D1 — recruiter checkout blocked by agency entitlement", () => {
  for (const source of AGENCY_SOURCES) {
    for (const status of ["active", "trialing"] as const) { // trial-allowlist
      // trial-allowlist: Stripe subscription status literal
      it(`blocks recruiter checkout for ${source}/${status} active owner`, () => {
        const d = evaluateRecruiterCheckoutCrossContext(
          agencyFacts({ source, status }),
        );
        expect(d.allowed).toBe(false);
        const b = blocked(d);
        expect(b.code).toBe("agency_entitlement_exists");
        expect(b.status).toBe(409);
        expect(b.message).toBe(
          CROSS_CONTEXT_MESSAGES.agency_entitlement_exists,
        );
      });
    }
  }

  it("blocks with management code for a Stripe-sourced past_due agency row", () => {
    const d = evaluateRecruiterCheckoutCrossContext(
      agencyFacts({ source: "stripe", status: "past_due" }),
    );
    expect(d.allowed).toBe(false);
    const b = blocked(d);
    expect(b.code).toBe("agency_billing_requires_management");
    expect(b.message).toBe(
      CROSS_CONTEXT_MESSAGES.agency_billing_requires_management,
    );
  });

  for (const source of ["manual", "admin_seed"] as const) {
    it(`fails closed for a ${source}-sourced past_due agency row`, () => {
      const d = evaluateRecruiterCheckoutCrossContext(
        agencyFacts({ source, status: "past_due" }),
      );
      expect(d.allowed).toBe(false);
      const b = blocked(d);
      expect(b.code).toBe("opposing_entitlement_unknown");
      expect(b.status).toBe(409);
      expect(b.message).toBe(
        CROSS_CONTEXT_MESSAGES.opposing_entitlement_unknown,
      );
    });
  }

  it("does not mutate input facts when evaluating a past_due row", () => {
    for (const source of AGENCY_SOURCES) {
      const facts = agencyFacts({ source, status: "past_due" });
      const snapshot = JSON.stringify(facts);
      evaluateRecruiterCheckoutCrossContext(facts);
      expect(JSON.stringify(facts)).toBe(snapshot);
    }
  });

  it("allows manual_beta", () => {

    expect(
      evaluateRecruiterCheckoutCrossContext(
        agencyFacts({ status: "manual_beta", source: "manual" }),
      ).allowed,
    ).toBe(true);
  });

  it("allows cancelled", () => {
    expect(
      evaluateRecruiterCheckoutCrossContext(agencyFacts({ status: "cancelled" }))
        .allowed,
    ).toBe(true);
  });

  it("allows when no entitlement row exists", () => {
    expect(
      evaluateRecruiterCheckoutCrossContext(
        agencyFacts({ hasRow: false, planKey: null, status: null, source: null }),
      ).allowed,
    ).toBe(true);
  });

  it("allows when the membership is not an active owner", () => {
    expect(
      evaluateRecruiterCheckoutCrossContext(
        agencyFacts({ hasActiveOwnerMembership: false }),
      ).allowed,
    ).toBe(true);
  });

  it("fails closed on an unknown plan key for a relevant row", () => {
    const d = evaluateRecruiterCheckoutCrossContext(
      agencyFacts({ planKey: "agency_ultra" }),
    );
    expect(d.allowed).toBe(false);
    const b = blocked(d);
    expect(b.code).toBe("opposing_entitlement_unknown");
  });

  it("fails closed on an unknown source for a relevant row", () => {
    const d = evaluateRecruiterCheckoutCrossContext(
      agencyFacts({ source: "wire_transfer" }),
    );
    expect(d.allowed).toBe(false);
    const b = blocked(d);
    expect(b.code).toBe("opposing_entitlement_unknown");
  });

  it("fails closed on an unknown status for a relevant row", () => {
    const d = evaluateRecruiterCheckoutCrossContext(
      agencyFacts({ status: "half_paid" }),
    );
    expect(d.allowed).toBe(false);
    const b = blocked(d);
    expect(b.code).toBe("opposing_entitlement_unknown");
  });

  it("fails closed on null fields for a relevant row", () => {
    const d = evaluateRecruiterCheckoutCrossContext(
      agencyFacts({ planKey: null, status: null, source: null }),
    );
    expect(d.allowed).toBe(false);
    const b = blocked(d);
    expect(b.code).toBe("opposing_entitlement_unknown");
  });

  it("does not mutate the input facts object", () => {
    const facts = agencyFacts();
    const snapshot = JSON.stringify(facts);
    evaluateRecruiterCheckoutCrossContext(facts);
    expect(JSON.stringify(facts)).toBe(snapshot);
  });
});

describe("Phase 1R-D1 — agency checkout blocked by recruiter subscription", () => {
  for (const status of RECRUITER_BLOCKING_STATUSES) {
    it(`blocks agency checkout for recruiter status ${status}`, () => {
      const d = evaluateAgencyCheckoutCrossContext(recruiterFacts({ status }));
      expect(d.allowed).toBe(false);
      const b = blocked(d);
      expect(b.code).toBe("recruiter_subscription_exists");
      expect(b.status).toBe(409);
      expect(b.message).toBe(
        CROSS_CONTEXT_MESSAGES.recruiter_subscription_exists,
      );
    });
  }

  for (const plan of ["starter", "growth", "fleet"] as const) {
    it(`blocks for paid plan ${plan} in an active status`, () => {
      const d = evaluateAgencyCheckoutCrossContext(
        recruiterFacts({ plan, status: "active" }),
      );
      expect(d.allowed).toBe(false);
    });
  }

  for (const status of RECRUITER_ALLOWING_STATUSES) {
    it(`allows agency checkout for recruiter status ${status}`, () => {
      expect(
        evaluateAgencyCheckoutCrossContext(recruiterFacts({ status })).allowed,
      ).toBe(true);
    });
  }

  it("allows when there is no recruiter billing row", () => {
    expect(
      evaluateAgencyCheckoutCrossContext(
        recruiterFacts({ hasRow: false, plan: null, status: null }),
      ).allowed,
    ).toBe(true);
  });

  it("fails closed on an unknown recruiter status", () => {
    const d = evaluateAgencyCheckoutCrossContext(
      recruiterFacts({ status: "frozen" }),
    );
    expect(d.allowed).toBe(false);
    const b = blocked(d);
    expect(b.code).toBe("opposing_entitlement_unknown");
  });

  it("fails closed on a null recruiter status", () => {
    const d = evaluateAgencyCheckoutCrossContext(
      recruiterFacts({ status: null }),
    );
    expect(d.allowed).toBe(false);
    const b = blocked(d);
    expect(b.code).toBe("opposing_entitlement_unknown");
  });

  it("fails closed on a malformed plan in a blocking status", () => {
    const d = evaluateAgencyCheckoutCrossContext(
      recruiterFacts({ plan: "enterprise", status: "active" }),
    );
    expect(d.allowed).toBe(false);
    const b = blocked(d);
    expect(b.code).toBe("opposing_entitlement_unknown");
  });

  it("fails closed on a null plan in a blocking status", () => {
    const d = evaluateAgencyCheckoutCrossContext(
      recruiterFacts({ plan: null, status: "past_due" }),
    );
    expect(d.allowed).toBe(false);
    const b = blocked(d);
    expect(b.code).toBe("opposing_entitlement_unknown");
  });

  it("allows a terminal status even when the dead row's plan is malformed", () => {
    expect(
      evaluateAgencyCheckoutCrossContext(
        recruiterFacts({ plan: "garbage", status: "canceled" }),
      ).allowed,
    ).toBe(true);
  });

  it("does not mutate the input facts object", () => {
    const facts = recruiterFacts();
    const snapshot = JSON.stringify(facts);
    evaluateAgencyCheckoutCrossContext(facts);
    expect(JSON.stringify(facts)).toBe(snapshot);
  });
});

describe("Phase 1R-D1 — public messages are safe", () => {
  it("contains no IDs, URLs, emails, or vendor names", () => {
    for (const msg of Object.values(CROSS_CONTEXT_MESSAGES)) {
      expect(msg).not.toMatch(/cus_|sub_|cs_|price_|https?:\/\//);
      expect(msg).not.toMatch(/@/);
      expect(msg).not.toMatch(/Stripe|Supabase/);
    }
  });
});
