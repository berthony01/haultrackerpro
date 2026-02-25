import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Truck, Mail, Lock, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export default function Auth() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error } = await signUp(form.email, form.password, form.name);
        if (error) throw error;
        toast.success('Check your email to confirm your account!');
      } else {
        const { error } = await signIn(form.email, form.password);
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center rounded-2xl bg-primary p-3 mx-auto">
            <Truck className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-black font-heading tracking-tight">HaulTracker</h1>
          <p className="text-sm text-muted-foreground">Load & Pay Manager</p>
        </div>

        <Card className="border-2 border-primary/20 shadow-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-heading text-center">
              {mode === 'login' ? 'Welcome Back' : 'Create Account'}
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                </div>
              )}
              <div>
                <Label htmlFor="email" className="flex items-center gap-1.5">
                  <Mail className="h-3 w-3" /> Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="driver@example.com"
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

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setMode(m => m === 'login' ? 'signup' : 'login')}
                className="text-sm text-primary font-semibold hover:underline"
              >
                {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
