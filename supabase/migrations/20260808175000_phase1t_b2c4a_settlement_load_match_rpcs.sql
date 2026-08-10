-- Phase 1T active-migration promotion.
--
-- Source candidate: supabase/migration-candidates/20260808175000_phase1t_b2c4a_settlement_load_match_rpcs.sql
--
-- This commit creates the managed migration FILE only. The SQL below is NOT
-- applied to production or to any connected database by this task.
--
-- The executable body below, from the first exact BEGIN; line through the final
-- exact COMMIT; line, is byte-for-byte identical to the accepted candidate.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) settlement_confirm_load_match(_settlement_item_id, _driver_load_id)
--    Manually confirm that one reported load_pay line corresponds to one of
--    the recipient driver's own COMPLETED load records.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_confirm_load_match(
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
  v_expected numeric;
  v_load_status text;
  v_existing_pair public.driver_settlement_matches;
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
    -- 'voided' and 'superseded' (and anything unknown) are never matchable.
    RAISE EXCEPTION 'settlement_not_editable';
  END IF;

  IF v_parent.status = 'draft'
     AND v_parent.source IN ('carrier_issued', 'agency_prepared') THEN
    RAISE EXCEPTION 'settlement_not_editable';
  END IF;

  -- ---- driver-side authorization ONLY -------------------------------------
  -- Carrier and agency management helpers are deliberately never called here.
  IF v_parent.status = 'finalized' THEN
    IF NOT (
      v_parent.driver_user_id = v_actor
      OR public.settlement_current_user_can_assist_driver(
           v_parent.driver_user_id, 'settlements_manage', false)
    ) THEN
      RAISE EXCEPTION 'settlement_match_not_authorized';
    END IF;
  ELSE
    -- driver_imported DRAFT: advanced driver-import management contract.
    IF NOT (
      (v_parent.driver_user_id = v_actor
        AND public.settlement_current_user_can_manage_driver_import())
      OR public.settlement_current_user_can_assist_driver(
           v_parent.driver_user_id, 'settlements_manage', true)
    ) THEN
      RAISE EXCEPTION 'settlement_match_not_authorized';
    END IF;
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
  SELECT l.status, l.estimated_pay INTO v_load_status, v_expected
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

  -- ---- expected pay snapshot: copied, never recomputed --------------------
  IF v_expected IS NULL
     OR v_expected::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_expected < 0
     OR v_expected > 999999999999.99 THEN
    RAISE EXCEPTION 'settlement_match_expected_pay_unavailable';
  END IF;

  -- ---- deterministic manual rematch ---------------------------------------
  -- The selected (item, load) pair is located and locked FIRST, because B1
  -- also enforces UNIQUE (settlement_item_id, driver_load_id): a pre-existing
  -- suggestion row for THIS pair must be promoted in place, never duplicated.
  SELECT dsm.* INTO v_existing_pair
  FROM public.driver_settlement_matches dsm
  WHERE dsm.settlement_item_id = v_item.id
    AND dsm.driver_load_id = _driver_load_id
  FOR UPDATE;

  IF FOUND THEN
    -- Preserve one-accepted-per-item: drop OTHER accepted rows only.
    DELETE FROM public.driver_settlement_matches dsm
    WHERE dsm.settlement_item_id = v_item.id
      AND dsm.id <> v_existing_pair.id
      AND dsm.match_state IN ('exact', 'confirmed');

    -- Manual confirmation overrides the prior state of the SELECTED pair,
    -- whatever it was ('exact', 'likely', 'possible', 'confirmed',
    -- 'rejected'). Non-selected suggestion/rejection history is untouched.
    UPDATE public.driver_settlement_matches dsm
    SET match_state = 'confirmed',
        confidence = NULL,
        matched_by_user_id = v_actor,
        matched_at = now()
    WHERE dsm.id = v_existing_pair.id
    RETURNING * INTO v_match;
  ELSE
    -- Only an ACCEPTED prior state is replaced. Suggestion/rejection history
    -- ('likely', 'possible', 'rejected') is never destroyed by a manual action.
    DELETE FROM public.driver_settlement_matches dsm
    WHERE dsm.settlement_item_id = v_item.id
      AND dsm.match_state IN ('exact', 'confirmed');

    INSERT INTO public.driver_settlement_matches (
      settlement_item_id,
      driver_load_id,
      match_state,
      confidence,
      matched_by_user_id,
      matched_at
    )
    VALUES (
      v_item.id,
      _driver_load_id,
      'confirmed',
      NULL,
      v_actor,
      now()
    )
    RETURNING * INTO v_match;
  END IF;


  -- ---- reconciliation metadata ONLY on the item ---------------------------
  -- amount, item_type, pay_method, quantity/rate, statement snapshots,
  -- settlement_id and created_by_user_id are deliberately untouched.
  UPDATE public.driver_settlement_items dsi
  SET expected_amount_snapshot = v_expected,
      updated_at = now()
  WHERE dsi.id = v_item.id;

  INSERT INTO public.driver_settlement_events (
    settlement_id, actor_user_id, event_type, metadata
  )
  VALUES (
    v_parent.id,
    v_actor,
    'match_confirmed',
    jsonb_build_object(
      'source', v_parent.source,
      'item_id', v_item.id,
      'driver_load_id', _driver_load_id,
      'change', 'load_match_confirmed'
    )
  );

  RETURN v_match;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) settlement_clear_load_match(_settlement_item_id)
--    Remove the accepted reconciliation link and its expected-pay snapshot.
--    Idempotent: clearing an already-clear line writes nothing.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_clear_load_match(
  _settlement_item_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_settlement_id uuid;
  v_parent public.driver_settlements;
  v_item public.driver_settlement_items;
  v_deleted integer := 0;
  v_had_snapshot boolean := false;
BEGIN
  IF v_actor IS NULL OR _settlement_item_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_request';
  END IF;

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

  IF v_parent.source NOT IN ('carrier_issued', 'agency_prepared', 'driver_imported') THEN
    RAISE EXCEPTION 'settlement_invalid_source';
  END IF;

  IF v_parent.status NOT IN ('draft', 'finalized') THEN
    RAISE EXCEPTION 'settlement_not_editable';
  END IF;

  IF v_parent.status = 'draft'
     AND v_parent.source IN ('carrier_issued', 'agency_prepared') THEN
    RAISE EXCEPTION 'settlement_not_editable';
  END IF;

  IF v_parent.status = 'finalized' THEN
    IF NOT (
      v_parent.driver_user_id = v_actor
      OR public.settlement_current_user_can_assist_driver(
           v_parent.driver_user_id, 'settlements_manage', false)
    ) THEN
      RAISE EXCEPTION 'settlement_match_not_authorized';
    END IF;
  ELSE
    IF NOT (
      (v_parent.driver_user_id = v_actor
        AND public.settlement_current_user_can_manage_driver_import())
      OR public.settlement_current_user_can_assist_driver(
           v_parent.driver_user_id, 'settlements_manage', true)
    ) THEN
      RAISE EXCEPTION 'settlement_match_not_authorized';
    END IF;
  END IF;

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

  v_had_snapshot := v_item.expected_amount_snapshot IS NOT NULL;

  DELETE FROM public.driver_settlement_matches dsm
  WHERE dsm.settlement_item_id = v_item.id
    AND dsm.match_state IN ('exact', 'confirmed');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 AND NOT v_had_snapshot THEN
    -- Idempotent no-op: nothing accepted, nothing snapshotted.
    RETURN v_item.id;
  END IF;

  UPDATE public.driver_settlement_items dsi
  SET expected_amount_snapshot = NULL,
      updated_at = now()
  WHERE dsi.id = v_item.id;

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
      'change', 'load_match_cleared'
    )
  );

  RETURN v_item.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- ACL contract: driver-side reconciliation entry points only. anon and PUBLIC
-- get nothing; authenticated and service_role may execute, and service_role
-- receives no special authorization result from either body.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.settlement_confirm_load_match(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_confirm_load_match(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_clear_load_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_clear_load_match(uuid) TO authenticated, service_role;

COMMIT;
