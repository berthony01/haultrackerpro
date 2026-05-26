import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export function useAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const checkedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) {
      setIsLoading(true);
      return;
    }

    if (!user) {
      setIsAdmin(false);
      setRole(null);
      setIsLoading(false);
      checkedUserId.current = null;
      return;
    }

    if (checkedUserId.current === user.id) return;

    setIsLoading(true);

    const check = async () => {
      // DB row in admin_users is the only source of truth. Server-side
      // RLS / is_admin() enforces the same check, so the UI cannot be
      // tricked into granting elevated access.
      const { data, error } = await supabase
        .from('admin_users')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!error && data) {
        setIsAdmin(true);
        setRole(data.role);
      } else {
        setIsAdmin(false);
        setRole(null);
      }
      checkedUserId.current = user.id;
      setIsLoading(false);
    };

    check();
  }, [user, authLoading]);

  return { isAdmin, role, isLoading };
}
