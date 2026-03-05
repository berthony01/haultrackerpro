import { ArrowRight, TrendingUp, DollarSign, FileText, BarChart3, Shield, Truck, ChevronDown, CheckCircle2, AlertTriangle, Calculator, Receipt, Route, Download, Mic, Camera, MapPin, ClipboardPaste, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import dashboardMockup from '@/assets/dashboard-mockup.png';
import SEOHead from '@/components/SEOHead';

const freeFeatures = [
  { icon: Truck, title: 'Load Tracking', desc: 'Log every load with miles, rate, fees, and multi-stop details in seconds.' },
  { icon: Receipt, title: 'Expense Tracking', desc: 'Track fuel, maintenance, tolls, and every cost that eats into your profit.' },
  { icon: Calculator, title: 'Net Profit Calculation', desc: 'See real net profit per load — not just gross revenue.' },
  { icon: MapPin, title: 'Multi-Stop Loads', desc: 'Add pickup and drop-off stops with detention tracking for complex routes.' },
  { icon: ClipboardPaste, title: 'Paste Load Parser', desc: 'Paste load details from any source and auto-fill the form — 5 free per week.' },
  { icon: Download, title: 'CSV Exports', desc: 'Export clean load summaries for tax prep or your own records.' },
];

const proFeatures = [
  { icon: Mic, title: 'AI Voice Logging', desc: 'Speak your expenses naturally — AI parses amount, category, and notes instantly.' },
  { icon: Camera, title: 'AI Receipt Scanning', desc: 'Snap a photo of any receipt and auto-fill expense details with OCR.' },
  { icon: BarChart3, title: 'Driver Scorecard', desc: 'Get graded across 5 performance metrics with tier rankings from Bronze to Platinum.' },
  { icon: FileText, title: 'Weekly Closeout', desc: 'Lock in weekly summaries with pay variance and deadhead tracking.' },
  { icon: TrendingUp, title: 'Unlimited Paste Parser', desc: 'Auto-fill load forms from pasted text — unlimited for Pro users.' },
  { icon: BarChart3, title: 'Performance Charts', desc: 'RPM trends, expense breakdowns, and advanced analytics to drive smarter decisions.' },
];

const faqs = [
  { q: 'Is my data secure?', a: 'Yes. All data is encrypted in transit and stored securely. We never sell or share your data with third parties.' },
  { q: 'Do I need accounting knowledge?', a: 'Not at all. Just enter your loads and expenses — HaulTrackerPro does the math for you automatically.' },
  { q: 'Is it really free?', a: 'The Free plan gives you unlimited loads, expenses, and CSV exports — no credit card required. Pro unlocks advanced features for $15/month or $120/year.' },
  { q: 'How is this different from a spreadsheet?', a: 'HaulTrackerPro gives you instant profit calculations, weekly closeouts, pay variance alerts, and professional exports — without any formulas.' },
];

export default function Landing() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const goToAuth = () => navigate('/auth');

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: 'hsl(220, 20%, 8%)' }}>
      <SEOHead
        title="HaulTrackerPro | Load, Expense & Profit Tracker for Truck Drivers"
        description="HaulTrackerPro helps owner-operators and 1099 truck drivers track loads, log expenses, and see real net profit."
        path="/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "HaulTrackerPro",
          "applicationCategory": "FinanceApplication",
          "operatingSystem": "Web",
          "description": "Track loads, expenses, and real net profit for owner-operators and lease drivers.",
          "url": "https://haultrackerpro.com",
          "offers": [
            { "@type": "Offer", "price": "0", "priceCurrency": "USD", "name": "Free" },
            { "@type": "Offer", "price": "15", "priceCurrency": "USD", "name": "Pro Monthly" }
          ]
        }}
      />
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b" style={{ background: 'hsl(220, 20%, 8%)', borderColor: 'hsl(220, 16%, 16%)' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <div className="flex items-center gap-2">
            <Truck className="h-6 w-6" style={{ color: 'hsl(25, 95%, 53%)' }} />
            <span className="text-lg font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>HaulTrackerPro</span>
          </div>
          {/* Desktop nav */}
          <div className="hidden sm:flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/features')} className="text-sm px-4" style={{ color: 'hsl(220, 10%, 70%)' }}>
              Features
            </Button>
            <Button variant="ghost" onClick={() => navigate('/pricing')} className="text-sm px-4" style={{ color: 'hsl(220, 10%, 70%)' }}>
              Pricing
            </Button>
            <Button variant="ghost" onClick={goToAuth} className="text-sm px-4" style={{ color: 'hsl(220, 10%, 70%)' }}>
              Sign In
            </Button>
            <Button onClick={goToAuth} className="text-sm font-bold rounded-xl px-5" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Start Free
            </Button>
          </div>
          {/* Mobile nav */}
          <div className="flex sm:hidden items-center gap-2">
            <Button onClick={goToAuth} className="text-xs font-bold rounded-xl px-3" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Start Free
            </Button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg"
              aria-label="Toggle menu"
              style={{ color: 'hsl(220, 10%, 70%)' }}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
        {/* Mobile menu panel */}
        {mobileMenuOpen && (
          <div className="sm:hidden border-t animate-in slide-in-from-top-2 duration-200" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
            <div className="flex flex-col px-4 py-4 space-y-1">
              {[
                { label: 'Features', href: '/features' },
                { label: 'Pricing', href: '/pricing' },
                { label: 'FAQ', href: '/faq' },
                { label: 'Sign In', href: '/auth' },
              ].map(item => (
                <button
                  key={item.href}
                  onClick={() => { setMobileMenuOpen(false); navigate(item.href); }}
                  className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-white/5"
                  style={{ color: 'hsl(220, 10%, 70%)' }}
                >
                  {item.label}
                </button>
              ))}
              <Button
                onClick={() => { setMobileMenuOpen(false); goToAuth(); }}
                className="w-full mt-2 text-sm font-bold rounded-xl"
                style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}
              >
                Start Free <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 80% 60% at 50% 0%, hsl(25, 95%, 53%, 0.08) 0%, transparent 70%)'
        }} />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-12 sm:pb-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-6" style={{
                  background: 'hsl(25, 95%, 53%, 0.12)', color: 'hsl(25, 95%, 60%)'
                }}>
                  <TrendingUp className="h-3.5 w-3.5" /> Built for Owner-Operators
                </div>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.1]" style={{ color: 'hsl(0, 0%, 100%)' }}>
                  Know What Every Load{' '}
                  <span style={{ color: 'hsl(25, 95%, 53%)' }}>Really Earns.</span>
                </h1>
                <p className="mt-5 text-base sm:text-lg leading-relaxed max-w-lg" style={{ color: 'hsl(220, 10%, 60%)' }}>
                  Track loads, expenses, and real net profit in one powerful dashboard built for owner-operators and lease drivers.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={goToAuth} size="lg" className="text-base font-bold rounded-xl h-13 px-8 gap-2" style={{
                  background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)',
                  boxShadow: '0 4px 20px -4px hsl(25, 95%, 53%, 0.5)'
                }}>
                  Start Tracking Free <ArrowRight className="h-5 w-5" />
                </Button>
                <Button variant="outline" size="lg" onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} className="text-base font-semibold rounded-xl h-13 px-8" style={{
                  borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent'
                }}>
                  See How It Works
                </Button>
              </div>
              <div className="flex items-center gap-6 pt-2">
                {['No credit card', 'Free plan available', 'Pro from $15/mo'].map(t => (
                  <span key={t} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'hsl(220, 10%, 50%)' }}>
                    <CheckCircle2 className="h-3.5 w-3.5" style={{ color: 'hsl(152, 60%, 42%)' }} /> {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="rounded-2xl overflow-hidden border" style={{
                borderColor: 'hsl(220, 16%, 18%)',
                boxShadow: '0 32px 64px -16px hsl(0, 0%, 0%, 0.5), 0 0 0 1px hsl(220, 16%, 16%)'
              }}>
                <img src={dashboardMockup} alt="HaulTrackerPro dashboard showing load tracking, net profit, and weekly earnings chart" className="w-full" loading="lazy" />
              </div>
              <div className="absolute -bottom-4 right-0 w-32 h-32 rounded-full blur-3xl pointer-events-none" style={{ background: 'hsl(25, 95%, 53%, 0.15)' }} />
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
              Most Drivers Track Revenue.{' '}
              <span style={{ color: 'hsl(25, 95%, 53%)' }}>Smart Drivers Track Profit.</span>
            </h2>
            <p className="mt-4 text-base" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Revenue looks good on paper. But after fuel, tolls, maintenance, and deadhead miles — do you really know what you earned?
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {[
              { icon: AlertTriangle, title: 'Hidden Losses', desc: 'Without tracking expenses per load, profitable-looking loads could be costing you money.' },
              { icon: DollarSign, title: 'Pay Disputes', desc: "When estimated and actual pay don't match, you need records to prove what you're owed." },
              { icon: FileText, title: 'Tax Season Chaos', desc: 'Scrambling to reconstruct expenses at tax time costs you deductions and peace of mind.' },
            ].map((item, i) => (
              <div key={i} className="p-6 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                <div className="h-10 w-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                  <item.icon className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                </div>
                <h3 className="text-lg font-bold mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>{item.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 55%)' }}>{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Button onClick={goToAuth} size="lg" className="text-base font-bold rounded-xl h-13 px-8 gap-2" style={{
              background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)'
            }}>
              Take Control of Your Numbers <ArrowRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Free Features Section */}
      <section id="features" className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 8%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
              Free Plan.{' '}
              <span style={{ color: 'hsl(25, 95%, 53%)' }}>Total Financial Clarity.</span>
            </h2>
            <p className="mt-4 text-base" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Everything you need to understand your real earnings — no spreadsheets, no guesswork.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {freeFeatures.map((f, i) => (
              <div key={i} className="group p-6 rounded-2xl border transition-all duration-300 hover:border-opacity-60" style={{
                background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)',
              }}>
                <div className="h-11 w-11 rounded-xl flex items-center justify-center mb-4 transition-colors" style={{ background: 'hsl(25, 95%, 53%, 0.1)' }}>
                  <f.icon className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                </div>
                <h3 className="text-base font-bold mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 55%)' }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pro Features Section */}
      <section className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
              Go Pro.{' '}
              <span style={{ color: 'hsl(25, 95%, 53%)' }}>Drive Smarter.</span>
            </h2>
            <p className="mt-4 text-base" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Advanced insights starting at $15/month or $120/year. Upgrade when you're ready.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {proFeatures.map((f, i) => (
              <div key={i} className="group p-6 rounded-2xl border transition-all duration-300" style={{
                background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(25, 95%, 53%, 0.3)',
              }}>
                <div className="h-11 w-11 rounded-xl flex items-center justify-center mb-4" style={{ background: 'hsl(25, 95%, 53%, 0.15)' }}>
                  <f.icon className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                </div>
                <h3 className="text-base font-bold mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 55%)' }}>{f.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Button onClick={() => navigate('/pricing')} size="lg" className="text-base font-bold rounded-xl h-13 px-8 gap-2" style={{
              background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)'
            }}>
              View Pricing <ArrowRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Built for Drivers */}
      <section className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-6" style={{ color: 'hsl(0, 0%, 100%)' }}>
                Built for Drivers Who Run Their Truck{' '}
                <span style={{ color: 'hsl(25, 95%, 53%)' }}>Like a Business.</span>
              </h2>
              <p className="text-base mb-8" style={{ color: 'hsl(220, 10%, 55%)' }}>
                Whether you're an owner-operator or lease driver, HaulTrackerPro gives you the financial tools that fleets have — without the fleet overhead.
              </p>
              <Button onClick={goToAuth} size="lg" className="text-base font-bold rounded-xl h-13 px-8 gap-2" style={{
                background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)'
              }}>
                Create Your Free Account <ArrowRight className="h-5 w-5" />
              </Button>
            </div>
            <div className="space-y-4">
              {[
                { icon: BarChart3, title: 'Weekly Summaries', desc: 'Close out every week with a snapshot of loads, miles, revenue, and profit.' },
                { icon: DollarSign, title: 'Estimated vs Actual Pay', desc: 'Compare what you expected to earn against what you actually received.' },
                { icon: AlertTriangle, title: 'Missing Pay Alerts', desc: 'Instantly see which loads are still unpaid — no more forgotten settlements.' },
                { icon: FileText, title: 'Export-Ready Reports', desc: 'Download professional reports for tax prep, bookkeepers, or dispute resolution.' },
              ].map((item, i) => (
                <div key={i} className="flex gap-4 p-5 rounded-xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                    <item.icon className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold mb-1" style={{ color: 'hsl(0, 0%, 100%)' }}>{item.title}</h3>
                    <p className="text-sm" style={{ color: 'hsl(220, 10%, 55%)' }}>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 8%)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
              Simple. Professional.{' '}
              <span style={{ color: 'hsl(25, 95%, 53%)' }}>Reliable.</span>
            </h2>
          </div>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div key={i} className="rounded-xl border overflow-hidden" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-5 text-left"
                >
                  <span className="text-sm font-bold" style={{ color: 'hsl(0, 0%, 100%)' }}>{faq.q}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${openFaq === i ? 'rotate-180' : ''}`} style={{ color: 'hsl(220, 10%, 50%)' }} />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-5 -mt-1">
                    <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 55%)' }}>{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Button onClick={goToAuth} size="lg" className="text-base font-bold rounded-xl h-13 px-8 gap-2" style={{
              background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)'
            }}>
              Start Free Today <ArrowRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 sm:py-28 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 50%, hsl(25, 95%, 53%, 0.06) 0%, transparent 70%)'
        }} />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center relative">
          <h2 className="text-3xl sm:text-5xl font-black tracking-tight mb-5" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Stop Guessing.{' '}
            <span style={{ color: 'hsl(25, 95%, 53%)' }}>Start Knowing.</span>
          </h2>
          <p className="text-base mb-8 max-w-md mx-auto" style={{ color: 'hsl(220, 10%, 55%)' }}>
            Join drivers who track every load, every expense, and every dollar. Free plan available — Pro from $15/month.
          </p>
          <Button onClick={goToAuth} size="lg" className="text-lg font-bold rounded-2xl h-14 px-10 gap-2" style={{
            background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)',
            boxShadow: '0 4px 24px -4px hsl(25, 95%, 53%, 0.5)'
          }}>
            Start Tracking Free <ArrowRight className="h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8" style={{ borderColor: 'hsl(220, 16%, 14%)', background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
          {/* Desktop: 3-column, Mobile: stacked */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-4">
            <div className="text-center sm:text-left">
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'hsl(220, 10%, 50%)' }}>Product</p>
              <div className="flex justify-center sm:block gap-4 sm:gap-0">
                {[
                  { label: 'Features', href: '/features' },
                  { label: 'Pricing', href: '/pricing' },
                  { label: 'FAQ', href: '/faq' },
                ].map(link => (
                  <a key={link.href} href={link.href} className="inline-block sm:block text-xs font-medium hover:underline mb-0 sm:mb-1.5 px-2 py-1 sm:px-0 sm:py-0" style={{ color: 'hsl(220, 10%, 45%)' }}>
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
            <div className="text-center sm:text-left">
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'hsl(220, 10%, 50%)' }}>Resources</p>
              <div className="grid grid-cols-3 gap-x-2 gap-y-2 sm:block max-w-xs mx-auto sm:max-w-none sm:mx-0">
                {[
                  { label: 'Finance Guides', href: '/trucking-finance-guides' },
                  { label: 'Tax Deductions', href: '/truck-driver-tax-deductions' },
                  { label: 'Expense Tracker', href: '/owner-operator-expense-tracker' },
                  { label: 'Profit Calculator', href: '/trucking-profit-calculator' },
                  { label: 'Cost Per Mile', href: '/trucking-cost-per-mile' },
                  { label: 'Bookkeeping', href: '/trucker-bookkeeping-guide' },
                ].map(link => (
                  <a key={link.href} href={link.href} className="block text-xs font-medium hover:underline text-center sm:text-left py-1.5 sm:py-0 sm:mb-1.5 rounded-md" style={{ color: 'hsl(220, 10%, 45%)' }}>
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
            <div className="text-center sm:text-left">
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'hsl(220, 10%, 50%)' }}>Legal</p>
              <div className="flex justify-center sm:block gap-4 sm:gap-0">
                {[
                  { label: 'Terms', href: '/terms' },
                  { label: 'Privacy', href: '/privacy' },
                ].map(link => (
                  <a key={link.href} href={link.href} className="inline-block sm:block text-xs font-medium hover:underline mb-0 sm:mb-1.5 px-2 py-1 sm:px-0 sm:py-0" style={{ color: 'hsl(220, 10%, 45%)' }}>
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center sm:justify-start gap-2 pt-4 border-t" style={{ borderColor: 'hsl(220, 16%, 14%)' }}>
            <Shield className="h-4 w-4" style={{ color: 'hsl(220, 10%, 40%)' }} />
            <span className="text-xs" style={{ color: 'hsl(220, 10%, 40%)' }}>© {new Date().getFullYear()} HaulTrackerPro. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
