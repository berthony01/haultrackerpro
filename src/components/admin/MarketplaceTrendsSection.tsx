import { TrendingUp, TrendingDown, Minus, Activity, Users, Briefcase, Send, Mail, Sparkles, AlertTriangle, Info } from 'lucide-react';

interface TrendsData {
  recruiter_marketplace_recruiters_7d?: number;
  recruiter_marketplace_recruiters_30d?: number;
  recruiter_marketplace_opportunities_7d?: number;
  recruiter_marketplace_opportunities_30d?: number;
  recruiter_marketplace_applications_7d?: number;
  recruiter_marketplace_applications_30d?: number;
  recruiter_marketplace_contact_requests_7d?: number;
  recruiter_marketplace_contact_requests_30d?: number;
  recruiters_created_7d?: number;
  recruiters_created_30d?: number;
  opportunities_created_7d?: number;
  opportunities_created_30d?: number;
  applications_7d?: number;
  applications_30d?: number;
  contact_requests_7d?: number;
  contact_requests_30d?: number;
  recruiters_pending?: number;
  recruiter_marketplace_health_score?: number;
  recruiter_marketplace_health_label?: string;
  recruiter_marketplace_health_summary?: string;
  recruiter_funnel_signups?: number;
  recruiter_funnel_approved?: number;
  recruiter_funnel_active?: number;
  recruiter_funnel_with_opportunity?: number;
  recruiter_funnel_with_active_opportunity?: number;
  recruiter_funnel_with_application?: number;
  recruiter_funnel_with_contact_request?: number;
  recruiter_approval_rate?: number;
  recruiter_activation_rate?: number;
  recruiter_posting_rate?: number;
  recruiter_active_posting_rate?: number;
  recruiter_application_rate?: number;
  recruiter_contact_request_rate?: number;
}

type MomentumLabel = 'Accelerating' | 'Steady' | 'Slowing' | 'No recent activity';

function computeMomentum(v7d: number, v30d: number): { ratio: number; label: MomentumLabel } {
  const avg7Equivalent = (v30d / 30) * 7;
  let ratio: number;
  if (avg7Equivalent > 0) {
    ratio = v7d / avg7Equivalent;
  } else {
    ratio = v7d > 0 ? 1 : 0;
  }
  let label: MomentumLabel;
  if (ratio === 0) label = 'No recent activity';
  else if (ratio >= 1.25) label = 'Accelerating';
  else if (ratio >= 0.85) label = 'Steady';
  else label = 'Slowing';
  return { ratio, label };
}

function momentumStyle(label: MomentumLabel) {
  switch (label) {
    case 'Accelerating':
      return { icon: TrendingUp, cls: 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/30' };
    case 'Steady':
      return { icon: Minus, cls: 'text-primary bg-primary/10 ring-primary/30' };
    case 'Slowing':
      return { icon: TrendingDown, cls: 'text-amber-400 bg-amber-500/10 ring-amber-500/30' };
    default:
      return { icon: Minus, cls: 'text-white/50 bg-white/[0.04] ring-white/10' };
  }
}

export function MarketplaceTrendsSection({ data }: { data: TrendsData }) {
  const num = (n?: number) => (typeof n === 'number' ? n : 0);

  const cards = [
    {
      label: 'New Recruiters',
      icon: Users,
      v7: num(data.recruiter_marketplace_recruiters_7d ?? data.recruiters_created_7d),
      v30: num(data.recruiter_marketplace_recruiters_30d ?? data.recruiters_created_30d),
    },
    {
      label: 'New Opportunities',
      icon: Briefcase,
      v7: num(data.recruiter_marketplace_opportunities_7d ?? data.opportunities_created_7d),
      v30: num(data.recruiter_marketplace_opportunities_30d ?? data.opportunities_created_30d),
    },
    {
      label: 'Applications',
      icon: Send,
      v7: num(data.recruiter_marketplace_applications_7d ?? data.applications_7d),
      v30: num(data.recruiter_marketplace_applications_30d ?? data.applications_30d),
    },
    {
      label: 'Contact Requests',
      icon: Mail,
      v7: num(data.recruiter_marketplace_contact_requests_7d ?? data.contact_requests_7d),
      v30: num(data.recruiter_marketplace_contact_requests_30d ?? data.contact_requests_30d),
    },
  ];

  const funnel = [
    { label: 'Signups', value: num(data.recruiter_funnel_signups) },
    { label: 'Approved', value: num(data.recruiter_funnel_approved) },
    { label: 'Active', value: num(data.recruiter_funnel_active) },
    { label: 'Posted', value: num(data.recruiter_funnel_with_opportunity) },
    { label: 'Active Opp', value: num(data.recruiter_funnel_with_active_opportunity) },
    { label: 'Applications', value: num(data.recruiter_funnel_with_application) },
    { label: 'Contact Req', value: num(data.recruiter_funnel_with_contact_request) },
  ];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.value));

  // Strongest/weakest stage based on Phase 7 conversion rates.
  // Pair each rate with its denominator to allow excluding zero-denominator stages.
  const signups = num(data.recruiter_funnel_signups);
  const approved = num(data.recruiter_funnel_approved);
  const active = num(data.recruiter_funnel_active);
  const posted = num(data.recruiter_funnel_with_opportunity);
  const activeOpp = num(data.recruiter_funnel_with_active_opportunity);

  const rateEntries = [
    { label: 'Approval', rate: num(data.recruiter_approval_rate), denom: signups },
    { label: 'Activation', rate: num(data.recruiter_activation_rate), denom: approved },
    { label: 'Posting', rate: num(data.recruiter_posting_rate), denom: active },
    { label: 'Active Posting', rate: num(data.recruiter_active_posting_rate), denom: posted },
    { label: 'Application', rate: num(data.recruiter_application_rate), denom: activeOpp },
    { label: 'Contact Request', rate: num(data.recruiter_contact_request_rate), denom: activeOpp },
  ];
  const valid = rateEntries.filter((r) => r.denom > 0);
  const strongest = valid.length > 0 ? valid.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;
  const weakest = valid.length > 0 ? valid.reduce((a, b) => (b.rate < a.rate ? b : a)) : null;

  // Deterministic owner insights (priority order, capped at 5)
  const insights: Array<{ tone: 'warn' | 'info' | 'good'; text: string }> = [];
  if (num(data.recruiter_marketplace_recruiters_30d ?? data.recruiters_created_30d) === 0) {
    insights.push({
      tone: 'warn',
      text: 'Recruiter acquisition is inactive. Focus on outreach and recruiter signup campaigns.',
    });
  }
  if (num(data.recruiters_pending) > 0) {
    insights.push({
      tone: 'info',
      text: 'Pending recruiters need review. Approving qualified recruiters can unlock more listings.',
    });
  }
  if (activeOpp === 0 && signups > 0) {
    insights.push({ tone: 'warn', text: 'Recruiters exist, but active opportunities are missing.' });
  }
  if (activeOpp > 0 && num(data.recruiter_funnel_with_application) === 0) {
    insights.push({ tone: 'warn', text: 'Opportunities are live, but drivers are not applying yet.' });
  }
  if (
    num(data.recruiter_funnel_with_application) > 0 &&
    num(data.recruiter_funnel_with_contact_request) === 0
  ) {
    insights.push({
      tone: 'info',
      text: 'Drivers are applying, but contact-request activity is not converting yet.',
    });
  }
  if (num(data.recruiter_marketplace_health_score) >= 80) {
    insights.push({
      tone: 'good',
      text: 'Marketplace appears strong based on current recruiter funnel activity.',
    });
  }
  const topInsights = insights.slice(0, 5);

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Marketplace Trends</p>
        <span className="text-[10px] text-white/40">
          Current snapshot · 7d/30d activity windows
        </span>
      </div>
      <div className="mb-3 flex items-start gap-2 rounded-xl border border-white/[0.06] bg-[#0D111A] px-3 py-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" />
        <p className="text-[11px] leading-relaxed text-white/60">
          These are <span className="font-semibold text-white/80">activity-window trends</span>, not stored
          historical daily snapshots. Momentum compares the last 7 days against the average pace of the last
          30 days.
        </p>
      </div>

      {/* Activity Window Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => {
          const m = computeMomentum(c.v7, c.v30);
          const style = momentumStyle(m.label);
          const MIcon = style.icon;
          const CIcon = c.icon;
          return (
            <div
              key={c.label}
              className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs text-white/70">
                  <CIcon className="h-3.5 w-3.5 text-primary/70" />
                  {c.label}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${style.cls}`}
                  title={`Pace ratio ${m.ratio.toFixed(2)}× (simple pace indicator)`}
                >
                  <MIcon className="h-3 w-3" />
                  {m.label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/[0.02] px-2.5 py-2 ring-1 ring-white/[0.04]">
                  <p className="text-[10px] font-medium text-white/50">Last 7d</p>
                  <p className="font-mono text-xl font-bold text-white">{c.v7}</p>
                </div>
                <div className="rounded-lg bg-white/[0.02] px-2.5 py-2 ring-1 ring-white/[0.04]">
                  <p className="text-[10px] font-medium text-white/50">Last 30d</p>
                  <p className="font-mono text-xl font-bold text-white">{c.v30}</p>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-white/40">
                Simple pace indicator: {m.ratio > 0 ? `${m.ratio.toFixed(2)}×` : '—'} of 30d average
              </p>
            </div>
          );
        })}
      </div>

      {/* Funnel Snapshot + Health Context + Insights */}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
              Funnel Snapshot (current)
            </p>
            <span className="text-[10px] text-white/40">Stages may overlap · not summed</span>
          </div>
          <div className="space-y-2">
            {funnel.map((f) => {
              const pct = Math.round((f.value / funnelMax) * 100);
              return (
                <div key={f.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-white/70">{f.label}</span>
                    <span className="font-mono font-bold text-white">{f.value}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.04]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
              Health Context
            </p>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary/70" />
              <span className="font-mono text-2xl font-bold text-white">
                {num(data.recruiter_marketplace_health_score)}
                <span className="text-sm text-white/40"> / 100</span>
              </span>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-white/70">
              {data.recruiter_marketplace_health_label ?? 'Early / insufficient activity'}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/50">
              {data.recruiter_marketplace_health_summary ??
                'No recruiter signups yet. Health score will become meaningful once recruiters join the marketplace.'}
            </p>
            <div className="mt-3 space-y-1.5 text-[11px]">
              {strongest && weakest ? (
                <>
                  <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-2 py-1.5 ring-1 ring-emerald-500/20">
                    <span className="text-white/70">Strongest stage</span>
                    <span className="font-mono font-bold text-emerald-300">
                      {strongest.label} · {strongest.rate}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-amber-500/10 px-2 py-1.5 ring-1 ring-amber-500/20">
                    <span className="text-white/70">Weakest stage</span>
                    <span className="font-mono font-bold text-amber-300">
                      {weakest.label} · {weakest.rate}%
                    </span>
                  </div>
                </>
              ) : (
                <div className="rounded-lg bg-white/[0.03] px-2 py-1.5 text-white/50">
                  Not enough activity to identify strongest or weakest funnel stage.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Owner Action Insights */}
      <div className="mt-3 rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
          Owner Action Insights
        </p>
        {topInsights.length === 0 ? (
          <p className="text-xs text-white/50">No actionable signals from current marketplace metrics.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {topInsights.map((i) => {
              const Icon = i.tone === 'good' ? Sparkles : i.tone === 'warn' ? AlertTriangle : Info;
              const cls =
                i.tone === 'good'
                  ? 'bg-emerald-500/10 ring-emerald-500/20 text-emerald-300'
                  : i.tone === 'warn'
                  ? 'bg-amber-500/10 ring-amber-500/20 text-amber-300'
                  : 'bg-primary/10 ring-primary/20 text-primary';
              return (
                <li
                  key={i.text}
                  className={`flex items-start gap-2 rounded-lg px-2.5 py-2 ring-1 ${cls}`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-xs text-white/80">{i.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
