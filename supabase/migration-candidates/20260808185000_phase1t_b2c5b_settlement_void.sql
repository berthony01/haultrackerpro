-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase 1T-B2C5B — Controlled settlement VOID lifecycle.
--
-- Scope: exactly ONE SECURITY DEFINER plpgsql function that transitions ONE
-- existing settlement from status 'finalized' to status 'voided', using the
-- SAME CURRENT per-source authorization boundary already accepted by Phase
-- 1T-B2C5A finalization.
--
-- Semantic contract (deliberate, and enforced below):
--   * Void is a LIFECYCLE transition only. It never recalculates, re-matches,
--     supersedes, corrects, exports, or notifies anything.
--   * Void is NOT idempotent: a second attempt on an already-voided settlement
--     fails BEFORE any write and adds no second audit event. 'draft' and
--     'superseded' are equally not voidable.
--   * Authorization is RE-DERIVED at void time from the locked row. Creator
--     identity, prior issuance, prior preparation, and the authorization that
--     was valid at finalization time are NEVER sufficient:
--       - carrier_issued  -> standalone paid recruiter subscription AND the
--                            EXACT active carrier-driver relationship;
--       - agency_prepared -> paid/grandfathered agency eligibility, active
--                            membership, approved delegation carrying
--                            'settlements_finalize' (manage alone is not
--                            enough). The driver's Free/Pro state never gates
--                            an authorized paid agency here;
--       - driver_imported -> ONLY a DIRECT assistant (agency_delegation_id IS
--                            NULL) holding exact 'settlements_finalize' over an
--                            ACTIVE-Pro target driver. The recipient driver
--                            actor deliberately does NOT receive void in this
--                            phase, matching accepted B2C5A finalization.
--   * finalized_by_user_id and finalized_at are HISTORICAL FACTS and are
--     preserved byte-identically; void never rewrites finalization provenance.
--   * Exactly FOUR columns change on the settlement: status,
--     voided_by_user_id, voided_at, updated_at. Every other field — provenance
--     ids, period dates, pay date, statement reference, payer/source snapshots,
--     reported gross/net, notes, calculation_version, version_number,
--     supersedes_settlement_id, created_by_user_id, finalization columns,
--     created_at — is preserved exactly.
--   * ZERO writes to public.loads, public.driver_settlement_items,
--     public.driver_settlement_matches, public.carrier_driver_relationships,
--     billing / entitlement / delegation tables, or anything else. The only
--     other write is ONE audit row in public.driver_settlement_events.
--
-- Deliberately NOT in this candidate:
--   * ZERO supersede / correction / revision / reopen transitions;
--   * ZERO void reason column, ZERO schema invention;
--   * ZERO discrepancy, variance, totals, or recalculation of any kind;
--   * ZERO matching, exports, UI, notifications, Stripe, pricing;
--   * ZERO table / column / constraint / index / view / trigger / type / enum
--     DDL, ZERO policies, ZERO table grants, ZERO DML outside the body;
--   * ZERO new event vocabulary — the accepted B1 'voided' event type is used.
--
-- Contract properties enforced below:
--   * the actor is ALWAYS auth.uid(); no caller-supplied actor id, no
--     client-settable GUC, no email / business-name / payer-name / statement
--     text authorization, ever;
--   * no dynamic SQL, no EXECUTE, no admin / service_role bypass branch —
--     service_role may call this, but receives no special authorization;
--   * every failure raises a FIXED machine-readable message; raw Postgres error
--     text, SQLSTATE, and constraint names are never surfaced, and no exception
--     handler exists that could leak SQLERRM;
--   * the settlement row is locked FOR UPDATE BEFORE authorization is derived
--     and before any lifecycle mutation.
--
-- This candidate intentionally does NOT use IF NOT EXISTS, CREATE OR REPLACE,
-- or DROP: a re-apply must fail loudly rather than silently replace an
-- authorization-bearing function.

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
