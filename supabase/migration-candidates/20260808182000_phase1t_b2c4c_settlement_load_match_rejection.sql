-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase 1T-B2C4C — Controlled load-match SUGGESTION REJECTION.
--
-- Scope: exactly ONE SECURITY DEFINER plpgsql function that lets the DRIVER
-- SIDE explicitly reject one existing Phase 1T-B2C4B machine suggestion for one
-- settlement `load_pay` line.
--
-- Why this exists:
--   * B2C4A provides manual confirm/clear only.
--   * B2C4B writes only 'likely'/'possible' and deliberately preserves any
--     'rejected' pair, but nothing in the sanctioned surface could ever CREATE
--     that rejected state. This candidate closes exactly that gap, and nothing
--     else.
--
-- Semantic contract (deliberate, and enforced below):
--   * Rejection is a HUMAN decision recorded on an EXISTING machine suggestion.
--     It never invents a rejection for a pair that was never suggested, so a
--     missing pair raises settlement_suggestion_not_found and inserts nothing.
--   * An accepted match ('exact' or 'confirmed') can NEVER be rejected here.
--     Phase 1T-B2C4A settlement_clear_load_match remains the only path that
--     removes an accepted match.
--   * Rejection PRESERVES the stored machine confidence verbatim: the score
--     that produced the suggestion is historical evidence, not a live value.
--   * Rejection is reversible only by an explicit human action: the existing
--     B2C4A settlement_confirm_load_match promotes the same row in place to
--     'confirmed'. This candidate does not modify B2C4A or B2C4B to achieve
--     that; the accepted contracts already support it.
--   * ZERO writes to public.loads, public.driver_settlements, and
--     public.driver_settlement_items occur, under any branch. In particular
--     `amount` (the REPORTED statement amount) and `expected_amount_snapshot`
--     are never touched.
--   * Exactly one match row — the selected pair — may change. No other match
--     row for the item or for any other item is read-modified.
--
-- Deliberately NOT in this candidate:
--   * ZERO finalize / void / supersede / correction / revision transitions;
--   * ZERO discrepancy, variance, or recalculation of any kind;
--   * ZERO exports, UI, notifications, Stripe, pricing;
--   * ZERO table / column / constraint / index / view / trigger / type / enum
--     DDL, ZERO policies, ZERO table grants, ZERO DML outside the body;
--   * ZERO new event vocabulary — the existing B1 'updated' event type is used.
--
-- Contract properties enforced below:
--   * the actor is ALWAYS auth.uid(); no caller-supplied actor id, no
--     client-settable GUC, no email / business-name / payer-name / statement
--     text authorization, ever;
--   * rejection acts on B2C4B suggestions and is therefore ADVANCED
--     reconciliation: it requires the recipient driver's ACTIVE Driver Pro,
--     proven only through the accepted B2A helpers, exactly as B2C4B does;
--   * carrier/recruiter and agency actors are NOT authorized merely because
--     they issued or prepared the settlement: the carrier and agency
--     management helpers, and the settlement view helper, are deliberately
--     never called;
--   * no dynamic SQL, no EXECUTE, no admin / service_role bypass branch —
--     service_role may call this, but receives no special authorization;
--   * every failure raises a FIXED machine-readable message; raw Postgres error
--     text, SQLSTATE, and constraint names are never surfaced, and no exception
--     handler exists that could leak SQLERRM;
--   * lock order matches B2C4A/B2C4B exactly: PARENT settlement FOR UPDATE
--     first, then the item FOR UPDATE, then the selected load FOR KEY SHARE
--     (non-mutating), then the exact existing match pair FOR UPDATE.
--
-- Reconciliation eligibility mirrors B2C4A/B2C4B exactly:
--   * carrier_issued / agency_prepared: ONLY status='finalized';
--   * driver_imported: 'draft' or 'finalized';
--   * 'voided' and 'superseded' are never rejectable;
--   * an unknown/malformed stored source or status always fails closed.
--
-- This candidate intentionally does NOT use IF NOT EXISTS, CREATE OR REPLACE,
-- or DROP: a re-apply must fail loudly rather than silently replace an
-- authorization-bearing function.

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
