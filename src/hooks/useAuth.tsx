import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Subscribe first (synchronous handler — no await inside)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession((prev) =>
        prev?.access_token === newSession?.access_token ? prev : newSession,
      );
      setUser((prev) => {
        const nextUser = newSession?.user ?? null;
        return prev?.id === nextUser?.id ? prev : nextUser;
      });
      setLoading(false);
    });

    // Then restore existing session
    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      setSession((prev) =>
        prev?.access_token === existing?.access_token ? prev : existing,
      );
      setUser((prev) => {
        const nextUser = existing?.user ?? null;
        return prev?.id === nextUser?.id ? prev : nextUser;
      });
      setLoading(false);
    });

    return () => subscription.unsubscribe();
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
