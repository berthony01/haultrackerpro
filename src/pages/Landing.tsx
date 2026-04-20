import { ArrowRight, TrendingUp, DollarSign, FileText, BarChart3, Shield, Truck, ChevronDown, CheckCircle2, AlertTriangle, Mic, Camera, Menu, X, Star, Users, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import dashboardMockup from '@/assets/dashboard-mockup.png';
import SEOHead from '@/components/SEOHead';

const faqs = [
  { q: 'Is my data secure?', a: 'Yes. All data is encrypted in transit and stored securely. We never sell or share your data with third parties.' },
  { q: 'Do I need accounting knowledge?', a: 'Not at all. Just enter your loads and expenses — HaulTrackerPro does the math for you automatically.' },
  { q: 'Is it really free?', a: 'The Free plan gives you unlimited loads, expenses, and CSV exports — no credit card required. Pro unlocks AI-powered automation and advanced features for $19.99/month or $179.88/year.' },
  { q: 'How is this different from a spreadsheet?', a: 'HaulTrackerPro gives you instant profit calculations, weekly closeouts, pay variance alerts, and professional exports — without any formulas.' },
  { q: 'Can I try Pro features before paying?', a: 'Yes — every new account starts with a free 14-day Pro trial. No credit card required. You get full access to AI Voice Logging, Receipt Scanning, Driver Scorecard, and all 5 performance charts.' },
];

export default function Landing() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const goToAuth = () => navigate('/auth');

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: 'hsl(220, 20%, 8%)' }}>
      <SEOHead
        title="HaulTrackerPro | Know Your Real Profit Per Load"
        description="Stop driving blind. HaulTrackerPro shows truck drivers their true profit after fuel, deadhead, and expenses — so you stop losing money on bad loads."
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
            { "@type": "Offer", "price": "19.99", "priceCurrency": "USD", "name": "Pro Monthly" }
          ]
        }}
      />

      {/* ═══════════════════════════════════════════ */}
      {/* NAV */}
      {/* ═══════════════════════════════════════════ */}
      <nav className="sticky top-0 z-50 border-b" style={{ background: 'hsl(220, 20%, 8%)', borderColor: 'hsl(220, 16%, 16%)' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <div className="flex items-center gap-2">
            <Truck className="h-6 w-6" style={{ color: 'hsl(25, 95%, 53%)' }} />
            <span className="text-lg font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>HaulTrackerPro</span>
          </div>
          <div className="hidden sm:flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/features')} className="text-sm px-4" style={{ color: 'hsl(220, 10%, 70%)' }}>Features</Button>
            <Button variant="ghost" onClick={() => navigate('/pricing')} className="text-sm px-4" style={{ color: 'hsl(220, 10%, 70%)' }}>Pricing</Button>
            <Button variant="ghost" onClick={goToAuth} className="text-sm px-4" style={{ color: 'hsl(220, 10%, 70%)' }}>Sign In</Button>
            <Button onClick={goToAuth} className="text-sm font-bold rounded-xl px-5" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Start Tracking Free
            </Button>
          </div>
          <div className="flex sm:hidden items-center gap-2">
            <Button onClick={goToAuth} className="text-xs font-bold rounded-xl px-3" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Start Tracking Free
            </Button>
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 rounded-lg" aria-label="Toggle menu" style={{ color: 'hsl(220, 10%, 70%)' }}>
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="sm:hidden border-t animate-in slide-in-from-top-2 duration-200" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
            <div className="flex flex-col px-4 py-4 space-y-1">
              {[
                { label: 'Features', href: '/features' },
                { label: 'Pricing', href: '/pricing' },
                { label: 'FAQ', href: '/faq' },
                { label: 'Sign In', href: '/auth' },
              ].map(item => (
                <button key={item.href} onClick={() => { setMobileMenuOpen(false); navigate(item.href); }}
                  className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-white/5"
                  style={{ color: 'hsl(220, 10%, 70%)' }}>{item.label}</button>
              ))}
              <Button onClick={() => { setMobileMenuOpen(false); goToAuth(); }}
                className="w-full mt-2 text-sm font-bold rounded-xl"
                style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
                Start Tracking Free <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}
      </nav>

      {/* ═══════════════════════════════════════════ */}
      {/* SECTION 1: HERO */}
      {/* ═══════════════════════════════════════════ */}
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
                  Stop Driving Blind.{' '}
                  <span style={{ color: 'hsl(25, 95%, 53%)' }}>Know Your Real Profit.</span>
                </h1>
                <p className="mt-5 text-base sm:text-lg leading-relaxed max-w-lg" style={{ color: 'hsl(220, 10%, 60%)' }}>
                  Most loads look profitable. Many aren't. HaulTrackerPro shows your true profit after fuel, deadhead, and expenses — so you stop losing money on bad loads.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={goToAuth} size="lg" className="text-base font-bold rounded-xl h-13 px-8 gap-2" style={{
                  background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)',
                  boxShadow: '0 4px 20px -4px hsl(25, 95%, 53%, 0.5)'
                }}>
                  Start Free — See Your Real Profit Today <ArrowRight className="h-5 w-5" />
                </Button>
                <Button variant="outline" size="lg" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })} className="text-base font-semibold rounded-xl h-13 px-8" style={{
                  borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent'
                }}>
                  Watch How It Works
                </Button>
              </div>
              <div className="flex items-center gap-6 pt-2">
                {['No credit card', 'Free plan available', 'Pro from $19.99/mo'].map(t => (
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

      {/* ═══════════════════════════════════════════ */}
      {/* SECTION 2: HOW IT WORKS */}
      {/* ═══════════════════════════════════════════ */}
      <section id="how-it-works" className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
              HaulTrackerPro Shows You The Truth About Every Load
            </h2>
            <p className="mt-4 text-base" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Track your loads, expenses, and miles in real time — and automatically see your true net profit. No spreadsheets. No guessing. No surprises.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {[
              { step: '1', title: 'Know Your Real Profit', desc: 'See exactly what you made after fuel, expenses, and deadhead — per load and per week.' },
              { step: '2', title: 'Catch Bad Loads Before They Cost You', desc: 'Stop taking loads that hurt your bottom line. Spot losers before you commit.' },
              { step: '3', title: 'Stop Missing Money', desc: 'Track payments, catch short-pays, and stay tax-ready year-round — automatically.' },
            ].map((item, i) => (
              <div key={i} className="p-6 rounded-2xl border text-center" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                <div className="h-10 w-10 rounded-full flex items-center justify-center mx-auto mb-4 text-sm font-black" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
                  {item.step}
                </div>
                <h3 className="text-lg font-bold mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>{item.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 55%)' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* SECTION 3: PAIN POINTS */}
      {/* ═══════════════════════════════════════════ */}
      <section className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 8%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
              You're Not Losing Money Because You're Working Hard…{' '}
              <span style={{ color: 'hsl(25, 95%, 53%)' }}>You're Losing Money Because You Can't See It.</span>
            </h2>
            <p className="mt-4 text-base" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Every week, drivers take loads that look good on paper — but after fuel, deadhead, maintenance, and hidden costs, profit is much lower than expected. Sometimes there's no profit at all.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto mb-12">
            {[
              { icon: AlertTriangle, title: 'You Only See Gross Pay', desc: 'Without expenses per load, profitable-looking runs could be quietly costing you money.' },
              { icon: DollarSign, title: 'You Miss Short-Pays', desc: "When estimated and actual pay don't match, you need records to catch what you're owed." },
              { icon: FileText, title: 'You Guess Instead of Knowing', desc: 'Tax season chaos and lost deductions — because the numbers were never tracked.' },
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

          {/* Reality Check — $2,000 → $700 */}
          <div className="max-w-2xl mx-auto p-6 sm:p-8 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(25, 95%, 53%, 0.25)' }}>
            <h3 className="text-xl sm:text-2xl font-black tracking-tight text-center mb-6" style={{ color: 'hsl(0, 0%, 100%)' }}>
              That $2,000 Load Might Only Be{' '}
              <span style={{ color: 'hsl(25, 95%, 53%)' }}>$700.</span>
            </h3>
            <div className="space-y-2 max-w-sm mx-auto text-sm">
              {[
                { label: 'Load pays', val: '$2,000', positive: true },
                { label: 'Fuel', val: '− $800' },
                { label: 'Deadhead', val: '− $150' },
                { label: 'Maintenance', val: '− $200' },
                { label: 'Insurance', val: '− $150' },
              ].map((row, i) => (
                <div key={i} className="flex justify-between py-1.5 border-b" style={{ borderColor: 'hsl(220, 16%, 14%)' }}>
                  <span style={{ color: 'hsl(220, 10%, 65%)' }}>{row.label}</span>
                  <span className="font-bold tabular-nums" style={{ color: row.positive ? 'hsl(0, 0%, 100%)' : 'hsl(220, 10%, 75%)' }}>{row.val}</span>
                </div>
              ))}
              <div className="flex justify-between pt-3 text-base">
                <span className="font-bold" style={{ color: 'hsl(0, 0%, 100%)' }}>Real Profit</span>
                <span className="font-black tabular-nums" style={{ color: 'hsl(25, 95%, 53%)' }}>$700</span>
              </div>
            </div>
            <p className="text-center mt-6 text-sm italic" style={{ color: 'hsl(220, 10%, 55%)' }}>
              If you're not tracking this… you're making decisions in the dark.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* SECTION 4: AI DEMO (NEW) */}
      {/* ═══════════════════════════════════════════ */}
      <section className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
              Log Expenses{' '}
              <span style={{ color: 'hsl(25, 95%, 53%)' }}>Without Typing.</span>
            </h2>
            <p className="mt-4 text-base" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Pro features that no other trucking app offers at this price.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {/* Voice Logging Demo */}
            <div className="p-6 sm:p-8 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(25, 95%, 53%, 0.2)' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-11 w-11 rounded-xl flex items-center justify-center" style={{ background: 'hsl(25, 95%, 53%, 0.15)' }}>
                  <Mic className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                </div>
                <h3 className="text-lg font-bold" style={{ color: 'hsl(0, 0%, 100%)' }}>AI Voice Logging</h3>
              </div>
              <div className="space-y-4">
                {[
                  { step: '1', label: 'You say:', text: '"$85 fuel at Pilot, diesel"' },
                  { step: '2', label: 'AI parses:', text: 'Amount: $85 · Category: Fuel · Station: Pilot' },
                  { step: '3', label: 'Result:', text: 'Expense logged — hands-free, eyes on the road' },
                ].map((s) => (
                  <div key={s.step} className="flex gap-3 items-start">
                    <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5" style={{ background: 'hsl(25, 95%, 53%, 0.15)', color: 'hsl(25, 95%, 53%)' }}>
                      {s.step}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'hsl(220, 10%, 45%)' }}>{s.label}</p>
                      <p className="text-sm font-medium" style={{ color: 'hsl(0, 0%, 90%)' }}>{s.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Receipt Scanning Demo */}
            <div className="p-6 sm:p-8 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(25, 95%, 53%, 0.2)' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-11 w-11 rounded-xl flex items-center justify-center" style={{ background: 'hsl(25, 95%, 53%, 0.15)' }}>
                  <Camera className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                </div>
                <h3 className="text-lg font-bold" style={{ color: 'hsl(0, 0%, 100%)' }}>AI Receipt Scanning</h3>
              </div>
              <div className="space-y-4">
                {[
                  { step: '1', label: 'You snap:', text: 'Photo of any fuel, toll, or maintenance receipt' },
                  { step: '2', label: 'AI reads:', text: 'Amount, vendor, date, and category extracted via OCR' },
                  { step: '3', label: 'Result:', text: 'Expense auto-filled — no typing, no lost receipts' },
                ].map((s) => (
                  <div key={s.step} className="flex gap-3 items-start">
                    <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5" style={{ background: 'hsl(25, 95%, 53%, 0.15)', color: 'hsl(25, 95%, 53%)' }}>
                      {s.step}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'hsl(220, 10%, 45%)' }}>{s.label}</p>
                      <p className="text-sm font-medium" style={{ color: 'hsl(0, 0%, 90%)' }}>{s.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Rate Con Scanner Demo */}
            <div className="p-6 sm:p-8 rounded-2xl border sm:col-span-2 lg:col-span-1" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(25, 95%, 53%, 0.2)' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-11 w-11 rounded-xl flex items-center justify-center" style={{ background: 'hsl(25, 95%, 53%, 0.15)' }}>
                  <Camera className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                </div>
                <h3 className="text-lg font-bold" style={{ color: 'hsl(0, 0%, 100%)' }}>Scan Rate Con</h3>
              </div>
              <div className="space-y-4">
                {[
                  { step: '1', label: 'You upload:', text: 'Screenshot or photo of your rate confirmation' },
                  { step: '2', label: 'AI extracts:', text: 'Pickup, dropoff, miles, rate, revenue, date' },
                  { step: '3', label: 'Result:', text: 'Load form auto-filled — review and save in seconds' },
                ].map((s) => (
                  <div key={s.step} className="flex gap-3 items-start">
                    <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5" style={{ background: 'hsl(25, 95%, 53%, 0.15)', color: 'hsl(25, 95%, 53%)' }}>
                      {s.step}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'hsl(220, 10%, 45%)' }}>{s.label}</p>
                      <p className="text-sm font-medium" style={{ color: 'hsl(0, 0%, 90%)' }}>{s.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="text-center mt-10">
            <p className="text-sm mb-4" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Every new account includes a free 14-day Pro trial. No credit card required.
            </p>
            <Button onClick={goToAuth} size="lg" className="text-base font-bold rounded-xl h-13 px-8 gap-2" style={{
              background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)'
            }}>
              Start Tracking Free <ArrowRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* SECTION 5: SOCIAL PROOF (NEW) */}
      {/* ═══════════════════════════════════════════ */}
      <section className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 8%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
              Not Another Tracking App.{' '}
              <span style={{ color: 'hsl(25, 95%, 53%)' }}>Your Profit Command Center.</span>
            </h2>
            <p className="mt-4 text-base" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Most tools help you find loads, log miles, or track fuel. HaulTrackerPro helps you keep your money — built from the ground up after talking to real owner-operators.
            </p>
          </div>

          {/* Trust signals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto mb-12">
            {[
              { icon: Shield, label: 'Your data stays yours', sub: 'Encrypted & private' },
              { icon: Zap, label: 'Set up in minutes', sub: 'No training needed' },
              { icon: Users, label: 'Built for solo operators', sub: 'Not bloated fleet software' },
              { icon: Star, label: '14-day Pro trial', sub: 'No credit card required' },
            ].map((item, i) => (
              <div key={i} className="text-center p-4 rounded-xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                <div className="h-9 w-9 rounded-lg flex items-center justify-center mx-auto mb-2" style={{ background: 'hsl(25, 95%, 53%, 0.1)' }}>
                  <item.icon className="h-4 w-4" style={{ color: 'hsl(25, 95%, 53%)' }} />
                </div>
                <p className="text-xs font-bold" style={{ color: 'hsl(0, 0%, 100%)' }}>{item.label}</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'hsl(220, 10%, 50%)' }}>{item.sub}</p>
              </div>
            ))}
          </div>

          {/* Testimonial placeholder — replace with real quotes when available */}
          <div className="max-w-2xl mx-auto">
            <div className="p-6 rounded-2xl border text-center" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
              <div className="flex justify-center gap-1 mb-3">
                {[1,2,3,4,5].map(s => (
                  <Star key={s} className="h-4 w-4 fill-current" style={{ color: 'hsl(25, 95%, 53%)' }} />
                ))}
              </div>
              <p className="text-base italic leading-relaxed mb-4" style={{ color: 'hsl(220, 10%, 70%)' }}>
                "I was using a spreadsheet for two years and thought I was profitable. HaulTrackerPro showed me I was losing money on my regular lane. Changed my whole game."
              </p>
              <p className="text-sm font-bold" style={{ color: 'hsl(0, 0%, 100%)' }}>— Early Access Driver</p>
              <p className="text-xs" style={{ color: 'hsl(220, 10%, 45%)' }}>Owner-Operator, Dry Van</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* SECTION 6: FAQ */}
      {/* ═══════════════════════════════════════════ */}
      <section className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
              Common{' '}
              <span style={{ color: 'hsl(25, 95%, 53%)' }}>Questions</span>
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
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* SECTION 7: FINAL CTA */}
      {/* ═══════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 50%, hsl(25, 95%, 53%, 0.06) 0%, transparent 70%)'
        }} />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center relative">
          <h2 className="text-3xl sm:text-5xl font-black tracking-tight mb-5" style={{ color: 'hsl(0, 0%, 100%)' }}>
            If You Don't Know Your Profit…{' '}
            <span style={{ color: 'hsl(25, 95%, 53%)' }}>You're Guessing Your Income.</span>
          </h2>
          <p className="text-base mb-8 max-w-md mx-auto" style={{ color: 'hsl(220, 10%, 55%)' }}>
            You're already working hard. Now make sure the numbers actually make sense.
          </p>
          <Button onClick={goToAuth} size="lg" className="text-lg font-bold rounded-2xl h-14 px-10 gap-2" style={{
            background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)',
            boxShadow: '0 4px 24px -4px hsl(25, 95%, 53%, 0.5)'
          }}>
            Start Your Free Trial <ArrowRight className="h-5 w-5" />
          </Button>
          <p className="text-xs mt-4" style={{ color: 'hsl(220, 10%, 45%)' }}>
            No credit card required.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* FOOTER */}
      {/* ═══════════════════════════════════════════ */}
      <footer className="border-t py-8" style={{ borderColor: 'hsl(220, 16%, 14%)', background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
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
                  { label: 'How to Use', href: '/how-to-use-haultrackerpro' },
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
