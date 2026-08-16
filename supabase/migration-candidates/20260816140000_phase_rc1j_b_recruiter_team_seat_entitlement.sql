-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase RC-1J-B — Recruiter Team Seat Entitlement & Enforcement.
--
-- Scope: backend-only seat entitlement + enforcement. NO Team UI, NO
-- operationalization of team_view / team_manage, NO Stripe/product changes.
--
-- Locked product model (TOTAL seats, OWNER INCLUDED):
--   Recruiter Standard / no qualifying standalone paid recruiter billing -> 1
--   standalone starter  (active|trialing) -> 2   (owner + 1 staff)
--   standalone growth   (active|trialing) -> 5   (owner + 4 staff)
--   standalone fleet    (active|trialing) -> 15  (owner + 14 staff)
-- Agency-included recruiter premium grants ZERO staff seats (owner-only, 1).
-- A dual paid recruiter+agency conflict fails closed to owner-only (1).
--
-- Over-limit behavior: never auto-revoke. All NON-OWNER recruiter staff
-- permissions fail closed until the owner reduces usage or restores billing.
-- Owner authorization is unchanged. Owner revoke/cleanup stays available.
--
-- No tables, columns, enums, indexes, RLS policies or triggers are added.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Internal seat helpers (RC-1J-B: NOT directly executable by clients)
-- ---------------------------------------------------------------------------

-- Total allowed seats INCLUDING the owner seat.
-- Fail closed: a nonexistent recruiter workspace has 0 seats.
-- Seat capacity derives ONLY from standalone recruiter billing anchored to the
-- recruiter profile id AND that profile's owner user_id.
CREATE OR REPLACE FUNCTION public.recruiter_team_seat_limit(_recruiter_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner_id uuid;
  _plan     text;
BEGIN
  IF _recruiter_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT rp.user_id INTO _owner_id
    FROM public.recruiter_profiles rp
   WHERE rp.id = _recruiter_id;

  -- Nonexistent workspace: no capacity at all.
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Dual paid recruiter + agency business entitlement conflict fails closed
  -- to owner-only capacity, even when a standalone paid row exists.
  IF public.effective_recruiter_tier(_recruiter_id) = 'conflict' THEN
    RETURN 1;
  END IF;

  -- Standalone recruiter billing ONLY. Agency-included premium is deliberately
  -- not consulted here, so agency-only workspaces resolve to owner-only.
  SELECT b.plan INTO _plan
    FROM public.recruiter_billing_profiles b
   WHERE b.recruiter_id = _recruiter_id
     AND b.user_id = _owner_id
     AND b.plan IN ('starter', 'growth', 'fleet')
     AND b.status IN ('active', 'trialing')  -- trial-allowlist: Stripe status literal
   ORDER BY CASE b.plan
              WHEN 'fleet'   THEN 3
              WHEN 'growth'  THEN 2
              WHEN 'starter' THEN 1
              ELSE 0
            END DESC
   LIMIT 1;

  RETURN CASE _plan
    WHEN 'starter' THEN 2
    WHEN 'growth'  THEN 5
    WHEN 'fleet'   THEN 15
    ELSE 1  -- free_standard / agency-only / past_due / canceled / unknown
  END;
END;
$$;

-- Occupied seats = reserved owner seat (1) + non-owner ACTIVE memberships
-- + non-owner PENDING invitations that have NOT expired.
-- Revoked members and expired pending invitations never occupy a seat.
-- The owner seat is reserved as 1 even if the owner membership row is missing.
CREATE OR REPLACE FUNCTION public.recruiter_team_occupied_seats(_recruiter_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _used integer;
BEGIN
  IF _recruiter_id IS NULL THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.recruiter_profiles rp WHERE rp.id = _recruiter_id) THEN
    RETURN 0;
  END IF;

  SELECT count(*)::integer INTO _used
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

  -- 1 = reserved owner seat.
  RETURN 1 + COALESCE(_used, 0);
END;
$$;

-- Fail closed: nonexistent workspace is never within limit.
CREATE OR REPLACE FUNCTION public.recruiter_team_workspace_within_limit(_recruiter_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _limit    integer;
  _occupied integer;
BEGIN
  IF _recruiter_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.recruiter_profiles rp WHERE rp.id = _recruiter_id) THEN
    RETURN false;
  END IF;

  _limit    := public.recruiter_team_seat_limit(_recruiter_id);
  _occupied := public.recruiter_team_occupied_seats(_recruiter_id);

  IF _limit IS NULL OR _limit < 1 THEN
    RETURN false;
  END IF;

  RETURN _occupied <= _limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- B. Central staff authorization — the single enforcement point for
--    RC-1D … RC-1I staff operations. Owner semantics unchanged.
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
       -- RC-1J-B does NOT change owner authorization in any way.
       public.is_recruiter_workspace_owner(_recruiter_id)
       OR (
         -- RC-1J-B: non-owner staff additionally require the workspace to be
         -- within its current team seat limit. Over limit => fail closed.
         public.recruiter_team_workspace_within_limit(_recruiter_id)
         AND EXISTS (
           -- Role is descriptive only: no role shortcut grants anything.
           SELECT 1
             FROM public.recruiter_members m
            WHERE m.recruiter_id = _recruiter_id
              AND m.member_user_id = auth.uid()
              AND m.status = 'active'
              AND jsonb_typeof(m.permissions) = 'object'
              AND (m.permissions -> (_permission::text)) = to_jsonb(true)
         )
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- C. Invite — OWNER ONLY (unchanged), now seat-aware.
--    Lock order: recruiter workspace/profile row FIRST, membership row SECOND.
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

  -- RC-1A: canonical recruiter owner only. RC-1J-B does not widen this.
  IF NOT public.is_recruiter_workspace_owner(_recruiter_id) THEN
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
    _occupied := public.recruiter_team_occupied_seats(_recruiter_id);

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
-- D. Accept — unchanged invited-email/token/expiry semantics, now over-limit
--    aware. Lock order: workspace/profile row FIRST, membership row SECOND.
-- ---------------------------------------------------------------------------
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
  _recruiter_id uuid;
  _lock_id uuid;
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

  _hash := encode(extensions.digest(btrim(_token), 'sha256'), 'hex');

  -- Resolve the invitation's workspace WITHOUT locking the membership row,
  -- so the workspace lock can always be taken first.
  SELECT m.recruiter_id INTO _recruiter_id
    FROM public.recruiter_members m
   WHERE m.invite_token_hash = _hash
     AND m.status = 'pending'
     AND m.invite_expires_at IS NOT NULL
     AND m.invite_expires_at > now()
     AND lower(m.invite_email::text) = _email;

  IF _recruiter_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '22023';
  END IF;

  -- RC-1J-B CONCURRENCY: lock the recruiter workspace row FIRST.
  SELECT rp.id INTO _lock_id
    FROM public.recruiter_profiles rp
   WHERE rp.id = _recruiter_id
   FOR UPDATE;

  IF _lock_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '22023';
  END IF;

  -- Re-validate and lock the membership row SECOND, under the workspace lock.
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

  -- An unexpired pending invitation already occupies its seat, so acceptance
  -- adds none. It must still fail when the workspace is currently OVER its
  -- allowed limit (e.g. downgrade or cancellation after the invitation).
  -- No other member is ever auto-revoked to make room.
  IF NOT public.recruiter_team_workspace_within_limit(_row.recruiter_id) THEN
    RAISE EXCEPTION 'Team seat limit reached' USING ERRCODE = '22023';
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

-- ---------------------------------------------------------------------------
-- E. Function privileges
-- ---------------------------------------------------------------------------

-- New seat helpers are INTERNAL in RC-1J-B. No public seat-status RPC yet.
-- Existing SECURITY DEFINER functions still call them as the function owner.
REVOKE ALL ON FUNCTION public.recruiter_team_seat_limit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recruiter_team_occupied_seats(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recruiter_team_workspace_within_limit(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.recruiter_team_seat_limit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recruiter_team_occupied_seats(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recruiter_team_workspace_within_limit(uuid) TO service_role;

-- Existing public surfaces keep exactly their prior grants.
REVOKE ALL ON FUNCTION public.current_user_has_recruiter_permission(uuid, public.recruiter_workspace_permission) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invite_recruiter_member(uuid, text, public.recruiter_member_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_recruiter_member_invite(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_user_has_recruiter_permission(uuid, public.recruiter_workspace_permission) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_recruiter_member(uuid, text, public.recruiter_member_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_recruiter_member_invite(text) TO authenticated;

COMMIT;
