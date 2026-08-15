-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase RC-1A — Recruiter Workspace Membership Foundation.
-- Scope: membership identity + lifecycle ONLY. This migration grants NO recruiter
-- operational authority (opportunities, applications, reports, referrals, contracts,
-- billing, profile, settings, routing). Those remain owner-only and untouched.
-- Does NOT reuse or modify agency_members or any Agency/Driver-Assistant object.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Dedicated recruiter membership enums (separate from Agency enums)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE public.recruiter_member_role AS ENUM ('recruiter_owner', 'recruiter_admin', 'recruiter_staff');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.recruiter_member_status AS ENUM ('pending', 'active', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- B. public.recruiter_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recruiter_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id        uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  member_user_id      uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_email        citext NOT NULL,
  invite_token_hash   text NULL,
  invite_expires_at   timestamptz NULL,
  role                public.recruiter_member_role NOT NULL DEFAULT 'recruiter_staff',
  status              public.recruiter_member_status NOT NULL DEFAULT 'pending',
  invited_by_user_id  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at          timestamptz NOT NULL DEFAULT now(),
  accepted_at         timestamptz NULL,
  revoked_at          timestamptz NULL,
  revoked_by_user_id  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Invariant 1: exactly one ACTIVE owner membership per recruiter workspace.
CREATE UNIQUE INDEX IF NOT EXISTS recruiter_members_one_active_owner_idx
  ON public.recruiter_members (recruiter_id)
  WHERE role = 'recruiter_owner' AND status = 'active';

-- Invariant 2: no duplicate ACTIVE memberships for the same user in a workspace.
CREATE UNIQUE INDEX IF NOT EXISTS recruiter_members_unique_active_user_idx
  ON public.recruiter_members (recruiter_id, member_user_id)
  WHERE status = 'active' AND member_user_id IS NOT NULL;

-- Invariant 3: no duplicate PENDING/ACTIVE rows for the same normalized email.
CREATE UNIQUE INDEX IF NOT EXISTS recruiter_members_unique_open_email_idx
  ON public.recruiter_members (recruiter_id, lower(invite_email::text))
  WHERE status IN ('pending', 'active');

-- Invariant 4: a pending non-null invite token hash must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS recruiter_members_unique_token_hash_idx
  ON public.recruiter_members (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS recruiter_members_member_user_idx
  ON public.recruiter_members (member_user_id) WHERE member_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- C. public.recruiter_member_audit_log (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recruiter_member_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id   uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  member_id      uuid NULL REFERENCES public.recruiter_members(id) ON DELETE SET NULL,
  actor_user_id  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type     text NOT NULL CHECK (event_type IN (
                   'owner_bootstrapped', 'invite_created', 'invite_refreshed',
                   'invite_accepted', 'member_revoked')),
  target_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_email   citext NULL,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recruiter_member_audit_log_recruiter_idx
  ON public.recruiter_member_audit_log (recruiter_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- D. Owner membership bootstrap + future-owner trigger
-- ---------------------------------------------------------------------------
WITH bootstrapped AS (
  INSERT INTO public.recruiter_members (
    recruiter_id, member_user_id, invite_email, role, status, accepted_at,
    invite_token_hash, invite_expires_at
  )
  SELECT rp.id,
         rp.user_id,
         lower(btrim(COALESCE(u.email::text, rp.recruiter_email)))::citext,
         'recruiter_owner'::public.recruiter_member_role,
         'active'::public.recruiter_member_status,
         now(),
         NULL,
         NULL
    FROM public.recruiter_profiles rp
    LEFT JOIN auth.users u ON u.id = rp.user_id
   WHERE COALESCE(u.email::text, rp.recruiter_email) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.recruiter_members m
        WHERE m.recruiter_id = rp.id
          AND m.role = 'recruiter_owner'
          AND m.status = 'active'
     )
  RETURNING id, recruiter_id, member_user_id, invite_email
)
INSERT INTO public.recruiter_member_audit_log (
  recruiter_id, member_id, actor_user_id, event_type, target_user_id, invite_email, metadata
)
SELECT b.recruiter_id, b.id, NULL, 'owner_bootstrapped', b.member_user_id, b.invite_email,
       jsonb_build_object('source', 'phase_rc1a_backfill')
  FROM bootstrapped b;

CREATE OR REPLACE FUNCTION public.rc1a_bootstrap_recruiter_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text;
  _member_id uuid;
BEGIN
  SELECT lower(btrim(COALESCE(u.email::text, NEW.recruiter_email)))
    INTO _email
    FROM (SELECT 1) x
    LEFT JOIN auth.users u ON u.id = NEW.user_id;

  IF _email IS NULL OR _email = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.recruiter_members (
    recruiter_id, member_user_id, invite_email, role, status, accepted_at
  )
  VALUES (
    NEW.id, NEW.user_id, _email::citext,
    'recruiter_owner'::public.recruiter_member_role,
    'active'::public.recruiter_member_status,
    now()
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO _member_id;

  IF _member_id IS NOT NULL THEN
    INSERT INTO public.recruiter_member_audit_log (
      recruiter_id, member_id, actor_user_id, event_type, target_user_id, invite_email, metadata
    )
    VALUES (NEW.id, _member_id, NEW.user_id, 'owner_bootstrapped', NEW.user_id, _email::citext,
            jsonb_build_object('source', 'recruiter_profiles_after_insert'));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rc1a_recruiter_profiles_owner_membership ON public.recruiter_profiles;
CREATE TRIGGER rc1a_recruiter_profiles_owner_membership
AFTER INSERT ON public.recruiter_profiles
FOR EACH ROW EXECUTE FUNCTION public.rc1a_bootstrap_recruiter_owner_membership();

-- ---------------------------------------------------------------------------
-- E. Security helpers / RPCs
-- ---------------------------------------------------------------------------

-- Membership identity ONLY. Not operational permission.
CREATE OR REPLACE FUNCTION public.is_recruiter_workspace_member(_recruiter_id uuid, _uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recruiter_members m
     WHERE m.recruiter_id = _recruiter_id
       AND m.member_user_id = _uid
       AND m.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_recruiter_workspaces()
RETURNS TABLE (
  membership_id uuid,
  recruiter_id uuid,
  owner_user_id uuid,
  company_name text,
  recruiter_name text,
  member_role public.recruiter_member_role,
  member_status public.recruiter_member_status,
  member_since timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.recruiter_id, rp.user_id, rp.company_name, rp.recruiter_name,
         m.role, m.status, COALESCE(m.accepted_at, m.invited_at)
    FROM public.recruiter_members m
    JOIN public.recruiter_profiles rp ON rp.id = m.recruiter_id
   WHERE m.member_user_id = auth.uid()
     AND auth.uid() IS NOT NULL
     AND m.status = 'active'
   ORDER BY COALESCE(m.accepted_at, m.invited_at) DESC;
$$;

CREATE OR REPLACE FUNCTION public.list_recruiter_members(_recruiter_id uuid)
RETURNS TABLE (
  membership_id uuid,
  recruiter_id uuid,
  member_user_id uuid,
  invite_email citext,
  member_role public.recruiter_member_role,
  member_status public.recruiter_member_status,
  invited_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invite_expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.recruiter_id, m.member_user_id, m.invite_email, m.role, m.status,
         m.invited_at, m.accepted_at, m.revoked_at, m.invite_expires_at
    FROM public.recruiter_members m
   WHERE m.recruiter_id = _recruiter_id
     AND auth.uid() IS NOT NULL
     AND (
       EXISTS (
         SELECT 1 FROM public.recruiter_profiles rp
          WHERE rp.id = _recruiter_id AND rp.user_id = auth.uid()
       )
       OR (
         m.member_user_id = auth.uid()
         AND m.status = 'active'
       )
     )
   ORDER BY m.invited_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.invite_recruiter_member(
  _recruiter_id uuid,
  _email text,
  _role public.recruiter_member_role DEFAULT 'recruiter_staff'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _norm text;
  _owner_email text;
  _raw_token text;
  _hash text;
  _expires timestamptz;
  _row public.recruiter_members%ROWTYPE;
  _existing public.recruiter_members%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- RC-1A: canonical recruiter owner only.
  IF NOT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
     WHERE rp.id = _recruiter_id AND rp.user_id = _uid
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _role IS NULL OR _role = 'recruiter_owner' THEN
    RAISE EXCEPTION 'Invalid role' USING ERRCODE = '22023';
  END IF;

  _norm := lower(btrim(COALESCE(_email, '')));
  IF _norm !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(COALESCE(u.email::text, rp.recruiter_email)))
    INTO _owner_email
    FROM public.recruiter_profiles rp
    LEFT JOIN auth.users u ON u.id = rp.user_id
   WHERE rp.id = _recruiter_id;

  IF _owner_email IS NOT NULL AND _norm = _owner_email THEN
    RAISE EXCEPTION 'Cannot invite the workspace owner' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _existing
    FROM public.recruiter_members m
   WHERE m.recruiter_id = _recruiter_id
     AND lower(m.invite_email::text) = _norm
     AND m.status IN ('pending', 'active')
   FOR UPDATE;

  IF FOUND AND _existing.status = 'active' THEN
    RAISE EXCEPTION 'Already a member' USING ERRCODE = '22023';
  END IF;

  _raw_token := encode(gen_random_bytes(24), 'hex');
  _hash := encode(digest(_raw_token, 'sha256'), 'hex');
  _expires := now() + interval '7 days';

  IF FOUND THEN
    UPDATE public.recruiter_members m
       SET invite_token_hash = _hash,
           invite_expires_at = _expires,
           role = _role,
           invited_by_user_id = _uid,
           invited_at = now(),
           updated_at = now()
     WHERE m.id = _existing.id
     RETURNING * INTO _row;

    INSERT INTO public.recruiter_member_audit_log (
      recruiter_id, member_id, actor_user_id, event_type, invite_email, metadata
    ) VALUES (_recruiter_id, _row.id, _uid, 'invite_refreshed', _row.invite_email,
              jsonb_build_object('role', _role));
  ELSE
    INSERT INTO public.recruiter_members (
      recruiter_id, invite_email, invite_token_hash, invite_expires_at,
      role, status, invited_by_user_id, invited_at
    ) VALUES (
      _recruiter_id, _norm::citext, _hash, _expires,
      _role, 'active'::public.recruiter_member_status IS NOT NULL
        AND FALSE OR 'pending'::public.recruiter_member_status,
      _uid, now()
    )
    RETURNING * INTO _row;

    INSERT INTO public.recruiter_member_audit_log (
      recruiter_id, member_id, actor_user_id, event_type, invite_email, metadata
    ) VALUES (_recruiter_id, _row.id, _uid, 'invite_created', _row.invite_email,
              jsonb_build_object('role', _role));
  END IF;

  RETURN jsonb_build_object(
    'membership_id', _row.id,
    'invite_token', _raw_token,
    'invite_email', _row.invite_email::text,
    'role', _row.role::text,
    'expires_at', _row.invite_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_recruiter_member_invite(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _email text;
  _hash text;
  _row public.recruiter_members%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(btrim(u.email::text)) INTO _email FROM auth.users u WHERE u.id = _uid;
  IF _email IS NULL OR _email = '' THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '22023';
  END IF;

  IF _token IS NULL OR btrim(_token) = '' THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '22023';
  END IF;

  _hash := encode(digest(btrim(_token), 'sha256'), 'hex');

  SELECT * INTO _row
    FROM public.recruiter_members m
   WHERE m.invite_token_hash = _hash
     AND m.status = 'pending'
     AND m.invite_expires_at IS NOT NULL
     AND m.invite_expires_at > now()
     AND lower(m.invite_email::text) = _email
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.recruiter_members m2
     WHERE m2.recruiter_id = _row.recruiter_id
       AND m2.member_user_id = _uid
       AND m2.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Already a member' USING ERRCODE = '22023';
  END IF;

  UPDATE public.recruiter_members m
     SET member_user_id = _uid,
         status = 'active',
         accepted_at = now(),
         invite_token_hash = NULL,
         invite_expires_at = NULL,
         updated_at = now()
   WHERE m.id = _row.id
     AND m.status = 'pending'
   RETURNING * INTO _row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.recruiter_member_audit_log (
    recruiter_id, member_id, actor_user_id, event_type, target_user_id, invite_email, metadata
  ) VALUES (_row.recruiter_id, _row.id, _uid, 'invite_accepted', _uid, _row.invite_email,
            jsonb_build_object('role', _row.role::text));

  RETURN jsonb_build_object(
    'membership_id', _row.id,
    'recruiter_id', _row.recruiter_id,
    'role', _row.role::text,
    'status', _row.status::text,
    'accepted_at', _row.accepted_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_recruiter_member(_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.recruiter_members%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT m.* INTO _row
    FROM public.recruiter_members m
    JOIN public.recruiter_profiles rp ON rp.id = m.recruiter_id
   WHERE m.id = _member_id
     AND rp.user_id = _uid
     AND m.role <> 'recruiter_owner'
     AND m.status IN ('pending', 'active')
   FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.recruiter_members m
     SET status = 'revoked',
         revoked_at = now(),
         revoked_by_user_id = _uid,
         invite_token_hash = NULL,
         invite_expires_at = NULL,
         updated_at = now()
   WHERE m.id = _row.id
   RETURNING * INTO _row;

  INSERT INTO public.recruiter_member_audit_log (
    recruiter_id, member_id, actor_user_id, event_type, target_user_id, invite_email, metadata
  ) VALUES (_row.recruiter_id, _row.id, _uid, 'member_revoked', _row.member_user_id, _row.invite_email,
            jsonb_build_object('role', _row.role::text));

  RETURN jsonb_build_object(
    'membership_id', _row.id,
    'recruiter_id', _row.recruiter_id,
    'status', _row.status::text,
    'revoked_at', _row.revoked_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- F. RLS + grants (membership visibility only; no direct writes)
-- ---------------------------------------------------------------------------
ALTER TABLE public.recruiter_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruiter_member_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.recruiter_members FROM anon, authenticated;
REVOKE ALL ON public.recruiter_member_audit_log FROM anon, authenticated;

GRANT SELECT ON public.recruiter_members TO authenticated;
GRANT SELECT ON public.recruiter_member_audit_log TO authenticated;
GRANT ALL ON public.recruiter_members TO service_role;
GRANT ALL ON public.recruiter_member_audit_log TO service_role;

DROP POLICY IF EXISTS "Recruiter owner reads workspace memberships" ON public.recruiter_members;
CREATE POLICY "Recruiter owner reads workspace memberships"
ON public.recruiter_members
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
     WHERE rp.id = recruiter_members.recruiter_id
       AND rp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Active member reads own membership row" ON public.recruiter_members;
CREATE POLICY "Active member reads own membership row"
ON public.recruiter_members
FOR SELECT
TO authenticated
USING (member_user_id = auth.uid() AND status = 'active');

DROP POLICY IF EXISTS "Recruiter owner reads membership audit" ON public.recruiter_member_audit_log;
CREATE POLICY "Recruiter owner reads membership audit"
ON public.recruiter_member_audit_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
     WHERE rp.id = recruiter_member_audit_log.recruiter_id
       AND rp.user_id = auth.uid()
  )
);

-- Function privileges: fail closed, then grant only the intended surface.
REVOKE ALL ON FUNCTION public.rc1a_bootstrap_recruiter_owner_membership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_recruiter_workspace_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_recruiter_workspaces() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_recruiter_members(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invite_recruiter_member(uuid, text, public.recruiter_member_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_recruiter_member_invite(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_recruiter_member(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_recruiter_workspace_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_recruiter_workspaces() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_recruiter_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_recruiter_member(uuid, text, public.recruiter_member_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_recruiter_member_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_recruiter_member(uuid) TO authenticated;

COMMIT;
