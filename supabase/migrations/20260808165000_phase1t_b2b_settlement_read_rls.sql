-- Phase 1T active-migration promotion.
--
-- Source candidate: supabase/migration-candidates/20260808165000_phase1t_b2b_settlement_read_rls.sql
--
-- This commit creates the managed migration FILE only. The SQL below is NOT
-- applied to production or to any connected database by this task.
--
-- The executable body below, from the first exact BEGIN; line through the final
-- exact COMMIT; line, is byte-for-byte identical to the accepted candidate.

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
