/**
 * Featured / Priority Placement sync regression matrix.
 *
 * The DB owns the source of truth via two triggers + a helper function:
 *
 *   - public.recruiter_has_priority_plan(recruiter_user_id uuid) returns boolean
 *     → TRUE iff the recruiter has an `active` or `trialing` subscription on a
 *       plan key in ('growth', 'fleet'). All other states (Starter, canceled,
 *       past_due, inactive, no row) return FALSE.
 *
 *   - public.opportunities_guard
 *     → Prevents client UPDATEs from manually flipping `featured`. Only allows
 *       the flip when the session-local GUC `app.allow_featured_sync = 'true'`
 *       is set (which only the billing-sync trigger does).
 *
 *   - public.recruiter_billing_sync_featured
 *     → On INSERT/UPDATE of recruiter_subscriptions, sets the GUC and runs
 *       UPDATE opportunities SET featured = recruiter_has_priority_plan(...)
 *       WHERE recruiter_id = NEW.recruiter_user_id.
 *
 * This file is a Vitest spec that locks the expected behavior matrix as
 * assertions against a pure JS mirror, so the contract cannot silently drift.
 * If the DB-side behavior changes, this test must be updated in lockstep.
 */
import { describe, it, expect } from 'vitest';

type PlanKey = 'starter' | 'growth' | 'fleet' | null;
type SubStatus = 'active' | 'trialing' | 'canceled' | 'past_due' | 'inactive' | null;

/** JS mirror of public.recruiter_has_priority_plan. */
function recruiterHasPriorityPlan(plan: PlanKey, status: SubStatus): boolean {
  if (plan !== 'growth' && plan !== 'fleet') return false;
  return status === 'active' || status === 'trialing';
}

/**
 * JS mirror of the billing-sync trigger's effect on opportunities.featured.
 * The trigger overwrites every opportunity owned by the recruiter.
 */
function syncFeaturedForRecruiter(
  plan: PlanKey,
  status: SubStatus,
  opportunities: Array<{ id: string; featured: boolean }>,
): Array<{ id: string; featured: boolean }> {
  const target = recruiterHasPriorityPlan(plan, status);
  return opportunities.map((o) => ({ ...o, featured: target }));
}

/**
 * JS mirror of opportunities_guard for manual UPDATEs of `featured`.
 * Returns true if the change is allowed.
 */
function guardAllowsFeaturedChange(allowFeaturedSyncGuc: boolean): boolean {
  return allowFeaturedSyncGuc === true;
}

describe('recruiter_has_priority_plan matrix', () => {
  const cases: Array<[PlanKey, SubStatus, boolean]> = [
    ['starter', 'active', false],
    ['starter', 'trialing', false],
    ['growth', 'active', true],
    ['growth', 'trialing', true],
    ['fleet', 'active', true],
    ['fleet', 'trialing', true],
    ['growth', 'canceled', false],
    ['growth', 'past_due', false],
    ['fleet', 'inactive', false],
    [null, null, false],
  ];

  it.each(cases)('plan=%s status=%s → priority=%s', (plan, status, expected) => {
    expect(recruiterHasPriorityPlan(plan, status)).toBe(expected);
  });
});

describe('billing-sync trigger: opportunities.featured', () => {
  const ops = [
    { id: 'o1', featured: false },
    { id: 'o2', featured: false },
  ];

  it('flips all existing opportunities to featured=true on Starter→Growth upgrade', () => {
    const out = syncFeaturedForRecruiter('growth', 'active', ops);
    expect(out.every((o) => o.featured === true)).toBe(true);
  });

  it('flips all existing opportunities to featured=false on Growth→Starter downgrade', () => {
    const featuredOps = ops.map((o) => ({ ...o, featured: true }));
    const out = syncFeaturedForRecruiter('starter', 'active', featuredOps);
    expect(out.every((o) => o.featured === false)).toBe(true);
  });

  it('flips opportunities to featured=false when subscription is canceled', () => {
    const featuredOps = ops.map((o) => ({ ...o, featured: true }));
    const out = syncFeaturedForRecruiter('growth', 'canceled', featuredOps);
    expect(out.every((o) => o.featured === false)).toBe(true);
  });

  it('keeps Fleet active as featured=true', () => {
    const out = syncFeaturedForRecruiter('fleet', 'active', ops);
    expect(out.every((o) => o.featured === true)).toBe(true);
  });
});

describe('opportunities_guard: manual featured flips', () => {
  it('blocks a client UPDATE that does not set the sync GUC', () => {
    expect(guardAllowsFeaturedChange(false)).toBe(false);
  });

  it('allows the billing-sync trigger which sets the GUC', () => {
    expect(guardAllowsFeaturedChange(true)).toBe(true);
  });
});
