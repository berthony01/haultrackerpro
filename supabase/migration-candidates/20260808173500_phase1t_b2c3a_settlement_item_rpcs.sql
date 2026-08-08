-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase 1T-B2C3A — Controlled DRAFT settlement line-item CRUD RPCs.
--
-- Scope: exactly three SECURITY DEFINER plpgsql functions that are the ONLY
-- sanctioned way to add, update, or delete a public.driver_settlement_items
-- row, and only while the parent public.driver_settlements row is still a
-- DRAFT. The Phase 1T-B2B read-only RLS contract stays untouched, so every
-- direct client INSERT/UPDATE/DELETE on driver_settlement_items and
-- driver_settlement_events remains blocked.
--
-- Semantic contract (deliberate, and enforced below):
--   * `amount` is the REPORTED line amount from the statement. It is validated
--     but NEVER recalculated or overwritten from rate/miles/revenue here.
--   * pay_method (per_mile / percentage / flat_rate / manual) only DESCRIBES the
--     statement's reported pay method. A later deterministic reconciliation
--     engine computes comparisons and discrepancies.
--   * `rate` for a percentage line is stored as a human percent: 30 means 30%,
--     never 0.30.
--   * `expected_amount_snapshot` is NOT caller-settable in this phase. It is
--     stored NULL on create and left exactly as-is on update, so a later
--     controlled match/reconciliation action can derive it from the driver's
--     OWN load record.
--   * A settlement item is a record of what the statement reports. It never
--     becomes a driver load record and never creates a load match.
--
-- Deliberately NOT in this candidate:
--   * ZERO matching, ZERO driver-load writes, ZERO calculation engine;
--   * ZERO finalize / void / supersede transitions;
--   * ZERO event types other than 'updated';
--   * ZERO policies, triggers, table/column/index/type/view DDL;
--   * ZERO table grants, ZERO DML outside the function bodies;
--   * no exports, no UI, no Stripe, no pricing.
--
-- Contract properties enforced below:
--   * the actor is ALWAYS auth.uid(); no caller-supplied actor id, no
--     client-settable GUC, no email or business-name authorization, ever;
--   * no dynamic SQL, no EXECUTE, no admin / service_role bypass branch —
--     service_role may call these, but receives no special authorization;
--   * every failure raises a FIXED machine-readable message; raw Postgres
--     error text, SQLSTATE, and constraint names are never surfaced;
--   * every mutation first locks the PARENT settlement FOR UPDATE, requires
--     status exactly 'draft', and RE-DERIVES the CURRENT source-specific
--     management authorization from the STORED parent identity — historical
--     read access never grants item mutation, and a lapsed plan, delegation,
--     or carrier relationship makes the draft's items read-only;
--   * an unknown/malformed stored source always fails closed;
--   * exactly one 'updated' event row is written per successful mutation.
--
-- Concurrency: the parent FOR UPDATE lock serializes item mutation against
-- later finalization and against other header/status operations that obey the
-- same parent lock. No advisory locks, no retry loops, no dynamic SQL.
--
-- This candidate intentionally does NOT use IF NOT EXISTS, CREATE OR REPLACE,
-- or DROP: a re-apply must fail loudly rather than silently replace an
-- authorization-bearing function.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) settlement_add_draft_item(...)
--    Append one reported line to a DRAFT statement.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_add_draft_item(
  _settlement_id uuid,
  _item_type text,
  _category text,
  _description text,
  _amount numeric,
  _pay_method text DEFAULT NULL,
  _quantity numeric DEFAULT NULL,
  _rate numeric DEFAULT NULL,
  _unit_label text DEFAULT NULL,
  _load_reference_snapshot text DEFAULT NULL,
  _pickup_date_snapshot date DEFAULT NULL,
  _delivery_date_snapshot date DEFAULT NULL,
  _origin_snapshot text DEFAULT NULL,
  _destination_snapshot text DEFAULT NULL,
  _loaded_miles_snapshot numeric DEFAULT NULL,
  _deadhead_miles_snapshot numeric DEFAULT NULL,
  _payable_miles_snapshot numeric DEFAULT NULL,
  _eligible_revenue_snapshot numeric DEFAULT NULL,
  _sort_order integer DEFAULT 0
)
RETURNS public.driver_settlement_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_parent public.driver_settlements;
  v_type text;
  v_method text;
  v_category text;
  v_description text;
  v_unit text;
  v_load_ref text;
  v_origin text;
  v_destination text;
  v_quantity numeric;
  v_item public.driver_settlement_items;
BEGIN
  IF v_actor IS NULL OR _settlement_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_request';
  END IF;

  -- ---- parent lock + CURRENT source authorization -------------------------
  SELECT ds.* INTO v_parent
  FROM public.driver_settlements ds
  WHERE ds.id = _settlement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found';
  END IF;

  IF v_parent.status <> 'draft' THEN
    RAISE EXCEPTION 'settlement_not_editable';
  END IF;

  IF v_parent.source = 'driver_imported' THEN
    IF NOT (
      (v_parent.driver_user_id = v_actor
        AND public.settlement_current_user_can_manage_driver_import())
      OR public.settlement_current_user_can_assist_driver(
           v_parent.driver_user_id, 'settlements_manage', true)
    ) THEN
      RAISE EXCEPTION 'settlement_driver_import_not_authorized';
    END IF;
  ELSIF v_parent.source = 'carrier_issued' THEN
    IF v_parent.carrier_recruiter_profile_id IS NULL
       OR v_parent.carrier_driver_relationship_id IS NULL
       OR NOT public.settlement_current_user_can_manage_carrier(
            v_parent.carrier_recruiter_profile_id,
            v_parent.carrier_driver_relationship_id,
            v_parent.driver_user_id) THEN
      RAISE EXCEPTION 'settlement_carrier_not_authorized';
    END IF;
  ELSIF v_parent.source = 'agency_prepared' THEN
    IF v_parent.agency_id IS NULL
       OR NOT public.settlement_current_user_can_manage_agency(
            v_parent.agency_id,
            v_parent.driver_user_id,
            'settlements_manage') THEN
      RAISE EXCEPTION 'settlement_agency_not_authorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'settlement_invalid_source';
  END IF;

  -- ---- item type ----------------------------------------------------------
  v_type := _item_type;
  IF v_type IS NULL
     OR v_type NOT IN ('load_pay', 'earning', 'reimbursement', 'deduction', 'withholding') THEN
    RAISE EXCEPTION 'settlement_invalid_item_type';
  END IF;

  -- ---- reported amount (validated, never recalculated) --------------------
  IF _amount IS NULL OR _amount < 0 OR _amount > 999999999999.99 THEN
    RAISE EXCEPTION 'settlement_invalid_item_amount';
  END IF;

  -- ---- text normalization -------------------------------------------------
  v_category := nullif(btrim(coalesce(_category, ''), E' \t\r\n'), '');
  v_description := nullif(btrim(coalesce(_description, ''), E' \t\r\n'), '');
  v_unit := nullif(btrim(coalesce(_unit_label, ''), E' \t\r\n'), '');
  v_load_ref := nullif(btrim(coalesce(_load_reference_snapshot, ''), E' \t\r\n'), '');
  v_origin := nullif(btrim(coalesce(_origin_snapshot, ''), E' \t\r\n'), '');
  v_destination := nullif(btrim(coalesce(_destination_snapshot, ''), E' \t\r\n'), '');

  IF length(coalesce(v_category, '')) > 100
     OR length(coalesce(v_description, '')) > 1000
     OR length(coalesce(v_unit, '')) > 50
     OR length(coalesce(v_load_ref, '')) > 200
     OR length(coalesce(v_origin, '')) > 200
     OR length(coalesce(v_destination, '')) > 200 THEN
    RAISE EXCEPTION 'settlement_item_text_too_long';
  END IF;

  -- ---- nullable numeric bounds -------------------------------------------
  IF (_quantity IS NOT NULL AND (_quantity < 0 OR _quantity > 9999999999.9999))
     OR (_rate IS NOT NULL AND (_rate < 0 OR _rate > 99999999.999999))
     OR (_loaded_miles_snapshot IS NOT NULL
          AND (_loaded_miles_snapshot < 0 OR _loaded_miles_snapshot > 9999999999.99))
     OR (_deadhead_miles_snapshot IS NOT NULL
          AND (_deadhead_miles_snapshot < 0 OR _deadhead_miles_snapshot > 9999999999.99))
     OR (_payable_miles_snapshot IS NOT NULL
          AND (_payable_miles_snapshot < 0 OR _payable_miles_snapshot > 9999999999.99))
     OR (_eligible_revenue_snapshot IS NOT NULL
          AND (_eligible_revenue_snapshot < 0
               OR _eligible_revenue_snapshot > 999999999999.99)) THEN
    RAISE EXCEPTION 'settlement_invalid_item_numeric';
  END IF;

  -- ---- date ordering ------------------------------------------------------
  IF _pickup_date_snapshot IS NOT NULL
     AND _delivery_date_snapshot IS NOT NULL
     AND _delivery_date_snapshot < _pickup_date_snapshot THEN
    RAISE EXCEPTION 'settlement_invalid_item_dates';
  END IF;

  -- ---- sort order ---------------------------------------------------------
  IF _sort_order IS NULL OR _sort_order < 0 OR _sort_order > 1000000 THEN
    RAISE EXCEPTION 'settlement_invalid_sort_order';
  END IF;

  -- ---- item shape ---------------------------------------------------------
  v_method := NULL;
  v_quantity := _quantity;

  IF v_type = 'load_pay' THEN
    v_method := _pay_method;
    IF v_method IS NULL
       OR v_method NOT IN ('per_mile', 'percentage', 'flat_rate', 'manual') THEN
      RAISE EXCEPTION 'settlement_invalid_pay_method';
    END IF;

    IF v_method = 'per_mile' THEN
      IF _rate IS NULL
         OR _payable_miles_snapshot IS NULL
         OR _eligible_revenue_snapshot IS NOT NULL
         OR (_quantity IS NOT NULL AND _quantity <> _payable_miles_snapshot) THEN
        RAISE EXCEPTION 'settlement_invalid_pay_shape';
      END IF;
      v_quantity := _payable_miles_snapshot;
      v_unit := 'mile';
    ELSIF v_method = 'percentage' THEN
      IF _rate IS NULL
         OR _rate > 100
         OR _eligible_revenue_snapshot IS NULL
         OR _quantity IS NOT NULL THEN
        RAISE EXCEPTION 'settlement_invalid_pay_shape';
      END IF;
      v_quantity := NULL;
      v_unit := 'percent';
    ELSE
      IF _quantity IS NOT NULL
         OR _rate IS NOT NULL
         OR _eligible_revenue_snapshot IS NOT NULL THEN
        RAISE EXCEPTION 'settlement_invalid_pay_shape';
      END IF;
      v_quantity := NULL;
      v_unit := NULL;
    END IF;
  ELSE
    IF _pay_method IS NOT NULL
       OR _quantity IS NOT NULL
       OR _rate IS NOT NULL
       OR v_unit IS NOT NULL
       OR v_load_ref IS NOT NULL
       OR _pickup_date_snapshot IS NOT NULL
       OR _delivery_date_snapshot IS NOT NULL
       OR v_origin IS NOT NULL
       OR v_destination IS NOT NULL
       OR _loaded_miles_snapshot IS NOT NULL
       OR _deadhead_miles_snapshot IS NOT NULL
       OR _payable_miles_snapshot IS NOT NULL
       OR _eligible_revenue_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'settlement_invalid_item_shape';
    END IF;
    v_quantity := NULL;
  END IF;

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
  VALUES (
    v_parent.id,
    v_type,
    v_category,
    v_description,
    _amount,
    v_method,
    v_quantity,
    _rate,
    v_unit,
    NULL,
    v_load_ref,
    _pickup_date_snapshot,
    _delivery_date_snapshot,
    v_origin,
    v_destination,
    _loaded_miles_snapshot,
    _deadhead_miles_snapshot,
    _payable_miles_snapshot,
    _eligible_revenue_snapshot,
    _sort_order,
    v_actor
  )
  RETURNING * INTO v_item;

  INSERT INTO public.driver_settlement_events (
    settlement_id, actor_user_id, event_type, metadata
  )
  VALUES (
    v_parent.id,
    v_actor,
    'updated',
    jsonb_build_object(
      'source', v_parent.source,
      'change', 'item_added',
      'item_id', v_item.id,
      'item_type', v_item.item_type
    )
  );

  RETURN v_item;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) settlement_update_draft_item(...)
--    Full replacement of the mutable fields of one DRAFT line.
--    id, settlement_id, expected_amount_snapshot, created_by_user_id and
--    created_at are never reachable by a caller: there is deliberately no
--    settlement parameter, so an item can never be moved to another statement.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_update_draft_item(
  _item_id uuid,
  _item_type text,
  _category text,
  _description text,
  _amount numeric,
  _pay_method text DEFAULT NULL,
  _quantity numeric DEFAULT NULL,
  _rate numeric DEFAULT NULL,
  _unit_label text DEFAULT NULL,
  _load_reference_snapshot text DEFAULT NULL,
  _pickup_date_snapshot date DEFAULT NULL,
  _delivery_date_snapshot date DEFAULT NULL,
  _origin_snapshot text DEFAULT NULL,
  _destination_snapshot text DEFAULT NULL,
  _loaded_miles_snapshot numeric DEFAULT NULL,
  _deadhead_miles_snapshot numeric DEFAULT NULL,
  _payable_miles_snapshot numeric DEFAULT NULL,
  _eligible_revenue_snapshot numeric DEFAULT NULL,
  _sort_order integer DEFAULT 0
)
RETURNS public.driver_settlement_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_parent_id uuid;
  v_parent public.driver_settlements;
  v_item public.driver_settlement_items;
  v_type text;
  v_method text;
  v_category text;
  v_description text;
  v_unit text;
  v_load_ref text;
  v_origin text;
  v_destination text;
  v_quantity numeric;
BEGIN
  IF v_actor IS NULL OR _item_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_request';
  END IF;

  SELECT dsi.settlement_id INTO v_parent_id
  FROM public.driver_settlement_items dsi
  WHERE dsi.id = _item_id;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'settlement_item_not_found';
  END IF;

  -- ---- parent lock + CURRENT source authorization -------------------------
  SELECT ds.* INTO v_parent
  FROM public.driver_settlements ds
  WHERE ds.id = v_parent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found';
  END IF;

  IF v_parent.status <> 'draft' THEN
    RAISE EXCEPTION 'settlement_not_editable';
  END IF;

  IF v_parent.source = 'driver_imported' THEN
    IF NOT (
      (v_parent.driver_user_id = v_actor
        AND public.settlement_current_user_can_manage_driver_import())
      OR public.settlement_current_user_can_assist_driver(
           v_parent.driver_user_id, 'settlements_manage', true)
    ) THEN
      RAISE EXCEPTION 'settlement_driver_import_not_authorized';
    END IF;
  ELSIF v_parent.source = 'carrier_issued' THEN
    IF v_parent.carrier_recruiter_profile_id IS NULL
       OR v_parent.carrier_driver_relationship_id IS NULL
       OR NOT public.settlement_current_user_can_manage_carrier(
            v_parent.carrier_recruiter_profile_id,
            v_parent.carrier_driver_relationship_id,
            v_parent.driver_user_id) THEN
      RAISE EXCEPTION 'settlement_carrier_not_authorized';
    END IF;
  ELSIF v_parent.source = 'agency_prepared' THEN
    IF v_parent.agency_id IS NULL
       OR NOT public.settlement_current_user_can_manage_agency(
            v_parent.agency_id,
            v_parent.driver_user_id,
            'settlements_manage') THEN
      RAISE EXCEPTION 'settlement_agency_not_authorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'settlement_invalid_source';
  END IF;

  -- ---- item lock, still under the same parent -----------------------------
  SELECT dsi.* INTO v_item
  FROM public.driver_settlement_items dsi
  WHERE dsi.id = _item_id
    AND dsi.settlement_id = v_parent.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_item_not_found';
  END IF;

  -- ---- item type ----------------------------------------------------------
  v_type := _item_type;
  IF v_type IS NULL
     OR v_type NOT IN ('load_pay', 'earning', 'reimbursement', 'deduction', 'withholding') THEN
    RAISE EXCEPTION 'settlement_invalid_item_type';
  END IF;

  -- ---- reported amount (validated, never recalculated) --------------------
  IF _amount IS NULL OR _amount < 0 OR _amount > 999999999999.99 THEN
    RAISE EXCEPTION 'settlement_invalid_item_amount';
  END IF;

  -- ---- text normalization -------------------------------------------------
  v_category := nullif(btrim(coalesce(_category, ''), E' \t\r\n'), '');
  v_description := nullif(btrim(coalesce(_description, ''), E' \t\r\n'), '');
  v_unit := nullif(btrim(coalesce(_unit_label, ''), E' \t\r\n'), '');
  v_load_ref := nullif(btrim(coalesce(_load_reference_snapshot, ''), E' \t\r\n'), '');
  v_origin := nullif(btrim(coalesce(_origin_snapshot, ''), E' \t\r\n'), '');
  v_destination := nullif(btrim(coalesce(_destination_snapshot, ''), E' \t\r\n'), '');

  IF length(coalesce(v_category, '')) > 100
     OR length(coalesce(v_description, '')) > 1000
     OR length(coalesce(v_unit, '')) > 50
     OR length(coalesce(v_load_ref, '')) > 200
     OR length(coalesce(v_origin, '')) > 200
     OR length(coalesce(v_destination, '')) > 200 THEN
    RAISE EXCEPTION 'settlement_item_text_too_long';
  END IF;

  -- ---- nullable numeric bounds -------------------------------------------
  IF (_quantity IS NOT NULL AND (_quantity < 0 OR _quantity > 9999999999.9999))
     OR (_rate IS NOT NULL AND (_rate < 0 OR _rate > 99999999.999999))
     OR (_loaded_miles_snapshot IS NOT NULL
          AND (_loaded_miles_snapshot < 0 OR _loaded_miles_snapshot > 9999999999.99))
     OR (_deadhead_miles_snapshot IS NOT NULL
          AND (_deadhead_miles_snapshot < 0 OR _deadhead_miles_snapshot > 9999999999.99))
     OR (_payable_miles_snapshot IS NOT NULL
          AND (_payable_miles_snapshot < 0 OR _payable_miles_snapshot > 9999999999.99))
     OR (_eligible_revenue_snapshot IS NOT NULL
          AND (_eligible_revenue_snapshot < 0
               OR _eligible_revenue_snapshot > 999999999999.99)) THEN
    RAISE EXCEPTION 'settlement_invalid_item_numeric';
  END IF;

  -- ---- date ordering ------------------------------------------------------
  IF _pickup_date_snapshot IS NOT NULL
     AND _delivery_date_snapshot IS NOT NULL
     AND _delivery_date_snapshot < _pickup_date_snapshot THEN
    RAISE EXCEPTION 'settlement_invalid_item_dates';
  END IF;

  -- ---- sort order ---------------------------------------------------------
  IF _sort_order IS NULL OR _sort_order < 0 OR _sort_order > 1000000 THEN
    RAISE EXCEPTION 'settlement_invalid_sort_order';
  END IF;

  -- ---- item shape ---------------------------------------------------------
  v_method := NULL;
  v_quantity := _quantity;

  IF v_type = 'load_pay' THEN
    v_method := _pay_method;
    IF v_method IS NULL
       OR v_method NOT IN ('per_mile', 'percentage', 'flat_rate', 'manual') THEN
      RAISE EXCEPTION 'settlement_invalid_pay_method';
    END IF;

    IF v_method = 'per_mile' THEN
      IF _rate IS NULL
         OR _payable_miles_snapshot IS NULL
         OR _eligible_revenue_snapshot IS NOT NULL
         OR (_quantity IS NOT NULL AND _quantity <> _payable_miles_snapshot) THEN
        RAISE EXCEPTION 'settlement_invalid_pay_shape';
      END IF;
      v_quantity := _payable_miles_snapshot;
      v_unit := 'mile';
    ELSIF v_method = 'percentage' THEN
      IF _rate IS NULL
         OR _rate > 100
         OR _eligible_revenue_snapshot IS NULL
         OR _quantity IS NOT NULL THEN
        RAISE EXCEPTION 'settlement_invalid_pay_shape';
      END IF;
      v_quantity := NULL;
      v_unit := 'percent';
    ELSE
      IF _quantity IS NOT NULL
         OR _rate IS NOT NULL
         OR _eligible_revenue_snapshot IS NOT NULL THEN
        RAISE EXCEPTION 'settlement_invalid_pay_shape';
      END IF;
      v_quantity := NULL;
      v_unit := NULL;
    END IF;
  ELSE
    IF _pay_method IS NOT NULL
       OR _quantity IS NOT NULL
       OR _rate IS NOT NULL
       OR v_unit IS NOT NULL
       OR v_load_ref IS NOT NULL
       OR _pickup_date_snapshot IS NOT NULL
       OR _delivery_date_snapshot IS NOT NULL
       OR v_origin IS NOT NULL
       OR v_destination IS NOT NULL
       OR _loaded_miles_snapshot IS NOT NULL
       OR _deadhead_miles_snapshot IS NOT NULL
       OR _payable_miles_snapshot IS NOT NULL
       OR _eligible_revenue_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'settlement_invalid_item_shape';
    END IF;
    v_quantity := NULL;
  END IF;

  -- expected_amount_snapshot is intentionally absent from this SET list: the
  -- stored value (NULL until a later controlled match action derives it) is
  -- preserved and is never caller-settable.
  UPDATE public.driver_settlement_items dsi
     SET item_type = v_type,
         category = v_category,
         description = v_description,
         amount = _amount,
         pay_method = v_method,
         quantity = v_quantity,
         rate = _rate,
         unit_label = v_unit,
         load_reference_snapshot = v_load_ref,
         pickup_date_snapshot = _pickup_date_snapshot,
         delivery_date_snapshot = _delivery_date_snapshot,
         origin_snapshot = v_origin,
         destination_snapshot = v_destination,
         loaded_miles_snapshot = _loaded_miles_snapshot,
         deadhead_miles_snapshot = _deadhead_miles_snapshot,
         payable_miles_snapshot = _payable_miles_snapshot,
         eligible_revenue_snapshot = _eligible_revenue_snapshot,
         sort_order = _sort_order,
         updated_at = now()
   WHERE dsi.id = v_item.id
  RETURNING * INTO v_item;

  INSERT INTO public.driver_settlement_events (
    settlement_id, actor_user_id, event_type, metadata
  )
  VALUES (
    v_parent.id,
    v_actor,
    'updated',
    jsonb_build_object(
      'source', v_parent.source,
      'change', 'item_updated',
      'item_id', v_item.id,
      'item_type', v_item.item_type
    )
  );

  RETURN v_item;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) settlement_delete_draft_item(_item_id)
--    Remove one DRAFT line. The parent statement itself always survives.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_delete_draft_item(
  _item_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_parent_id uuid;
  v_parent public.driver_settlements;
  v_item public.driver_settlement_items;
  v_item_id uuid;
  v_item_type text;
BEGIN
  IF v_actor IS NULL OR _item_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_request';
  END IF;

  SELECT dsi.settlement_id INTO v_parent_id
  FROM public.driver_settlement_items dsi
  WHERE dsi.id = _item_id;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'settlement_item_not_found';
  END IF;

  -- ---- parent lock + CURRENT source authorization -------------------------
  SELECT ds.* INTO v_parent
  FROM public.driver_settlements ds
  WHERE ds.id = v_parent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found';
  END IF;

  IF v_parent.status <> 'draft' THEN
    RAISE EXCEPTION 'settlement_not_editable';
  END IF;

  IF v_parent.source = 'driver_imported' THEN
    IF NOT (
      (v_parent.driver_user_id = v_actor
        AND public.settlement_current_user_can_manage_driver_import())
      OR public.settlement_current_user_can_assist_driver(
           v_parent.driver_user_id, 'settlements_manage', true)
    ) THEN
      RAISE EXCEPTION 'settlement_driver_import_not_authorized';
    END IF;
  ELSIF v_parent.source = 'carrier_issued' THEN
    IF v_parent.carrier_recruiter_profile_id IS NULL
       OR v_parent.carrier_driver_relationship_id IS NULL
       OR NOT public.settlement_current_user_can_manage_carrier(
            v_parent.carrier_recruiter_profile_id,
            v_parent.carrier_driver_relationship_id,
            v_parent.driver_user_id) THEN
      RAISE EXCEPTION 'settlement_carrier_not_authorized';
    END IF;
  ELSIF v_parent.source = 'agency_prepared' THEN
    IF v_parent.agency_id IS NULL
       OR NOT public.settlement_current_user_can_manage_agency(
            v_parent.agency_id,
            v_parent.driver_user_id,
            'settlements_manage') THEN
      RAISE EXCEPTION 'settlement_agency_not_authorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'settlement_invalid_source';
  END IF;

  SELECT dsi.* INTO v_item
  FROM public.driver_settlement_items dsi
  WHERE dsi.id = _item_id
    AND dsi.settlement_id = v_parent.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_item_not_found';
  END IF;

  v_item_id := v_item.id;
  v_item_type := v_item.item_type;

  DELETE FROM public.driver_settlement_items dsi
   WHERE dsi.id = v_item_id;

  INSERT INTO public.driver_settlement_events (
    settlement_id, actor_user_id, event_type, metadata
  )
  VALUES (
    v_parent.id,
    v_actor,
    'updated',
    jsonb_build_object(
      'source', v_parent.source,
      'change', 'item_deleted',
      'item_id', v_item_id,
      'item_type', v_item_type
    )
  );

  RETURN v_item_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- ACL contract: anon and PUBLIC get nothing; authenticated and service_role may
-- execute. No table privileges are granted anywhere in this candidate.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.settlement_add_draft_item(uuid, text, text, text, numeric, text, numeric, numeric, text, text, date, date, text, text, numeric, numeric, numeric, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_add_draft_item(uuid, text, text, text, numeric, text, numeric, numeric, text, text, date, date, text, text, numeric, numeric, numeric, numeric, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_update_draft_item(uuid, text, text, text, numeric, text, numeric, numeric, text, text, date, date, text, text, numeric, numeric, numeric, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_update_draft_item(uuid, text, text, text, numeric, text, numeric, numeric, text, text, date, date, text, text, numeric, numeric, numeric, numeric, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_delete_draft_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_delete_draft_item(uuid) TO authenticated, service_role;

COMMIT;
