-- Phase 1T active-migration promotion.
--
-- Source candidate: supabase/migration-candidates/20260808185000_phase1t_b2c5b_settlement_void.sql
--
-- This commit creates the managed migration FILE only. The SQL below is NOT
-- applied to production or to any connected database by this task.
--
-- The executable body below, from the first exact BEGIN; line through the final
-- exact COMMIT; line, is byte-for-byte identical to the accepted candidate.

BEGIN;

-- ---------------------------------------------------------------------------
-- settlement_void_finalized(_settlement_id)
--
-- 'finalized' -> 'voided' (one audit event), for exactly one settlement.
--   null actor / null id  -> settlement_invalid_request
--   missing row           -> settlement_not_found
--   non-finalized status  -> settlement_not_voidable
--   unknown stored source -> settlement_invalid_source
--   carrier not current   -> settlement_carrier_not_authorized
--   agency not current    -> settlement_agency_not_authorized
--   driver import path    -> settlement_driver_import_not_authorized
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_void_finalized(
  _settlement_id uuid
)
RETURNS public.driver_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_settlement public.driver_settlements;
  v_result public.driver_settlements;
BEGIN
  IF v_actor IS NULL OR _settlement_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_request';
  END IF;

  -- ---- lock the exact settlement BEFORE authorization / mutation ----------
  SELECT ds.* INTO v_settlement
  FROM public.driver_settlements ds
  WHERE ds.id = _settlement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found';
  END IF;

  -- ---- lifecycle eligibility: EXACTLY finalized, never idempotent ---------
  IF v_settlement.status IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'settlement_not_voidable';
  END IF;

  -- ---- source vocabulary, fail-closed -------------------------------------
  IF v_settlement.source NOT IN ('carrier_issued', 'agency_prepared', 'driver_imported') THEN
    RAISE EXCEPTION 'settlement_invalid_source';
  END IF;

  -- ---- CURRENT authorization, re-derived per source -----------------------
  IF v_settlement.source = 'carrier_issued' THEN
    IF v_settlement.carrier_recruiter_profile_id IS NULL
       OR v_settlement.carrier_driver_relationship_id IS NULL
       OR NOT public.settlement_current_user_can_manage_carrier(
            v_settlement.carrier_recruiter_profile_id,
            v_settlement.carrier_driver_relationship_id,
            v_settlement.driver_user_id
          ) THEN
      RAISE EXCEPTION 'settlement_carrier_not_authorized';
    END IF;

  ELSIF v_settlement.source = 'agency_prepared' THEN
    IF v_settlement.agency_id IS NULL
       OR NOT public.settlement_current_user_can_manage_agency(
            v_settlement.agency_id,
            v_settlement.driver_user_id,
            'settlements_finalize'
          ) THEN
      RAISE EXCEPTION 'settlement_agency_not_authorized';
    END IF;

  ELSE
    -- driver_imported: DIRECT assistant only, over an ACTIVE-Pro target
    -- driver. The recipient driver actor deliberately does not receive void.
    IF NOT public.settlement_current_user_can_assist_driver(
           v_settlement.driver_user_id,
           'settlements_finalize',
           true
         ) THEN
      RAISE EXCEPTION 'settlement_driver_import_not_authorized';
    END IF;
  END IF;

  -- ---- the ONLY settlement write: exactly four columns --------------------
  UPDATE public.driver_settlements ds
  SET status = 'voided',
      voided_by_user_id = v_actor,
      voided_at = now(),
      updated_at = now()
  WHERE ds.id = v_settlement.id
  RETURNING * INTO v_result;

  INSERT INTO public.driver_settlement_events (
    settlement_id, actor_user_id, event_type, metadata
  )
  VALUES (
    v_result.id,
    v_actor,
    'voided',
    jsonb_build_object(
      'source', v_result.source,
      'change', 'settlement_voided'
    )
  );

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- ACL contract: authenticated callers and service_role may execute; anon and
-- PUBLIC get nothing, and service_role receives no special authorization
-- result from the body.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.settlement_void_finalized(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_void_finalized(uuid) TO authenticated, service_role;

COMMIT;
