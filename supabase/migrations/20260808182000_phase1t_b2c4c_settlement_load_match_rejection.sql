-- Phase 1T active-migration promotion.
--
-- Source candidate: supabase/migration-candidates/20260808182000_phase1t_b2c4c_settlement_load_match_rejection.sql
--
-- This commit creates the managed migration FILE only. The SQL below is NOT
-- applied to production or to any connected database by this task.
--
-- The executable body below, from the first exact BEGIN; line through the final
-- exact COMMIT; line, is byte-for-byte identical to the accepted candidate.

BEGIN;

-- ---------------------------------------------------------------------------
-- settlement_reject_load_match(_settlement_item_id, _driver_load_id)
--
-- Reject ONE existing machine suggestion for ONE load_pay line.
--   'likely' | 'possible' -> 'rejected'  (one audit event)
--   'rejected'            -> idempotent no-op, no event
--   'exact' | 'confirmed' -> settlement_match_already_accepted
--   anything else stored  -> settlement_invalid_match_state
--   no such pair          -> settlement_suggestion_not_found
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_reject_load_match(
  _settlement_item_id uuid,
  _driver_load_id uuid
)
RETURNS public.driver_settlement_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_settlement_id uuid;
  v_parent public.driver_settlements;
  v_item public.driver_settlement_items;
  v_load_status text;
  v_existing public.driver_settlement_matches;
  v_match public.driver_settlement_matches;
BEGIN
  IF v_actor IS NULL OR _settlement_item_id IS NULL OR _driver_load_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_request';
  END IF;

  -- ---- resolve parent, then lock the PARENT first -------------------------
  SELECT dsi.settlement_id INTO v_settlement_id
  FROM public.driver_settlement_items dsi
  WHERE dsi.id = _settlement_item_id;

  IF v_settlement_id IS NULL THEN
    RAISE EXCEPTION 'settlement_item_not_found';
  END IF;

  SELECT ds.* INTO v_parent
  FROM public.driver_settlements ds
  WHERE ds.id = v_settlement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found';
  END IF;

  -- ---- reconciliation eligibility (source x status), fail-closed ----------
  IF v_parent.source NOT IN ('carrier_issued', 'agency_prepared', 'driver_imported') THEN
    RAISE EXCEPTION 'settlement_invalid_source';
  END IF;

  IF v_parent.status NOT IN ('draft', 'finalized') THEN
    -- 'voided' and 'superseded' (and anything unknown) are never rejectable.
    RAISE EXCEPTION 'settlement_not_editable';
  END IF;

  IF v_parent.status = 'draft'
     AND v_parent.source IN ('carrier_issued', 'agency_prepared') THEN
    RAISE EXCEPTION 'settlement_not_editable';
  END IF;

  -- ---- driver-side ADVANCED authorization ONLY ----------------------------
  -- Active Driver Pro is required for the recipient driver, on every source and
  -- status. Carrier and agency management helpers are never called here.
  IF NOT (
    (v_parent.driver_user_id = v_actor
      AND public.settlement_current_user_can_manage_driver_import())
    OR public.settlement_current_user_can_assist_driver(
         v_parent.driver_user_id, 'settlements_manage', true)
  ) THEN
    RAISE EXCEPTION 'settlement_rejection_not_authorized';
  END IF;

  -- ---- lock the item under the already-locked parent ----------------------
  SELECT dsi.* INTO v_item
  FROM public.driver_settlement_items dsi
  WHERE dsi.id = _settlement_item_id
    AND dsi.settlement_id = v_parent.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_item_not_found';
  END IF;

  IF v_item.item_type <> 'load_pay' THEN
    RAISE EXCEPTION 'settlement_match_requires_load_pay_item';
  END IF;

  -- ---- selected load: same driver, non-mutating row lock ------------------
  SELECT l.status INTO v_load_status
  FROM public.loads l
  WHERE l.id = _driver_load_id
    AND l.user_id = v_parent.driver_user_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_match_load_not_found';
  END IF;

  IF v_load_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'settlement_match_load_not_completed';
  END IF;

  -- ---- the exact existing pair, locked ------------------------------------
  SELECT dsm.* INTO v_existing
  FROM public.driver_settlement_matches dsm
  WHERE dsm.settlement_item_id = v_item.id
    AND dsm.driver_load_id = _driver_load_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- A rejection is only ever recorded ON an existing machine suggestion.
    RAISE EXCEPTION 'settlement_suggestion_not_found';
  END IF;

  IF v_existing.match_state IN ('exact', 'confirmed') THEN
    RAISE EXCEPTION 'settlement_match_already_accepted';
  END IF;

  IF v_existing.match_state = 'rejected' THEN
    -- Idempotent no-op: no column change, no second audit event.
    RETURN v_existing;
  END IF;

  IF v_existing.match_state NOT IN ('likely', 'possible') THEN
    RAISE EXCEPTION 'settlement_invalid_match_state';
  END IF;

  UPDATE public.driver_settlement_matches dsm
  SET match_state = 'rejected',
      -- confidence is deliberately NOT written: the machine score that produced
      -- the suggestion is preserved verbatim as historical evidence.
      matched_by_user_id = v_actor,
      matched_at = now()
  WHERE dsm.id = v_existing.id
  RETURNING * INTO v_match;

  INSERT INTO public.driver_settlement_events (
    settlement_id, actor_user_id, event_type, metadata
  )
  VALUES (
    v_parent.id,
    v_actor,
    'updated',
    jsonb_build_object(
      'source', v_parent.source,
      'item_id', v_item.id,
      'driver_load_id', _driver_load_id,
      'change', 'load_match_rejected'
    )
  );

  RETURN v_match;
END;
$$;

-- ---------------------------------------------------------------------------
-- ACL contract: driver-side advanced reconciliation entry point only. anon and
-- PUBLIC get nothing; authenticated and service_role may execute, and
-- service_role receives no special authorization result from the body.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.settlement_reject_load_match(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_reject_load_match(uuid, uuid) TO authenticated, service_role;

COMMIT;
