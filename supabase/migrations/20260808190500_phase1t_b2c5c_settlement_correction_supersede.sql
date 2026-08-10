-- Phase 1T active-migration promotion.
--
-- Source candidate: supabase/migration-candidates/20260808190500_phase1t_b2c5c_settlement_correction_supersede.sql
--
-- This commit creates the managed migration FILE only. The SQL below is NOT
-- applied to production or to any connected database by this task.
--
-- The executable body below, from the first exact BEGIN; line through the final
-- exact COMMIT; line, is byte-for-byte identical to the accepted candidate.

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
