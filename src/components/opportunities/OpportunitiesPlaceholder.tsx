import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BriefcaseBusiness,
  ShieldCheck,
  DollarSign,
  Gauge,
  AlertTriangle,
  Lock,
} from 'lucide-react';

const features = [
  {
    icon: ShieldCheck,
    title: 'Verified recruiter opportunities',
    body: 'Only approved, transparent recruiters can post — no spam, no bait-and-switch listings.',
  },
  {
    icon: DollarSign,
    title: 'Estimated gross & net pay',
    body: 'See realistic weekly take-home before you call, with deductions factored in.',
  },
  {
    icon: Gauge,
    title: 'Effective RPM clarity',
    body: 'Loaded vs total miles, paid vs unpaid deadhead — one honest rate-per-mile number.',
  },
  {
    icon: AlertTriangle,
    title: 'Deadhead & deduction warnings',
    body: 'HaulTrackerPro flags unpaid deadhead, lease, escrow, and hidden costs before you commit.',
  },
  {
    icon: Lock,
    title: 'Driver privacy controls',
    body: 'You decide who can see your profile and how recruiters reach you.',
  },
];

export function OpportunitiesPlaceholder() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero */}
      <Card className="p-6 sm:p-8 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <BriefcaseBusiness className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                Opportunities
              </h1>
              <Badge variant="secondary" className="bg-primary/15 text-primary border-primary/20">
                Coming Soon
              </Badge>
            </div>
            <p className="text-base text-muted-foreground leading-relaxed max-w-2xl">
              Profit-first trucking opportunities are coming to HaulTrackerPro. We're building a
              transparent place to compare verified recruiter offers — with the same financial
              honesty you already get from your dashboard.
            </p>
          </div>
        </div>
      </Card>

      {/* Feature grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {features.map(({ icon: Icon, title, body }) => (
          <Card key={title} className="p-5 border-border/60 hover:border-primary/30 transition-colors">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2 shrink-0">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-foreground mb-1">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* CTAs */}
      <Card className="p-6 border-border/60 bg-card/60">
        <h2 className="text-lg font-black text-foreground mb-1">Be ready when we launch</h2>
        <p className="text-sm text-muted-foreground mb-4">
          We'll let you know the moment Opportunities goes live. Driver and recruiter access are
          coming in the next phase.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button disabled className="flex-1 cursor-not-allowed">
            Driver Profile Coming Soon
          </Button>
          <Button disabled variant="outline" className="flex-1 cursor-not-allowed">
            Recruiter Access Coming Soon
          </Button>
        </div>
      </Card>
    </div>
  );
}
