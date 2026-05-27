import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Download, Shield, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import { useAuth } from '@/hooks/useAuth';
import { STARTER_KIT_DOWNLOAD_URL, triggerStarterKitDownload } from '@/lib/leadMagnet';
import {
  trackLeadMagnetView,
  trackLeadMagnetDownload,
  trackLeadMagnetSignupClick,
  trackStarterKitDownloadClicked,
  trackStarterKitSignupClicked,
} from '@/lib/analytics';

const ORANGE = 'hsl(25, 95%, 53%)';
const BG = 'hsl(220, 20%, 8%)';
const CARD_BG = 'hsl(220, 20%, 10%)';
const CARD_BORDER = 'hsl(220, 16%, 16%)';
const TEXT_MUTED = 'hsl(220, 10%, 55%)';
const TEXT_BODY = 'hsl(220, 10%, 70%)';

export default function StarterKitThanks() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const email = params.get('email');

  useEffect(() => {
    trackLeadMagnetView('starter-kit-thanks');
  }, []);

  const handleDownload = () => {
    trackLeadMagnetDownload();
    trackStarterKitDownloadClicked('thanks');
    triggerStarterKitDownload();
  };

  const handleSignup = () => {
    trackLeadMagnetSignupClick();
    trackStarterKitSignupClicked();
    navigate(user ? '/dashboard' : '/auth');
  };

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: BG }}>
      <SEOHead
        title="Your Free Trucker Starter Kit Is Ready | HaulTrackerPro"
        description="Download the Free Trucker Starter Kit — CDL study, checklists, and trucking guidance from HaulTrackerPro."
        path="/starter-kit/thanks"
        noindex
      />

      {/* Sticky nav — matches platform */}
      <nav className="sticky top-0 z-50 border-b" style={{ background: BG, borderColor: CARD_BORDER }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <button onClick={() => navigate('/')} className="flex items-center gap-2">
            <Truck className="h-6 w-6" style={{ color: ORANGE }} />
            <span className="text-lg font-black tracking-tight text-white">HaulTrackerPro</span>
          </button>
          <Button
            onClick={() => navigate(user ? '/dashboard' : '/auth')}
            className="text-xs sm:text-sm font-bold rounded-xl px-3 sm:px-5"
            style={{ background: ORANGE, color: 'white' }}
          >
            {user ? 'Dashboard' : 'Start Tracking Free'}
          </Button>
        </div>
      </nav>

      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, hsl(25, 95%, 53%, 0.08) 0%, transparent 70%)' }}
        />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-12 md:py-16">
          <div className="flex justify-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: 'hsl(25, 95%, 53%, 0.15)' }}
            >
              <CheckCircle2 className="w-8 h-8" style={{ color: ORANGE }} />
            </div>
          </div>
          <h1 className="mt-5 text-3xl md:text-4xl font-black tracking-tight text-white text-center">
            Your Free Trucker Starter Kit Is Ready
          </h1>
          <p className="mt-3 text-center" style={{ color: TEXT_MUTED }}>
            {email ? <>We've got your email <span className="text-white">({email})</span>. </> : null}
            Tap the button below to download your kit (ZIP file — 6 PDFs inside, ~70 KB).
          </p>

          <div
            className="mt-8 p-6 rounded-2xl border"
            style={{
              background: CARD_BG,
              borderColor: ORANGE,
              boxShadow: '0 0 30px -8px hsl(25, 95%, 53%, 0.2), 0 0 0 1px hsl(25, 95%, 53%, 0.15)',
            }}
          >
            <Button
              onClick={handleDownload}
              className="w-full h-12 font-bold text-base rounded-xl gap-2"
              style={{
                background: ORANGE,
                color: 'white',
                boxShadow: '0 4px 20px -4px hsl(25, 95%, 53%, 0.5)',
              }}
            >
              <Download className="w-5 h-5" /> Download Free Kit
            </Button>
            <a
              href={STARTER_KIT_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block text-xs text-center underline underline-offset-4"
              style={{ color: 'hsl(220, 10%, 55%)' }}
            >
              Trouble downloading? Tap here to open the file directly
            </a>
            <p className="mt-2 text-xs text-center" style={{ color: 'hsl(220, 10%, 45%)' }}>
              On iPhone, the file opens in Safari — tap Share → Save to Files. On Android, it saves to Downloads.
            </p>
          </div>

          <div className="mt-5 p-6 rounded-2xl border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <h2 className="text-white font-bold text-lg">Now — make your trucking pay you back.</h2>
            <p className="mt-1 text-sm" style={{ color: TEXT_MUTED }}>
              HaulTrackerPro turns every load and expense into clear profit numbers. Free plan, no credit card.
            </p>
            <Button
              onClick={handleSignup}
              variant="outline"
              className="mt-4 w-full h-11 font-bold rounded-xl gap-2 bg-transparent hover:bg-white/5"
              style={{ borderColor: 'hsl(220, 16%, 22%)', color: TEXT_BODY }}
            >
              {user ? 'Go to Dashboard' : 'Create Free Account'} <ArrowRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="mt-5 p-5 rounded-xl border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <h3 className="text-white font-bold text-sm">Want the full Trucker Starter Pack?</h3>
            <p className="mt-1 text-xs" style={{ color: TEXT_MUTED }}>
              The expanded paid bundle adds owner-operator startup templates, expense trackers, broker vetting sheets, and
              more. Coming soon to HaulTrackerPro members.
            </p>
          </div>
        </div>
      </section>

      {/* Standard 3-column footer */}
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
