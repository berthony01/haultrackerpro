import { useState } from 'react';
import { ArrowRight, Check, Minus, Truck, Shield, TrendingUp, Target, BarChart3, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { PLANS } from '@/lib/billing/plans';

const freeFeatures = [
  'Unlimited load logging',
  'Unlimited expense tracking',
  'Net profit per load calculation',
  'Estimated vs actual pay comparison',
  'Multi-stop load support',
  'Basic smart alerts',
  '2 Performance Charts (Net Profit & Revenue vs Expenses)',
  'Basic Tax Set-Aside estimate (single total)',
  'CSV exports',
  'Paste Load Parser (5 per week)',
  'Custom week start day',
];

const proFeatures = [
  'AI Voice Expense Logging',
  'AI Receipt & Screenshot Scanning',
  'Paste Load Parser (Unlimited)',
  'RPM, Deadhead % & Expense Breakdown Charts',
  'Driver Performance Scorecard',
  'Weekly Closeout Snapshots',
  'Full Tax Breakdown & Quarterly Schedule',
  'Advanced Smart Alerts (profit drops, RPM dips)',
  'PDF Exports & Profit Reports',
];

const comparisonRows: { feature: string; free: string; pro: string }[] = [
  { feature: 'Load & expense logging', free: 'Unlimited', pro: 'Unlimited' },
  { feature: 'Net profit per load', free: '✓', pro: '✓' },
  { feature: 'Est. vs actual pay', free: '✓', pro: '✓' },
  { feature: 'Multi-stop loads', free: '✓', pro: '✓' },
  { feature: 'Smart alerts', free: 'Basic', pro: 'All (advanced included)' },
  { feature: 'Performance charts', free: '2 charts', pro: 'All 5 charts' },
  { feature: 'Tax planning', free: 'Total estimate only', pro: 'Full breakdown + quarterly' },
  { feature: 'Paste Load Parser', free: '5 per week', pro: 'Unlimited' },
  { feature: 'AI Voice Logging', free: '—', pro: '✓' },
  { feature: 'AI Receipt Scanning', free: '—', pro: '✓' },
  { feature: 'Driver Scorecard', free: '—', pro: '✓' },
  { feature: 'Weekly Closeout', free: '—', pro: '✓' },
  { feature: 'CSV exports', free: '✓', pro: '✓' },
  { feature: 'PDF exports & reports', free: '—', pro: '✓' },
];

const whyProPoints = [
  { icon: Zap, title: 'Log Expenses in Seconds', desc: 'Use voice or receipt scan — no manual typing required.' },
  { icon: BarChart3, title: 'See What Others Miss', desc: 'Performance trends most drivers never track: RPM, deadhead %, expense breakdown.' },
  { icon: Target, title: 'Plan Taxes with Confidence', desc: 'Full federal, state, and SE tax breakdown with quarterly payment schedule.' },
  { icon: TrendingUp, title: 'Close Your Week Like a Business', desc: 'Weekly Closeout snapshots lock in your numbers with pay variance tracking.' },
];

export default function Pricing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [annual, setAnnual] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { priceId: annual ? ANNUAL_PRICE_ID : MONTHLY_PRICE_ID },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to start checkout');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'hsl(220, 20%, 8%)' }}>
      <SEOHead title="Pricing | HaulTrackerPro" description="Start free with HaulTrackerPro. Upgrade to Pro for automation, insights, and advanced reporting." path="/pricing" />
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b" style={{ background: 'hsl(220, 20%, 8%)', borderColor: 'hsl(220, 16%, 16%)' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <button onClick={() => navigate('/')} className="flex items-center gap-2">
            <Truck className="h-6 w-6" style={{ color: 'hsl(25, 95%, 53%)' }} />
            <span className="text-lg font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>HaulTrackerPro</span>
          </button>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/auth')} className="text-sm" style={{ color: 'hsl(220, 10%, 70%)' }}>
              Sign In
            </Button>
            <Button onClick={() => navigate('/auth')} className="text-sm font-bold rounded-xl px-5" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Start Free
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 80% 60% at 50% 0%, hsl(25, 95%, 53%, 0.08) 0%, transparent 70%)'
        }} />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-8 text-center relative">
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Stop Driving Blind.{' '}
            <span style={{ color: 'hsl(25, 95%, 53%)' }}>Know Your Real Profit.</span>
          </h1>
          <p className="mt-4 text-base sm:text-lg max-w-xl mx-auto" style={{ color: 'hsl(220, 10%, 55%)' }}>
            HaulTrackerPro helps owner-operators track profit, automate bookkeeping, and plan taxes with confidence.
          </p>
        </div>
      </section>

      {/* Billing Toggle */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-3 p-1 rounded-xl" style={{ background: 'hsl(220, 20%, 12%)' }}>
          <button
            onClick={() => setAnnual(false)}
            className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
            style={{
              background: !annual ? 'hsl(25, 95%, 53%)' : 'transparent',
              color: !annual ? 'hsl(0, 0%, 100%)' : 'hsl(220, 10%, 55%)',
            }}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
            style={{
              background: annual ? 'hsl(25, 95%, 53%)' : 'transparent',
              color: annual ? 'hsl(0, 0%, 100%)' : 'hsl(220, 10%, 55%)',
            }}
          >
            Annual <span className="ml-1 text-xs opacity-80">Save $60</span>
          </button>
        </div>
      </div>

      {/* Pricing Cards */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-16">
        <div className="grid sm:grid-cols-2 gap-6">
          {/* Free Card */}
          <div className="p-6 sm:p-8 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'hsl(0, 0%, 100%)' }}>Free</h3>
            <p className="text-sm mb-6" style={{ color: 'hsl(220, 10%, 55%)' }}>Everything you need to start tracking</p>
            <div className="mb-6">
              <span className="text-4xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>$0</span>
              <span className="text-sm ml-1" style={{ color: 'hsl(220, 10%, 55%)' }}>/month</span>
            </div>
            <Button onClick={() => navigate('/auth')} variant="outline" className="w-full rounded-xl font-bold mb-6" style={{
              borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent'
            }}>
              Start Free
            </Button>
            <ul className="space-y-3">
              {freeFeatures.map(f => (
                <li key={f} className="flex items-start gap-2.5 text-sm" style={{ color: 'hsl(220, 10%, 70%)' }}>
                  <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'hsl(152, 60%, 42%)' }} />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Pro Card */}
          <div className="p-6 sm:p-8 rounded-2xl border relative" style={{
            background: 'hsl(220, 20%, 10%)',
            borderColor: 'hsl(25, 95%, 53%)',
            boxShadow: '0 0 30px -8px hsl(25, 95%, 53%, 0.2), 0 0 0 1px hsl(25, 95%, 53%, 0.15)'
          }}>
            <div className="absolute -top-3 right-6 px-3 py-1 rounded-full text-xs font-bold" style={{
              background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)'
            }}>
              MOST POPULAR
            </div>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'hsl(0, 0%, 100%)' }}>Pro</h3>
            <p className="text-sm mb-6" style={{ color: 'hsl(220, 10%, 55%)' }}>Advanced insights for serious drivers</p>
            <div className="mb-6">
              <span className="text-4xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>
                ${annual ? '10' : '15'}
              </span>
              <span className="text-sm ml-1" style={{ color: 'hsl(220, 10%, 55%)' }}>/month</span>
              {annual && (
                <span className="block text-xs mt-1" style={{ color: 'hsl(25, 95%, 60%)' }}>
                  $120/year — save $60
                </span>
              )}
            </div>
            <Button onClick={handleUpgrade} disabled={loading} className="w-full rounded-xl font-bold mb-2 gap-2" style={{
              background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)',
              boxShadow: '0 4px 20px -4px hsl(25, 95%, 53%, 0.5)'
            }}>
              {loading ? 'Loading...' : 'Start Free Trial'} {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
            <p className="text-center text-xs font-semibold mb-6 px-3 py-1.5 rounded-full mx-auto w-fit" style={{
              background: 'hsl(25, 95%, 53%, 0.12)', color: 'hsl(25, 95%, 60%)'
            }}>
              ✨ 14-day free trial included
            </p>
            <p className="text-xs mb-4 font-semibold" style={{ color: 'hsl(25, 95%, 60%)' }}>
              Everything in Free, plus:
            </p>
            <ul className="space-y-3">
              {proFeatures.map(f => (
                <li key={f} className="flex items-start gap-2.5 text-sm" style={{ color: 'hsl(220, 10%, 70%)' }}>
                  <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'hsl(25, 95%, 53%)' }} />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Why Go Pro */}
      <section className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-12" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Why Go <span style={{ color: 'hsl(25, 95%, 53%)' }}>Pro?</span>
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {whyProPoints.map((p, i) => (
              <div key={i} className="flex gap-4 p-5 rounded-xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                  <p.icon className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                </div>
                <div>
                  <h3 className="text-sm font-bold mb-1" style={{ color: 'hsl(0, 0%, 100%)' }}>{p.title}</h3>
                  <p className="text-sm" style={{ color: 'hsl(220, 10%, 55%)' }}>{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 8%)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-10" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Full Feature <span style={{ color: 'hsl(25, 95%, 53%)' }}>Comparison</span>
          </h2>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'hsl(220, 16%, 16%)' }}>
            {/* Header */}
            <div className="grid grid-cols-3 text-sm font-bold" style={{ background: 'hsl(220, 20%, 12%)' }}>
              <div className="p-4" style={{ color: 'hsl(220, 10%, 55%)' }}>Feature</div>
              <div className="p-4 text-center" style={{ color: 'hsl(220, 10%, 70%)' }}>Free</div>
              <div className="p-4 text-center" style={{ color: 'hsl(25, 95%, 53%)' }}>Pro</div>
            </div>
            {/* Rows */}
            {comparisonRows.map((row, i) => (
              <div key={i} className="grid grid-cols-3 text-sm border-t" style={{ borderColor: 'hsl(220, 16%, 14%)' }}>
                <div className="p-4" style={{ color: 'hsl(220, 10%, 70%)' }}>{row.feature}</div>
                <div className="p-4 text-center" style={{ color: row.free === '—' ? 'hsl(220, 10%, 30%)' : 'hsl(220, 10%, 60%)' }}>
                  {row.free === '✓' ? <Check className="h-4 w-4 mx-auto" style={{ color: 'hsl(152, 60%, 42%)' }} /> : row.free === '—' ? <Minus className="h-4 w-4 mx-auto" /> : row.free}
                </div>
                <div className="p-4 text-center font-medium" style={{
                  color: 'hsl(25, 95%, 60%)',
                  background: 'hsl(25, 95%, 53%, 0.04)'
                }}>
                  {row.pro === '✓' ? <Check className="h-4 w-4 mx-auto" style={{ color: 'hsl(25, 95%, 53%)' }} /> : row.pro}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-20 sm:py-28 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 50%, hsl(25, 95%, 53%, 0.06) 0%, transparent 70%)'
        }} />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center relative">
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-5" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Ready to Drive Smarter?
          </h2>
          <p className="text-base mb-8 max-w-md mx-auto" style={{ color: 'hsl(220, 10%, 55%)' }}>
            Start free today. Upgrade to Pro when you're ready for next-level insights.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Button onClick={() => navigate('/auth')} variant="outline" size="lg" className="text-base font-bold rounded-xl h-13 px-8" style={{
              borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent'
            }}>
              Start Free Today
            </Button>
            <Button onClick={handleUpgrade} disabled={loading} size="lg" className="text-base font-bold rounded-xl h-13 px-8 gap-2" style={{
              background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)',
              boxShadow: '0 4px 24px -4px hsl(25, 95%, 53%, 0.5)'
            }}>
              {loading ? 'Loading...' : 'Start Free Trial'} {!loading && <ArrowRight className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8" style={{ borderColor: 'hsl(220, 16%, 14%)', background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" style={{ color: 'hsl(220, 10%, 40%)' }} />
            <span className="text-xs" style={{ color: 'hsl(220, 10%, 40%)' }}>© {new Date().getFullYear()} HaulTrackerPro. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-5">
            {[
              { label: 'Features', href: '/features' },
              { label: 'Pricing', href: '/pricing' },
              { label: 'Terms', href: '/terms' },
              { label: 'Privacy', href: '/privacy' },
              { label: 'FAQ', href: '/faq' },
            ].map(link => (
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
