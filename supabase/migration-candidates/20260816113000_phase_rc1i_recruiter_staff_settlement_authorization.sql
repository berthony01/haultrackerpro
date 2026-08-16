-- Phase RC-1I — Recruiter staff settlement authorization.
--
-- SIXTH operational consumer of the RC-1B recruiter staff permission
-- contract, after opportunities (RC-1D), applications (RC-1E), referrals
-- (RC-1F), contracts (RC-1G) and reports (RC-1H). Authorizes exactly three
-- permission keys:
--   settlements_view, settlements_prepare, settlements_finalize
--
-- Security contract:
--   * STAFF-ONLY path. The canonical recruiter OWNER is explicitly EXCLUDED
--     from these helpers. Owner authorization keeps flowing exclusively
--     through the frozen 1T owner helpers
--     (settlement_current_user_can_manage_carrier / _administer_carrier),
--     which remain unmodified.
--   * STAFF requires ALL of:
--       - non-owner caller, AND
--       - posting-ready / non-suspended workspace
--         (public.recruiter_profile_can_manage_opportunities), AND
--       - the explicit RC-1B boolean permission on an ACTIVE membership
--         (public.current_user_has_recruiter_permission), AND
--       - a STANDALONE recruiter/carrier billing row for that recruiter
--         workspace at plan growth|fleet with status active|trialing.
--     Role labels alone grant nothing.
--   * Agency-included recruiter entitlement is deliberately NOT consulted and
--     NOT extended to recruiter staff. No Agency table/function is touched.
--   * Carrier-issued statements ONLY. Driver-imported and agency-prepared
--     sources are untouched by every branch added here.
--   * The relationship helper additionally requires the EXACT active
--     carrier↔driver relationship triple, mirroring the owner helper: a
--     relationship id belonging to another workspace, another driver, or a
--     non-active status authorizes nothing.
--   * settlements_prepare does NOT imply settlements_finalize, and
--     settlements_finalize does NOT imply settlements_prepare. Correction /
--     supersede requires BOTH.
--   * settlements_view grants READ only. It never reaches a lifecycle RPC.
--
-- FROZEN — NOT replaced or redefined by this migration:
--   public.current_user_has_recruiter_permission(...),
--   public.recruiter_profile_can_manage_opportunities(...),
--   public.is_recruiter_owner(...),
--   public.settlement_current_user_can_manage_carrier(...),
--   public.settlement_current_user_can_administer_carrier(...),
--   public.settlement_current_user_can_manage_agency(...),
--   public.settlement_current_user_can_manage_driver_import(...),
--   public.settlement_current_user_can_assist_driver(...),
--   public.settlement_current_user_can_view_settlement(...),
--   all owner and driver and agency settlement paths,
--   every existing settlement RLS policy.

BEGIN;

-- ---------------------------------------------------------------------------
-- A) Staff-only settlement action helper (workspace scope)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settlement_current_user_can_recruiter_staff_action(
  _recruiter_id uuid,
  _permission public.recruiter_workspace_permission
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND _recruiter_id IS NOT NULL
    AND _permission IS NOT NULL
    AND _permission IN (
      'settlements_view'::public.recruiter_workspace_permission,
      'settlements_prepare'::public.recruiter_workspace_permission,
      'settlements_finalize'::public.recruiter_workspace_permission
    )
    -- Canonical owner is excluded from the STAFF settlement path entirely.
    AND NOT public.is_recruiter_owner(auth.uid(), _recruiter_id)
    -- Non-owner STAFF branch. No role shortcut anywhere.
    AND public.recruiter_profile_can_manage_opportunities(_recruiter_id)
    AND public.current_user_has_recruiter_permission(_recruiter_id, _permission)
    AND EXISTS (
      SELECT 1
      FROM public.recruiter_billing_profiles b
      WHERE b.recruiter_id = _recruiter_id
        AND b.plan IN ('growth', 'fleet')
        AND b.status IN ('active', 'trialing') -- trial-allowlist
    );
$function$;

REVOKE ALL ON FUNCTION public.settlement_current_user_can_recruiter_staff_action(uuid, public.recruiter_workspace_permission) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settlement_current_user_can_recruiter_staff_action(uuid, public.recruiter_workspace_permission) FROM anon;
GRANT EXECUTE ON FUNCTION public.settlement_current_user_can_recruiter_staff_action(uuid, public.recruiter_workspace_permission) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- B) Staff-only settlement action helper (exact relationship scope)
-- ---------------------------------------------------------------------------
-- Mirrors the owner helper's relationship contract: the triple
-- (recruiter, relationship, driver) must be an EXACT ACTIVE row.
CREATE OR REPLACE FUNCTION public.settlement_current_user_can_recruiter_staff_relationship_action(
  _recruiter_id uuid,
  _relationship_id uuid,
  _driver_user_id uuid,
  _permission public.recruiter_workspace_permission
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    _recruiter_id IS NOT NULL
    AND _relationship_id IS NOT NULL
    AND _driver_user_id IS NOT NULL
    AND public.settlement_current_user_can_recruiter_staff_action(
          _recruiter_id, _permission)
    AND EXISTS (
      SELECT 1
      FROM public.carrier_driver_relationships r
      WHERE r.id = _relationship_id
        AND r.recruiter_id = _recruiter_id
        AND r.driver_user_id = _driver_user_id
        AND r.status = 'active'
    );
$function$;

REVOKE ALL ON FUNCTION public.settlement_current_user_can_recruiter_staff_relationship_action(uuid, uuid, uuid, public.recruiter_workspace_permission) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settlement_current_user_can_recruiter_staff_relationship_action(uuid, uuid, uuid, public.recruiter_workspace_permission) FROM anon;
GRANT EXECUTE ON FUNCTION public.settlement_current_user_can_recruiter_staff_relationship_action(uuid, uuid, uuid, public.recruiter_workspace_permission) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- C) Staff relationship listing RPC (settlements_view only)
-- ---------------------------------------------------------------------------
-- Minimal projection: relationship identity + status + timestamps. No driver
-- contact data, no financial data, no billing data.
CREATE OR REPLACE FUNCTION public.list_recruiter_staff_settlement_relationships(
  _recruiter_id uuid
)
RETURNS TABLE (
  id uuid,
  recruiter_id uuid,
  driver_user_id uuid,
  status text,
  accepted_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.settlement_current_user_can_recruiter_staff_action(
       _recruiter_id,
       'settlements_view'::public.recruiter_workspace_permission) THEN
    RAISE EXCEPTION 'recruiter_staff_settlements_not_authorized';
  END IF;

  RETURN QUERY
  SELECT r.id,
         r.recruiter_id,
         r.driver_user_id,
         r.status,
         r.accepted_at,
         r.created_at
  FROM public.carrier_driver_relationships r
  WHERE r.recruiter_id = _recruiter_id
    AND r.status = 'active'
  ORDER BY r.created_at ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_recruiter_staff_settlement_relationships(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_recruiter_staff_settlement_relationships(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_recruiter_staff_settlement_relationships(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D) Additive STAFF SELECT policies (carrier-issued statements only)
-- ---------------------------------------------------------------------------
-- Every existing SELECT policy is left untouched; these are additional
-- permissive policies that only ever widen access to a non-owner staff member
-- holding settlements_view on the exact issuing workspace + active
-- relationship.
DROP POLICY IF EXISTS carrier_driver_relationships_select_recruiter_staff
  ON public.carrier_driver_relationships;
CREATE POLICY carrier_driver_relationships_select_recruiter_staff
  ON public.carrier_driver_relationships
  FOR SELECT
  TO authenticated
  USING (
    carrier_driver_relationships.status = 'active'
    AND public.settlement_current_user_can_recruiter_staff_relationship_action(
      carrier_driver_relationships.recruiter_id,
      carrier_driver_relationships.id,
      carrier_driver_relationships.driver_user_id,
      'settlements_view'::public.recruiter_workspace_permission
    )
  );

DROP POLICY IF EXISTS driver_settlements_select_recruiter_staff
  ON public.driver_settlements;
CREATE POLICY driver_settlements_select_recruiter_staff
  ON public.driver_settlements
  FOR SELECT
  TO authenticated
  USING (
    driver_settlements.source = 'carrier_issued'
    AND driver_settlements.carrier_recruiter_profile_id IS NOT NULL
    AND driver_settlements.carrier_driver_relationship_id IS NOT NULL
    AND public.settlement_current_user_can_recruiter_staff_relationship_action(
      driver_settlements.carrier_recruiter_profile_id,
      driver_settlements.carrier_driver_relationship_id,
      driver_settlements.driver_user_id,
      'settlements_view'::public.recruiter_workspace_permission
    )
  );

DROP POLICY IF EXISTS driver_settlement_items_select_recruiter_staff
  ON public.driver_settlement_items;
CREATE POLICY driver_settlement_items_select_recruiter_staff
  ON public.driver_settlement_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.driver_settlements ds
      WHERE ds.id = driver_settlement_items.settlement_id
        AND ds.source = 'carrier_issued'
        AND ds.carrier_recruiter_profile_id IS NOT NULL
        AND ds.carrier_driver_relationship_id IS NOT NULL
        AND public.settlement_current_user_can_recruiter_staff_relationship_action(
          ds.carrier_recruiter_profile_id,
          ds.carrier_driver_relationship_id,
          ds.driver_user_id,
          'settlements_view'::public.recruiter_workspace_permission
        )
    )
  );

DROP POLICY IF EXISTS driver_settlement_matches_select_recruiter_staff
  ON public.driver_settlement_matches;
CREATE POLICY driver_settlement_matches_select_recruiter_staff
  ON public.driver_settlement_matches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.driver_settlement_items si
      JOIN public.driver_settlements ds ON ds.id = si.settlement_id
      WHERE si.id = driver_settlement_matches.settlement_item_id
        AND ds.source = 'carrier_issued'
        AND ds.carrier_recruiter_profile_id IS NOT NULL
        AND ds.carrier_driver_relationship_id IS NOT NULL
        AND public.settlement_current_user_can_recruiter_staff_relationship_action(
          ds.carrier_recruiter_profile_id,
          ds.carrier_driver_relationship_id,
          ds.driver_user_id,
          'settlements_view'::public.recruiter_workspace_permission
        )
    )
  );

DROP POLICY IF EXISTS driver_settlement_events_select_recruiter_staff
  ON public.driver_settlement_events;
CREATE POLICY driver_settlement_events_select_recruiter_staff
  ON public.driver_settlement_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.driver_settlements ds
      WHERE ds.id = driver_settlement_events.settlement_id
        AND ds.source = 'carrier_issued'
        AND ds.carrier_recruiter_profile_id IS NOT NULL
        AND ds.carrier_driver_relationship_id IS NOT NULL
        AND public.settlement_current_user_can_recruiter_staff_relationship_action(
          ds.carrier_recruiter_profile_id,
          ds.carrier_driver_relationship_id,
          ds.driver_user_id,
          'settlements_view'::public.recruiter_workspace_permission
        )
    )
  );

-- ---------------------------------------------------------------------------
-- E) Lifecycle RPC carrier-branch extension (8 functions)
-- ---------------------------------------------------------------------------
-- Each function below is re-declared byte-identically to its 1T definition
-- EXCEPT for the single carrier-issued authorization expression, which is
-- widened from
--     settlement_current_user_can_manage_carrier(...)
-- to
--     settlement_current_user_can_manage_carrier(...)
--     OR settlement_current_user_can_recruiter_staff_relationship_action(..., <key>)
-- No other branch, validation, projection or side effect is altered.
--
-- Permission mapping:
--   settlement_create_carrier_draft      -> settlements_prepare
--   settlement_update_draft_header       -> settlements_prepare
--   settlement_add_draft_item            -> settlements_prepare
--   settlement_update_draft_item         -> settlements_prepare
--   settlement_delete_draft_item         -> settlements_prepare
--   settlement_finalize_draft            -> settlements_finalize
--   settlement_void_settlement           -> settlements_finalize
--   settlement_create_correction_draft   -> settlements_prepare AND settlements_finalize

-- ---- settlement_create_carrier_draft ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.settlement_create_carrier_draft(
  _recruiter_id uuid,
  _relationship_id uuid,
  _driver_user_id uuid,
  _period_start date,
  _period_end date,
  _pay_date date DEFAULT NULL,
  _statement_reference text DEFAULT NULL,
  _reported_gross_amount numeric DEFAULT NULL,
  _reported_net_amount numeric DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.driver_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_carrier_name text;
  v_reference text;
  v_notes text;
  v_row public.driver_settlements;
BEGIN
  IF v_actor IS NULL
     OR _recruiter_id IS NULL
     OR _relationship_id IS NULL
     OR _driver_user_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_request';
  END IF;

  IF NOT (
            public.settlement_current_user_can_manage_carrier(
              _recruiter_id,
              _relationship_id,
              _driver_user_id)
            OR public.settlement_current_user_can_recruiter_staff_relationship_action(
                _recruiter_id,
                _relationship_id,
                _driver_user_id,
                'settlements_prepare'::public.recruiter_workspace_permission)
          ) THEN
    RAISE EXCEPTION 'settlement_carrier_not_authorized';
  END IF;

  -- Canonical server-side business name; never caller-supplied.
  SELECT nullif(btrim(coalesce(rp.company_name, ''), E' \t\r\n'), '')
    INTO v_carrier_name
    FROM public.recruiter_profiles rp
   WHERE rp.id = _recruiter_id;

  IF v_carrier_name IS NULL OR length(v_carrier_name) > 200 THEN
    RAISE EXCEPTION 'settlement_carrier_name_unavailable';
  END IF;

  IF _period_start IS NULL OR _period_end IS NULL OR _period_end < _period_start THEN
    RAISE EXCEPTION 'settlement_invalid_period';
  END IF;

  IF (_reported_gross_amount IS NOT NULL
       AND (_reported_gross_amount::text IN ('NaN', 'Infinity', '-Infinity')
            OR _reported_gross_amount < 0
            OR _reported_gross_amount > 999999999999.99))
     OR (_reported_net_amount IS NOT NULL
       AND (_reported_net_amount::text IN ('NaN', 'Infinity', '-Infinity')
            OR _reported_net_amount < -999999999999.99
            OR _reported_net_amount > 999999999999.99)) THEN
    RAISE EXCEPTION 'settlement_invalid_amount';
  END IF;

  v_reference := nullif(btrim(coalesce(_statement_reference, ''), E' \t\r\n'), '');
  v_notes := nullif(btrim(coalesce(_notes, ''), E' \t\r\n'), '');

  IF length(coalesce(v_reference, '')) > 200
     OR length(coalesce(v_notes, '')) > 5000 THEN
    RAISE EXCEPTION 'settlement_text_too_long';
  END IF;

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
    created_by_user_id,
    finalized_by_user_id,
    finalized_at,
    voided_by_user_id,
    voided_at
  )
  VALUES (
    _driver_user_id,
    'carrier_issued',
    'draft',
    _recruiter_id,
    _relationship_id,
    NULL,
    _period_start,
    _period_end,
    _pay_date,
    v_reference,
    v_carrier_name,
    v_carrier_name,
    _reported_gross_amount,
    _reported_net_amount,
    v_notes,
    '1',
    1,
    NULL,
    v_actor,
    NULL,
    NULL,
    NULL,
    NULL
  )
  RETURNING * INTO v_row;

  INSERT INTO public.driver_settlement_events (
    settlement_id, actor_user_id, event_type, metadata
  )
  VALUES (
    v_row.id,
    v_actor,
    'created',
    jsonb_build_object(
      'source', 'carrier_issued',
      'recruiter_id', _recruiter_id,
      'relationship_id', _relationship_id
    )
  );

  RETURN v_row;
END;
$$;

-- ---- settlement_update_draft_header ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.settlement_update_draft_header(
  _settlement_id uuid,
  _period_start date,
  _period_end date,
  _pay_date date DEFAULT NULL,
  _statement_reference text DEFAULT NULL,
  _payer_name_snapshot text DEFAULT NULL,
  _reported_gross_amount numeric DEFAULT NULL,
  _reported_net_amount numeric DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.driver_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reference text;
  v_payer text;
  v_notes text;
  v_row public.driver_settlements;
BEGIN
  IF v_actor IS NULL OR _settlement_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_request';
  END IF;

  SELECT ds.* INTO v_row
  FROM public.driver_settlements ds
  WHERE ds.id = _settlement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found';
  END IF;

  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'settlement_not_editable';
  END IF;

  -- CURRENT authorization is re-derived per source. Historical read access is
  -- never sufficient to edit; a lapsed plan/delegation/relationship makes the
  -- draft read-only.
  IF v_row.source = 'driver_imported' THEN
    IF NOT (
      (v_row.driver_user_id = v_actor
        AND public.settlement_current_user_can_manage_driver_import())
      OR public.settlement_current_user_can_assist_driver(
           v_row.driver_user_id, 'settlements_manage', true)
    ) THEN
      RAISE EXCEPTION 'settlement_driver_import_not_authorized';
    END IF;
  ELSIF v_row.source = 'carrier_issued' THEN
    IF v_row.carrier_recruiter_profile_id IS NULL
       OR v_row.carrier_driver_relationship_id IS NULL
       OR NOT (
            public.settlement_current_user_can_manage_carrier(
              v_row.carrier_recruiter_profile_id,
              v_row.carrier_driver_relationship_id,
              v_row.driver_user_id)
            OR public.settlement_current_user_can_recruiter_staff_relationship_action(
                v_row.carrier_recruiter_profile_id,
                v_row.carrier_driver_relationship_id,
                v_row.driver_user_id,
                'settlements_prepare'::public.recruiter_workspace_permission)
          ) THEN
      RAISE EXCEPTION 'settlement_carrier_not_authorized';
    END IF;
  ELSIF v_row.source = 'agency_prepared' THEN
    IF v_row.agency_id IS NULL
       OR NOT public.settlement_current_user_can_manage_agency(
            v_row.agency_id,
            v_row.driver_user_id,
            'settlements_manage') THEN
      RAISE EXCEPTION 'settlement_agency_not_authorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'settlement_invalid_source';
  END IF;

  IF _period_start IS NULL OR _period_end IS NULL OR _period_end < _period_start THEN
    RAISE EXCEPTION 'settlement_invalid_period';
  END IF;

  IF (_reported_gross_amount IS NOT NULL
       AND (_reported_gross_amount::text IN ('NaN', 'Infinity', '-Infinity')
            OR _reported_gross_amount < 0
            OR _reported_gross_amount > 999999999999.99))
     OR (_reported_net_amount IS NOT NULL
       AND (_reported_net_amount::text IN ('NaN', 'Infinity', '-Infinity')
            OR _reported_net_amount < -999999999999.99
            OR _reported_net_amount > 999999999999.99)) THEN
    RAISE EXCEPTION 'settlement_invalid_amount';
  END IF;

  v_reference := nullif(btrim(coalesce(_statement_reference, ''), E' \t\r\n'), '');
  v_payer := nullif(btrim(coalesce(_payer_name_snapshot, ''), E' \t\r\n'), '');
  v_notes := nullif(btrim(coalesce(_notes, ''), E' \t\r\n'), '');

  IF length(coalesce(v_reference, '')) > 200
     OR length(coalesce(v_payer, '')) > 200
     OR length(coalesce(v_notes, '')) > 5000 THEN
    RAISE EXCEPTION 'settlement_text_too_long';
  END IF;

  -- A carrier statement's payer identity is the server-resolved carrier name and
  -- can never be rewritten through this generic header RPC.
  IF v_row.source = 'carrier_issued' THEN
    v_payer := v_row.payer_name_snapshot;
  END IF;

  UPDATE public.driver_settlements ds
     SET period_start = _period_start,
         period_end = _period_end,
         pay_date = _pay_date,
         statement_reference = v_reference,
         payer_name_snapshot = v_payer,
         reported_gross_amount = _reported_gross_amount,
         reported_net_amount = _reported_net_amount,
         notes = v_notes,
         updated_at = now()
   WHERE ds.id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.driver_settlement_events (
    settlement_id, actor_user_id, event_type, metadata
  )
  VALUES (
    v_row.id,
    v_actor,
    'updated',
    jsonb_build_object('source', v_row.source)
  );

  RETURN v_row;
END;
$$;

-- ---- settlement_add_draft_item ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.settlement_add_draft_item(
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
       OR NOT (
            public.settlement_current_user_can_manage_carrier(
              v_parent.carrier_recruiter_profile_id,
              v_parent.carrier_driver_relationship_id,
              v_parent.driver_user_id)
            OR public.settlement_current_user_can_recruiter_staff_relationship_action(
                v_parent.carrier_recruiter_profile_id,
                v_parent.carrier_driver_relationship_id,
                v_parent.driver_user_id,
                'settlements_prepare'::public.recruiter_workspace_permission)
          ) THEN
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
  IF _amount IS NULL
     OR _amount::text IN ('NaN', 'Infinity', '-Infinity')
     OR _amount < 0
     OR _amount > 999999999999.99 THEN
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
  IF (_quantity IS NOT NULL
       AND (_quantity::text IN ('NaN', 'Infinity', '-Infinity')
            OR _quantity < 0 OR _quantity > 9999999999.9999))
     OR (_rate IS NOT NULL
       AND (_rate::text IN ('NaN', 'Infinity', '-Infinity')
            OR _rate < 0 OR _rate > 99999999.999999))
     OR (_loaded_miles_snapshot IS NOT NULL
          AND (_loaded_miles_snapshot::text IN ('NaN', 'Infinity', '-Infinity')
               OR _loaded_miles_snapshot < 0 OR _loaded_miles_snapshot > 9999999999.99))
     OR (_deadhead_miles_snapshot IS NOT NULL
          AND (_deadhead_miles_snapshot::text IN ('NaN', 'Infinity', '-Infinity')
               OR _deadhead_miles_snapshot < 0 OR _deadhead_miles_snapshot > 9999999999.99))
     OR (_payable_miles_snapshot IS NOT NULL
          AND (_payable_miles_snapshot::text IN ('NaN', 'Infinity', '-Infinity')
               OR _payable_miles_snapshot < 0 OR _payable_miles_snapshot > 9999999999.99))
     OR (_eligible_revenue_snapshot IS NOT NULL
          AND (_eligible_revenue_snapshot::text IN ('NaN', 'Infinity', '-Infinity')
               OR _eligible_revenue_snapshot < 0
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

-- ---- settlement_update_draft_item ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.settlement_update_draft_item(
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
       OR NOT (
            public.settlement_current_user_can_manage_carrier(
              v_parent.carrier_recruiter_profile_id,
              v_parent.carrier_driver_relationship_id,
              v_parent.driver_user_id)
            OR public.settlement_current_user_can_recruiter_staff_relationship_action(
                v_parent.carrier_recruiter_profile_id,
                v_parent.carrier_driver_relationship_id,
                v_parent.driver_user_id,
                'settlements_prepare'::public.recruiter_workspace_permission)
          ) THEN
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
  IF _amount IS NULL
     OR _amount::text IN ('NaN', 'Infinity', '-Infinity')
     OR _amount < 0
     OR _amount > 999999999999.99 THEN
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
  IF (_quantity IS NOT NULL
       AND (_quantity::text IN ('NaN', 'Infinity', '-Infinity')
            OR _quantity < 0 OR _quantity > 9999999999.9999))
     OR (_rate IS NOT NULL
       AND (_rate::text IN ('NaN', 'Infinity', '-Infinity')
            OR _rate < 0 OR _rate > 99999999.999999))
     OR (_loaded_miles_snapshot IS NOT NULL
          AND (_loaded_miles_snapshot::text IN ('NaN', 'Infinity', '-Infinity')
               OR _loaded_miles_snapshot < 0 OR _loaded_miles_snapshot > 9999999999.99))
     OR (_deadhead_miles_snapshot IS NOT NULL
          AND (_deadhead_miles_snapshot::text IN ('NaN', 'Infinity', '-Infinity')
               OR _deadhead_miles_snapshot < 0 OR _deadhead_miles_snapshot > 9999999999.99))
     OR (_payable_miles_snapshot IS NOT NULL
          AND (_payable_miles_snapshot::text IN ('NaN', 'Infinity', '-Infinity')
               OR _payable_miles_snapshot < 0 OR _payable_miles_snapshot > 9999999999.99))
     OR (_eligible_revenue_snapshot IS NOT NULL
          AND (_eligible_revenue_snapshot::text IN ('NaN', 'Infinity', '-Infinity')
               OR _eligible_revenue_snapshot < 0
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

-- ---- settlement_delete_draft_item ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.settlement_delete_draft_item(
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
       OR NOT (
            public.settlement_current_user_can_manage_carrier(
              v_parent.carrier_recruiter_profile_id,
              v_parent.carrier_driver_relationship_id,
              v_parent.driver_user_id)
            OR public.settlement_current_user_can_recruiter_staff_relationship_action(
                v_parent.carrier_recruiter_profile_id,
                v_parent.carrier_driver_relationship_id,
                v_parent.driver_user_id,
                'settlements_prepare'::public.recruiter_workspace_permission)
          ) THEN
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

-- ---- settlement_finalize_draft ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.settlement_finalize_draft(
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

  -- ---- lifecycle eligibility: EXACTLY draft, never idempotent -------------
  IF v_settlement.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'settlement_not_finalizable';
  END IF;

  -- ---- source vocabulary, fail-closed -------------------------------------
  IF v_settlement.source NOT IN ('carrier_issued', 'agency_prepared', 'driver_imported') THEN
    RAISE EXCEPTION 'settlement_invalid_source';
  END IF;

  -- ---- CURRENT authorization, re-derived per source -----------------------
  IF v_settlement.source = 'carrier_issued' THEN
    IF v_settlement.carrier_recruiter_profile_id IS NULL
       OR v_settlement.carrier_driver_relationship_id IS NULL
       OR NOT (
            public.settlement_current_user_can_manage_carrier(
              v_settlement.carrier_recruiter_profile_id,
              v_settlement.carrier_driver_relationship_id,
              v_settlement.driver_user_id)
            OR public.settlement_current_user_can_recruiter_staff_relationship_action(
                v_settlement.carrier_recruiter_profile_id,
                v_settlement.carrier_driver_relationship_id,
                v_settlement.driver_user_id,
                'settlements_finalize'::public.recruiter_workspace_permission)
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
    -- driver_imported: DIRECT assistant finalization only. The recipient
    -- driver actor deliberately does not receive finalization in this phase.
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
  SET status = 'finalized',
      finalized_by_user_id = v_actor,
      finalized_at = now(),
      updated_at = now()
  WHERE ds.id = v_settlement.id
  RETURNING * INTO v_result;

  INSERT INTO public.driver_settlement_events (
    settlement_id, actor_user_id, event_type, metadata
  )
  VALUES (
    v_result.id,
    v_actor,
    'finalized',
    jsonb_build_object(
      'source', v_result.source,
      'change', 'settlement_finalized'
    )
  );

  RETURN v_result;
END;
$$;

-- ---- settlement_void_finalized ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.settlement_void_finalized(
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
       OR NOT (
            public.settlement_current_user_can_manage_carrier(
              v_settlement.carrier_recruiter_profile_id,
              v_settlement.carrier_driver_relationship_id,
              v_settlement.driver_user_id)
            OR public.settlement_current_user_can_recruiter_staff_relationship_action(
                v_settlement.carrier_recruiter_profile_id,
                v_settlement.carrier_driver_relationship_id,
                v_settlement.driver_user_id,
                'settlements_finalize'::public.recruiter_workspace_permission)
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

-- ---- settlement_create_correction_draft ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.settlement_create_correction_draft(
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
       OR NOT (
            public.settlement_current_user_can_manage_carrier(
              v_prev.carrier_recruiter_profile_id,
              v_prev.carrier_driver_relationship_id,
              v_prev.driver_user_id)
            OR (
              public.settlement_current_user_can_recruiter_staff_relationship_action(
                v_prev.carrier_recruiter_profile_id,
                v_prev.carrier_driver_relationship_id,
                v_prev.driver_user_id,
                'settlements_prepare'::public.recruiter_workspace_permission) AND public.settlement_current_user_can_recruiter_staff_relationship_action(
                v_prev.carrier_recruiter_profile_id,
                v_prev.carrier_driver_relationship_id,
                v_prev.driver_user_id,
                'settlements_finalize'::public.recruiter_workspace_permission)
            )
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

COMMIT;
