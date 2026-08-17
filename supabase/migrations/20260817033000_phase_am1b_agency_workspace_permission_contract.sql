-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase AM-1B — Agency Workspace Permission Contract.
-- Scope: permission vocabulary + storage + server-side resolver/map/setter ONLY.
-- This migration grants NO operational access to any current Agency feature.
-- Packages, client requests, clients, delegations, work items, audit listing,
-- billing, entitlements and settlement authorization remain unchanged and are
-- cut over in a later phase. Driver Assistant permissions and Recruiter
-- workspace permissions are separate authorization planes and are untouched.
-- Agency workspace permission does NOT grant driver-account access; driver data
-- still requires an exact driver-approved delegation.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Agency workspace permission vocabulary
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE public.agency_workspace_permission AS ENUM (
    'packages_view',
    'packages_manage',
    'client_requests_view',
    'client_requests_manage',
    'clients_view',
    'delegations_view',
    'delegations_manage',
    'work_items_view_all',
    'work_items_manage',
    'audit_view',
    'team_view'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- B. Membership permission storage (fail-closed default, no role backfill)
-- ---------------------------------------------------------------------------
ALTER TABLE public.agency_members
  ADD COLUMN IF NOT EXISTS workspace_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  ALTER TABLE public.agency_members
    ADD CONSTRAINT agency_members_workspace_permissions_object_chk
    CHECK (jsonb_typeof(workspace_permissions) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- C. Current-user permission resolver — fail closed, auth.uid() scoped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_has_agency_permission(
  _agency_id uuid,
  _permission public.agency_workspace_permission
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND _agency_id IS NOT NULL
     AND _permission IS NOT NULL
     AND (
       -- Canonical Agency owner holds every workspace permission implicitly.
       EXISTS (
         SELECT 1
           FROM public.agency_profiles ap
          WHERE ap.id = _agency_id
            AND ap.owner_user_id = auth.uid()
       )
       OR EXISTS (
         -- Role is descriptive only: no role value grants anything here.
         SELECT 1
           FROM public.agency_members m
          WHERE m.agency_id = _agency_id
            AND m.member_user_id = auth.uid()
            AND m.status = 'active'
            AND jsonb_typeof(m.workspace_permissions) = 'object'
            AND (m.workspace_permissions -> (_permission::text)) = to_jsonb(true)
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- D. Complete resolved permission map for the calling user
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_agency_permissions(_agency_id uuid)
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
  _key public.agency_workspace_permission;
BEGIN
  IF _uid IS NULL OR _agency_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  _is_owner := EXISTS (
    SELECT 1 FROM public.agency_profiles ap
     WHERE ap.id = _agency_id
       AND ap.owner_user_id = _uid
  );

  IF NOT _is_owner AND NOT EXISTS (
    SELECT 1 FROM public.agency_members m
     WHERE m.agency_id = _agency_id
       AND m.member_user_id = _uid
       AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  FOR _key IN
    SELECT unnest(enum_range(NULL::public.agency_workspace_permission))
  LOOP
    _result := _result || jsonb_build_object(
      _key::text,
      CASE WHEN _is_owner THEN true
           ELSE public.current_user_has_agency_permission(_agency_id, _key)
      END
    );
  END LOOP;

  RETURN _result;
END;
$$;

-- ---------------------------------------------------------------------------
-- E. Canonical owner-only permission setter
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_agency_member_permissions(
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
  _row public.agency_members%ROWTYPE;
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

  -- Canonical Agency owner only. Stored permissions and descriptive roles
  -- never grant setter authority.
  SELECT m.* INTO _row
    FROM public.agency_members m
   WHERE m.id = _member_id
     AND EXISTS (
       SELECT 1 FROM public.agency_profiles ap
        WHERE ap.id = m.agency_id
          AND ap.owner_user_id = _uid
     )
     AND m.role <> 'agency_owner'
     AND m.status IN ('pending', 'active')
   FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  FOR _k, _v IN SELECT key, value FROM jsonb_each(_permissions)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM unnest(enum_range(NULL::public.agency_workspace_permission)) e
       WHERE e::text = _k
    ) THEN
      RAISE EXCEPTION 'Unknown permission key: %', _k USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(_v) <> 'boolean' THEN
      RAISE EXCEPTION 'Permission value must be boolean: %', _k USING ERRCODE = '22023';
    END IF;

    _canonical := _canonical || jsonb_build_object(_k, _v);
  END LOOP;

  _previous := COALESCE(_row.workspace_permissions, '{}'::jsonb);

  UPDATE public.agency_members m
     SET workspace_permissions = _canonical,
         updated_at = now()
   WHERE m.id = _row.id
   RETURNING * INTO _row;

  INSERT INTO public.agency_audit_log
    (actor_user_id, agency_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    _uid,
    _row.agency_id,
    _row.member_user_id,
    'agency_member_permissions_updated',
    'agency_member',
    _row.id,
    jsonb_build_object(
      'previous_permissions', _previous,
      'new_permissions', _canonical,
      'role', _row.role::text,
      'status', _row.status::text
    )
  );

  RETURN jsonb_build_object(
    'membership_id', _row.id,
    'agency_id', _row.agency_id,
    'role', _row.role::text,
    'status', _row.status::text,
    'workspace_permissions', _row.workspace_permissions,
    'updated_at', _row.updated_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- F. Function privileges (no RLS or table grant changes in AM-1B)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.current_user_has_agency_permission(uuid, public.agency_workspace_permission) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_agency_permissions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_agency_member_permissions(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_user_has_agency_permission(uuid, public.agency_workspace_permission) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_agency_permissions(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_agency_member_permissions(uuid, jsonb) TO authenticated, service_role;

COMMIT;