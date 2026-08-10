-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase 1T-B2C5C — Controlled finalized-settlement CORRECTION / SUPERSEDE
-- lifecycle.
--
-- Scope: exactly ONE SECURITY DEFINER plpgsql function that atomically turns
-- ONE currently finalized settlement into preserved superseded history and
-- creates ONE new mutable correction draft revision.
--
-- Semantic contract (deliberate, and enforced below):
--   * Finalized financial history is NEVER edited in place. The predecessor is
--     preserved byte-identically except for its lifecycle status (and the
--     mandatory updated_at bookkeeping stamp); the corrected numbers live in a
--     NEW draft revision.
--   * Correction is NOT idempotent and applies ONLY to status 'finalized'.
--     'draft', 'voided', 'superseded' and any replayed second attempt fail
--     BEFORE any write with settlement_not_correctable, so no second successor
--     revision and no second audit pair can ever be produced.
--   * Authorization is RE-DERIVED at correction time from the LOCKED
--     predecessor row. Creator identity, prior issuance/preparation, prior read
--     access, and the authorization that was valid at finalization time are
--     NEVER sufficient:
--       - carrier_issued  -> the exact accepted current paid-carrier +
--                            ACTIVE relationship contract;
--       - agency_prepared -> because this single operation BOTH supersedes a
--                            finalized record AND creates a mutable draft, the
--                            SAME actor must currently hold BOTH
--                            'settlements_finalize' AND 'settlements_manage'
--                            for the stored agency/driver pair;
--       - driver_imported -> ONLY a DIRECT assistant (agency_delegation_id IS
--                            NULL) holding BOTH 'settlements_finalize' AND
--                            'settlements_manage' over an ACTIVE-Pro target
--                            driver. The recipient driver deliberately cannot
--                            initiate this lifecycle operation, and an
--                            agency-generated assistant row can never satisfy
--                            it.
--   * Historical business-name / payer snapshots are COPIED, never re-resolved
--     or rewritten: a correction must not silently restate who issued the
--     original statement.
--   * Reconciliation isolation: ZERO driver_settlement_matches rows are cloned
--     and expected_amount_snapshot is reset to NULL on every cloned item.
--     Reconciliation metadata is not statement data; driver-side matching must
--     be performed again against the corrected revision once it is finalized,
--     and stale prior match decisions can never leak into a mutable draft.
--   * ZERO writes to public.loads, predecessor items, predecessor matches,
--     carrier relationships, billing / entitlement / delegation tables, or
--     anything else outside the new revision, its cloned items, the
--     predecessor status transition, and exactly two audit rows.
--
-- Deliberately NOT in this candidate:
--   * ZERO void / reopen / re-finalize transitions;
--   * ZERO totals, variance, discrepancy or recalculation logic;
--   * ZERO exports, notifications, UI, Stripe, pricing, OCR, payroll or tax;
--   * ZERO table / column / constraint / index / view / trigger / type / enum
--     DDL, ZERO policies, ZERO table grants, ZERO helper functions;
--   * ZERO new event vocabulary — only the accepted B1 'superseded' and
--     'created' event types are used.
--
-- Contract properties enforced below:
--   * the actor is ALWAYS auth.uid(); no caller-supplied actor id, no
--     client-settable GUC, no email / business-name / statement-text
--     authorization, ever;
--   * no dynamic SQL, no EXECUTE, no advisory lock, no retry loop, no admin /
--     service_role bypass branch — service_role may call this, but receives no
--     special authorization;
--   * every failure raises a FIXED machine-readable message; raw Postgres
--     error text, SQLSTATE and constraint names are never surfaced, and no
--     exception handler exists that could leak SQLERRM;
--   * the predecessor row is locked FOR UPDATE BEFORE authorization is derived
--     and before any write, so competing correction attempts serialize and the
--     loser fails on the status gate.
--
-- This candidate intentionally does NOT use IF NOT EXISTS, CREATE OR REPLACE,
-- or DROP: a re-apply must fail loudly rather than silently replace an
-- authorization-bearing function.

BEGIN;

-- ---------------------------------------------------------------------------
-- settlement_create_correction_draft(_settlement_id)
--
-- 'finalized' -> 'superseded' predecessor + ONE new 'draft' successor revision.
--   null actor / null id  -> settlement_invalid_request
--   missing row           -> settlement_not_found
--   non-finalized status  -> settlement_not_correctable
--   unknown stored source -> settlement_invalid_source
--   carrier not current   -> settlement_carrier_not_authorized
--   agency not current    -> settlement_agency_not_authorized
--   driver import path    -> settlement_driver_import_not_authorized
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_create_correction_draft(
  _settlement_id uuid
)
RETURNS public.driver_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_prev public.driver_settlements;
  v_result public.driver_settlements;
BEGIN
  IF v_actor IS NULL OR _settlement_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_request';
  END IF;

  -- ---- lock the exact predecessor BEFORE authorization / any write --------
  SELECT ds.* INTO v_prev
  FROM public.driver_settlements ds
  WHERE ds.id = _settlement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found';
  END IF;

  -- ---- lifecycle eligibility: EXACTLY finalized, never idempotent ---------
  IF v_prev.status IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'settlement_not_correctable';
  END IF;

  -- ---- source vocabulary, fail-closed -------------------------------------
  IF v_prev.source NOT IN ('carrier_issued', 'agency_prepared', 'driver_imported') THEN
    RAISE EXCEPTION 'settlement_invalid_source';
  END IF;

  -- ---- CURRENT authorization, re-derived per source -----------------------
  IF v_prev.source = 'carrier_issued' THEN
    IF v_prev.carrier_recruiter_profile_id IS NULL
       OR v_prev.carrier_driver_relationship_id IS NULL
       OR NOT public.settlement_current_user_can_manage_carrier(
            v_prev.carrier_recruiter_profile_id,
            v_prev.carrier_driver_relationship_id,
            v_prev.driver_user_id
          ) THEN
      RAISE EXCEPTION 'settlement_carrier_not_authorized';
    END IF;

  ELSIF v_prev.source = 'agency_prepared' THEN
    -- BOTH permissions: supersede a finalized record AND create a draft.
    IF v_prev.agency_id IS NULL
       OR NOT public.settlement_current_user_can_manage_agency(
            v_prev.agency_id,
            v_prev.driver_user_id,
            'settlements_finalize'
          )
       OR NOT public.settlement_current_user_can_manage_agency(
            v_prev.agency_id,
            v_prev.driver_user_id,
            'settlements_manage'
          ) THEN
      RAISE EXCEPTION 'settlement_agency_not_authorized';
    END IF;

  ELSE
    -- driver_imported: DIRECT assistant only, BOTH permissions, ACTIVE-Pro
    -- target driver. The recipient driver actor deliberately cannot correct.
    IF NOT public.settlement_current_user_can_assist_driver(
           v_prev.driver_user_id,
           'settlements_finalize',
           true
         )
       OR NOT public.settlement_current_user_can_assist_driver(
            v_prev.driver_user_id,
            'settlements_manage',
            true
          ) THEN
      RAISE EXCEPTION 'settlement_driver_import_not_authorized';
    END IF;
  END IF;

  -- ---- the new mutable correction revision --------------------------------
  -- Historical snapshots are copied verbatim; nothing is re-resolved.
  INSERT INTO public.driver_settlements (
    driver_user_id,
    source,
    status,
    carrier_recruiter_profile_id,
    carrier_driver_relationship_id,
    agency_id,
    period_start,
    period_end,
    pay_date,
    statement_reference,
    payer_name_snapshot,
    source_display_name_snapshot,
    reported_gross_amount,
    reported_net_amount,
    notes,
    calculation_version,
    version_number,
    supersedes_settlement_id,
    created_by_user_id
  )
  VALUES (
    v_prev.driver_user_id,
    v_prev.source,
    'draft',
    v_prev.carrier_recruiter_profile_id,
    v_prev.carrier_driver_relationship_id,
    v_prev.agency_id,
    v_prev.period_start,
    v_prev.period_end,
    v_prev.pay_date,
    v_prev.statement_reference,
    v_prev.payer_name_snapshot,
    v_prev.source_display_name_snapshot,
    v_prev.reported_gross_amount,
    v_prev.reported_net_amount,
    v_prev.notes,
    v_prev.calculation_version,
    v_prev.version_number + 1,
    v_prev.id,
    v_actor
  )
  RETURNING * INTO v_result;

  -- ---- clone every predecessor line item ----------------------------------
  -- expected_amount_snapshot is reconciliation metadata, not statement data,
  -- and is deliberately reset to NULL on every cloned item.
  INSERT INTO public.driver_settlement_items (
    settlement_id,
    item_type,
    category,
    description,
    amount,
    pay_method,
    quantity,
    rate,
    unit_label,
    expected_amount_snapshot,
    load_reference_snapshot,
    pickup_date_snapshot,
    delivery_date_snapshot,
    origin_snapshot,
    destination_snapshot,
    loaded_miles_snapshot,
    deadhead_miles_snapshot,
    payable_miles_snapshot,
    eligible_revenue_snapshot,
    sort_order,
    created_by_user_id
  )
  SELECT
    v_result.id,
    i.item_type,
    i.category,
    i.description,
    i.amount,
    i.pay_method,
    i.quantity,
    i.rate,
    i.unit_label,
    NULL,
    i.load_reference_snapshot,
    i.pickup_date_snapshot,
    i.delivery_date_snapshot,
    i.origin_snapshot,
    i.destination_snapshot,
    i.loaded_miles_snapshot,
    i.deadhead_miles_snapshot,
    i.payable_miles_snapshot,
    i.eligible_revenue_snapshot,
    i.sort_order,
    v_actor
  FROM public.driver_settlement_items i
  WHERE i.settlement_id = v_prev.id
  ORDER BY i.sort_order, i.id;

  -- ---- predecessor transition: ONLY status + updated_at -------------------
  -- finalized_by_user_id and finalized_at remain historical facts; no void
  -- field is ever written here.
  UPDATE public.driver_settlements ds
  SET status = 'superseded',
      updated_at = now()
  WHERE ds.id = v_prev.id;

  -- ---- audit: exactly two rows, existing B1 vocabulary only ---------------
  INSERT INTO public.driver_settlement_events (
    settlement_id, actor_user_id, event_type, metadata
  )
  VALUES (
    v_prev.id,
    v_actor,
    'superseded',
    jsonb_build_object(
      'source', v_prev.source,
      'change', 'settlement_superseded',
      'successor_settlement_id', v_result.id
    )
  );

  INSERT INTO public.driver_settlement_events (
    settlement_id, actor_user_id, event_type, metadata
  )
  VALUES (
    v_result.id,
    v_actor,
    'created',
    jsonb_build_object(
      'source', v_result.source,
      'change', 'settlement_correction_created',
      'supersedes_settlement_id', v_prev.id,
      'version_number', v_result.version_number
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
REVOKE ALL ON FUNCTION public.settlement_create_correction_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_create_correction_draft(uuid) TO authenticated, service_role;

COMMIT;
