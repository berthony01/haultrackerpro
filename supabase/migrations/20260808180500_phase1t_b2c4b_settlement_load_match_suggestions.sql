-- Phase 1T active-migration promotion.
--
-- Source candidate: supabase/migration-candidates/20260808180500_phase1t_b2c4b_settlement_load_match_suggestions.sql
--
-- This commit creates the managed migration FILE only. The SQL below is NOT
-- applied to production or to any connected database by this task.
--
-- The executable body below, from the first exact BEGIN; line through the final
-- exact COMMIT; line, is byte-for-byte identical to the accepted candidate.

BEGIN;

-- ---------------------------------------------------------------------------
-- settlement_refresh_load_match_suggestions(_settlement_item_id)
--
-- Deterministic five-signal scoring over a bounded candidate window:
--   1. delivery date        max +0.35
--   2. origin               +0.20
--   3. destination          +0.20
--   4. loaded miles         max +0.15
--   5. pay corroboration    max +0.10   (never a disqualifier)
-- score >= 0.70 => 'likely'; >= 0.40 => 'possible'; < 0.40 => not persisted.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_refresh_load_match_suggestions(
  _settlement_item_id uuid
)
RETURNS SETOF public.driver_settlement_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_settlement_id uuid;
  v_parent public.driver_settlements;
  v_item public.driver_settlement_items;
  v_accepted public.driver_settlement_matches;
  v_window_start date;
  v_window_end date;
  v_candidates jsonb;
BEGIN
  IF v_actor IS NULL OR _settlement_item_id IS NULL THEN
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
    -- 'voided' and 'superseded' (and anything unknown) are never matchable.
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
    RAISE EXCEPTION 'settlement_suggestions_not_authorized';
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

  -- ---- manual acceptance always wins --------------------------------------
  SELECT dsm.* INTO v_accepted
  FROM public.driver_settlement_matches dsm
  WHERE dsm.settlement_item_id = v_item.id
    AND dsm.match_state IN ('exact', 'confirmed')
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY
    SELECT dsm.*
    FROM public.driver_settlement_matches dsm
    WHERE dsm.id = v_accepted.id;
    RETURN;
  END IF;

  -- ---- lock this item's existing match rows before mutating ---------------
  PERFORM 1
  FROM public.driver_settlement_matches dsm
  WHERE dsm.settlement_item_id = v_item.id
  FOR UPDATE;

  -- ---- bounded deterministic candidate window -----------------------------
  v_window_start := v_parent.period_start - 7;
  v_window_end := v_parent.period_end + 7;

  -- Candidate loads are read ONLY: same driver, completed, effective delivery
  -- date COALESCE(dropoff_date, load_date) inside the bounded window. Every
  -- numeric read from public.loads passes an explicit finite guard, so no score
  -- or confidence value can become NaN or +/-Infinity from stored data.
  WITH cand AS (
    SELECT
      l.id AS load_id,
      COALESCE(l.dropoff_date, l.load_date) AS eff_date,
      LEAST(
        1.0000::numeric,
        round(
          -- 1) delivery date signal, max +0.35
          CASE
            WHEN v_item.delivery_date_snapshot IS NULL THEN 0.0000
            WHEN abs(COALESCE(l.dropoff_date, l.load_date)
                     - v_item.delivery_date_snapshot) = 0 THEN 0.3500
            WHEN abs(COALESCE(l.dropoff_date, l.load_date)
                     - v_item.delivery_date_snapshot) = 1 THEN 0.2500
            WHEN abs(COALESCE(l.dropoff_date, l.load_date)
                     - v_item.delivery_date_snapshot) = 2 THEN 0.1500
            ELSE 0.0000
          END
          -- 2) origin signal, +0.20
          + CASE
              WHEN nullif(regexp_replace(btrim(lower(v_item.origin_snapshot)),
                                         '\s+', ' ', 'g'), '') IS NOT NULL
               AND nullif(regexp_replace(btrim(lower(v_item.origin_snapshot)),
                                         '\s+', ' ', 'g'), '')
                   = nullif(regexp_replace(btrim(lower(l.pickup_location)),
                                           '\s+', ' ', 'g'), '')
              THEN 0.2000
              ELSE 0.0000
            END
          -- 3) destination signal, +0.20
          + CASE
              WHEN nullif(regexp_replace(btrim(lower(v_item.destination_snapshot)),
                                         '\s+', ' ', 'g'), '') IS NOT NULL
               AND nullif(regexp_replace(btrim(lower(v_item.destination_snapshot)),
                                         '\s+', ' ', 'g'), '')
                   = nullif(regexp_replace(btrim(lower(l.dropoff_location)),
                                           '\s+', ' ', 'g'), '')
              THEN 0.2000
              ELSE 0.0000
            END
          -- 4) loaded miles signal, max +0.15
          + CASE
              WHEN v_item.loaded_miles_snapshot IS NULL
                OR v_item.loaded_miles_snapshot::text
                     IN ('NaN', 'Infinity', '-Infinity')
                OR v_item.loaded_miles_snapshot <= 0
                OR l.loaded_miles IS NULL
                OR l.loaded_miles::text IN ('NaN', 'Infinity', '-Infinity')
              THEN 0.0000
              WHEN abs(l.loaded_miles - v_item.loaded_miles_snapshot) <= 1 THEN 0.1500
              WHEN abs(l.loaded_miles - v_item.loaded_miles_snapshot)
                     / v_item.loaded_miles_snapshot <= 0.02 THEN 0.1000
              WHEN abs(l.loaded_miles - v_item.loaded_miles_snapshot)
                     / v_item.loaded_miles_snapshot <= 0.05 THEN 0.0500
              ELSE 0.0000
            END
          -- 5) pay corroboration, max +0.10. NEVER a disqualifier.
          + CASE
              WHEN l.estimated_pay IS NULL
                OR l.estimated_pay::text IN ('NaN', 'Infinity', '-Infinity')
                OR l.estimated_pay < 0
              THEN 0.0000
              WHEN abs(l.estimated_pay - v_item.amount) <= 1.00 THEN 0.1000
              WHEN abs(l.estimated_pay - v_item.amount) <= 25.00 THEN 0.0500
              ELSE 0.0000
            END
          , 4)
      ) AS score,
      CASE
        WHEN v_item.delivery_date_snapshot IS NULL THEN 999999
        ELSE abs(COALESCE(l.dropoff_date, l.load_date)
                 - v_item.delivery_date_snapshot)
      END AS date_distance
    FROM public.loads l
    WHERE l.user_id = v_parent.driver_user_id
      AND l.status = 'completed'
      AND COALESCE(l.dropoff_date, l.load_date) IS NOT NULL
      AND COALESCE(l.dropoff_date, l.load_date) >= v_window_start
      AND COALESCE(l.dropoff_date, l.load_date) <= v_window_end
  ),
  qualifying AS (
    SELECT
      c.load_id,
      c.score,
      c.date_distance,
      c.eff_date,
      CASE WHEN c.score >= 0.70 THEN 'likely' ELSE 'possible' END AS state
    FROM cand c
    WHERE c.score >= 0.40
  ),
  ranked AS (
    SELECT
      q.*,
      row_number() OVER (
        ORDER BY q.score DESC, q.date_distance ASC, q.eff_date DESC, q.load_id ASC
      ) AS rn
    FROM qualifying q
  )
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'load_id', r.load_id,
               'state', r.state,
               'score', r.score
             )
             ORDER BY r.rn
           ),
           '[]'::jsonb
         )
  INTO v_candidates
  FROM ranked r
  WHERE r.rn <= 25;

  -- ---- stale-only cleanup, scoped to THIS item ----------------------------
  -- Only machine suggestion states are removable. 'rejected' rows survive, and
  -- accepted states cannot be present at this point.
  DELETE FROM public.driver_settlement_matches dsm
  WHERE dsm.settlement_item_id = v_item.id
    AND dsm.match_state IN ('likely', 'possible')
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(v_candidates)
        AS c(load_id uuid, state text, score numeric)
      WHERE c.load_id = dsm.driver_load_id
    );

  -- ---- upsert the qualifying suggestions ----------------------------------
  -- The DO UPDATE branch is restricted to rows that are already machine
  -- suggestions, so a 'rejected' pair is preserved untouched and an accepted
  -- pair could never be downgraded.
  INSERT INTO public.driver_settlement_matches (
    settlement_item_id,
    driver_load_id,
    match_state,
    confidence,
    matched_by_user_id,
    matched_at
  )
  SELECT
    v_item.id,
    c.load_id,
    c.state,
    c.score,
    NULL,
    NULL
  FROM jsonb_to_recordset(v_candidates)
    AS c(load_id uuid, state text, score numeric)
  ON CONFLICT (settlement_item_id, driver_load_id) DO UPDATE
    SET match_state = EXCLUDED.match_state,
        confidence = EXCLUDED.confidence,
        matched_by_user_id = NULL,
        matched_at = NULL
    WHERE public.driver_settlement_matches.match_state IN ('likely', 'possible');

  -- ---- deterministic result set -------------------------------------------
  RETURN QUERY
  SELECT dsm.*
  FROM public.driver_settlement_matches dsm
  WHERE dsm.settlement_item_id = v_item.id
    AND dsm.match_state IN ('likely', 'possible', 'rejected')
  ORDER BY
    CASE dsm.match_state
      WHEN 'likely' THEN 0
      WHEN 'possible' THEN 1
      ELSE 2
    END,
    dsm.confidence DESC NULLS LAST,
    dsm.driver_load_id ASC;
END;
$$;

-- ---------------------------------------------------------------------------
-- ACL contract: driver-side advanced reconciliation entry point only. anon and
-- PUBLIC get nothing; authenticated and service_role may execute, and
-- service_role receives no special authorization result from the body.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.settlement_refresh_load_match_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_refresh_load_match_suggestions(uuid) TO authenticated, service_role;

COMMIT;
