import { ArrowLeft, ArrowRight, Download, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { featureList, downloadFeatureSheet } from '@/lib/featureList';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';
import MarketingHeader from '@/components/marketing/MarketingHeader';

export default function Features() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ background: 'hsl(220, 20%, 8%)' }}>
      <SEOHead title="Features — Truck Driver Profit, Expense, RPM & Back-Office Agency Tools | HaulTrackerPro" description="Track loads, fuel, expenses, real RPM, profit, contracts, parking, referrals, and settlement statements — plus driver assistants and a back-office agency workflow for managing approved driver clients with permission-based access." path="/features" jsonLd={buildBreadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Features', path: '/features' }])} />
      <MarketingHeader />


      {/* Header */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-10">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-xs font-medium mb-6" style={{ color: 'hsl(220, 10%, 50%)' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
              All <span style={{ color: 'hsl(25, 95%, 53%)' }}>Features</span>
            </h1>
            <p className="mt-3 text-base max-w-lg" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Everything HaulTrackerPro offers — from free essentials to Pro-tier analytics.
            </p>
          </div>
          <Button onClick={downloadFeatureSheet} variant="outline" className="gap-2 rounded-xl font-bold shrink-0" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>
            <Download className="h-4 w-4" /> Download Feature Sheet
          </Button>
        </div>
      </section>

      {/* Feature Categories */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20 space-y-14">
        {featureList.map((cat) => (
          <div key={cat.category} id={cat.category === 'Team & Agency Workflow' ? 'team-agency' : undefined}>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>
              {cat.category}
            </h2>
            {cat.category === 'Team & Agency Workflow' && (
              <p className="text-sm mb-5 max-w-3xl" style={{ color: 'hsl(220, 10%, 60%)' }}>
                Use HaulTracker Pro as a private operating system for trucking back-office services. Drivers stay in control while assistants and agencies manage only what they are approved to manage. Submitting an agency request never grants account access — a driver must explicitly approve each delegation.
              </p>
            )}
            {cat.category === 'Contract Protection' && (
              <p className="text-xs mb-5 max-w-3xl" style={{ color: 'hsl(220, 10%, 50%)' }}>
                Review recruiter-sent contracts before you approve an opportunity, sign, or get marked hired. AI contract review is informational only and does not replace reading the full agreement or speaking with a qualified attorney.
              </p>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {cat.features.map((f) => (
                <div key={f.title} className="p-5 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center mb-3" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                    <f.icon className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                  </div>
                  <h3 className="text-sm font-bold mb-1.5 flex items-center gap-2" style={{ color: 'hsl(0, 0%, 100%)' }}>
                    {f.title}
                    {f.pro && (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full" style={{ background: 'hsl(25, 95%, 53%, 0.15)', color: 'hsl(25, 95%, 60%)' }}>Pro</span>
                    )}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 55%)' }}>{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Opportunities / Recruiter ecosystem */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
        <div className="p-6 sm:p-8 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Opportunities Built Around Real Numbers
          </h2>
          <p className="text-sm mb-6 max-w-2xl" style={{ color: 'hsl(220, 10%, 55%)' }}>
            HaulTrackerPro connects drivers and approved recruiters through a structured, profit-first opportunity ecosystem.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mb-6">
            {[
              'Opportunity Preferences for accurate matching',
              'Profit Intelligence applied to every opportunity',
              'Deterministic match scores (no black-box AI claims)',
              'Approved recruiter access only',
              'Applications & request-info dashboard',
              'Estimates only — no guaranteed jobs or income',
            ].map((t) => (
              <div key={t} className="text-sm flex items-start gap-2" style={{ color: 'hsl(220, 10%, 75%)' }}>
                <span className="mt-1 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: 'hsl(25, 95%, 53%)' }} />
                {t}
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={() => navigate('/recruiters')} className="rounded-xl font-bold gap-2" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Explore Recruiter Access
            </Button>
            <Button onClick={() => navigate('/pricing')} variant="outline" className="rounded-xl font-bold" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>
              View Pricing
            </Button>
          </div>
        </div>
      </section>

      {/* Resource Hub CTA */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
        <div className="p-6 sm:p-8 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Want a deeper breakdown?
          </h2>
          <p className="text-sm mb-4 max-w-2xl" style={{ color: 'hsl(220, 10%, 55%)' }}>
            Explore trucking resources on profit tracking, real RPM, load profit calculators, 1099 expenses, contract clarity, parking, referrals, and recruiter tools.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={() => navigate('/resources')} className="rounded-xl font-bold gap-2" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Explore trucking resources <ArrowRight className="h-4 w-4" />
            </Button>
            <Button onClick={() => navigate('/resources/truck-driver-profit-tracking')} variant="outline" className="rounded-xl font-bold" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>
              Profit Tracking Guide
            </Button>
            <Button onClick={() => navigate('/best-truck-driver-profit-tracker')} variant="outline" className="rounded-xl font-bold" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>
              Best Truck Driver Profit Tracker
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8" style={{ borderColor: 'hsl(220, 16%, 14%)', background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs" style={{ color: 'hsl(220, 10%, 40%)' }}>© {new Date().getFullYear()} HaulTrackerPro. All rights reserved.</span>
          <div className="flex items-center gap-5 flex-wrap justify-center">
            {[{ label: 'Features', href: '/features' }, { label: 'Pricing', href: '/pricing' }, { label: 'Resources', href: '/resources' }, { label: 'About', href: '/about' }, { label: 'Terms', href: '/terms' }, { label: 'Privacy', href: '/privacy' }, { label: 'FAQ', href: '/faq' }].map(link => (
              <a key={link.href} href={link.href} className="text-xs font-medium hover:underline" style={{ color: 'hsl(220, 10%, 50%)' }}>
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
