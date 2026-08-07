import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Truck, Mail, Lock, User, Briefcase, Users, Building2, Check, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable';
import { toast } from 'sonner';
import SEOHead from '@/components/SEOHead';
import { trackSignUp, trackLogin } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { isInternalTestEmail } from '@/lib/internalTestAccounts';
import { sanitizeNextPath, getCapabilityFromNext, type Capability } from '@/lib/authNavigation';

type AuthRole = 'driver' | 'recruiter';

const AMBER = 'hsl(25, 95%, 53%)';
const NAVY_BG = 'hsl(220, 20%, 8%)';
const NAVY_SURFACE = 'hsl(220, 20%, 10%)';
const NAVY_CARD = 'hsl(220, 22%, 12%)';
const NAVY_BORDER = 'hsl(220, 16%, 18%)';
const TEXT_MUTED = 'hsl(220, 10%, 65%)';
const TEXT_DIM = 'hsl(220, 10%, 50%)';

const CAPABILITIES: Array<{
  id: Capability;
  label: string;
  blurb: string;
  Icon: typeof Truck;
  nextDefault: string | null; // null = use intent=recruiter / driver default
}> = [
  {
    id: 'driver',
    label: 'Driver',
    blurb: 'Track loads, expenses, fuel logs, reports, and real profit.',
    Icon: Truck,
    nextDefault: null,
  },
  {
    id: 'recruiter',
    label: 'Recruiter / Carrier',
    blurb: 'Post structured opportunities, manage applicants, and recruit with transparency.',
    Icon: Briefcase,
    nextDefault: null,
  },
  {
    id: 'assistant',
    label: 'Driver Assistant',
    blurb: 'Help approved drivers manage trucking records and back-office tasks. Access begins through a driver invite.',
    Icon: Users,
    nextDefault: '/assistant',
  },
  {
    id: 'agency',
    label: 'Back-Office Agency',
    blurb: 'Create an agency workspace to manage approved driver clients.',
    Icon: Building2,
    nextDefault: '/agency',
  },
];

export default function Auth() {
  const { signIn, signUp } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '' });

  // Read & sanitize `next` once per location change.
  const safeNext = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return sanitizeNextPath(params.get('next'));
  }, [location.search]);

  const intentParam = useMemo(() => {
    return new URLSearchParams(location.search).get('intent');
  }, [location.search]);

  // Initial capability: derive from `next` first, then `intent=recruiter`, else driver.
  const [capability, setCapability] = useState<Capability>(() => {
    const c = getCapabilityFromNext(safeNext);
    if (c) return c;
    if (intentParam === 'recruiter') return 'recruiter';
    return 'driver';
  });

  useEffect(() => {
    const c = getCapabilityFromNext(safeNext);
    if (c) setCapability(c);
    else if (intentParam === 'recruiter') setCapability('recruiter');
  }, [safeNext, intentParam]);

  // Onboarding role for handle_new_user(): only driver/recruiter are real
  // server-side intended_roles. Assistant/Agency are capabilities, not roles —
  // they default to 'driver' for sign-up but post-auth continuation routes
  // them to /assistant or /agency.
  const role: AuthRole = capability === 'recruiter' ? 'recruiter' : 'driver';
  const isRecruiter = capability === 'recruiter';

  // Persist recruiter intent for the reconciler (Google OAuth round-trip).
  useEffect(() => {
    try {
      if (capability === 'recruiter') sessionStorage.setItem('htp_auth_intent', 'recruiter');
      else sessionStorage.removeItem('htp_auth_intent');
    } catch {}
  }, [capability]);

  // Phase 1S-A8 — transient workspace choice hint consumed once by
  // `useViewMode` after capabilities resolve. Preference ONLY: it never
  // grants access and never rewrites `profiles.intended_role`. Written
  // eagerly so it survives both email/password sign-in and the Google
  // OAuth round-trip in the same tab. Assistant/Agency clear it so a
  // stale Driver/Recruiter choice cannot override their continuation.
  useEffect(() => {
    try {
      if (capability === 'driver' || capability === 'recruiter') {
        sessionStorage.setItem('htp_workspace_intent', capability);
      } else {
        sessionStorage.removeItem('htp_workspace_intent');
      }
    } catch {}
  }, [capability]);


  // Compute effective `next` for this capability. Manual capability switch
  // (e.g. user lands without ?next= and clicks Agency) overrides default.
  const effectiveNext: string | null = useMemo(() => {
    if (safeNext) return safeNext;
    const cap = CAPABILITIES.find((c) => c.id === capability);
    return cap?.nextDefault ?? null;
  }, [safeNext, capability]);

  const handleGoogleSignIn = async () => {
    if (googleLoading || loading) return;
    setGoogleLoading(true);
    try {
      // Build a redirect URL that the PublicRoute will honor after OAuth.
      // Recruiter keeps the legacy intent param; assistant/agency/driver
      // ride on the canonical `next` parameter.
      const params = new URLSearchParams();
      if (isRecruiter) params.set('intent', 'recruiter');
      if (effectiveNext) params.set('next', effectiveNext);
      const qs = params.toString();
      const redirect_uri = window.location.origin + '/' + (qs ? `?${qs}` : '');
      const result = await lovable.auth.signInWithOAuth('google', { redirect_uri });
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

  const DOMAIN_TYPOS: Record<string, string> = {
    'gmail.comm': 'gmail.com',
    'gmail.con': 'gmail.com',
    'gmial.com': 'gmail.com',
    'gmaill.com': 'gmail.com',
    'yahoo.con': 'yahoo.com',
    'yaho.com': 'yahoo.com',
    'outlook.con': 'outlook.com',
    'hotmail.con': 'hotmail.com',
    'hotmial.com': 'hotmail.com',
    'icloud.con': 'icloud.com',
  };
  const suggestEmailFix = (email: string): string | null => {
    const at = email.lastIndexOf('@');
    if (at < 0) return null;
    const local = email.slice(0, at);
    const domain = email.slice(at + 1).toLowerCase();
    const fix = DOMAIN_TYPOS[domain];
    return fix ? `${local}@${fix}` : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'signup') {
      const suggested = suggestEmailFix(form.email.trim());
      if (suggested && suggested !== form.email.trim()) {
        const useFixed = window.confirm(`Did you mean ${suggested}?\n\nClick OK to use the corrected email, or Cancel to keep ${form.email}.`);
        if (useFixed) {
          setForm((p) => ({ ...p, email: suggested }));
          toast.info(`Email updated to ${suggested}. Click Create Account again to continue.`);
          return;
        }
      }
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error } = await signUp(form.email, form.password, form.name, role, {
          emailRedirectNext: effectiveNext,
        });
        if (error) throw error;
        trackSignUp('email');
        if (!isInternalTestEmail(form.email)) {
          supabase.functions
            .invoke('send-transactional-email', {
              body: {
                templateName: 'lifecycle-day0',
                recipientEmail: form.email,
                idempotencyKey: `lifecycle-day0-${form.email.toLowerCase().trim()}`,
                templateData: { name: form.name },
              },
            })
            .catch(() => {});
        }
        toast.success('Check your email to confirm your account!');
      } else {
        const { error } = await signIn(form.email, form.password);
        if (error) throw error;
        trackLogin('email');
        // Honor capability selection: if user picked Assistant/Agency on /auth
        // without ?next=, route to the matching workspace. ProtectedRoute will
        // also respect any pre-set ?next= via resolvePostAuthDestination.
        if (effectiveNext) {
          navigate(effectiveNext, { replace: true });
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };


  const titles: Record<Capability, { login: string; signup: string }> = {
    driver: { login: 'Welcome back, driver', signup: 'Create your driver account' },
    recruiter: { login: 'Welcome back, recruiter', signup: 'Create your recruiter account' },
    assistant: { login: 'Continue to assistant dashboard', signup: 'Create your account to assist drivers' },
    agency: { login: 'Continue to agency workspace', signup: 'Create your agency workspace account' },
  };
  const title = titles[capability][mode];

  const helpers: Record<Capability, string> = {
    driver: 'Track your real profit, manage loads, compare opportunities, and get a guided setup after sign up.',
    recruiter: 'Apply for recruiter access, post structured opportunities, and manage driver requests. Recruiter accounts require approval before posting.',
    assistant: 'Driver Assistant access begins through a driver invite or approved delegation. Create an account, then ask a driver to invite you. We do not auto-grant access to any driver account.',
    agency: 'Create a personal agency workspace, publish service packages, share your private agency request link, and manage approved driver clients. We do not process service payments or guarantee income.',
  };
  const helper = helpers[capability];

  return (
    <div className="min-h-screen px-4 py-8" style={{ background: NAVY_BG }}>
      <SEOHead title="Sign in | HaulTrackerPro" description="Sign in to HaulTrackerPro." path="/auth" noindex />
      <div className="max-w-5xl mx-auto">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-xs font-medium mb-6"
          style={{ color: TEXT_DIM }}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to home
        </button>

        <div className="grid md:grid-cols-[1fr_minmax(0,440px)] gap-8 items-start">
          {/* Side panel */}
          <aside className="space-y-6">
            <div className="flex items-center gap-2">
              <div
                className="inline-flex items-center justify-center rounded-2xl p-3"
                style={{ background: AMBER }}
              >
                <Truck className="h-7 w-7 text-white" />
              </div>
              <span className="text-2xl font-black tracking-tight text-white">HaulTrackerPro</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white leading-tight">
              Choose how you want to start.
            </h1>
            <p className="text-sm" style={{ color: TEXT_MUTED }}>
              HaulTrackerPro serves drivers, recruiters, driver assistants, and back-office agencies. Pick the
              capability that matches what you want to do today — you can use more than one over time.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CAPABILITIES.map((c) => {
                const active = capability === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCapability(c.id);
                      // Sync URL so refresh / sharing preserves the chosen capability.
                      // Recruiter keeps the legacy intent param; assistant/agency
                      // use the canonical `next` parameter; driver clears both.
                      const params = new URLSearchParams(location.search);
                      params.delete('intent');
                      params.delete('next');
                      if (c.id === 'recruiter') params.set('intent', 'recruiter');
                      else if (c.nextDefault) params.set('next', c.nextDefault);
                      const qs = params.toString();
                      navigate(
                        { pathname: '/auth', search: qs ? `?${qs}` : '' },
                        { replace: true },
                      );
                    }}
                    aria-pressed={active}
                    aria-label={`Select ${c.label} capability`}
                    className={cn(
                      'text-left rounded-xl border p-4 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F1115]',
                      active ? 'ring-2' : 'hover:border-white/20',
                    )}
                    style={{
                      background: NAVY_CARD,
                      borderColor: active ? AMBER : NAVY_BORDER,
                      boxShadow: active ? `0 0 0 3px hsl(25 95% 53% / 0.15)` : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <c.Icon className="h-4 w-4" style={{ color: active ? AMBER : TEXT_MUTED }} />
                      <span className="font-bold text-sm text-white">{c.label}</span>
                    </div>
                    <p className="text-xs mt-1.5 leading-snug" style={{ color: TEXT_MUTED }}>
                      {c.blurb}
                    </p>
                  </button>
                );
              })}
            </div>

            {effectiveNext && (
              <div
                className="rounded-lg border px-3 py-2 text-xs flex items-start gap-2"
                style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER, color: TEXT_MUTED }}
              >
                <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: AMBER }} />
                <span>
                  After sign-in you'll continue to{' '}
                  <span className="font-mono text-white">{effectiveNext}</span>
                </span>
              </div>
            )}
          </aside>

          {/* Auth card */}
          <div
            className="w-full rounded-2xl border p-6 sm:p-8 shadow-2xl backdrop-blur"
            style={{
              background: NAVY_CARD,
              borderColor: NAVY_BORDER,
              boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6)',
            }}
          >
            <div className="space-y-1 mb-5">
              <h2 className="text-lg font-bold text-white text-center">{title}</h2>
              <p className="text-xs text-center" style={{ color: TEXT_MUTED }}>
                {helper}
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignIn}
              disabled={googleLoading || loading}
              className="w-full h-12 text-base font-semibold border-2 bg-white text-slate-900 hover:bg-white/90 hover:text-slate-900"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.74-6-6.1s2.7-6.1 6-6.1c1.88 0 3.14.8 3.86 1.49l2.63-2.54C16.78 3.4 14.6 2.5 12 2.5 6.76 2.5 2.5 6.76 2.5 12S6.76 21.5 12 21.5c6.94 0 9.5-4.87 9.5-9.5 0-.64-.07-1.13-.16-1.6H12z"
                />
              </svg>
              {googleLoading ? 'Connecting...' : 'Continue with Google'}
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" style={{ borderColor: NAVY_BORDER }} />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="px-2" style={{ background: NAVY_CARD, color: TEXT_DIM }}>
                  or continue with
                </span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <div>
                  <Label htmlFor="name" className="flex items-center gap-1.5 text-white/90">
                    <User className="h-3 w-3" /> Display Name
                  </Label>
                  <Input
                    id="name"
                    placeholder="Your name"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    required
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  />
                </div>
              )}
              <div>
                <Label htmlFor="email" className="flex items-center gap-1.5 text-white/90">
                  <Mail className="h-3 w-3" /> Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  required
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                />
              </div>
              <div>
                <Label htmlFor="password" className="flex items-center gap-1.5 text-white/90">
                  <Lock className="h-3 w-3" /> Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                  required
                  minLength={6}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                />
              </div>
              <Button
                type="submit"
                className="w-full h-12 text-base font-bold"
                disabled={loading}
                style={{ background: AMBER, color: 'white' }}
              >
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
                  className="text-xs hover:underline"
                  style={{ color: TEXT_MUTED }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setMode((m) => (m === 'login' ? 'signup' : 'login'))}
                className="text-sm font-semibold hover:underline"
                style={{ color: AMBER }}
              >
                {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
