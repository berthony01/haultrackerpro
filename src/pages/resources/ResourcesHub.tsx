import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, TrendingUp, Calculator, Gauge, Receipt, FileSignature, ParkingCircle, Users, Briefcase, Truck, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';
import { supabase } from '@/integrations/supabase/client';

interface PublishedArticle {
  id: string; slug: string; title: string; excerpt: string | null; topic_cluster: string;
}

export const RESOURCE_GUIDES = [
  { to: '/resources/truck-driver-profit-tracking', title: 'Truck Driver Profit Tracking', desc: 'Gross pay vs. real net profit — what to track on every load.', icon: TrendingUp },
  { to: '/resources/load-profit-calculator', title: 'Load Profit Calculator Guide', desc: 'Estimate if a load is worth taking before you accept it.', icon: Calculator },
  { to: '/resources/real-rpm-trucking', title: 'Real RPM in Trucking', desc: 'Loaded miles, deadhead, and expenses — your true rate per mile.', icon: Gauge },
  { to: '/resources/1099-truck-driver-expenses', title: '1099 Truck Driver Expenses', desc: 'Organize expenses and receipts for cleaner records.', icon: Receipt },
  { to: '/resources/trucking-contract-clarity', title: 'Trucking Contract Clarity', desc: 'Spot risks in carrier and lease contracts before signing.', icon: FileSignature },
  { to: '/resources/truck-parking-tracker', title: 'Truck Parking Tracker', desc: 'Use driver reports to plan stops with better visibility.', icon: ParkingCircle },
  { to: '/resources/driver-referral-tracking', title: 'Driver Referral Tracking', desc: 'Track recruiter referrals and recruiter-stated terms.', icon: Users },
  { to: '/resources/trucking-recruiter-tools', title: 'Trucking Recruiter Tools', desc: 'Verified recruiter access, applicants, and premium visibility.', icon: Briefcase },
];

export default function ResourcesHub() {
  const navigate = useNavigate();
  const [dynamicArticles, setDynamicArticles] = useState<PublishedArticle[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Public-safe view: excludes ai_generation_prompt and other internal fields.
      const { data, error } = await (supabase as any)
        .from('resource_articles_public')
        .select('id,slug,title,excerpt,topic_cluster')
        .order('published_at', { ascending: false })
        .limit(24);
      if (!cancelled && !error && data) setDynamicArticles(data as PublishedArticle[]);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucking Resources for Profit, Expenses, Contracts & Recruiting | HaulTrackerPro"
        description="Free trucking guides for owner-operators, 1099 drivers, and recruiters — load profit, real RPM, expenses, contracts, parking, and referral tracking."
        path="/resources"
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            headline: 'Trucking Resources for Profit, Expenses, Contracts, Referrals, and Recruiting',
            description: 'Guides that help truck drivers and recruiters understand trucking business workflows.',
            author: { '@type': 'Organization', name: 'HaulTrackerPro' },
          },
          buildBreadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Resources', path: '/resources' }]),
        ]}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-4xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate('/')} aria-label="Home">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Resources</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-4xl mx-auto space-y-10">
        <section className="text-center space-y-4 py-4">
          <div className="flex justify-center">
            <BookOpen className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-black font-heading">
            Trucking Resources for Profit, Expenses, Contracts, Referrals, and Recruiting
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Practical guides to help truck drivers and recruiters understand trucking business workflows — from load profit and real RPM to expenses, contracts, parking, and referral tracking.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {RESOURCE_GUIDES.map((g) => {
            const Icon = g.icon;
            return (
              <Link
                key={g.to}
                to={g.to}
                className="flex items-start gap-3 p-5 rounded-xl border border-border bg-card shadow-sm hover:border-primary/40 transition-colors group"
              >
                <Icon className="h-6 w-6 text-primary mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-foreground group-hover:text-primary transition-colors">{g.title}</div>
                  <div className="text-sm text-muted-foreground mt-1 leading-relaxed">{g.desc}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
              </Link>
            );
          })}
        </section>

        {dynamicArticles.length > 0 && (
          <section className="space-y-3 border-t border-border pt-6">
            <h3 className="font-black font-heading text-lg text-center">More trucking articles</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {dynamicArticles.map((a) => (
                <Link key={a.id} to={`/resources/${a.slug}`} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors">
                  <FileText className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-foreground text-sm">{a.title}</div>
                    {a.excerpt && <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{a.excerpt}</div>}
                    <div className="text-[10px] text-muted-foreground/70 mt-1 uppercase tracking-wider">{a.topic_cluster}</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}



        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-3 text-center">
            <Truck className="h-8 w-8 text-primary mx-auto" />
            <h3 className="font-black font-heading">For Drivers</h3>
            <p className="text-sm text-muted-foreground">Track loads, fuel, expenses, and real RPM in one place.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" className="rounded-xl" onClick={() => navigate('/auth')}>Start Tracking Free</Button>
              <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate('/pricing')}>View Pricing</Button>
            </div>
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-3 text-center">
            <Briefcase className="h-8 w-8 text-primary mx-auto" />
            <h3 className="font-black font-heading">For Recruiters</h3>
            <p className="text-sm text-muted-foreground">Verified access, applicants, referral tracking, and premium tools.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" className="rounded-xl" onClick={() => navigate('/recruiters')}>Apply for Recruiter Access</Button>
              <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate('/recruiter/features')}>Explore Recruiter Tools</Button>
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h3 className="font-black font-heading text-lg text-center">Compare trucking profit tracking options</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { to: '/haultrackerpro-vs-spreadsheets', title: 'Haul Tracker Pro vs Spreadsheets', desc: 'Trucking profit tracker compared to spreadsheets.' },
              { to: '/haultrackerpro-vs-quickbooks', title: 'Haul Tracker Pro vs QuickBooks', desc: 'Trucking-specific tracker vs general bookkeeping.' },
              { to: '/best-truck-driver-profit-tracker', title: 'Best Truck Driver Profit Tracker', desc: 'What owner-operators should look for.' },
            ].map((c) => (
              <Link key={c.to} to={c.to} className="block p-4 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors">
                <div className="font-semibold text-foreground text-sm">{c.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{c.desc}</div>
              </Link>
            ))}
          </div>
        </section>

        <nav aria-label="More about HaulTrackerPro" className="border-t border-border pt-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">More about HaulTrackerPro</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate('/about')}>About</Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate('/features')}>Features</Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate('/pricing')}>Pricing</Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate('/recruiters')}>For Recruiters</Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate('/faq')}>FAQ</Button>
          </div>
        </nav>
      </main>
    </div>
  );
}
