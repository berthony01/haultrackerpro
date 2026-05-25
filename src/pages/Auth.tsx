import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Truck, Mail, Lock, User, Briefcase, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable';
import { toast } from 'sonner';
import SEOHead from '@/components/SEOHead';
import { trackSignUp, trackLogin } from '@/lib/analytics';
import { cn } from '@/lib/utils';

type Role = 'driver' | 'recruiter';

export default function Auth() {
  const { signIn, signUp } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [role, setRole] = useState<Role>(() => {
    try {
      const intent = new URLSearchParams(window.location.search).get('intent');
      return intent === 'recruiter' ? 'recruiter' : 'driver';
    } catch {
      return 'driver';
    }
  });

  // Keep role in sync if the query string changes
  useEffect(() => {
    const intent = new URLSearchParams(location.search).get('intent');
    if (intent === 'recruiter') setRole('recruiter');
  }, [location.search]);

  // Persist intent to sessionStorage whenever role changes so the post-auth
  // redirect (in App.tsx / useAuth flow) can pick it up after email confirm
  // or OAuth round-trips.
  const persistIntent = (r: Role) => {
    try {
      if (r === 'recruiter') sessionStorage.setItem('htp_auth_intent', 'recruiter');
      else sessionStorage.removeItem('htp_auth_intent');
    } catch {}
  };

  useEffect(() => {
    persistIntent(role);
  }, [role]);

  const isRecruiter = role === 'recruiter';

  const handleGoogleSignIn = async () => {
    if (googleLoading || loading) return;
    setGoogleLoading(true);
    persistIntent(role);
    try {
      const result = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: window.location.origin + (isRecruiter ? '/?intent=recruiter' : '/'),
      });
      if (result?.error) {
        toast.error("Couldn't start Google sign-in. Please try again.");
        setGoogleLoading(false);
        return;
      }
    } catch {
      toast.error("Couldn't start Google sign-in. Please try again.");
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    persistIntent(role);
    try {
      if (mode === 'signup') {
        const { error } = await signUp(form.email, form.password, form.name, role);
        if (error) throw error;
        trackSignUp('email');
        const TEST_ACCOUNTS = ['berthonyxyz@gmail.com', 'peejayslifestyle@gmail.com', 'wysdomaniac@gmail.com'];
        if (!TEST_ACCOUNTS.includes(form.email.toLowerCase().trim())) {
          supabase.functions.invoke('send-transactional-email', {
            body: {
              templateName: 'lifecycle-day0',
              recipientEmail: form.email,
              idempotencyKey: `lifecycle-day0-${form.email.toLowerCase().trim()}`,
              templateData: { name: form.name },
            },
          }).catch(() => {});
        }
        toast.success('Check your email to confirm your account!');
      } else {
        const { error } = await signIn(form.email, form.password);
        if (error) throw error;
        trackLogin('email');
      }
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const title = isRecruiter
    ? (mode === 'login' ? 'Welcome Back, Recruiter' : 'Create Your Recruiter Access Account')
    : (mode === 'login' ? 'Welcome Back, Driver' : 'Create Your Driver Account');

  const helper = isRecruiter
    ? 'Apply for recruiter access, post structured opportunities, and manage driver requests. Recruiter accounts require approval before posting opportunities.'
    : 'Track your real profit, manage loads, compare opportunities, and get a guided setup after sign up.';

  const googleHelper = isRecruiter
    ? "You'll continue into Recruiter Access. Posting unlocks after your account is approved."
    : "You'll continue into the driver dashboard and a quick onboarding walkthrough.";

  const driverBullets = [
    'Real profit tracking',
    'Load and expense management',
    'Opportunity matching',
    'PDF/CSV reports',
  ];
  const recruiterBullets = [
    'Approved recruiter workflow',
    'Structured opportunity posting',
    'Driver request pipeline',
    'Contact permission system',
  ];
  const bullets = isRecruiter ? recruiterBullets : driverBullets;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <SEOHead title="Login | HaulTrackerPro" description="Sign in to HaulTrackerPro." path="/auth" noindex />
      <div className="w-full max-w-5xl grid md:grid-cols-[1fr_minmax(0,420px)] gap-8 items-start">
        {/* Side value panel (desktop) */}
        <aside className="hidden md:block space-y-6 pt-8">
          <div className="inline-flex items-center justify-center rounded-2xl bg-primary p-3">
            <Truck className="h-8 w-8 text-primary-foreground" />
          </div>
          <h2 className="text-3xl font-black font-heading tracking-tight">
            {isRecruiter ? 'Recruit drivers with transparency.' : 'Track real profit, not just revenue.'}
          </h2>
          <p className="text-muted-foreground">{helper}</p>
          <ul className="space-y-3">
            {bullets.map(b => (
              <li key={b} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </aside>

        <div className="w-full space-y-6">
          {/* Brand (mobile) */}
          <div className="text-center space-y-2 md:hidden">
            <div className="inline-flex items-center justify-center rounded-2xl bg-primary p-3 mx-auto">
              <Truck className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-black font-heading tracking-tight">HaulTrackerPro</h1>
          </div>

          <Card className="border-2 border-primary/20 shadow-xl">
            <CardHeader className="pb-4 space-y-4">
              {/* Role selector */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  What are you using HaulTrackerPro for?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('driver')}
                    className={cn(
                      'text-left rounded-lg border-2 p-3 transition-colors',
                      role === 'driver'
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/40'
                    )}
                    aria-pressed={role === 'driver'}
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-sm">
                      <Truck className="h-4 w-4" /> Driver
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-snug">
                      Track profit, loads, expenses, reports, and find better opportunities.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('recruiter')}
                    className={cn(
                      'text-left rounded-lg border-2 p-3 transition-colors',
                      role === 'recruiter'
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/40'
                    )}
                    aria-pressed={role === 'recruiter'}
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-sm">
                      <Briefcase className="h-4 w-4" /> Recruiter / Carrier
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-snug">
                      Post structured opportunities, manage driver requests, and recruit with transparency.
                    </p>
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <CardTitle className="text-lg font-heading text-center">{title}</CardTitle>
                <p className="text-xs text-center text-muted-foreground">{helper}</p>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                variant="outline"
                onClick={handleGoogleSignIn}
                disabled={googleLoading || loading}
                className="w-full h-12 text-base font-semibold border-2"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.74-6-6.1s2.7-6.1 6-6.1c1.88 0 3.14.8 3.86 1.49l2.63-2.54C16.78 3.4 14.6 2.5 12 2.5 6.76 2.5 2.5 6.76 2.5 12S6.76 21.5 12 21.5c6.94 0 9.5-4.87 9.5-9.5 0-.64-.07-1.13-.16-1.6H12z"/>
                </svg>
                {googleLoading ? 'Connecting...' : 'Continue with Google'}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-2">{googleHelper}</p>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or continue with</span></div>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'signup' && (
                  <div>
                    <Label htmlFor="name" className="flex items-center gap-1.5">
                      <User className="h-3 w-3" /> Display Name
                    </Label>
                    <Input
                      id="name"
                      placeholder="Your name"
                      value={form.name}
                      onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                      required
                    />
                    {isRecruiter ? (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        You'll add company details after account creation. Recruiter accounts require approval before posting opportunities.
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        We'll walk you through a quick setup (pay model and your first load) right after sign up.
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <Label htmlFor="email" className="flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={isRecruiter ? 'recruiter@company.com' : 'driver@example.com'}
                    value={form.email}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="password" className="flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full h-12 text-base font-bold" disabled={loading}>
                  {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
                </Button>
              </form>

              {mode === 'login' && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!form.email) {
                        toast.error('Enter your email first, then click Forgot password');
                        return;
                      }
                      try {
                        const { error } = await supabase.auth.resetPasswordForEmail(form.email, {
                          redirectTo: `${window.location.origin}/reset-password`,
                        });
                        if (error) throw error;
                        toast.success('Check your email for a password reset link!');
                      } catch (err: any) {
                        toast.error(err.message || 'Failed to send reset email');
                      }
                    }}
                    className="text-xs text-muted-foreground hover:text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setMode(m => m === 'login' ? 'signup' : 'login')}
                  className="text-sm text-primary font-semibold hover:underline"
                >
                  {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                </button>
              </div>

              {/* Role switch footer */}
              <div className="mt-4 pt-4 border-t border-border text-center text-xs text-muted-foreground">
                {isRecruiter ? (
                  <>
                    Here to track your own loads?{' '}
                    <button
                      type="button"
                      onClick={() => setRole('driver')}
                      className="text-primary font-semibold hover:underline"
                    >
                      {mode === 'login' ? 'Sign in as driver' : 'Sign up as driver'}
                    </button>
                  </>
                ) : (
                  <>
                    Recruiting drivers?{' '}
                    <button
                      type="button"
                      onClick={() => setRole('recruiter')}
                      className="text-primary font-semibold hover:underline"
                    >
                      {mode === 'login' ? 'Sign in as recruiter' : 'Sign up as recruiter'}
                    </button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
