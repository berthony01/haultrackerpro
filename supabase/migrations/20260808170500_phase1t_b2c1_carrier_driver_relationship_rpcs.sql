-- Phase 1T active-migration promotion.
--
-- Source candidate: supabase/migration-candidates/20260808170500_phase1t_b2c1_carrier_driver_relationship_rpcs.sql
--
-- This commit creates the managed migration FILE only. The SQL below is NOT
-- applied to production or to any connected database by this task.
--
-- The executable body below, from the first exact BEGIN; line through the final
-- exact COMMIT; line, is byte-for-byte identical to the accepted candidate.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) settlement_invite_carrier_driver(_recruiter_id, _driver_user_id)
--    Paid standalone carrier invites an existing HaulTracker user. Never
--    activates: only the driver's own accept RPC may do that.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_invite_carrier_driver(
  _recruiter_id uuid,
  _driver_user_id uuid
)
RETURNS public.carrier_driver_relationships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.carrier_driver_relationships;
BEGIN
  IF v_actor IS NULL OR _recruiter_id IS NULL OR _driver_user_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_relationship_request';
  END IF;

  IF NOT public.settlement_current_user_can_administer_carrier(_recruiter_id) THEN
    RAISE EXCEPTION 'settlement_carrier_not_authorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _driver_user_id) THEN
    RAISE EXCEPTION 'settlement_driver_not_found';
  END IF;

  SELECT r.* INTO v_row
  FROM public.carrier_driver_relationships r
  WHERE r.recruiter_id = _recruiter_id
    AND r.driver_user_id = _driver_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Atomic insert-if-absent on the canonical unique pair. A concurrent
    -- authorized invite for the same pair can no longer surface a raw
    -- unique_violation: the loser gets no row back and re-reads the winner's
    -- row, then falls through to the SAME canonical status handling below.
    INSERT INTO public.carrier_driver_relationships (
      recruiter_id,
      driver_user_id,
      status,
      created_by_user_id,
      invited_at,
      accepted_at,
      ended_at,
      updated_at
    )
    VALUES (
      _recruiter_id,
      _driver_user_id,
      'invited',
      v_actor,
      now(),
      NULL,
      NULL,
      now()
    )
    ON CONFLICT (recruiter_id, driver_user_id) DO NOTHING
    RETURNING * INTO v_row;

    IF FOUND THEN
      RETURN v_row;
    END IF;

    SELECT r.* INTO v_row
    FROM public.carrier_driver_relationships r
    WHERE r.recruiter_id = _recruiter_id
      AND r.driver_user_id = _driver_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'settlement_relationship_concurrent_write_failed';
    END IF;
  END IF;


  IF v_row.status = 'invited' OR v_row.status = 'active' THEN
    -- Idempotent: no duplicate row, no acceptance reset, no activation.
    UPDATE public.carrier_driver_relationships r
       SET updated_at = now()
     WHERE r.id = v_row.id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  IF v_row.status = 'inactive' OR v_row.status = 'ended' THEN
    -- Re-invite the SAME canonical row; created_by_user_id and created_at are
    -- original-provenance fields and are never rewritten.
    UPDATE public.carrier_driver_relationships r
       SET status = 'invited',
           invited_at = now(),
           accepted_at = NULL,
           ended_at = NULL,
           updated_at = now()
     WHERE r.id = v_row.id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  RAISE EXCEPTION 'settlement_relationship_invalid_state';
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) settlement_accept_my_carrier_relationship(_relationship_id)
--    Only the exact recipient driver may activate an invite.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_accept_my_carrier_relationship(
  _relationship_id uuid
)
RETURNS public.carrier_driver_relationships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.carrier_driver_relationships;
BEGIN
  IF v_actor IS NULL OR _relationship_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_relationship_request';
  END IF;

  SELECT r.* INTO v_row
  FROM public.carrier_driver_relationships r
  WHERE r.id = _relationship_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_relationship_not_found';
  END IF;

  IF v_row.driver_user_id <> v_actor THEN
    RAISE EXCEPTION 'settlement_relationship_not_authorized';
  END IF;

  IF v_row.status = 'invited' THEN
    UPDATE public.carrier_driver_relationships r
       SET status = 'active',
           accepted_at = now(),
           ended_at = NULL,
           updated_at = now()
     WHERE r.id = v_row.id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  IF v_row.status = 'active' THEN
    -- Idempotent: accepted_at is the original acceptance instant and is never
    -- replaced.
    UPDATE public.carrier_driver_relationships r
       SET updated_at = now()
     WHERE r.id = v_row.id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  RAISE EXCEPTION 'settlement_relationship_invalid_state';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) settlement_decline_my_carrier_relationship(_relationship_id)
--    Only the exact recipient driver may decline, and only a pending invite.
--    An already-active relationship must be ENDED, never declined.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_decline_my_carrier_relationship(
  _relationship_id uuid
)
RETURNS public.carrier_driver_relationships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.carrier_driver_relationships;
BEGIN
  IF v_actor IS NULL OR _relationship_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_relationship_request';
  END IF;

  SELECT r.* INTO v_row
  FROM public.carrier_driver_relationships r
  WHERE r.id = _relationship_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_relationship_not_found';
  END IF;

  IF v_row.driver_user_id <> v_actor THEN
    RAISE EXCEPTION 'settlement_relationship_not_authorized';
  END IF;

  IF v_row.status = 'invited' THEN
    UPDATE public.carrier_driver_relationships r
       SET status = 'inactive',
           accepted_at = NULL,
           ended_at = now(),
           updated_at = now()
     WHERE r.id = v_row.id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  IF v_row.status = 'inactive' THEN
    -- Idempotent: the original decline instant is preserved.
    UPDATE public.carrier_driver_relationships r
       SET updated_at = now()
     WHERE r.id = v_row.id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  RAISE EXCEPTION 'settlement_relationship_invalid_state';
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) settlement_end_carrier_relationship(_relationship_id)
--    Either side may disconnect. Deliberately NOT billing-gated: cleanup must
--    stay possible after a cancellation. Assistants and agencies are never
--    authorized here, and nothing is ever deleted.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_end_carrier_relationship(
  _relationship_id uuid
)
RETURNS public.carrier_driver_relationships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.carrier_driver_relationships;
BEGIN
  IF v_actor IS NULL OR _relationship_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_relationship_request';
  END IF;

  SELECT r.* INTO v_row
  FROM public.carrier_driver_relationships r
  WHERE r.id = _relationship_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_relationship_not_found';
  END IF;

  IF NOT (
    v_row.driver_user_id = v_actor
    OR EXISTS (
      SELECT 1
      FROM public.recruiter_profiles rp
      WHERE rp.id = v_row.recruiter_id
        AND rp.user_id = v_actor
    )
  ) THEN
    RAISE EXCEPTION 'settlement_relationship_not_authorized';
  END IF;

  IF v_row.status = 'invited' OR v_row.status = 'active' THEN
    UPDATE public.carrier_driver_relationships r
       SET status = 'ended',
           ended_at = now(),
           updated_at = now()
     WHERE r.id = v_row.id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  IF v_row.status = 'inactive' THEN
    -- An existing decline instant is preserved; only a missing one is stamped.
    UPDATE public.carrier_driver_relationships r
       SET status = 'ended',
           ended_at = COALESCE(r.ended_at, now()),
           updated_at = now()
     WHERE r.id = v_row.id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  IF v_row.status = 'ended' THEN
    -- Idempotent: ended_at is never rewritten.
    UPDATE public.carrier_driver_relationships r
       SET updated_at = now()
     WHERE r.id = v_row.id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  RAISE EXCEPTION 'settlement_relationship_invalid_state';
END;
$$;

-- ---------------------------------------------------------------------------
-- ACL contract: PUBLIC and anon get nothing; only authenticated and
-- service_role may execute. No table write privilege is granted anywhere.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.settlement_invite_carrier_driver(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_invite_carrier_driver(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_accept_my_carrier_relationship(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_accept_my_carrier_relationship(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_decline_my_carrier_relationship(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_decline_my_carrier_relationship(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_end_carrier_relationship(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_end_carrier_relationship(uuid) TO authenticated, service_role;

COMMIT;
