import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Download, FileText, ShieldCheck, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import SEOHead from '@/components/SEOHead';
import { useAuth } from '@/hooks/useAuth';
import { leadMagnetSchema, submitLeadMagnet, STARTER_KIT_DOWNLOAD_URL } from '@/lib/leadMagnet';
import { trackLeadMagnetView, trackLeadMagnetSubmit, trackLeadMagnetDownload } from '@/lib/analytics';

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
    <div className="min-h-screen overflow-x-hidden" style={{ background: 'hsl(220, 20%, 8%)' }}>
      <SEOHead
        title="Free Trucker Starter Kit — CDL Study, Checklists & Guides | HaulTrackerPro"
        description="Download the Free Trucker Starter Kit — CDL study companion, test day checklist, owner-operator paperwork list, and the first 30 days success guide. Built for new and aspiring truck drivers."
        path="/starter-kit"
      />

      {/* Top bar */}
      <header className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-white">
            <Truck className="w-5 h-5 text-amber-400" />
            <span className="font-semibold">HaulTrackerPro</span>
          </button>
          <Button variant="ghost" className="text-white hover:bg-white/5" onClick={() => navigate('/auth')}>
            Sign in
          </Button>
        </div>
      </header>

      {/* Hero + Form */}
      <section className="max-w-6xl mx-auto px-5 py-10 md:py-16 grid md:grid-cols-2 gap-10 items-start">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/10 text-amber-300 text-xs font-medium mb-4">
            <Download className="w-3.5 h-3.5" /> 100% Free • Instant Download
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight">
            Get the Free <span className="text-amber-400">Trucker Starter Kit</span>
          </h1>
          <p className="mt-4 text-lg text-white/70">
            CDL help, real-world checklists, and owner-operator guidance to help new drivers start strong — without the
            guesswork.
          </p>

          <ul className="mt-6 space-y-2.5 text-white/80">
            {[
              'CDL Study Companion + Test Day Checklist',
              'New Driver Mistakes to Avoid',
              'Owner-Operator Document Checklist',
              'First 30 Days Success Checklist',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <Card className="p-6 md:p-7 bg-white/5 border-white/10 backdrop-blur">
          <h2 className="text-xl font-semibold text-white">Send me the free kit</h2>
          <p className="text-sm text-white/60 mt-1">Instant download. No spam. Unsubscribe anytime.</p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <Label htmlFor="lm-first-name" className="text-white/80">
                First name <span className="text-white/40 text-xs">(optional)</span>
              </Label>
              <Input
                id="lm-first-name"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="James"
                maxLength={100}
                className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-white/30"
                autoComplete="given-name"
              />
            </div>
            <div>
              <Label htmlFor="lm-email" className="text-white/80">
                Email <span className="text-amber-400">*</span>
              </Label>
              <Input
                id="lm-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                maxLength={255}
                className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-white/30"
                autoComplete="email"
              />
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-11 bg-amber-400 hover:bg-amber-500 text-black font-semibold"
            >
              {submitting ? 'Sending…' : 'Send Me the Free Kit'}
              {!submitting && <ArrowRight className="w-4 h-4 ml-2" />}
            </Button>
            {user && (
              <button
                type="button"
                onClick={directDownload}
                className="w-full text-center text-sm text-white/60 hover:text-amber-300 underline underline-offset-4"
              >
                Already signed in — download now
              </button>
            )}
          </form>
        </Card>
      </section>

      {/* What's included */}
      <section className="max-w-6xl mx-auto px-5 py-12 border-t border-white/10">
        <h2 className="text-2xl md:text-3xl font-bold text-white">What's inside</h2>
        <p className="mt-2 text-white/60">Six concise, printable PDFs you can use today.</p>
        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {INCLUDED.map((item) => (
            <Card key={item.title} className="p-5 bg-white/5 border-white/10">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-white font-semibold">{item.title}</h3>
                  <p className="text-sm text-white/60 mt-1">{item.desc}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      <section className="max-w-6xl mx-auto px-5 py-12 border-t border-white/10">
        <h2 className="text-2xl md:text-3xl font-bold text-white">Who it's for</h2>
        <div className="mt-5 grid md:grid-cols-3 gap-4">
          {[
            { title: 'New CDL students', body: 'Studying for your permit or behind-the-wheel exam.' },
            { title: 'Brand new drivers', body: 'Wrapping up training and starting your first 30 days.' },
            { title: 'Future owner-operators', body: 'Planning your move from company driver to your own authority.' },
          ].map((b) => (
            <Card key={b.title} className="p-5 bg-white/5 border-white/10">
              <h3 className="text-white font-semibold">{b.title}</h3>
              <p className="mt-1 text-sm text-white/60">{b.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="max-w-3xl mx-auto px-5 py-10">
        <Card className="p-5 bg-white/5 border-white/10 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-white/70">
            We never sell or share your email. The Starter Kit is general guidance — not legal, tax, or compliance
            advice. Always verify with your carrier and your state's DMV / DOT.
          </p>
        </Card>
      </section>

      {/* HaulTrackerPro bridge */}
      <section className="max-w-6xl mx-auto px-5 py-14 border-t border-white/10">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-white">Once you're driving — track every dollar.</h2>
            <p className="mt-3 text-white/70">
              HaulTrackerPro is the load + expense tracker built for owner-operators and company drivers. Log loads in
              seconds, see real profit per load, and never miss a short-pay again.
            </p>
            <ul className="mt-5 space-y-2 text-white/80">
              {['Unlimited load + expense logging', 'Estimated vs actual pay tracking', 'CSV exports & weekly closeouts'].map(
                (l) => (
                  <li key={l} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-amber-400" /> {l}
                  </li>
                ),
              )}
            </ul>
          </div>
          <Card className="p-6 bg-white/5 border-white/10">
            <h3 className="text-white font-semibold text-lg">Start Tracking — Free</h3>
            <p className="text-sm text-white/60 mt-1">
              14-day Pro trial included. No credit card required.
            </p>
            <Button
              onClick={() => navigate('/auth')}
              className="mt-4 w-full h-11 bg-amber-400 hover:bg-amber-500 text-black font-semibold"
            >
              Create Free Account <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Card>
        </div>
      </section>

      <footer className="border-t border-white/10 py-8 text-center text-white/40 text-sm">
        © {new Date().getFullYear()} HaulTrackerPro
      </footer>
    </div>
  );
}
