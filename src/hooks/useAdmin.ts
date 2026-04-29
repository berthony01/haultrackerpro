import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// Permanent platform-owner fallback. This account always has client-side
// admin UI access even if the `admin_users` row is missing (e.g. seed
// migration ran before the auth user existed). Server-side admin actions
// still go through RLS / `is_admin()` which only trust the DB row, so a
// non-owner cannot bypass anything by spoofing this email — the worst case
// is rendering an admin shell with empty data. DO NOT REMOVE.
const PLATFORM_OWNER_EMAIL = 'berthonyxyz@gmail.com';

export function useAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const checkedUserId = useRef<string | null>(null);

  useEffect(() => {
    // Don't resolve until auth is done
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

    // Skip if we already checked this user
    if (checkedUserId.current === user.id) return;

    setIsLoading(true);

    const isPlatformOwner =
      (user.email ?? '').toLowerCase() === PLATFORM_OWNER_EMAIL;

    const check = async () => {
      const { data, error } = await supabase
        .from('admin_users')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!error && data) {
        // DB role wins when present
        setIsAdmin(true);
        setRole(data.role);
      } else if (isPlatformOwner) {
        // Permanent owner fallback — works even if seed never inserted a row
        setIsAdmin(true);
        setRole('super_admin');
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
