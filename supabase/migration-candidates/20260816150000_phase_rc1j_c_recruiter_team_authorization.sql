-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase RC-1J-C — Recruiter Team Authorization.
--
-- Scope: operationalize ONLY `team_view` and `team_manage` on top of the live
-- RC-1J-B seat enforcement. Backend authorization only. NO Team UI, NO routes,
-- NO Stripe/Agency/RLS/table/column/enum/index/trigger changes.
--
-- Locked authorization model:
--   1. Canonical recruiter owner semantics unchanged; the owner is never
--      restricted by staff seat over-limit permission shutdown.
--   2. Non-owner team reader requires exact team_view = true.
--   3. Non-owner team manager requires BOTH team_view = true AND
--      team_manage = true (team_manage does NOT imply team_view).
--   4. RC-1J-B central resolution is seat-gated, so an over-limit non-owner
--      manager automatically loses delegated team authority. Owner cleanup /
--      revoke / permission management remains available while over limit.
--   5. Roles are DESCRIPTIVE ONLY. recruiter_admin grants no implicit rights.
--   6. A staff manager may never mutate their OWN membership row.
--   7. A staff manager may never target the recruiter_owner membership.
--   8. A staff manager may flip a target permission false/missing -> true ONLY
--      if the acting manager currently holds that exact permission. Preserving
--      an already-true permission the manager lacks is allowed; turning it
--      false is allowed. The owner has no subset restriction.
--
-- FROZEN — deliberately NOT redefined here:
--   current_user_has_recruiter_permission, get_my_recruiter_permissions,
--   list_recruiter_members, accept_recruiter_member_invite,
--   is_recruiter_workspace_owner, is_recruiter_workspace_member,
--   recruiter_team_seat_limit, recruiter_team_occupied_seats,
--   recruiter_team_workspace_within_limit, effective_recruiter_tier,
--   and every RC-1D … RC-1I operational helper.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Audit event allowlist: preserve the exact prior six, add exactly one.
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
    'permissions_updated',
    'role_updated'
  ));

-- ---------------------------------------------------------------------------
-- B. Team action helper — the single team authorization entry point.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_team_action(
  _recruiter_id uuid,
  _permission public.recruiter_workspace_permission
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR _recruiter_id IS NULL OR _permission IS NULL THEN
    RETURN false;
  END IF;

  -- Only the two team permissions are ever accepted here.
  IF _permission NOT IN ('team_view', 'team_manage') THEN
    RETURN false;
  END IF;

  -- Canonical owner: implicit true, never seat-gated.
  IF public.is_recruiter_workspace_owner(_recruiter_id) THEN
    RETURN true;
  END IF;

  -- Non-owner: exact permission booleans through the RC-1J-B seat-gated
  -- central resolver. No role shortcut. No billing/Agency logic here.
  IF _permission = 'team_view' THEN
    RETURN public.current_user_has_recruiter_permission(_recruiter_id, 'team_view');
  END IF;

  -- team_manage requires BOTH keys.
  RETURN public.current_user_has_recruiter_permission(_recruiter_id, 'team_view')
     AND public.current_user_has_recruiter_permission(_recruiter_id, 'team_manage');
END;
$$;

-- ---------------------------------------------------------------------------
-- C. Safe team read RPC (legacy list_recruiter_members is NOT redefined).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_recruiter_team_members_safe(_recruiter_id uuid)
RETURNS TABLE (
  membership_id uuid,
  member_user_id uuid,
  invite_email text,
  member_role public.recruiter_member_role,
  member_status public.recruiter_member_status,
  permissions jsonb,
  invited_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invite_expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR _recruiter_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.current_user_can_recruiter_team_action(_recruiter_id, 'team_view') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Locked safe projection: no invite_token_hash, no revoked_by_user_id,
  -- no auth.users join, no billing/profile private data, no audit metadata.
  RETURN QUERY
    SELECT m.id,
           m.member_user_id,
           m.invite_email::text,
           m.role,
           m.status,
           COALESCE(m.permissions, '{}'::jsonb),
           m.invited_at,
           m.accepted_at,
           m.revoked_at,
           m.invite_expires_at
      FROM public.recruiter_members m
     WHERE m.recruiter_id = _recruiter_id
     ORDER BY (m.role = 'recruiter_owner') DESC,
              (m.status = 'active') DESC,
              m.invited_at ASC NULLS LAST,
              m.id ASC;
END;
$$;

-- ---------------------------------------------------------------------------
-- D. Invite — RC-1J-B behavior preserved EXACTLY; authorization widened to
--    owner OR delegated team_manage.
-- ---------------------------------------------------------------------------
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
  _is_owner boolean;
  _actor_email text;
  _norm text;
  _owner_email text;
  _raw_token text;
  _hash text;
  _expires timestamptz;
  _lock_id uuid;
  _limit integer;
  _occupied integer;
  _refresh_unexpired boolean := false;
  _row public.recruiter_members%ROWTYPE;
  _existing public.recruiter_members%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  _is_owner := public.is_recruiter_workspace_owner(_recruiter_id);

  -- RC-1J-C: owner OR delegated team manager (seat-gated by RC-1J-B).
  IF NOT _is_owner
     AND NOT public.current_user_can_recruiter_team_action(_recruiter_id, 'team_manage') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _role IS NULL OR _role = 'recruiter_owner' THEN
    RAISE EXCEPTION 'Invalid role' USING ERRCODE = '22023';
  END IF;

  _norm := lower(btrim(COALESCE(_email, '')));
  IF _norm='' OR _norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
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

  -- RC-1J-C: a staff manager may never invite their own authenticated email.
  IF NOT _is_owner THEN
    SELECT lower(btrim(u.email::text)) INTO _actor_email
      FROM auth.users u WHERE u.id = _uid;

    IF _actor_email IS NOT NULL AND _norm = _actor_email THEN
      RAISE EXCEPTION 'Invalid email' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- RC-1J-B CONCURRENCY: serialize seat allocation per recruiter workspace by
  -- locking the recruiter profile row BEFORE touching / counting memberships.
  -- Consistent lock order (workspace first, membership second) prevents
  -- deadlocks and prevents two concurrent invites from over-allocating seats.
  SELECT rp.id INTO _lock_id
    FROM public.recruiter_profiles rp
   WHERE rp.id = _recruiter_id
   FOR UPDATE;

  IF _lock_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
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

  -- An UNEXPIRED pending invite already occupies its seat: refreshing it does
  -- not consume an additional seat and stays allowed at exactly the limit.
  -- An EXPIRED pending invite has released its seat, so refreshing it would
  -- consume a seat again and must re-check capacity.
  _refresh_unexpired := FOUND
    AND _existing.status = 'pending'
    AND _existing.invite_expires_at IS NOT NULL
    AND _existing.invite_expires_at > now();

  IF NOT _refresh_unexpired THEN
    _limit    := public.recruiter_team_seat_limit(_recruiter_id);

    -- RC-1J-B CONCURRENCY CORRECTION: recount occupied seats with a DIRECT
    -- statement inside this VOLATILE function. A STABLE helper would reuse the
    -- snapshot taken before this transaction waited on the FOR UPDATE lock and
    -- could therefore miss a concurrently committed invite.
    SELECT 1 + count(*)::integer INTO _occupied
      FROM public.recruiter_members m
     WHERE m.recruiter_id = _recruiter_id
       AND m.role <> 'recruiter_owner'
       AND (
         m.status = 'active'
         OR (
           m.status = 'pending'
           AND m.invite_expires_at IS NOT NULL
           AND m.invite_expires_at > now()
         )
       );

    IF _limit IS NULL OR _limit < 1 OR _occupied >= _limit THEN
      -- Stable generic capacity exception: never leaks billing internals.
      RAISE EXCEPTION 'Team seat limit reached' USING ERRCODE = '22023';
    END IF;
  END IF;

  _raw_token := encode(extensions.gen_random_bytes(24), 'hex');
  _hash := encode(extensions.digest(_raw_token, 'sha256'), 'hex');
  _expires := now() + interval '7 days';

  IF _existing.id IS NOT NULL THEN
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
      _role, 'pending'::public.recruiter_member_status,
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

-- ---------------------------------------------------------------------------
-- E. Revoke — owner OR delegated team_manage. No auto-revoke behavior added.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_recruiter_member(_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.recruiter_members%ROWTYPE;
  _is_owner boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Target must be a non-owner pending/active membership in a workspace the
  -- caller may manage: canonical owner, or delegated team manager.
  SELECT m.* INTO _row
    FROM public.recruiter_members m
   WHERE m.id = _member_id
     AND (
       public.is_recruiter_workspace_owner(m.recruiter_id)
       OR public.current_user_can_recruiter_team_action(m.recruiter_id, 'team_manage')
     )
     AND m.role <> 'recruiter_owner'
     AND m.status IN ('pending', 'active')
   FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  _is_owner := public.is_recruiter_workspace_owner(_row.recruiter_id);

  -- A staff manager may never revoke their own membership.
  IF NOT _is_owner AND _row.member_user_id IS NOT DISTINCT FROM _uid THEN
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
-- F. Permissions setter — owner OR delegated team_manage, plus the staff
--    manager subset restriction on newly granted permissions.
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
  _is_owner boolean;
  _k text;
  _v jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF _member_id IS NULL OR _permissions IS NULL OR jsonb_typeof(_permissions) <> 'object' THEN
    RAISE EXCEPTION 'Invalid permissions payload' USING ERRCODE = '22023';
  END IF;

  -- Canonical workspace owner, or a delegated team manager. Role labels
  -- (recruiter_admin) still grant NO setter authority by themselves.
  SELECT m.* INTO _row
    FROM public.recruiter_members m
   WHERE m.id = _member_id
     AND (
       public.is_recruiter_workspace_owner(m.recruiter_id)
       OR public.current_user_can_recruiter_team_action(m.recruiter_id, 'team_manage')
     )
     AND m.role <> 'recruiter_owner'
     AND m.status IN ('pending', 'active')
   FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  _is_owner := public.is_recruiter_workspace_owner(_row.recruiter_id);

  -- A staff manager may never edit their own permissions.
  IF NOT _is_owner AND _row.member_user_id IS NOT DISTINCT FROM _uid THEN
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

  -- RC-1J-C subset restriction — STAFF MANAGER ONLY. Escalation beyond the
  -- acting manager's own authority is impossible: a permission may only move
  -- false/missing -> true when the manager currently holds that exact
  -- permission. Preserving an already-true permission the manager lacks is
  -- allowed, and turning any permission false is always allowed. The owner
  -- bypasses this restriction entirely.
  IF NOT _is_owner THEN
    FOR _k, _v IN SELECT key, value FROM jsonb_each(_canonical)
    LOOP
      IF _v = to_jsonb(true)
         AND COALESCE(_previous -> _k, 'null'::jsonb) <> to_jsonb(true) THEN
        IF NOT public.current_user_has_recruiter_permission(
                 _row.recruiter_id,
                 _k::public.recruiter_workspace_permission
               ) THEN
          -- Stable generic authorization error: no billing/seat internals.
          RAISE EXCEPTION 'Cannot grant permission you do not hold' USING ERRCODE = '42501';
        END IF;
      END IF;
    END LOOP;
  END IF;

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
-- G. NEW role setter — descriptive label only, NEVER alters permissions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_recruiter_member_role(
  _member_id uuid,
  _role public.recruiter_member_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.recruiter_members%ROWTYPE;
  _previous_role text;
  _is_owner boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF _member_id IS NULL OR _role IS NULL OR _role = 'recruiter_owner' THEN
    RAISE EXCEPTION 'Invalid role' USING ERRCODE = '22023';
  END IF;

  SELECT m.* INTO _row
    FROM public.recruiter_members m
   WHERE m.id = _member_id
     AND (
       public.is_recruiter_workspace_owner(m.recruiter_id)
       OR public.current_user_can_recruiter_team_action(m.recruiter_id, 'team_manage')
     )
     AND m.role <> 'recruiter_owner'
     AND m.status IN ('pending', 'active')
   FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  _is_owner := public.is_recruiter_workspace_owner(_row.recruiter_id);

  -- A staff manager may never change their own role.
  IF NOT _is_owner AND _row.member_user_id IS NOT DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  _previous_role := _row.role::text;

  -- Role is a descriptive label: permissions are deliberately untouched.
  UPDATE public.recruiter_members m
     SET role = _role,
         updated_at = now()
   WHERE m.id = _row.id
   RETURNING * INTO _row;

  INSERT INTO public.recruiter_member_audit_log (
    recruiter_id, member_id, actor_user_id, event_type, target_user_id, invite_email, metadata
  ) VALUES (
    _row.recruiter_id, _row.id, _uid, 'role_updated', _row.member_user_id, _row.invite_email,
    jsonb_build_object(
      'previous_role', _previous_role,
      'new_role', _row.role::text
    )
  );

  RETURN jsonb_build_object(
    'membership_id', _row.id,
    'recruiter_id', _row.recruiter_id,
    'role', _row.role::text,
    'status', _row.status::text,
    'updated_at', _row.updated_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- H. Function privileges. No RLS policy or table grant changes in RC-1J-C.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.current_user_can_recruiter_team_action(uuid, public.recruiter_workspace_permission) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_recruiter_team_members_safe(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_recruiter_member_role(uuid, public.recruiter_member_role) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_user_can_recruiter_team_action(uuid, public.recruiter_workspace_permission) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_recruiter_team_members_safe(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_recruiter_member_role(uuid, public.recruiter_member_role) TO authenticated, service_role;

-- Existing surfaces keep exactly their prior exposure.
REVOKE ALL ON FUNCTION public.invite_recruiter_member(uuid, text, public.recruiter_member_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_recruiter_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_recruiter_member_permissions(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.invite_recruiter_member(uuid, text, public.recruiter_member_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_recruiter_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_recruiter_member_permissions(uuid, jsonb) TO authenticated;

COMMIT;
