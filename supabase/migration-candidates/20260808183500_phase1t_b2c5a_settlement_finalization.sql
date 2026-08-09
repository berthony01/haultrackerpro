-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase 1T-B2C5A — Controlled settlement DRAFT FINALIZATION.
--
-- Scope: exactly ONE SECURITY DEFINER plpgsql function that transitions ONE
-- existing settlement from status 'draft' to status 'finalized', according to
-- the already-accepted Phase 1T-A capability contract and the accepted Phase
-- 1T-B2A authorization helpers.
--
-- Semantic contract (deliberate, and enforced below):
--   * Finalization is a LIFECYCLE transition only. It never recalculates,
--     re-matches, exports, voids, supersedes, or corrects anything.
--   * Finalization is NOT idempotent: a second attempt on an already-finalized
--     settlement fails BEFORE any write and adds no second audit event.
--   * Authorization is RE-DERIVED from the locked row at finalize time. Prior
--     read access, prior issuance, or prior preparation is never sufficient:
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
--                            actor deliberately does NOT receive finalization
--                            in this phase, matching the accepted Phase 1T-A
--                            contract where the driver actor does not receive
--                            canFinalizeManagedSettlement.
--   * No readiness heuristic exists: item totals, load matches, suggestion
--     states, and discrepancy calculations are never inspected. The accepted
--     architecture does not define such a prerequisite, so none is invented.
--   * Exactly FOUR columns change on the settlement: status,
--     finalized_by_user_id, finalized_at, updated_at. Every other field —
--     provenance ids, period dates, pay date, statement reference, payer/source
--     snapshots, reported gross/net, notes, calculation_version,
--     version_number, supersedes_settlement_id, created_by_user_id, void
--     columns, created_at — is preserved exactly.
--   * ZERO writes to public.loads, public.driver_settlement_items,
--     public.driver_settlement_matches, public.carrier_driver_relationships,
--     billing/subscription/delegation tables, or anything else. The only other
--     write is ONE audit row in public.driver_settlement_events.
--
-- Deliberately NOT in this candidate:
--   * ZERO void / supersede / correction / revision transitions;
--   * ZERO discrepancy, variance, totals, or recalculation of any kind;
--   * ZERO matching, exports, UI, notifications, Stripe, pricing;
--   * ZERO table / column / constraint / index / view / trigger / type / enum
--     DDL, ZERO policies, ZERO table grants, ZERO DML outside the body;
--   * ZERO new event vocabulary — the accepted B1 'finalized' event type is used.
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
-- settlement_finalize_draft(_settlement_id)
--
-- 'draft' -> 'finalized' (one audit event), for exactly one settlement.
--   non-draft status      -> settlement_not_finalizable
--   unknown stored source -> settlement_invalid_source
--   carrier not current   -> settlement_carrier_not_authorized
--   agency not current    -> settlement_agency_not_authorized
--   driver import path    -> settlement_driver_import_not_authorized
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_finalize_draft(
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

-- ---------------------------------------------------------------------------
-- ACL contract: authenticated callers and service_role may execute; anon and
-- PUBLIC get nothing, and service_role receives no special authorization
-- result from the body.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.settlement_finalize_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_finalize_draft(uuid) TO authenticated, service_role;

COMMIT;
