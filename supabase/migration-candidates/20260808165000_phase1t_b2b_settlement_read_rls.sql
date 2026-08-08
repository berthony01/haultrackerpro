-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase 1T-B2B — Settlement read-only RLS contract (SELECT policies only).
--
-- Scope: exactly five RLS policies, one per Phase 1T-B1 table, every one of them
-- FOR SELECT TO authenticated. This turns the five fail-closed tables created by
-- the Phase 1T-B1 candidate into READ-ONLY authenticated surfaces, using the
-- accepted Phase 1T-B2A authorization contract as the single source of truth.
--
-- Deliberately NOT in this candidate:
--   * ZERO INSERT / UPDATE / DELETE / ALL policies — every direct client write
--     to these five tables stays blocked by RLS. Controlled writes arrive later
--     as Phase 1T-B2C SECURITY DEFINER mutation RPCs;
--   * ZERO functions, triggers, tables, indexes, views, types;
--   * ZERO GRANT/REVOKE, ZERO DML/backfill, ZERO RLS-enablement changes
--     (Phase 1T-B1 already enabled row level security on all five tables).
--
-- Authorization notes:
--   * settlement / item / event visibility is delegated entirely to
--     public.settlement_current_user_can_view_settlement(uuid), so recipient,
--     carrier issuer, agency preparer, direct-assistant and agency-delegation
--     semantics — including the direct vs agency-delegated isolation repair —
--     can never drift between the helper and the policies;
--   * match visibility derives through its parent settlement item and then the
--     same helper; owning the matched load is never sufficient by itself;
--   * carrier_driver_relationships is the one table with its own predicate: it
--     is a relationship ledger, not a settlement, so it is readable by the
--     recipient driver and by the canonical recruiter-profile owner. Historical
--     read is deliberately NOT gated on current paid billing, and assistants and
--     agencies get no visibility here at all.
--   * identity is always auth.uid() and canonical business ids; no email, no
--     display name, no client-settable GUC is ever used for authorization.
--
-- This candidate intentionally does NOT use IF NOT EXISTS or DROP POLICY: a
-- re-apply or a pre-existing policy of the same name must fail loudly rather
-- than silently replace an authorization rule.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) public.carrier_driver_relationships
-- ---------------------------------------------------------------------------
CREATE POLICY carrier_driver_relationships_select_authorized
  ON public.carrier_driver_relationships
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      carrier_driver_relationships.driver_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.recruiter_profiles rp
        WHERE rp.id = carrier_driver_relationships.recruiter_id
          AND rp.user_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2) public.driver_settlements
-- ---------------------------------------------------------------------------
CREATE POLICY driver_settlements_select_authorized
  ON public.driver_settlements
  FOR SELECT
  TO authenticated
  USING (
    public.settlement_current_user_can_view_settlement(driver_settlements.id)
  );

-- ---------------------------------------------------------------------------
-- 3) public.driver_settlement_items
-- ---------------------------------------------------------------------------
CREATE POLICY driver_settlement_items_select_authorized
  ON public.driver_settlement_items
  FOR SELECT
  TO authenticated
  USING (
    public.settlement_current_user_can_view_settlement(
      driver_settlement_items.settlement_id
    )
  );

-- ---------------------------------------------------------------------------
-- 4) public.driver_settlement_matches
-- ---------------------------------------------------------------------------
CREATE POLICY driver_settlement_matches_select_authorized
  ON public.driver_settlement_matches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.driver_settlement_items si
      WHERE si.id = driver_settlement_matches.settlement_item_id
        AND public.settlement_current_user_can_view_settlement(si.settlement_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5) public.driver_settlement_events
-- ---------------------------------------------------------------------------
CREATE POLICY driver_settlement_events_select_authorized
  ON public.driver_settlement_events
  FOR SELECT
  TO authenticated
  USING (
    public.settlement_current_user_can_view_settlement(
      driver_settlement_events.settlement_id
    )
  );

COMMIT;
