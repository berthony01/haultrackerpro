
-- =====================================================================
-- Phase 2 cleanup: agency FKs + non-recursive RLS helpers
-- =====================================================================

-- 1. Safe foreign keys to auth.users -----------------------------------

ALTER TABLE public.agency_profiles
  DROP CONSTRAINT IF EXISTS agency_profiles_owner_user_id_fkey;
ALTER TABLE public.agency_profiles
  ADD CONSTRAINT agency_profiles_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE
  NOT VALID;
ALTER TABLE public.agency_profiles
  VALIDATE CONSTRAINT agency_profiles_owner_user_id_fkey;

ALTER TABLE public.agency_members
  DROP CONSTRAINT IF EXISTS agency_members_member_user_id_fkey;
ALTER TABLE public.agency_members
  ADD CONSTRAINT agency_members_member_user_id_fkey
  FOREIGN KEY (member_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.agency_members
  VALIDATE CONSTRAINT agency_members_member_user_id_fkey;

-- 2. SECURITY DEFINER helpers (no recursion) ---------------------------

CREATE OR REPLACE FUNCTION public.is_agency_owner(_agency_id uuid, _uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agency_profiles ap
     WHERE ap.id = _agency_id AND ap.owner_user_id = _uid
  );
$$;

CREATE OR REPLACE FUNCTION public.is_agency_member(_agency_id uuid, _uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agency_members am
     WHERE am.agency_id = _agency_id
       AND am.member_user_id = _uid
       AND am.status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_agency_owner(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_agency_member(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_agency_owner(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_agency_member(uuid,uuid) TO authenticated;

-- 3. Rewrite policies to use helpers (no cross-table EXISTS subqueries) -

DROP POLICY IF EXISTS "agency_profiles_owner_all"      ON public.agency_profiles;
DROP POLICY IF EXISTS "agency_profiles_member_select"  ON public.agency_profiles;
DROP POLICY IF EXISTS "agency_members_owner_all"       ON public.agency_members;
DROP POLICY IF EXISTS "agency_members_self_select"     ON public.agency_members;

CREATE POLICY "agency_profiles_owner_all" ON public.agency_profiles
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "agency_profiles_member_select" ON public.agency_profiles
  FOR SELECT TO authenticated
  USING (public.is_agency_member(id, auth.uid()));

CREATE POLICY "agency_members_owner_all" ON public.agency_members
  FOR ALL TO authenticated
  USING (public.is_agency_owner(agency_id, auth.uid()))
  WITH CHECK (public.is_agency_owner(agency_id, auth.uid()));

CREATE POLICY "agency_members_self_select" ON public.agency_members
  FOR SELECT TO authenticated
  USING (member_user_id = auth.uid());
