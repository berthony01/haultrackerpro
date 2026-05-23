import { describe, it, expect } from 'vitest';
import {
  aggregateAdminReferrals,
  type AdminReferralRow,
} from '@/lib/opportunities/adminReferralAggregator';

const recruiters = [
  { id: 'rec-1', company_name: 'Alpha Logistics', recruiter_email: 'a@x.com' },
  { id: 'rec-2', company_name: 'Bravo Freight', recruiter_email: 'b@x.com' },
];
const opportunities = [
  { id: 'opp-1', title: 'Reefer Lane', recruiter_id: 'rec-1' },
  { id: 'opp-2', title: '', recruiter_id: 'rec-2' },
];

function ref(p: Partial<AdminReferralRow>): AdminReferralRow {
  return {
    id: p.id ?? Math.random().toString(),
    status: p.status ?? 'referral_sent',
    opportunity_id: p.opportunity_id ?? 'opp-1',
    recruiter_id: p.recruiter_id ?? 'rec-1',
    referring_driver_id: p.referring_driver_id ?? 'driver-aaaaaaaa-1',
    created_at: p.created_at ?? new Date().toISOString(),
    last_status_at: p.last_status_at ?? null,
    referred_driver_name: p.referred_driver_name ?? null,
  };
}

describe('aggregateAdminReferrals', () => {
  it('empty input → zeros, no NaN', () => {
    const a = aggregateAdminReferrals({
      referrals: [],
      opportunities: [],
      recruiters: [],
      settings: [],
      timeframe: 'all',
    });
    expect(a.kpis).toEqual({
      total: 0, open: 0, hired: 0, eligible: 0, markedPaidExternally: 0, hireRate: 0,
    });
    expect(a.recruiterPerformance).toEqual([]);
    expect(a.recent).toEqual([]);
  });

  it('mixed statuses → counts + grouping', () => {
    const a = aggregateAdminReferrals({
      referrals: [
        ref({ id: '1', status: 'hired' }),
        ref({ id: '2', status: 'referral_sent' }),
        ref({ id: '3', status: 'closed_not_hired' }),
        ref({ id: '4', status: 'marked_paid_externally', recruiter_id: 'rec-2', opportunity_id: 'opp-2' }),
        ref({ id: '5', status: 'eligible_for_bonus' }),
      ],
      opportunities,
      recruiters,
      settings: [{ recruiter_id: 'rec-1', bonus_amount: 500, terms: null }],
      timeframe: 'all',
    });
    expect(a.kpis.total).toBe(5);
    expect(a.kpis.hired).toBe(1);
    expect(a.kpis.eligible).toBe(1);
    expect(a.kpis.markedPaidExternally).toBe(1);
    expect(a.kpis.open).toBe(3); // not closed_not_hired, not marked_paid_externally
    expect(a.kpis.hireRate).toBe(20);
    const rec1 = a.recruiterPerformance.find((r) => r.recruiter_id === 'rec-1')!;
    expect(rec1.total).toBe(4);
    expect(rec1.hired).toBe(1);
    expect(rec1.company_name).toBe('Alpha Logistics');
    const opp2 = a.opportunityPerformance.find((o) => o.opportunity_id === 'opp-2')!;
    expect(opp2.title).toBe('Untitled opportunity');
  });

  it('watchlist: missing terms, high closed, no movement, stale', () => {
    const old = new Date('2025-01-01').toISOString();
    const a = aggregateAdminReferrals({
      referrals: [
        // rec-2: 5 closed_not_hired → high_closed + missing_terms (no settings row)
        ref({ id: 'c1', status: 'closed_not_hired', recruiter_id: 'rec-2', opportunity_id: 'opp-2' }),
        ref({ id: 'c2', status: 'closed_not_hired', recruiter_id: 'rec-2', opportunity_id: 'opp-2' }),
        ref({ id: 'c3', status: 'closed_not_hired', recruiter_id: 'rec-2', opportunity_id: 'opp-2' }),
        ref({ id: 'c4', status: 'closed_not_hired', recruiter_id: 'rec-2', opportunity_id: 'opp-2' }),
        ref({ id: 'c5', status: 'closed_not_hired', recruiter_id: 'rec-2', opportunity_id: 'opp-2' }),
        // stale, not terminal, has terms (rec-1)
        ref({ id: 's1', status: 'recruiter_contacted', created_at: old, last_status_at: old }),
      ],
      opportunities,
      recruiters,
      settings: [{ recruiter_id: 'rec-1', bonus_amount: 500, terms: null }],
      timeframe: 'all',
      now: new Date('2026-01-01').getTime(),
    });
    const kinds = a.watchlist.map((w) => w.kind);
    expect(kinds).toContain('high_closed');
    expect(kinds).toContain('missing_terms');
    expect(kinds).toContain('stale_referral');
  });

  it('handles invalid/missing dates without crashing sort', () => {
    const a = aggregateAdminReferrals({
      referrals: [
        ref({ id: '1', created_at: null, last_status_at: null }),
        ref({ id: '2', created_at: 'not-a-date', last_status_at: 'nope' }),
        ref({ id: '3', created_at: new Date().toISOString() }),
      ],
      opportunities,
      recruiters,
      settings: [{ recruiter_id: 'rec-1', bonus_amount: 100, terms: null }],
      timeframe: 'all',
    });
    // Only valid created_at survives timeframe filter when not 'all', but here 'all' keeps all.
    expect(a.kpis.total).toBe(3);
    expect(a.recent.length).toBe(3);
  });
});
