import { useState, type FormEvent } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { miniAppPath, type MiniAppView } from '@/lib/telegramMiniApp';

export function MiniAppAuth({ view }: { view: MiniAppView }) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const email = form.email.trim();
      const result = mode === 'sign-up'
        ? await signUp(email, form.password, form.name.trim(), 'recruiter', { emailRedirectNext: miniAppPath(view) })
        : await signIn(email, form.password);
      if (result.error) {
        setMessage(mode === 'sign-up' ? 'Account creation could not be completed. Check your details, or sign in if you already have an account.' : 'Sign-in could not be completed. Check your email and password and confirm your email address.');
      } else if (mode === 'sign-up') {
        setForm(previous => ({ ...previous, password: '' }));
        setMessage('Check your email to confirm your account. Then return to this Mini App and sign in.');
      }
    } catch { setMessage('The connection could not be completed. Please try again.'); }
    finally { setBusy(false); }
  };
  return <Card className="mx-auto w-full max-w-md space-y-5 border-border/60 p-5 sm:p-7">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Your HaulTracker account</p>
      <h1 className="mt-2 text-2xl font-bold">{mode === 'sign-in' ? 'Welcome back' : 'Start recruiting'}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{mode === 'sign-in' ? 'Sign in to continue inside Telegram. Your jobs and conversations stay connected to the website.' : 'Create a recruiter account, confirm your email, then complete your company profile.'}</p>
    </div>
    <form onSubmit={submit} className="space-y-4">
      {mode === 'sign-up' && <div className="space-y-2"><Label htmlFor="mini-name">Your name</Label><Input id="mini-name" autoComplete="name" maxLength={120} required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></div>}
      <div className="space-y-2"><Label htmlFor="mini-email">Email</Label><Input id="mini-email" type="email" autoComplete="email" maxLength={254} required value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="mini-password">Password</Label><Input id="mini-password" type="password" autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} minLength={mode === 'sign-up' ? 8 : undefined} maxLength={128} required value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></div>
      {message && <p role="status" className="text-sm leading-relaxed text-muted-foreground">{message}</p>}
      <Button className="min-h-11 w-full" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create recruiter account'}</Button>
    </form>
    <Button className="min-h-11 w-full whitespace-normal" variant="outline" disabled={busy} onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage(''); setForm(previous => ({ ...previous, password: '' })); }}>{mode === 'sign-in' ? 'New here? Create a recruiter account' : 'Already have an account? Sign in'}</Button>
    <p className="text-xs leading-relaxed text-muted-foreground">Invited teammates: sign in with the account on your invitation. Team membership and permissions are granted by your workspace administrator.</p>
    <p className="text-xs text-muted-foreground">By continuing, you agree to the <a href="https://haultrackerpro.com/terms" target="_blank" rel="noopener noreferrer" className="underline">Terms</a> and <a href="https://haultrackerpro.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">Privacy Policy</a>.</p>
    <a className="block text-center text-sm text-primary underline" href="https://haultrackerpro.com/auth" target="_blank" rel="noopener noreferrer">Use Google sign-in or reset your password on the website</a>
  </Card>;
}
