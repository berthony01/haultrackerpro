
DO $$ BEGIN
  CREATE TYPE public.agency_member_role AS ENUM ('agency_owner','agency_admin','agency_member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.agency_member_status AS ENUM ('pending','active','revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.agency_status AS ENUM ('active','disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- agency_profiles first (without member-cross-ref policy yet) ---------------

CREATE TABLE IF NOT EXISTS public.agency_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  contact_email   TEXT,
  status          public.agency_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agency_profiles_one_per_owner ON public.agency_profiles(owner_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_profiles TO authenticated;
GRANT ALL ON public.agency_profiles TO service_role;

ALTER TABLE public.agency_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agency_profiles_owner_all" ON public.agency_profiles;
CREATE POLICY "agency_profiles_owner_all" ON public.agency_profiles
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_agency_profiles_updated_at ON public.agency_profiles;
CREATE TRIGGER trg_agency_profiles_updated_at
  BEFORE UPDATE ON public.agency_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- agency_members -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agency_members (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id          UUID NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  member_user_id     UUID,
  invite_email       TEXT NOT NULL,
  invite_token_hash  TEXT,
  role               public.agency_member_role NOT NULL DEFAULT 'agency_member',
  status             public.agency_member_status NOT NULL DEFAULT 'pending',
  invited_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at        TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agency_members_email_unique
  ON public.agency_members(agency_id, lower(invite_email))
  WHERE status IN ('pending','active');

CREATE INDEX IF NOT EXISTS agency_members_member_idx
  ON public.agency_members(member_user_id) WHERE member_user_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_members TO authenticated;
GRANT ALL ON public.agency_members TO service_role;

ALTER TABLE public.agency_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agency_members_owner_all" ON public.agency_members;
CREATE POLICY "agency_members_owner_all" ON public.agency_members
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agency_profiles ap
                  WHERE ap.id = agency_members.agency_id AND ap.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.agency_profiles ap
                       WHERE ap.id = agency_members.agency_id AND ap.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "agency_members_self_select" ON public.agency_members;
CREATE POLICY "agency_members_self_select" ON public.agency_members
  FOR SELECT TO authenticated USING (member_user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_agency_members_updated_at ON public.agency_members;
CREATE TRIGGER trg_agency_members_updated_at
  BEFORE UPDATE ON public.agency_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Now add the cross-ref policy on agency_profiles ------------------------

DROP POLICY IF EXISTS "agency_profiles_member_select" ON public.agency_profiles;
CREATE POLICY "agency_profiles_member_select" ON public.agency_profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agency_members am
                  WHERE am.agency_id = agency_profiles.id
                    AND am.member_user_id = auth.uid()
                    AND am.status = 'active'));

-- =====================================================================
-- RPCs
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_agency(_name text, _description text DEFAULT NULL, _contact_email text DEFAULT NULL)
RETURNS public.agency_profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _row public.agency_profiles;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF _name IS NULL OR length(btrim(_name))<2 OR length(_name)>120 THEN
    RAISE EXCEPTION 'Agency name must be 2–120 characters' USING ERRCODE='22023'; END IF;
  IF _contact_email IS NOT NULL AND _contact_email<>''
     AND lower(_contact_email) !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid contact email' USING ERRCODE='22023'; END IF;
  INSERT INTO public.agency_profiles(owner_user_id,name,description,contact_email)
  VALUES (_uid, btrim(_name), NULLIF(btrim(coalesce(_description,'')),''),
          NULLIF(lower(btrim(coalesce(_contact_email,''))),''))
  RETURNING * INTO _row;
  INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, role, status, accepted_at)
  VALUES (_row.id, _uid, COALESCE((SELECT lower(email) FROM auth.users WHERE id=_uid),'owner@local'),
          'agency_owner','active', now());
  RETURN _row;
END;$$;

CREATE OR REPLACE FUNCTION public.update_my_agency(_name text, _description text, _contact_email text, _status public.agency_status)
RETURNS public.agency_profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _row public.agency_profiles;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF _name IS NULL OR length(btrim(_name))<2 THEN RAISE EXCEPTION 'Agency name required' USING ERRCODE='22023'; END IF;
  UPDATE public.agency_profiles
    SET name=btrim(_name), description=NULLIF(btrim(coalesce(_description,'')),''),
        contact_email=NULLIF(lower(btrim(coalesce(_contact_email,''))),''),
        status=COALESCE(_status,status), updated_at=now()
    WHERE owner_user_id=_uid RETURNING * INTO _row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agency not found' USING ERRCODE='P0002'; END IF;
  RETURN _row;
END;$$;

CREATE OR REPLACE FUNCTION public.get_my_agency()
RETURNS TABLE (id uuid, owner_user_id uuid, name text, description text,
               contact_email text, status public.agency_status,
               created_at timestamptz, updated_at timestamptz,
               my_role public.agency_member_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ap.id, ap.owner_user_id, ap.name, ap.description, ap.contact_email, ap.status,
         ap.created_at, ap.updated_at, am.role
    FROM public.agency_profiles ap
    JOIN public.agency_members am ON am.agency_id=ap.id
     AND am.member_user_id=auth.uid() AND am.status='active'
   WHERE auth.uid() IS NOT NULL LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.invite_agency_member(_agency_id uuid, _email text, _role public.agency_member_role DEFAULT 'agency_member')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid:=auth.uid(); _en text:=lower(btrim(coalesce(_email,''))); _t text; _h text; _row public.agency_members;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agency_profiles ap WHERE ap.id=_agency_id AND ap.owner_user_id=_uid) THEN
    RAISE EXCEPTION 'Not your agency' USING ERRCODE='42501'; END IF;
  IF _role='agency_owner' THEN RAISE EXCEPTION 'Cannot assign owner role' USING ERRCODE='22023'; END IF;
  IF _en='' OR _en !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE='22023'; END IF;
  _t:=encode(gen_random_bytes(24),'hex'); _h:=encode(digest(_t,'sha256'),'hex');
  INSERT INTO public.agency_members(agency_id,invite_email,invite_token_hash,role,status)
  VALUES (_agency_id,_en,_h,_role,'pending')
  ON CONFLICT (agency_id, lower(invite_email)) WHERE status IN ('pending','active')
  DO UPDATE SET role=EXCLUDED.role, invite_token_hash=EXCLUDED.invite_token_hash,
                invited_at=now(), updated_at=now()
  RETURNING * INTO _row;
  RETURN jsonb_build_object('id',_row.id,'invite_token',_t,'invite_email',_row.invite_email);
END;$$;

CREATE OR REPLACE FUNCTION public.accept_agency_invite(_token text)
RETURNS public.agency_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid:=auth.uid(); _h text:=encode(digest(coalesce(_token,''),'sha256'),'hex'); _em text; _row public.agency_members;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT lower(email) INTO _em FROM auth.users WHERE id=_uid;
  UPDATE public.agency_members SET member_user_id=_uid, status='active', accepted_at=now(),
         invite_token_hash=NULL, updated_at=now()
   WHERE invite_token_hash=_h AND status='pending' AND lower(invite_email)=_em
  RETURNING * INTO _row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invite invalid or not addressed to your email' USING ERRCODE='P0002'; END IF;
  RETURN _row;
END;$$;

CREATE OR REPLACE FUNCTION public.revoke_agency_member(_member_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid:=auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  UPDATE public.agency_members am SET status='revoked', revoked_at=now(),
         invite_token_hash=NULL, updated_at=now()
   WHERE am.id=_member_id
     AND EXISTS (SELECT 1 FROM public.agency_profiles ap
                   WHERE ap.id=am.agency_id AND ap.owner_user_id=_uid)
     AND am.role<>'agency_owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found or cannot revoke owner' USING ERRCODE='P0002'; END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.list_agency_members(_agency_id uuid)
RETURNS TABLE (id uuid, agency_id uuid, member_user_id uuid, invite_email text,
               role public.agency_member_role, status public.agency_member_status,
               invited_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT am.id, am.agency_id, am.member_user_id, am.invite_email, am.role, am.status,
         am.invited_at, am.accepted_at, am.revoked_at
    FROM public.agency_members am
   WHERE am.agency_id=_agency_id
     AND (EXISTS (SELECT 1 FROM public.agency_profiles ap
                    WHERE ap.id=_agency_id AND ap.owner_user_id=auth.uid())
          OR am.member_user_id=auth.uid())
   ORDER BY am.invited_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.create_agency(text,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_my_agency(text,text,text,public.agency_status) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_agency() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.invite_agency_member(uuid,text,public.agency_member_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_agency_invite(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_agency_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_agency_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_agency(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_agency(text,text,text,public.agency_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_agency() TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_agency_member(uuid,text,public.agency_member_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_agency_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_agency_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_agency_members(uuid) TO authenticated;

-- =====================================================================
-- AUDIT READER RPCs
-- =====================================================================

CREATE OR REPLACE FUNCTION public.list_driver_assistant_audit(_limit int DEFAULT 100)
RETURNS TABLE (id uuid, created_at timestamptz, action text, entity_type text,
               entity_id uuid, assistant_user_id uuid, assistant_email text, metadata jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT al.id, al.created_at, al.action, al.entity_type, al.entity_id, al.assistant_user_id,
         COALESCE(da.invite_email, (SELECT lower(email) FROM auth.users u WHERE u.id=al.assistant_user_id)),
         al.metadata
    FROM public.assistant_audit_log al
    LEFT JOIN public.driver_assistants da ON da.id=al.delegate_id
   WHERE al.driver_user_id=auth.uid()
   ORDER BY al.created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(_limit,100),500));
$$;

CREATE OR REPLACE FUNCTION public.list_my_assistant_audit(_limit int DEFAULT 100)
RETURNS TABLE (id uuid, created_at timestamptz, action text, entity_type text,
               entity_id uuid, driver_user_id uuid, driver_email text, metadata jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT al.id, al.created_at, al.action, al.entity_type, al.entity_id, al.driver_user_id,
         (SELECT lower(email) FROM auth.users u WHERE u.id=al.driver_user_id),
         al.metadata
    FROM public.assistant_audit_log al
   WHERE al.assistant_user_id=auth.uid()
   ORDER BY al.created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(_limit,100),500));
$$;

CREATE OR REPLACE FUNCTION public.list_my_pending_assistant_invites()
RETURNS TABLE (id uuid, driver_user_id uuid, invite_email text, invited_at timestamptz, permissions jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT da.id, da.driver_user_id, da.invite_email, da.invited_at, da.permissions
    FROM public.driver_assistants da
   WHERE da.status='pending'
     AND lower(da.invite_email)=(SELECT lower(email) FROM auth.users WHERE id=auth.uid())
   ORDER BY da.invited_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.list_driver_assistant_audit(int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_my_assistant_audit(int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_my_pending_assistant_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_driver_assistant_audit(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_assistant_audit(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_pending_assistant_invites() TO authenticated;
