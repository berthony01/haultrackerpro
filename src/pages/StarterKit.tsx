import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Download, FileText, Shield, ShieldCheck, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import SEOHead from '@/components/SEOHead';
import { useAuth } from '@/hooks/useAuth';
import { leadMagnetSchema, submitLeadMagnet, STARTER_KIT_DOWNLOAD_URL } from '@/lib/leadMagnet';
import { trackLeadMagnetView, trackLeadMagnetSubmit, trackLeadMagnetDownload } from '@/lib/analytics';

const ORANGE = 'hsl(25, 95%, 53%)';
const ORANGE_SOFT = 'hsl(25, 95%, 60%)';
const BG = 'hsl(220, 20%, 8%)';
const CARD_BG = 'hsl(220, 20%, 10%)';
const CARD_BORDER = 'hsl(220, 16%, 16%)';
const TEXT_MUTED = 'hsl(220, 10%, 55%)';
const TEXT_BODY = 'hsl(220, 10%, 70%)';

const INCLUDED = [
  { title: 'Start Here Guide', desc: 'Quick orientation for using everything in this kit.' },
  { title: 'CDL Study Companion', desc: 'Key concepts to help you pass your CDL exam.' },
  { title: 'CDL Test Day Checklist', desc: 'What to bring and expect on testing day.' },
  { title: 'New Driver Mistakes to Avoid', desc: 'Hard-earned lessons from veteran drivers.' },
  { title: 'Owner-Operator Document Checklist', desc: 'The paperwork you need before going out on your own.' },
  { title: 'First 30 Days Success Checklist', desc: 'Daily and weekly habits that set new drivers apart.' },
];

export default function StarterKit() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    trackLeadMagnetView('starter-kit');
    if (user?.email) setEmail(user.email);
  }, [user?.email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = leadMagnetSchema.safeParse({ email, first_name: firstName });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? 'Please check your details');
      return;
    }
    setSubmitting(true);
    try {
      await submitLeadMagnet(parsed.data, { convertedUserId: user?.id ?? null });
      trackLeadMagnetSubmit();
      toast.success('Your kit is ready! Redirecting…');
      navigate(`/starter-kit/thanks?email=${encodeURIComponent(parsed.data.email)}`);
    } catch (err) {
      console.error('Lead magnet submit failed', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const directDownload = () => {
    trackLeadMagnetDownload();
    window.open(STARTER_KIT_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: BG }}>
      <SEOHead
        title="Free Trucker Starter Kit — CDL Study, Checklists & Guides | HaulTrackerPro"
        description="Download the Free Trucker Starter Kit — CDL study companion, test day checklist, owner-operator paperwork list, and the first 30 days success guide. Built for new and aspiring truck drivers."
        path="/starter-kit"
      />

      {/* Sticky nav — matches Landing/Pricing */}
      <nav className="sticky top-0 z-50 border-b" style={{ background: BG, borderColor: CARD_BORDER }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <button onClick={() => navigate('/')} className="flex items-center gap-2">
            <Truck className="h-6 w-6" style={{ color: ORANGE }} />
            <span className="text-lg font-black tracking-tight text-white">HaulTrackerPro</span>
          </button>
          <div className="flex items-center gap-1 sm:gap-3">
            <Button variant="ghost" onClick={() => navigate('/auth')} className="text-sm hidden sm:inline-flex" style={{ color: TEXT_BODY }}>
              Sign In
            </Button>
            <Button
              onClick={() => navigate('/auth')}
              className="text-xs sm:text-sm font-bold rounded-xl px-3 sm:px-5"
              style={{ background: ORANGE, color: 'white' }}
            >
              Start Tracking Free
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero + Form */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, hsl(25, 95%, 53%, 0.08) 0%, transparent 70%)' }}
        />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-12 md:py-20 grid md:grid-cols-2 gap-10 items-start">
          <div>
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-4"
              style={{ background: 'hsl(25, 95%, 53%, 0.12)', color: ORANGE_SOFT }}
            >
              <Download className="w-3.5 h-3.5" /> 100% Free • Instant Download
            </div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white leading-tight">
              Get the Free <span style={{ color: ORANGE }}>Trucker Starter Kit</span>
            </h1>
            <p className="mt-4 text-base md:text-lg" style={{ color: TEXT_MUTED }}>
              CDL help, real-world checklists, and owner-operator guidance to help new drivers start strong — without the
              guesswork.
            </p>

            <ul className="mt-6 space-y-2.5" style={{ color: TEXT_BODY }}>
              {[
                'CDL Study Companion + Test Day Checklist',
                'New Driver Mistakes to Avoid',
                'Owner-Operator Document Checklist',
                'First 30 Days Success Checklist',
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: ORANGE }} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div
            className="p-6 md:p-7 rounded-2xl border"
            style={{
              background: CARD_BG,
              borderColor: ORANGE,
              boxShadow: '0 0 30px -8px hsl(25, 95%, 53%, 0.2), 0 0 0 1px hsl(25, 95%, 53%, 0.15)',
            }}
          >
            <h2 className="text-xl font-bold text-white">Send me the free kit</h2>
            <p className="text-sm mt-1" style={{ color: TEXT_MUTED }}>Instant download. No spam. Unsubscribe anytime.</p>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <Label htmlFor="lm-first-name" style={{ color: TEXT_BODY }}>
                  First name <span className="text-xs" style={{ color: 'hsl(220, 10%, 40%)' }}>(optional)</span>
                </Label>
                <Input
                  id="lm-first-name"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="James"
                  maxLength={100}
                  className="mt-1.5 text-white placeholder:text-white/30"
                  style={{ background: 'hsl(220, 20%, 8%)', borderColor: CARD_BORDER }}
                  autoComplete="given-name"
                />
              </div>
              <div>
                <Label htmlFor="lm-email" style={{ color: TEXT_BODY }}>
                  Email <span style={{ color: ORANGE }}>*</span>
                </Label>
                <Input
                  id="lm-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  maxLength={255}
                  className="mt-1.5 text-white placeholder:text-white/30"
                  style={{ background: 'hsl(220, 20%, 8%)', borderColor: CARD_BORDER }}
                  autoComplete="email"
                />
              </div>
              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-11 font-bold rounded-xl gap-2"
                style={{
                  background: ORANGE,
                  color: 'white',
                  boxShadow: '0 4px 20px -4px hsl(25, 95%, 53%, 0.5)',
                }}
              >
                {submitting ? 'Sending…' : 'Send Me the Free Kit'}
                {!submitting && <ArrowRight className="w-4 h-4" />}
              </Button>
              {user && (
                <button
                  type="button"
                  onClick={directDownload}
                  className="w-full text-center text-sm underline underline-offset-4"
                  style={{ color: TEXT_MUTED }}
                >
                  Already signed in — download now
                </button>
              )}
            </form>
          </div>
        </div>
      </section>

      {/* What's included */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 border-t" style={{ borderColor: CARD_BORDER }}>
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white">What's inside</h2>
        <p className="mt-2" style={{ color: TEXT_MUTED }}>Six concise, printable PDFs you can use today.</p>
        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {INCLUDED.map((item) => (
            <div key={item.title} className="p-5 rounded-xl border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 shrink-0 mt-0.5" style={{ color: ORANGE }} />
                <div>
                  <h3 className="text-white font-bold">{item.title}</h3>
                  <p className="text-sm mt-1" style={{ color: TEXT_MUTED }}>{item.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 border-t" style={{ borderColor: CARD_BORDER }}>
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white">Who it's for</h2>
        <div className="mt-5 grid md:grid-cols-3 gap-4">
          {[
            { title: 'New CDL students', body: 'Studying for your permit or behind-the-wheel exam.' },
            { title: 'Brand new drivers', body: 'Wrapping up training and starting your first 30 days.' },
            { title: 'Future owner-operators', body: 'Planning your move from company driver to your own authority.' },
          ].map((b) => (
            <div key={b.title} className="p-5 rounded-xl border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
              <h3 className="text-white font-bold">{b.title}</h3>
              <p className="mt-1 text-sm" style={{ color: TEXT_MUTED }}>{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="p-5 rounded-xl border flex items-start gap-3" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
          <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: ORANGE }} />
          <p className="text-sm" style={{ color: TEXT_BODY }}>
            We never sell or share your email. The Starter Kit is general guidance — not legal, tax, or compliance
            advice. Always verify with your carrier and your state's DMV / DOT.
          </p>
        </div>
      </section>

      {/* HaulTrackerPro bridge */}
      <section className="border-t" style={{ borderColor: CARD_BORDER, background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white">
              Once you're driving — track every dollar.
            </h2>
            <p className="mt-3" style={{ color: TEXT_MUTED }}>
              HaulTrackerPro is the load + expense tracker built for owner-operators and company drivers. Log loads in
              seconds, see real profit per load, and never miss a short-pay again.
            </p>
            <ul className="mt-5 space-y-2" style={{ color: TEXT_BODY }}>
              {['Unlimited load + expense logging', 'Estimated vs actual pay tracking', 'CSV exports & weekly closeouts'].map(
                (l) => (
                  <li key={l} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" style={{ color: ORANGE }} /> {l}
                  </li>
                ),
              )}
            </ul>
          </div>
          <div className="p-6 rounded-2xl border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <h3 className="text-white font-bold text-lg">Start Tracking — Free</h3>
            <p className="text-sm mt-1" style={{ color: TEXT_MUTED }}>Free to start. No credit card required.</p>
            <Button
              onClick={() => navigate('/auth')}
              className="mt-4 w-full h-11 font-bold rounded-xl gap-2"
              style={{
                background: ORANGE,
                color: 'white',
                boxShadow: '0 4px 20px -4px hsl(25, 95%, 53%, 0.5)',
              }}
            >
              Create Free Account <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Standard 3-column footer (matches Landing) */}
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
                ].map((link) => (
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
                  { label: 'Free Starter Kit', href: '/starter-kit' },
                  { label: 'Finance Guides', href: '/trucking-finance-guides' },
                  { label: 'How to Use', href: '/how-to-use-haultrackerpro' },
                  { label: 'Tax Deductions', href: '/truck-driver-tax-deductions' },
                  { label: 'Expense Tracker', href: '/owner-operator-expense-tracker' },
                  { label: 'Profit Calculator', href: '/trucking-profit-calculator' },
                  { label: 'Cost Per Mile', href: '/trucking-cost-per-mile' },
                  { label: 'Bookkeeping', href: '/trucker-bookkeeping-guide' },
                ].map((link) => (
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
                ].map((link) => (
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
