import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, displayName?: string, intendedRole?: 'driver' | 'recruiter') => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // Stay loading until BOTH the initial getSession() and the first
  // onAuthStateChange have settled. This prevents the brief "logged out"
  // flash where ProtectedRoute would <Navigate to="/" /> and paint the
  // public Landing ("Start Free…") hero before the restored session arrives.
  const [loading, setLoading] = useState(true);
  const initialResolvedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const finalize = (next: Session | null) => {
      if (cancelled) return;
      setSession((prev) =>
        prev?.access_token === next?.access_token ? prev : next,
      );
      setUser((prev) => {
        const nextUser = next?.user ?? null;
        return prev?.id === nextUser?.id ? prev : nextUser;
      });
    };

    // Subscribe first (synchronous handler — no await inside)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      finalize(newSession);
      // Only flip loading off once the initial restoration has happened.
      if (initialResolvedRef.current) {
        setLoading(false);
      }
    });

    // Then restore existing session — this is the source of truth for
    // "was the user already logged in when the app booted?".
    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      finalize(existing);
      initialResolvedRef.current = true;
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: displayName },
      },
    });
    return { error };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Defensive fallback to avoid breaking rendering if provider is missing
    return {
      user: null,
      session: null,
      loading: true,
      signUp: async () => ({ error: new Error('AuthProvider missing') }),
      signIn: async () => ({ error: new Error('AuthProvider missing') }),
      signOut: async () => {},
    };
  }
  return ctx;
}
