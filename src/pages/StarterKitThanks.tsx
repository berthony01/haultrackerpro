import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Download, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import SEOHead from '@/components/SEOHead';
import { useAuth } from '@/hooks/useAuth';
import { STARTER_KIT_DOWNLOAD_URL } from '@/lib/leadMagnet';
import {
  trackLeadMagnetView,
  trackLeadMagnetDownload,
  trackLeadMagnetSignupClick,
} from '@/lib/analytics';

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
    window.open(STARTER_KIT_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
  };

  const handleSignup = () => {
    trackLeadMagnetSignupClick();
    navigate(user ? '/dashboard' : '/auth');
  };

  return (
    <div className="min-h-screen" style={{ background: 'hsl(220, 20%, 8%)' }}>
      <SEOHead
        title="Your Free Trucker Starter Kit Is Ready | HaulTrackerPro"
        description="Download the Free Trucker Starter Kit — CDL study, checklists, and trucking guidance from HaulTrackerPro."
        canonicalUrl="https://www.haultrackerpro.com/starter-kit/thanks"
      />

      <header className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-white">
            <Truck className="w-5 h-5 text-amber-400" />
            <span className="font-semibold">HaulTrackerPro</span>
          </button>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-5 py-12 md:py-16">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-full bg-amber-400/15 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-amber-400" />
          </div>
        </div>
        <h1 className="mt-5 text-3xl md:text-4xl font-bold text-white text-center">
          Your Free Trucker Starter Kit Is Ready
        </h1>
        <p className="mt-3 text-white/70 text-center">
          {email ? <>We've got your email <span className="text-white">({email})</span>. </> : null}
          Tap the button below to download your kit (6 PDFs, ~70 KB).
        </p>

        <Card className="mt-8 p-6 bg-white/5 border-white/10">
          <Button
            onClick={handleDownload}
            className="w-full h-12 bg-amber-400 hover:bg-amber-500 text-black font-semibold text-base"
          >
            <Download className="w-5 h-5 mr-2" /> Download Free Kit
          </Button>
          <p className="mt-3 text-xs text-white/50 text-center">
            Trouble downloading? Try a different browser or check your popup blocker.
          </p>
        </Card>

        <Card className="mt-5 p-6 bg-white/5 border-white/10">
          <h2 className="text-white font-semibold text-lg">Now — make your trucking pay you back.</h2>
          <p className="mt-1 text-sm text-white/60">
            HaulTrackerPro turns every load and expense into clear profit numbers. Free plan, no credit card.
          </p>
          <Button
            onClick={handleSignup}
            variant="outline"
            className="mt-4 w-full h-11 bg-transparent border-white/20 text-white hover:bg-white/5"
          >
            {user ? 'Go to Dashboard' : 'Create Free Account'} <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Card>

        <Card className="mt-5 p-5 bg-white/5 border-white/10">
          <h3 className="text-white font-semibold text-sm">Want the full Trucker Starter Pack?</h3>
          <p className="mt-1 text-xs text-white/60">
            The expanded paid bundle adds owner-operator startup templates, expense trackers, broker vetting sheets, and
            more. Coming soon to HaulTrackerPro members.
          </p>
        </Card>
      </section>

      <footer className="border-t border-white/10 py-8 text-center text-white/40 text-sm">
        © {new Date().getFullYear()} HaulTrackerPro
      </footer>
    </div>
  );
}
