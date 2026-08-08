-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase 1T-B2C2A — Controlled settlement DRAFT HEADER creation / update RPCs.
--
-- Scope: exactly four SECURITY DEFINER plpgsql functions that are the ONLY
-- sanctioned way to create a public.driver_settlements draft header or edit a
-- draft header's caller-controlled fields. The Phase 1T-B2B read-only RLS
-- contract stays untouched, so every direct client INSERT/UPDATE/DELETE on
-- driver_settlements and driver_settlement_events remains blocked.
--
-- Deliberately NOT in this candidate:
--   * ZERO finalize / void / supersede transitions;
--   * ZERO settlement item, match, or calculation logic;
--   * ZERO event types other than 'created' and 'updated';
--   * ZERO policies, ZERO triggers, ZERO table/column/index/type/view DDL;
--   * ZERO DML or backfill outside the function bodies;
--   * no exports, no UI, no Stripe, no pricing.
--
-- Contract properties enforced below:
--   * the actor is ALWAYS auth.uid(); no caller-supplied actor id, no
--     client-settable GUC, no email or business-name authorization, ever;
--   * no dynamic SQL, no EXECUTE, no admin / service_role bypass branch —
--     service_role may call these, but receives no special authorization;
--   * every failure raises a FIXED machine-readable message; raw Postgres
--     error text, SQLSTATE, and constraint names are never surfaced;
--   * callers never control source, status, business identity ids,
--     source_display_name_snapshot, calculation_version, version_number,
--     supersedes_settlement_id, created_by_user_id, finalized/voided fields,
--     created_at or updated_at;
--   * business SOURCE display names are resolved server-side from the canonical
--     production columns public.recruiter_profiles.company_name and
--     public.agency_profiles.name and snapshotted at creation time;
--   * the update RPC locks the exact settlement row FOR UPDATE, edits ONLY a
--     draft, and re-checks CURRENT authorization: historical read permission is
--     never sufficient to edit. If billing, delegation, or the carrier
--     relationship lapses, the draft becomes read-only;
--   * an unknown/malformed stored source always fails closed.
--
-- Product rules:
--   * driver_imported drafts require an ACTIVE driver Pro recipient, or a DIRECT
--     (never agency-generated) assistant holding settlements_manage over an
--     active-Pro target driver — enforced by the accepted Phase 1T-B2A helpers;
--   * carrier_issued drafts require a STANDALONE paid recruiter/carrier context
--     plus the EXACT active carrier-driver relationship triple;
--   * agency_prepared drafts require a paid/trialing/manual_beta agency context
--     plus the EXACT approved settlements_manage delegation; the driver's own
--     Free/Pro state never gates agency preparation.
--
-- This candidate intentionally does NOT use IF NOT EXISTS, CREATE OR REPLACE,
-- or DROP: a re-apply must fail loudly rather than silently replace an
-- authorization-bearing function.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) settlement_create_driver_imported_draft(...)
--    The driver's own manually imported statement, or the same import performed
--    by a DIRECT assistant on an active-Pro driver's behalf.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_create_driver_imported_draft(
  _driver_user_id uuid,
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
  IF v_actor IS NULL OR _driver_user_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_request';
  END IF;

  IF NOT (
    (_driver_user_id = v_actor
      AND public.settlement_current_user_can_manage_driver_import())
    OR public.settlement_current_user_can_assist_driver(
         _driver_user_id, 'settlements_manage', true)
  ) THEN
    RAISE EXCEPTION 'settlement_driver_import_not_authorized';
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
    'driver_imported',
    'draft',
    NULL,
    NULL,
    NULL,
    _period_start,
    _period_end,
    _pay_date,
    v_reference,
    v_payer,
    NULL,
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
    jsonb_build_object('source', 'driver_imported')
  );

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) settlement_create_carrier_draft(...)
--    A standalone paid carrier issues a statement to an EXACT active relationship
--    driver. The carrier business display name is resolved server-side and is
--    never a caller parameter.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_create_carrier_draft(
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

  IF NOT public.settlement_current_user_can_manage_carrier(
       _recruiter_id, _relationship_id, _driver_user_id) THEN
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

-- ---------------------------------------------------------------------------
-- 3) settlement_create_agency_draft(...)
--    An authorized agency member prepares a statement for a delegating driver.
--    The AGENCY is the source (server-resolved name); the payer may be an
--    outside carrier and therefore stays a normalized caller field.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_create_agency_draft(
  _agency_id uuid,
  _driver_user_id uuid,
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
  v_agency_name text;
  v_reference text;
  v_payer text;
  v_notes text;
  v_row public.driver_settlements;
BEGIN
  IF v_actor IS NULL OR _agency_id IS NULL OR _driver_user_id IS NULL THEN
    RAISE EXCEPTION 'settlement_invalid_request';
  END IF;

  IF NOT public.settlement_current_user_can_manage_agency(
       _agency_id, _driver_user_id, 'settlements_manage') THEN
    RAISE EXCEPTION 'settlement_agency_not_authorized';
  END IF;

  -- Canonical server-side business name; never caller-supplied.
  SELECT nullif(btrim(coalesce(ap.name, ''), E' \t\r\n'), '')
    INTO v_agency_name
    FROM public.agency_profiles ap
   WHERE ap.id = _agency_id;

  IF v_agency_name IS NULL OR length(v_agency_name) > 200 THEN
    RAISE EXCEPTION 'settlement_agency_name_unavailable';
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
    'agency_prepared',
    'draft',
    NULL,
    NULL,
    _agency_id,
    _period_start,
    _period_end,
    _pay_date,
    v_reference,
    v_payer,
    v_agency_name,
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
    jsonb_build_object('source', 'agency_prepared', 'agency_id', _agency_id)
  );

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) settlement_update_draft_header(...)
--    Edits ONLY the caller-controlled header fields of a DRAFT, and only while
--    the actor's CURRENT authorization for that draft's source still holds.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_update_draft_header(
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
       OR NOT public.settlement_current_user_can_manage_carrier(
            v_row.carrier_recruiter_profile_id,
            v_row.carrier_driver_relationship_id,
            v_row.driver_user_id) THEN
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

-- ---------------------------------------------------------------------------
-- ACL contract: anon and PUBLIC get nothing; authenticated and service_role may
-- execute. No table privileges are granted anywhere in this candidate.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.settlement_create_driver_imported_draft(uuid, date, date, date, text, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_create_driver_imported_draft(uuid, date, date, date, text, text, numeric, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_create_carrier_draft(uuid, uuid, uuid, date, date, date, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_create_carrier_draft(uuid, uuid, uuid, date, date, date, text, numeric, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_create_agency_draft(uuid, uuid, date, date, date, text, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_create_agency_draft(uuid, uuid, date, date, date, text, text, numeric, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_update_draft_header(uuid, date, date, date, text, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_update_draft_header(uuid, date, date, date, text, text, numeric, numeric, text) TO authenticated, service_role;

COMMIT;
