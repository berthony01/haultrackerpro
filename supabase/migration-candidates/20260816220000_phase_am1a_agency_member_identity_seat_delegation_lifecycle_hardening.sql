-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase AM-1A — Agency Member Identity, Seat & Delegation Lifecycle Hardening.
--
-- Scope: backend-only. NO Agency granular permission system (that is AM-1B),
-- NO Stripe/product/plan/price/limit changes, NO frontend, NO RLS broadening.
--
-- Locked product model (unchanged here):
--   member limits INCLUDE the owner seat and come exclusively from
--   public.get_effective_agency_limits(_agency_id).member_limit
--   (Starter=2, Team=5, Growth=15 by default, entitlement overrides win).
--   General Agency usable entitlement statuses stay:
--     manual_beta, active, trialing, past_due
--   cancelled / missing entitlement row stay unusable.
--   Settlement authorization stays STRICTER (manual_beta, active, trialing).
--
-- What this phase adds:
--   A. invite expiry column + defensive identity invariants on agency_members
--   B. canonical seat / paid-operational-authority helpers (service-only) plus
--      one safe current-user delegation wrapper
--   C. seat enforcement that ignores EXPIRED pending invites, plus a
--      fail-closed over-seat guard for active NON-OWNER members
--   D. member revocation that cascades to delegations, agency-originated
--      driver_assistants rows, and stale assignment references
--   E. continuous agency-delegation validity for driver data access
--   F. target/assigned member lifecycle validation on positive operations
--   G. settlement composition (stricter statuses preserved)
--
-- Direct (non-agency) Driver Assistant behavior (agency_delegation_id IS NULL)
-- is preserved byte-semantically: it still requires driver_has_active_pro.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Agency member identity / invite schema hardening
-- ---------------------------------------------------------------------------

ALTER TABLE public.agency_members
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz NULL;

-- Deterministic replay-safe backfill. Pending rows only; active/revoked rows
-- are never touched. Production currently has zero pending rows.
UPDATE public.agency_members
   SET invite_expires_at = COALESCE(invite_expires_at, invited_at + interval '7 days')
 WHERE status = 'pending'
   AND invite_expires_at IS NULL;

-- Defensive invariants (deterministic names, idempotent creation).
CREATE UNIQUE INDEX IF NOT EXISTS agency_members_active_user_uq
  ON public.agency_members (agency_id, member_user_id)
  WHERE status = 'active' AND member_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agency_members_active_owner_uq
  ON public.agency_members (agency_id)
  WHERE status = 'active' AND role = 'agency_owner';

CREATE UNIQUE INDEX IF NOT EXISTS agency_members_invite_token_hash_uq
  ON public.agency_members (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agency_members_active_identity_chk'
       AND conrelid = 'public.agency_members'::regclass
  ) THEN
    ALTER TABLE public.agency_members
      ADD CONSTRAINT agency_members_active_identity_chk
      CHECK (status <> 'active' OR member_user_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agency_members_pending_invite_shape_chk'
       AND conrelid = 'public.agency_members'::regclass
  ) THEN
    ALTER TABLE public.agency_members
      ADD CONSTRAINT agency_members_pending_invite_shape_chk
      CHECK (
        status <> 'pending'
        OR (
          member_user_id IS NULL
          AND invite_token_hash IS NOT NULL
          AND invite_expires_at IS NOT NULL
          AND role <> 'agency_owner'
        )
      );
  END IF;
END $$;

-- agency_members_email_unique, agency_members_member_idx and the primary key
-- are intentionally preserved unchanged.

-- ---------------------------------------------------------------------------
-- B. Canonical seat / operational helpers
--    Internal arbitrary-user helpers are SERVICE-ONLY (PUBLIC revoked).
-- ---------------------------------------------------------------------------

-- Occupied seats = active memberships (owner included) + UNEXPIRED pending
-- invites. Expired pending and revoked rows never occupy a seat.
CREATE OR REPLACE FUNCTION public.agency_team_occupied_seats(_agency_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _agency_id IS NULL THEN 0
    ELSE (
      SELECT count(*)::integer
        FROM public.agency_members am
       WHERE am.agency_id = _agency_id
         AND (
           am.status = 'active'
           OR (am.status = 'pending' AND am.invite_expires_at IS NOT NULL AND am.invite_expires_at > now())
         )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.agency_team_occupied_seats(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agency_team_occupied_seats(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agency_team_occupied_seats(uuid) TO service_role;

-- Effective member limit is sourced ONLY from get_effective_agency_limits.
-- NULL member_limit means unlimited.
CREATE OR REPLACE FUNCTION public.agency_team_workspace_within_limit(_agency_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lim record;
  used integer;
BEGIN
  IF _agency_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO lim FROM public.get_effective_agency_limits(_agency_id);
  IF NOT FOUND THEN RETURN false; END IF;
  IF lim.member_limit IS NULL THEN RETURN true; END IF;
  used := public.agency_team_occupied_seats(_agency_id);
  RETURN used <= lim.member_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.agency_team_workspace_within_limit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agency_team_workspace_within_limit(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agency_team_workspace_within_limit(uuid) TO service_role;

-- Fail-closed paid operational authority for one agency member.
-- Requires: active agency profile, active membership, and a REAL agency
-- entitlement row in a generally usable status. The canonical owner is exempt
-- ONLY from the over-seat check — never from profile/billing validity.
CREATE OR REPLACE FUNCTION public._agency_member_paid_operational_authority(_agency_id uuid, _uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_owner boolean;
  _ent_ok   boolean;
BEGIN
  IF _agency_id IS NULL OR _uid IS NULL THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.agency_profiles ap
     WHERE ap.id = _agency_id AND ap.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.agency_members am
     WHERE am.agency_id = _agency_id
       AND am.member_user_id = _uid
       AND am.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.agency_entitlements ae
     WHERE ae.agency_id = _agency_id
       AND ae.status IN ('manual_beta', 'active', 'trialing', 'past_due')
  ) INTO _ent_ok;
  IF NOT _ent_ok THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.agency_profiles ap
     WHERE ap.id = _agency_id AND ap.owner_user_id = _uid
  ) INTO _is_owner;

  IF _is_owner THEN
    RETURN true;
  END IF;

  RETURN public.agency_team_workspace_within_limit(_agency_id);
END;
$$;

REVOKE ALL ON FUNCTION public._agency_member_paid_operational_authority(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._agency_member_paid_operational_authority(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._agency_member_paid_operational_authority(uuid, uuid) TO service_role;

-- Continuous validity of ONE exact agency delegation for ONE exact pair.
CREATE OR REPLACE FUNCTION public._agency_delegation_operationally_active(_delegation_id uuid, _member_user_id uuid, _driver_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _delegation_id IS NOT NULL
     AND _member_user_id IS NOT NULL
     AND _driver_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.agency_delegation_requests dr
        WHERE dr.id = _delegation_id
          AND dr.status = 'approved'
          AND dr.member_user_id = _member_user_id
          AND dr.driver_user_id = _driver_user_id
          AND public._agency_member_paid_operational_authority(dr.agency_id, dr.member_user_id)
     );
$$;

REVOKE ALL ON FUNCTION public._agency_delegation_operationally_active(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._agency_delegation_operationally_active(uuid, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._agency_delegation_operationally_active(uuid, uuid, uuid) TO service_role;

-- Safe current-user-only wrapper. Never exposes arbitrary-user results.
CREATE OR REPLACE FUNCTION public.current_user_can_use_agency_delegation(_delegation_id uuid, _driver_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public._agency_delegation_operationally_active(_delegation_id, auth.uid(), _driver_user_id);
$$;

REVOKE ALL ON FUNCTION public.current_user_can_use_agency_delegation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_use_agency_delegation(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_use_agency_delegation(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- C. Seat enforcement / concurrency
-- ---------------------------------------------------------------------------

-- Changes vs prior definition:
--   * invite_member counts active + UNEXPIRED pending (expired invites free).
--   * NEW fail-closed over-seat guard: an ACTIVE NON-OWNER member of the same
--     agency cannot perform positive actions while the workspace is over its
--     effective member limit. The canonical owner is exempt from this guard
--     (cleanup authority must survive an over-limit workspace) but NOT from
--     the pre-existing cancelled-billing guard.
-- Action names, plan labels, package/client limits are unchanged.
CREATE OR REPLACE FUNCTION public.assert_agency_limit(_agency_id uuid, _action text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lim record;
  used integer;
  plan_label text;
  _uid uuid := auth.uid();
  _is_owner boolean := false;
BEGIN
  SELECT * INTO lim FROM public.get_effective_agency_limits(_agency_id);
  plan_label := public._agency_plan_label(lim.plan_key);

  -- Phase 1S-A2: hard block before counting when billing is not active.
  -- Covers never-started placeholders and previously cancelled plans with
  -- the same truthful copy. Grandfathered manual_beta rows are unaffected.
  IF lim.status = 'cancelled' THEN
    RAISE EXCEPTION
      'Agency billing is not active. Start or restart your % plan from the Plan & Limits card to continue this action.',
      plan_label USING ERRCODE = 'P0001';
  END IF;

  -- Phase AM-1A: over-seat fail-closed guard for active NON-OWNER members.
  IF _uid IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.agency_profiles ap
       WHERE ap.id = _agency_id AND ap.owner_user_id = _uid
    ) INTO _is_owner;

    IF NOT _is_owner
       AND EXISTS (
         SELECT 1 FROM public.agency_members am
          WHERE am.agency_id = _agency_id
            AND am.member_user_id = _uid
            AND am.status = 'active'
       )
       AND NOT public.agency_team_workspace_within_limit(_agency_id)
    THEN
      RAISE EXCEPTION
        'This agency workspace is over its % plan member limit. The agency owner must reduce members or upgrade before team members can continue this action.',
        plan_label USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF _action = 'create_service_package' THEN
    IF lim.service_package_limit IS NULL THEN RETURN; END IF;
    SELECT count(*) INTO used FROM public.agency_service_packages
      WHERE agency_id = _agency_id AND is_active = true;
    IF used >= lim.service_package_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % active service packages. Upgrade your agency plan to add more.',
        plan_label, lim.service_package_limit USING ERRCODE = 'P0001';
    END IF;

  ELSIF _action = 'invite_member' THEN
    IF lim.member_limit IS NULL THEN RETURN; END IF;
    SELECT count(*) INTO used FROM public.agency_members
      WHERE agency_id = _agency_id
        AND (
          status = 'active'
          OR (status = 'pending' AND invite_expires_at IS NOT NULL AND invite_expires_at > now())
        );
    IF used >= lim.member_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % agency members. Upgrade your agency plan to invite more.',
        plan_label, lim.member_limit USING ERRCODE = 'P0001';
    END IF;

  ELSIF _action = 'activate_client' THEN
    IF lim.active_client_limit IS NULL THEN RETURN; END IF;
    SELECT count(DISTINCT d.driver_user_id) INTO used FROM public.agency_delegation_requests d
      WHERE d.agency_id = _agency_id AND d.status = 'approved';
    IF used >= lim.active_client_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % active driver clients. Upgrade your agency plan to take on more.',
        plan_label, lim.active_client_limit USING ERRCODE = 'P0001';
    END IF;
  -- Phase 1S-A2-R1/R2: non-numeric paid Agency Workspace operations. These
  -- do not consume a countable seat/package/client slot, so for any
  -- non-cancelled entitlement they simply succeed. The cancelled block above
  -- already rejected them for unpaid or missing-row agencies.
  ELSIF _action IN (
    'set_private_request_link',
    'submit_client_request',
    'progress_client_request',
    'create_delegation_request',
    'create_work_item',
    'accept_member_invite'
  ) THEN
    RETURN;

  ELSE
    RAISE EXCEPTION 'Unknown agency limit action: %', _action USING ERRCODE = '22023';
  END IF;
END $$;

-- Owner-only invitation with agency-row lock ordering, a DIRECT post-lock seat
-- recount (never the STABLE helper for the concurrency-sensitive decision),
-- and a 7-day invite expiry.
CREATE OR REPLACE FUNCTION public.invite_agency_member(_agency_id uuid, _email text, _role agency_member_role DEFAULT 'agency_member'::agency_member_role)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _en text := lower(btrim(coalesce(_email,'')));
  _t text;
  _h text;
  _row public.agency_members;
  _existing public.agency_members;
  _locked uuid;
  _limit integer;
  _used integer;
  _expiry timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agency_profiles ap WHERE ap.id=_agency_id AND ap.owner_user_id=_uid) THEN
    RAISE EXCEPTION 'Not your agency' USING ERRCODE='42501';
  END IF;
  IF _role='agency_owner' THEN RAISE EXCEPTION 'Cannot assign owner role' USING ERRCODE='22023'; END IF;
  IF _en='' OR _en !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE='22023';
  END IF;

  -- Lock the agency row FIRST so concurrent invites/accepts serialize.
  SELECT ap.id INTO _locked FROM public.agency_profiles ap
   WHERE ap.id = _agency_id FOR UPDATE;
  IF _locked IS NULL THEN RAISE EXCEPTION 'Not your agency' USING ERRCODE='42501'; END IF;

  SELECT * INTO _existing FROM public.agency_members am
   WHERE am.agency_id = _agency_id
     AND lower(am.invite_email) = _en
     AND am.status IN ('pending','active')
   LIMIT 1;

  -- An already ACTIVE membership is never re-tokenized or role-rewritten.
  IF FOUND AND _existing.status = 'active' THEN
    RAISE EXCEPTION 'That person is already an active member of this agency' USING ERRCODE='22023';
  END IF;

  -- Billing validity (cancelled billing blocks invites for everyone).
  PERFORM public.assert_agency_limit(_agency_id, 'create_work_item');

  SELECT l.member_limit INTO _limit FROM public.get_effective_agency_limits(_agency_id) l;

  -- DIRECT post-lock recount inside this VOLATILE function.
  SELECT count(*)::integer INTO _used FROM public.agency_members am
   WHERE am.agency_id = _agency_id
     AND (
       am.status = 'active'
       OR (am.status = 'pending' AND am.invite_expires_at IS NOT NULL AND am.invite_expires_at > now())
     );

  _expiry := now() + interval '7 days';

  IF _existing.id IS NOT NULL THEN
    -- Pending refresh path.
    IF _existing.invite_expires_at IS NOT NULL AND _existing.invite_expires_at > now() THEN
      -- Unexpired pending invite already occupies its seat: refreshing adds
      -- no seat, but must still fail if the workspace is already over limit.
      IF _limit IS NOT NULL AND _used > _limit THEN
        RAISE EXCEPTION 'Your % plan allows up to % agency members. Upgrade your agency plan to invite more.',
          public._agency_plan_label((SELECT plan_key FROM public.get_effective_agency_limits(_agency_id))), _limit
          USING ERRCODE='P0001';
      END IF;
    ELSE
      -- Expired pending invite freed its seat: refreshing consumes one again.
      IF _limit IS NOT NULL AND _used >= _limit THEN
        RAISE EXCEPTION 'Your % plan allows up to % agency members. Upgrade your agency plan to invite more.',
          public._agency_plan_label((SELECT plan_key FROM public.get_effective_agency_limits(_agency_id))), _limit
          USING ERRCODE='P0001';
      END IF;
    END IF;
  ELSE
    -- Brand-new or previously revoked email: must have an available seat.
    IF _limit IS NOT NULL AND _used >= _limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % agency members. Upgrade your agency plan to invite more.',
        public._agency_plan_label((SELECT plan_key FROM public.get_effective_agency_limits(_agency_id))), _limit
        USING ERRCODE='P0001';
    END IF;
  END IF;

  -- 24-byte cryptographic token; only the SHA-256 hash is ever stored.
  _t := encode(gen_random_bytes(24),'hex');
  _h := encode(digest(_t,'sha256'),'hex');

  INSERT INTO public.agency_members(agency_id,invite_email,invite_token_hash,role,status,invite_expires_at)
  VALUES (_agency_id,_en,_h,_role,'pending',_expiry)
  ON CONFLICT (agency_id, lower(invite_email)) WHERE status IN ('pending','active')
  DO UPDATE SET role=EXCLUDED.role, invite_token_hash=EXCLUDED.invite_token_hash,
                invited_at=now(), invite_expires_at=EXCLUDED.invite_expires_at,
                updated_at=now()
  RETURNING * INTO _row;

  RETURN jsonb_build_object('id',_row.id,'invite_token',_t,'invite_email',_row.invite_email);
END;$$;

-- Consistent lock ordering: discover agency id -> lock agency row -> lock the
-- exact pending membership row -> revalidate everything.
CREATE OR REPLACE FUNCTION public.accept_agency_invite(_token text)
RETURNS agency_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _h text := encode(digest(coalesce(_token,''),'sha256'),'hex');
  _em text;
  _agency_id uuid;
  _locked uuid;
  _pending public.agency_members;
  _row public.agency_members;
  _limit integer;
  _used integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT lower(email) INTO _em FROM auth.users WHERE id=_uid;

  -- Discovery read only (no row lock) to learn which agency row to lock.
  SELECT am.agency_id INTO _agency_id FROM public.agency_members am
   WHERE am.invite_token_hash=_h AND am.status='pending' AND lower(am.invite_email)=_em
   LIMIT 1;
  IF _agency_id IS NULL THEN
    RAISE EXCEPTION 'Invite invalid or not addressed to your email' USING ERRCODE='P0002';
  END IF;

  -- Lock the agency profile row FIRST.
  SELECT ap.id INTO _locked FROM public.agency_profiles ap
   WHERE ap.id = _agency_id FOR UPDATE;
  IF _locked IS NULL THEN
    RAISE EXCEPTION 'Invite invalid or not addressed to your email' USING ERRCODE='P0002';
  END IF;

  -- Re-read and lock the exact pending membership row, revalidating token,
  -- normalized email, pending status and expiry.
  SELECT * INTO _pending FROM public.agency_members am
   WHERE am.invite_token_hash=_h
     AND am.status='pending'
     AND lower(am.invite_email)=_em
     AND am.agency_id=_agency_id
     AND am.invite_expires_at IS NOT NULL
     AND am.invite_expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite invalid or not addressed to your email' USING ERRCODE='P0002';
  END IF;

  -- The same auth user must not already be active in this agency.
  IF EXISTS (
    SELECT 1 FROM public.agency_members am2
     WHERE am2.agency_id=_agency_id
       AND am2.member_user_id=_uid
       AND am2.status='active'
  ) THEN
    RAISE EXCEPTION 'You are already an active member of this agency' USING ERRCODE='22023';
  END IF;

  PERFORM public.assert_agency_limit(_pending.agency_id, 'accept_member_invite');

  -- DIRECT post-lock recount. A pending seat BECOMES active rather than adding
  -- a seat, so acceptance is allowed at exact capacity and rejected only when
  -- the workspace is already over limit (e.g. after a plan downgrade).
  SELECT l.member_limit INTO _limit FROM public.get_effective_agency_limits(_agency_id) l;
  SELECT count(*)::integer INTO _used FROM public.agency_members am
   WHERE am.agency_id = _agency_id
     AND (
       am.status = 'active'
       OR (am.status = 'pending' AND am.invite_expires_at IS NOT NULL AND am.invite_expires_at > now())
     );
  IF _limit IS NOT NULL AND _used > _limit THEN
    RAISE EXCEPTION 'This agency workspace is over its member limit. Ask the agency owner to free a seat or upgrade before joining.'
      USING ERRCODE='P0001';
  END IF;

  UPDATE public.agency_members SET member_user_id=_uid, status='active', accepted_at=now(),
         invite_token_hash=NULL, invite_expires_at=NULL, updated_at=now()
   WHERE id=_pending.id AND status='pending'
  RETURNING * INTO _row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite invalid or not addressed to your email' USING ERRCODE='P0002';
  END IF;

  RETURN _row;
END $$;

-- ---------------------------------------------------------------------------
-- D. Revocation kills all agency-originated access
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_agency_member(_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _agency_id uuid;
  _locked uuid;
  _member public.agency_members;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;

  SELECT am.agency_id INTO _agency_id FROM public.agency_members am WHERE am.id=_member_id;
  IF _agency_id IS NULL THEN
    RAISE EXCEPTION 'Member not found or cannot revoke owner' USING ERRCODE='P0002';
  END IF;

  -- Lock the agency row first, then the target member row.
  SELECT ap.id INTO _locked FROM public.agency_profiles ap
   WHERE ap.id=_agency_id AND ap.owner_user_id=_uid FOR UPDATE;
  IF _locked IS NULL THEN
    RAISE EXCEPTION 'Member not found or cannot revoke owner' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO _member FROM public.agency_members am
   WHERE am.id=_member_id AND am.agency_id=_agency_id AND am.role<>'agency_owner'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found or cannot revoke owner' USING ERRCODE='P0002';
  END IF;

  UPDATE public.agency_members SET status='revoked', revoked_at=now(),
         invite_token_hash=NULL, invite_expires_at=NULL, updated_at=now()
   WHERE id=_member_id;

  IF _member.member_user_id IS NOT NULL THEN
    -- 2. Kill this member's live delegations in this agency.
    UPDATE public.agency_delegation_requests dr
       SET status='revoked', decided_at=COALESCE(dr.decided_at, now()), updated_at=now()
     WHERE dr.agency_id=_agency_id
       AND dr.member_user_id=_member.member_user_id
       AND dr.status IN ('pending_driver_approval','approved');

    -- 3. Kill agency-originated driver_assistants rows linked to them.
    UPDATE public.driver_assistants da
       SET status='revoked', revoked_at=now(), invite_token_hash=NULL, updated_at=now()
     WHERE da.agency_delegation_id IS NOT NULL
       AND da.status IN ('pending','active')
       AND da.agency_delegation_id IN (
         SELECT dr.id FROM public.agency_delegation_requests dr
          WHERE dr.agency_id=_agency_id
            AND dr.member_user_id=_member.member_user_id
       );

    -- 4. Clear stale assignment references so a later rejoin cannot silently
    --    reactivate old work. Historical delegation/audit rows are preserved.
    UPDATE public.agency_client_requests
       SET assigned_member_user_id=NULL, updated_at=now()
     WHERE agency_id=_agency_id AND assigned_member_user_id=_member.member_user_id;

    UPDATE public.agency_work_items
       SET assigned_member_user_id=NULL, updated_at=now()
     WHERE agency_id=_agency_id AND assigned_member_user_id=_member.member_user_id;

    INSERT INTO public.agency_audit_log
      (actor_user_id, agency_id, target_user_id, action, entity_type, entity_id, metadata)
    VALUES (_uid, _agency_id, _member.member_user_id, 'agency_member_revoked',
            'agency_member', _member_id,
            jsonb_build_object('cascaded', true));
  END IF;
END;$$;

-- ---------------------------------------------------------------------------
-- E. Continuous agency-delegation validity for driver data
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assistant_has_permission(_assistant uuid, _driver uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.driver_assistants da
    WHERE da.assistant_user_id = _assistant
      AND da.driver_user_id    = _driver
      AND da.status            = 'active'
      AND COALESCE((da.permissions ->> _perm)::boolean, false) = true
      AND (
        CASE
          WHEN da.agency_delegation_id IS NULL
            THEN public.driver_has_active_pro(da.driver_user_id)
          ELSE public._agency_delegation_operationally_active(
                 da.agency_delegation_id, da.assistant_user_id, da.driver_user_id)
        END
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_managed_drivers()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'delegate_id', da.id,
    'driver_user_id', da.driver_user_id,
    'driver_email', lower(u.email),
    'driver_name', COALESCE(p.display_name, lower(u.email)),
    'permissions', da.permissions,
    'accepted_at', da.accepted_at,
    'last_active_at', da.last_active_at,
    'driver_is_pro', public.driver_has_active_pro(da.driver_user_id)
  )
  FROM public.driver_assistants da
  JOIN auth.users u ON u.id = da.driver_user_id
  LEFT JOIN public.profiles p ON p.user_id = da.driver_user_id
  WHERE da.assistant_user_id = _uid
    AND da.status = 'active'
    AND (
      CASE
        WHEN da.agency_delegation_id IS NULL
          THEN public.driver_has_active_pro(da.driver_user_id)
        ELSE public._agency_delegation_operationally_active(
               da.agency_delegation_id, da.assistant_user_id, da.driver_user_id)
      END
    )
  ORDER BY da.accepted_at DESC NULLS LAST;
END;
$$;

-- Replace (do NOT parallel-add) the assistant SELECT policy. The driver's own
-- SELECT policy is untouched.
DROP POLICY IF EXISTS driver_assistants_assistant_select ON public.driver_assistants;
CREATE POLICY driver_assistants_assistant_select
  ON public.driver_assistants
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND auth.uid() = assistant_user_id
    AND (
      agency_delegation_id IS NULL
      OR public.current_user_can_use_agency_delegation(agency_delegation_id, driver_user_id)
    )
  );

-- ---------------------------------------------------------------------------
-- F. Target member / assigned member lifecycle
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_agency_delegation_request(_client_request_id uuid, _member_user_id uuid, _requested_permissions jsonb)
RETURNS agency_delegation_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _req public.agency_client_requests; _mbr public.agency_members; _clean jsonb; _row public.agency_delegation_requests;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _req FROM public.agency_client_requests WHERE id=_client_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client request not found' USING ERRCODE='42704'; END IF;
  IF NOT public.is_agency_owner_or_admin(_req.agency_id,_uid) THEN
    RAISE EXCEPTION 'Only agency owner/admin can create delegation requests' USING ERRCODE='42501';
  END IF;
  PERFORM public.assert_agency_limit(_req.agency_id, 'create_delegation_request');
  IF _req.status NOT IN ('pending','approved') THEN
    RAISE EXCEPTION 'Cannot create delegation for a % client request' , _req.status USING ERRCODE='22023';
  END IF;
  SELECT * INTO _mbr FROM public.agency_members
   WHERE agency_id=_req.agency_id AND member_user_id=_member_user_id AND status='active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected member must be an active agency member with a verified account' USING ERRCODE='22023';
  END IF;
  IF NOT public._agency_member_paid_operational_authority(_req.agency_id, _mbr.member_user_id) THEN
    RAISE EXCEPTION 'Selected member cannot take on client work under this agency plan' USING ERRCODE='22023';
  END IF;
  _clean := public.clean_assistant_permissions(_requested_permissions);
  INSERT INTO public.agency_delegation_requests
    (agency_id, client_request_id, driver_user_id, member_user_id,
     member_invite_email, requested_permissions, created_by_user_id)
  VALUES (_req.agency_id, _req.id, _req.driver_user_id, _mbr.member_user_id,
          _mbr.invite_email, _clean, _uid)
  RETURNING * INTO _row;
  UPDATE public.agency_client_requests
     SET status='approved', decided_at=now(), decided_by_user_id=_uid,
         assigned_member_user_id=_mbr.member_user_id
   WHERE id=_req.id AND status IN ('pending','approved');
  INSERT INTO public.agency_audit_log (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, _req.agency_id, _req.driver_user_id, _mbr.member_user_id,
          'delegation_request_created', 'agency_delegation_request', _row.id,
          jsonb_build_object('client_request_id', _req.id, 'permissions', _clean));
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.driver_decide_delegation(_id uuid, _approve boolean)
RETURNS agency_delegation_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _d public.agency_delegation_requests;
  _da public.driver_assistants;
  _email_norm text;
  _already_client boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _d FROM public.agency_delegation_requests WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delegation not found' USING ERRCODE='42704'; END IF;
  IF _d.driver_user_id <> _uid THEN RAISE EXCEPTION 'Only the driver can decide' USING ERRCODE='42501'; END IF;
  IF _d.status <> 'pending_driver_approval' THEN RAISE EXCEPTION 'Already decided' USING ERRCODE='22023'; END IF;

  IF NOT _approve THEN
    UPDATE public.agency_delegation_requests SET status='declined', decided_at=now()
      WHERE id=_id RETURNING * INTO _d;
    INSERT INTO public.agency_audit_log
      (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
    VALUES (_uid,_d.agency_id,_d.driver_user_id,_d.member_user_id,
            'delegation_declined_by_driver','agency_delegation_request',_d.id,'{}'::jsonb);
    RETURN _d;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id=_d.agency_id AND member_user_id=_d.member_user_id AND status='active'
  ) THEN RAISE EXCEPTION 'Agency member is no longer active' USING ERRCODE='22023'; END IF;

  IF NOT public._agency_member_paid_operational_authority(_d.agency_id, _d.member_user_id) THEN
    RAISE EXCEPTION 'Agency member is no longer active' USING ERRCODE='22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.agency_delegation_requests
     WHERE agency_id = _d.agency_id
       AND driver_user_id = _d.driver_user_id
       AND status = 'approved'
       AND id <> _d.id
  ) INTO _already_client;

  IF NOT _already_client THEN
    PERFORM public.assert_agency_limit(_d.agency_id, 'activate_client');
  END IF;

  _email_norm := lower(btrim(_d.member_invite_email));

  INSERT INTO public.driver_assistants
    (driver_user_id, assistant_user_id, invite_email, status, permissions,
     accepted_at, agency_delegation_id)
  VALUES (_uid, _d.member_user_id, _email_norm, 'active', _d.requested_permissions,
          now(), _d.id)
  ON CONFLICT (driver_user_id, lower(invite_email))
    WHERE status IN ('pending','active')
  DO UPDATE SET
    status              = 'active',
    assistant_user_id   = EXCLUDED.assistant_user_id,
    permissions         = EXCLUDED.permissions,
    accepted_at         = COALESCE(public.driver_assistants.accepted_at, now()),
    revoked_at          = NULL,
    agency_delegation_id = EXCLUDED.agency_delegation_id,
    updated_at          = now()
  RETURNING * INTO _da;

  UPDATE public.agency_delegation_requests SET status='approved', decided_at=now()
    WHERE id=_id RETURNING * INTO _d;

  IF _d.client_request_id IS NOT NULL THEN
    UPDATE public.agency_client_requests
       SET status='converted_to_client', decided_at=now(), decided_by_user_id=_uid
     WHERE id=_d.client_request_id;
  END IF;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES (_da.id, _uid, _d.member_user_id, 'delegation_approved', 'driver_assistants', _da.id,
          jsonb_build_object('agency_id', _d.agency_id, 'delegation_id', _d.id));

  INSERT INTO public.agency_audit_log
    (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid,_d.agency_id,_d.driver_user_id,_d.member_user_id,
          'delegation_approved_by_driver','agency_delegation_request',_d.id,
          jsonb_build_object('driver_assistants_id', _da.id));
  RETURN _d;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_agency_client_request_status(_id uuid, _status agency_client_request_status, _assigned_member_user_id uuid DEFAULT NULL::uuid)
RETURNS agency_client_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _row public.agency_client_requests; _old public.agency_client_requests;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _old FROM public.agency_client_requests WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE='42704'; END IF;
  IF _old.driver_user_id = _uid AND _status='cancelled' AND _assigned_member_user_id IS NULL THEN NULL;
  ELSIF public.is_agency_owner_or_admin(_old.agency_id,_uid) THEN
    IF _status NOT IN ('declined','cancelled') OR _assigned_member_user_id IS NOT NULL THEN
      PERFORM public.assert_agency_limit(_old.agency_id, 'progress_client_request');
    END IF;
  ELSE RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _assigned_member_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id=_old.agency_id AND member_user_id=_assigned_member_user_id AND status='active'
  ) THEN RAISE EXCEPTION 'Assigned member must be an active agency member' USING ERRCODE='22023'; END IF;
  IF _assigned_member_user_id IS NOT NULL
     AND NOT public._agency_member_paid_operational_authority(_old.agency_id, _assigned_member_user_id) THEN
    RAISE EXCEPTION 'Assigned member cannot take on client work under this agency plan' USING ERRCODE='22023';
  END IF;
  UPDATE public.agency_client_requests SET
    status=_status,
    assigned_member_user_id=COALESCE(_assigned_member_user_id, assigned_member_user_id),
    decided_at=now(), decided_by_user_id=_uid
  WHERE id=_id RETURNING * INTO _row;
  INSERT INTO public.agency_audit_log (actor_user_id, agency_id, driver_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, _row.agency_id, _row.driver_user_id,
          'client_request_'||_status::text, 'agency_client_request', _row.id,
          jsonb_build_object('assigned_member_user_id', _row.assigned_member_user_id));
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.create_agency_work_item(_agency_id uuid, _driver_user_id uuid, _title text, _description text, _type agency_work_item_type, _priority agency_work_item_priority, _assigned_member_user_id uuid, _client_request_id uuid, _due_date date)
RETURNS agency_work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _row public.agency_work_items;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.is_agency_owner_or_admin(_agency_id,_uid) THEN
    RAISE EXCEPTION 'Only agency owner/admin can create work items' USING ERRCODE='42501';
  END IF;
  PERFORM public.assert_agency_limit(_agency_id, 'create_work_item');
  IF NOT EXISTS (
    SELECT 1 FROM public.agency_delegation_requests
     WHERE agency_id=_agency_id
       AND driver_user_id=_driver_user_id
       AND status='approved'
  ) THEN
    RAISE EXCEPTION 'Driver is not an approved client of this agency' USING ERRCODE='42501';
  END IF;
  IF _assigned_member_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id=_agency_id AND member_user_id=_assigned_member_user_id AND status='active'
  ) THEN RAISE EXCEPTION 'Assigned member must be an active agency member' USING ERRCODE='22023'; END IF;
  IF _assigned_member_user_id IS NOT NULL
     AND NOT public._agency_member_paid_operational_authority(_agency_id, _assigned_member_user_id) THEN
    RAISE EXCEPTION 'Assigned member cannot take on work under this agency plan' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.agency_work_items
    (agency_id, driver_user_id, assigned_member_user_id, client_request_id,
     title, description, type, priority, due_date, created_by_user_id)
  VALUES (_agency_id,_driver_user_id,_assigned_member_user_id,_client_request_id,
          btrim(_title), NULLIF(btrim(coalesce(_description,'')),''),
          COALESCE(_type,'other'::public.agency_work_item_type),
          COALESCE(_priority,'normal'::public.agency_work_item_priority),
          _due_date,_uid)
  RETURNING * INTO _row;
  INSERT INTO public.agency_audit_log (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid,_agency_id,_driver_user_id,_assigned_member_user_id,
          'work_item_created','agency_work_item',_row.id,
          jsonb_build_object('title',_row.title,'type',_row.type,'priority',_row.priority));
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.update_agency_work_item(_id uuid, _status agency_work_item_status, _assigned_member_user_id uuid, _title text, _description text, _priority agency_work_item_priority, _due_date date)
RETURNS agency_work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _old public.agency_work_items;
  _row public.agency_work_items;
  _is_admin boolean;
  _is_assigned boolean;
  _reassigning boolean;
  _renaming boolean;
  _positive boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _old FROM public.agency_work_items WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work item not found' USING ERRCODE='42704'; END IF;

  _is_admin    := public.is_agency_owner_or_admin(_old.agency_id, _uid);
  _is_assigned := (_old.assigned_member_user_id = _uid);

  IF NOT (_is_admin OR _is_assigned) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501';
  END IF;

  -- Treat NULL as "no change" so assigned members can patch status / due_date
  -- without inadvertently looking like a reassignment.
  _reassigning := (_assigned_member_user_id IS NOT NULL
                   AND _assigned_member_user_id IS DISTINCT FROM _old.assigned_member_user_id);
  _renaming    := (NULLIF(btrim(coalesce(_title,'')),'') IS NOT NULL
                   AND _title <> _old.title);

  IF (_reassigning OR _renaming) AND NOT _is_admin THEN
    RAISE EXCEPTION 'Only agency owner/admin can reassign or rename' USING ERRCODE='42501';
  END IF;

  -- Phase AM-1A: an assigned member acting on their own item must still hold
  -- CURRENT active agency membership; positive working actions additionally
  -- require paid operational authority. Owner/admin cleanup paths keep working.
  IF _is_assigned AND NOT _is_admin THEN
    IF NOT public.is_agency_member(_old.agency_id, _uid) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501';
    END IF;
    _positive := (_status IS NOT NULL AND _status NOT IN ('cancelled'))
                 OR _priority IS NOT NULL
                 OR _due_date IS NOT NULL
                 OR NULLIF(btrim(coalesce(_description,'')),'') IS NOT NULL;
    IF _positive AND NOT public._agency_member_paid_operational_authority(_old.agency_id, _uid) THEN
      RAISE EXCEPTION 'Your agency workspace cannot perform this action right now' USING ERRCODE='P0001';
    END IF;
  END IF;

  IF _reassigning AND NOT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id=_old.agency_id
       AND member_user_id=_assigned_member_user_id
       AND status='active'
  ) THEN
    RAISE EXCEPTION 'Assigned member must be an active agency member' USING ERRCODE='22023';
  END IF;

  IF _reassigning
     AND NOT public._agency_member_paid_operational_authority(_old.agency_id, _assigned_member_user_id) THEN
    RAISE EXCEPTION 'Assigned member cannot take on work under this agency plan' USING ERRCODE='22023';
  END IF;

  -- Re-verify the driver is still an approved client of this agency.
  IF NOT EXISTS (
    SELECT 1 FROM public.agency_delegation_requests
     WHERE agency_id=_old.agency_id
       AND driver_user_id=_old.driver_user_id
       AND status='approved'
  ) THEN
    RAISE EXCEPTION 'Driver is no longer an approved client of this agency' USING ERRCODE='42501';
  END IF;

  UPDATE public.agency_work_items SET
    status                  = COALESCE(_status, status),
    assigned_member_user_id = CASE WHEN _reassigning THEN _assigned_member_user_id
                                   ELSE assigned_member_user_id END,
    title                   = COALESCE(NULLIF(btrim(_title),''), title),
    description             = COALESCE(NULLIF(btrim(coalesce(_description,'')),''), description),
    priority                = COALESCE(_priority, priority),
    due_date                = COALESCE(_due_date, due_date),
    completed_at            = CASE WHEN _status='completed' THEN now() ELSE completed_at END
  WHERE id=_id RETURNING * INTO _row;

  INSERT INTO public.agency_audit_log
    (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, _row.agency_id, _row.driver_user_id, _row.assigned_member_user_id,
          CASE
            WHEN _old.assigned_member_user_id IS DISTINCT FROM _row.assigned_member_user_id THEN 'work_item_assigned'
            WHEN _old.status IS DISTINCT FROM _row.status AND _row.status='completed' THEN 'work_item_completed'
            WHEN _old.status IS DISTINCT FROM _row.status THEN 'work_item_status_changed'
            ELSE 'work_item_updated'
          END,
          'agency_work_item', _row.id,
          jsonb_build_object('from_status', _old.status, 'to_status', _row.status));
  RETURN _row;
END $$;

-- Assigned-member listing branch now requires CURRENT active membership.
CREATE OR REPLACE FUNCTION public.list_agency_work_items(_agency_id uuid, _status agency_work_item_status DEFAULT NULL::agency_work_item_status, _driver_user_id uuid DEFAULT NULL::uuid, _assigned_member_user_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(id uuid, agency_id uuid, driver_user_id uuid, driver_email text, assigned_member_user_id uuid, assigned_member_email text, client_request_id uuid, title text, description text, type agency_work_item_type, status agency_work_item_status, priority agency_work_item_priority, due_date date, created_at timestamp with time zone, completed_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.agency_id, w.driver_user_id, du.email,
         w.assigned_member_user_id, mu.email,
         w.client_request_id, w.title, w.description, w.type, w.status,
         w.priority, w.due_date, w.created_at, w.completed_at
    FROM public.agency_work_items w
    LEFT JOIN auth.users du ON du.id = w.driver_user_id
    LEFT JOIN auth.users mu ON mu.id = w.assigned_member_user_id
   WHERE w.agency_id=_agency_id
     AND (
       public.is_agency_owner_or_admin(_agency_id, auth.uid())
       OR (
         w.assigned_member_user_id = auth.uid()
         AND public.is_agency_member(_agency_id, auth.uid())
       )
     )
     AND (_status IS NULL OR w.status=_status)
     AND (_driver_user_id IS NULL OR w.driver_user_id=_driver_user_id)
     AND (_assigned_member_user_id IS NULL OR w.assigned_member_user_id=_assigned_member_user_id)
   ORDER BY w.due_date NULLS LAST, w.created_at DESC;
$$;

-- list_agency_clients already requires active membership for member-owned
-- rows; it is intentionally left unchanged (no broadening, no weakening).

-- Tighten (REPLACE, never parallel-add) the three assigned-member SELECT
-- policies. Still-active members keep read access during a billing lapse;
-- revoked members lose it immediately.
DROP POLICY IF EXISTS acr_assigned_member_select ON public.agency_client_requests;
CREATE POLICY acr_assigned_member_select
  ON public.agency_client_requests
  FOR SELECT
  USING (
    assigned_member_user_id = auth.uid()
    AND public.is_agency_member(agency_id, auth.uid())
  );

DROP POLICY IF EXISTS adr_member_select ON public.agency_delegation_requests;
CREATE POLICY adr_member_select
  ON public.agency_delegation_requests
  FOR SELECT
  USING (
    member_user_id = auth.uid()
    AND public.is_agency_member(agency_id, auth.uid())
  );

DROP POLICY IF EXISTS awi_assigned_member_select ON public.agency_work_items;
CREATE POLICY awi_assigned_member_select
  ON public.agency_work_items
  FOR SELECT
  USING (
    assigned_member_user_id = auth.uid()
    AND public.is_agency_member(agency_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- G. Settlement composition — STRICTER settlement statuses preserved
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.settlement_current_user_can_manage_agency(_agency_id uuid, _driver_user_id uuid, _permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND _agency_id IS NOT NULL
     AND _driver_user_id IS NOT NULL
     AND _permission IS NOT NULL
     AND _permission IN ('settlements_manage', 'settlements_finalize')
     AND EXISTS (SELECT 1 FROM public.agency_profiles ap WHERE ap.id = _agency_id AND ap.status = 'active')
     AND EXISTS (SELECT 1 FROM public.agency_members am WHERE am.agency_id = _agency_id AND am.member_user_id = auth.uid() AND am.status = 'active')
     AND EXISTS (SELECT 1 FROM public.agency_entitlements ae WHERE ae.agency_id = _agency_id AND ae.plan_key IN ('agency_starter', 'agency_team', 'agency_growth') AND ae.status IN ('active', 'trialing', 'manual_beta'))
     AND public._agency_member_paid_operational_authority(_agency_id, auth.uid())
     AND EXISTS (
       SELECT 1 FROM public.agency_delegation_requests dr
       WHERE dr.agency_id = _agency_id
         AND dr.driver_user_id = _driver_user_id
         AND dr.member_user_id = auth.uid()
         AND dr.status = 'approved'
         AND jsonb_typeof(dr.requested_permissions -> _permission) = 'boolean'
         AND (dr.requested_permissions -> _permission) = to_jsonb(true)
     )
     AND NOT (
       EXISTS (SELECT 1 FROM public.agency_members am2 WHERE am2.agency_id = _agency_id AND am2.member_user_id = auth.uid() AND am2.status = 'active' AND am2.role = 'agency_owner')
       AND EXISTS (SELECT 1 FROM public.recruiter_billing_profiles rb WHERE rb.user_id = auth.uid() AND rb.plan IN ('starter', 'growth', 'fleet') AND rb.status IN ('active', 'trialing'))
     );
$$;

COMMIT;
