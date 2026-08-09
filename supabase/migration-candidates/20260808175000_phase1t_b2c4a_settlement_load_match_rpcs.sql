-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase 1T-B2C4A — Recipient-controlled settlement load-match RPCs.
--
-- Scope: exactly two SECURITY DEFINER plpgsql functions that are the ONLY
-- sanctioned way for the DRIVER SIDE to manually confirm or clear the
-- correspondence between one settlement `load_pay` line and one of THAT SAME
-- DRIVER'S completed HaulTracker load records.
--
-- Semantic contract (deliberate, and enforced below):
--   * public.driver_settlement_matches is a reconciliation LINK ONLY. It never
--     merges, rewrites, or supersedes either the company statement line or the
--     driver's own load record — the two records stay independent forever.
--   * driver_settlement_items.amount is the REPORTED statement amount. It is
--     never read for recalculation and never written here.
--   * expected_amount_snapshot is reconciliation-only and is COPIED verbatim
--     from the selected driver's existing public.loads.estimated_pay at
--     confirmation time. It is never recomputed in SQL and never derived from
--     actual_pay_received.
--   * ZERO writes to public.loads occur in this candidate, under any branch.
--
-- Deliberately NOT in this candidate:
--   * ZERO auto-matching, ZERO candidate scoring, ZERO suggestion states —
--     'exact', 'likely', 'possible', and 'rejected' are never written here;
--     manual confirmation writes ONLY match_state='confirmed' with a NULL
--     confidence, because a human decision has no model confidence;
--   * ZERO finalize / void / supersede / correction transitions;
--   * ZERO discrepancy or variance column, table, or calculation;
--   * ZERO policies, triggers, table/column/index/type/view DDL;
--   * ZERO table grants, ZERO DML outside the function bodies;
--   * no exports, no UI, no notifications, no Stripe, no pricing.
--
-- Contract properties enforced below:
--   * the actor is ALWAYS auth.uid(); no caller-supplied actor id, no
--     client-settable GUC, no email / business-name / payer-name / statement
--     text authorization, ever;
--   * no dynamic SQL, no EXECUTE, no admin / service_role bypass branch —
--     service_role may call these, but receives no special authorization;
--   * carrier/recruiter and agency actors are NOT authorized here merely
--     because they created or manage the settlement: the carrier and agency
--     management helpers are deliberately never called. This is a driver-side
--     reconciliation operation;
--   * every failure raises a FIXED machine-readable message; raw Postgres
--     error text, SQLSTATE, and constraint names are never surfaced;
--   * every mutation first locks the PARENT settlement FOR UPDATE, then the
--     item FOR UPDATE, then reads the selected load under FOR KEY SHARE so the
--     load cannot be deleted or re-keyed underneath the match;
--   * an unknown/malformed stored source or status always fails closed.
--
-- Reconciliation eligibility (exact):
--   * carrier_issued / agency_prepared: ONLY status='finalized' is matchable.
--     A company DRAFT is the business's working copy and stays unreconcilable
--     until it is issued.
--   * driver_imported: status='draft' is matchable only through the existing
--     active-Pro driver-import management contract; status='finalized' is
--     matchable through basic recipient reconciliation.
--   * 'voided' and 'superseded' are never matchable.
--
-- The Phase 1T-B2B read-only RLS contract stays untouched, so every direct
-- client INSERT/UPDATE/DELETE on the settlement tables remains blocked and
-- mutation happens only through these functions.
--
-- This candidate intentionally does NOT use IF NOT EXISTS, CREATE OR REPLACE,
-- or DROP: a re-apply must fail loudly rather than silently replace an
-- authorization-bearing function.

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
