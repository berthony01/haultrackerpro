-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase RC-1B — Recruiter Staff Permission Resolver & Authorization Contract.
-- Scope: permission vocabulary + server-side resolver/setter ONLY.
-- This migration grants NO staff operational access to any current recruiter
-- feature. Opportunities, applications, referrals, reports, contracts,
-- settlements, billing, and profile authorization remain unchanged/owner-only
-- until later consumer phases. No Agency or Driver-Assistant object touched.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Permission vocabulary enum
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE public.recruiter_workspace_permission AS ENUM (
    'opportunities_view',
    'opportunities_create',
    'opportunities_edit',
    'opportunities_change_status',
    'opportunities_delete',
    'applications_view',
    'applications_manage_status',
    'applications_request_contact',
    'applications_manage_notes',
    'contracts_view',
    'contracts_manage',
    'referrals_view',
    'referrals_manage_status',
    'referral_terms_manage',
    'reports_view',
    'reports_export',
    'settlements_view',
    'settlements_prepare',
    'settlements_finalize',
    'team_view',
    'team_manage'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- B. Membership permission storage
-- ---------------------------------------------------------------------------
ALTER TABLE public.recruiter_members
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  ALTER TABLE public.recruiter_members
    ADD CONSTRAINT recruiter_members_permissions_object_check
    CHECK (jsonb_typeof(permissions) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- C. Audit event allowlist: preserve RC-1A events, add exactly one
-- ---------------------------------------------------------------------------
ALTER TABLE public.recruiter_member_audit_log
  DROP CONSTRAINT IF EXISTS recruiter_member_audit_log_event_type_check;

ALTER TABLE public.recruiter_member_audit_log
  ADD CONSTRAINT recruiter_member_audit_log_event_type_check
  CHECK (event_type IN (
    'owner_bootstrapped',
    'invite_created',
    'invite_refreshed',
    'invite_accepted',
    'member_revoked',
    'permissions_updated'
  ));

-- ---------------------------------------------------------------------------
-- D. Permission resolver — fail closed, auth.uid() scoped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_has_recruiter_permission(
  _recruiter_id uuid,
  _permission public.recruiter_workspace_permission
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND _recruiter_id IS NOT NULL
     AND _permission IS NOT NULL
     AND (
       -- Canonical workspace owner holds every permission implicitly.
       public.is_recruiter_workspace_owner(_recruiter_id)
       OR EXISTS (
         -- Role is descriptive only: no role shortcut grants anything.
         SELECT 1
           FROM public.recruiter_members m
          WHERE m.recruiter_id = _recruiter_id
            AND m.member_user_id = auth.uid()
            AND m.status = 'active'
            AND jsonb_typeof(m.permissions) = 'object'
            AND (m.permissions -> (_permission::text)) = to_jsonb(true)
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- E. Complete resolved permission map for the calling user
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_recruiter_permissions(_recruiter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_owner boolean;
  _result jsonb := '{}'::jsonb;
  _key public.recruiter_workspace_permission;
BEGIN
  IF _uid IS NULL OR _recruiter_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  _is_owner := public.is_recruiter_workspace_owner(_recruiter_id);

  IF NOT _is_owner AND NOT EXISTS (
    SELECT 1 FROM public.recruiter_members m
     WHERE m.recruiter_id = _recruiter_id
       AND m.member_user_id = _uid
       AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  FOR _key IN
    SELECT unnest(enum_range(NULL::public.recruiter_workspace_permission))
  LOOP
    _result := _result || jsonb_build_object(
      _key::text,
      CASE WHEN _is_owner THEN true
           ELSE public.current_user_has_recruiter_permission(_recruiter_id, _key)
      END
    );
  END LOOP;

  RETURN _result;
END;
$$;

-- ---------------------------------------------------------------------------
-- F. Owner-only permission setter
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_recruiter_member_permissions(
  _member_id uuid,
  _permissions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.recruiter_members%ROWTYPE;
  _previous jsonb;
  _canonical jsonb := '{}'::jsonb;
  _k text;
  _v jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF _member_id IS NULL OR _permissions IS NULL OR jsonb_typeof(_permissions) <> 'object' THEN
    RAISE EXCEPTION 'Invalid permissions payload' USING ERRCODE = '22023';
  END IF;

  -- Canonical workspace owner only. recruiter_admin / team_manage do NOT
  -- grant setter authority in RC-1B.
  SELECT m.* INTO _row
    FROM public.recruiter_members m
   WHERE m.id = _member_id
     AND public.is_recruiter_workspace_owner(m.recruiter_id)
     AND m.role <> 'recruiter_owner'
     AND m.status IN ('pending', 'active')
   FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  FOR _k, _v IN SELECT key, value FROM jsonb_each(_permissions)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM unnest(enum_range(NULL::public.recruiter_workspace_permission)) e
       WHERE e::text = _k
    ) THEN
      RAISE EXCEPTION 'Unknown permission key: %', _k USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(_v) <> 'boolean' THEN
      RAISE EXCEPTION 'Permission value must be boolean: %', _k USING ERRCODE = '22023';
    END IF;

    _canonical := _canonical || jsonb_build_object(_k, _v);
  END LOOP;

  _previous := _row.permissions;

  UPDATE public.recruiter_members m
     SET permissions = _canonical,
         updated_at = now()
   WHERE m.id = _row.id
   RETURNING * INTO _row;

  INSERT INTO public.recruiter_member_audit_log (
    recruiter_id, member_id, actor_user_id, event_type, target_user_id, invite_email, metadata
  ) VALUES (
    _row.recruiter_id, _row.id, _uid, 'permissions_updated', _row.member_user_id, _row.invite_email,
    jsonb_build_object(
      'previous_permissions', COALESCE(_previous, '{}'::jsonb),
      'new_permissions', _canonical,
      'role', _row.role::text
    )
  );

  RETURN jsonb_build_object(
    'membership_id', _row.id,
    'recruiter_id', _row.recruiter_id,
    'role', _row.role::text,
    'status', _row.status::text,
    'permissions', _row.permissions,
    'updated_at', _row.updated_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- G. Function privileges (no RLS or table grant changes in RC-1B)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.current_user_has_recruiter_permission(uuid, public.recruiter_workspace_permission) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_recruiter_permissions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_recruiter_member_permissions(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_user_has_recruiter_permission(uuid, public.recruiter_workspace_permission) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_recruiter_permissions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_recruiter_member_permissions(uuid, jsonb) TO authenticated;

COMMIT;
