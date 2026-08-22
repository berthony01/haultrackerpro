-- Phase TG-2E3-O13 — Deterministic Owner QA fixture reset (CANDIDATE ONLY).
--
-- Adds two owner-only SECURITY DEFINER RPCs that preview and remove the
-- OPERATIONAL DESCENDANTS of the three registered QA fixture roots
-- (user / recruiter_profile / agency_profile) owned by the calling super admin.
--
-- THIS FILE IS NOT BILLING, SUBSCRIPTION, ENTITLEMENT, OR AUTHORIZATION TRUTH.
-- It never touches Stripe, subscriptions, entitlements, email, Telegram, or the
-- fixture root registry itself. The three roots and their root identities
-- (auth user, profile, capabilities, recruiter/agency profiles + members,
-- recruiter-owned opportunities, suppression state, Owner QA sessions) are
-- preserved unconditionally.

-- ---------------------------------------------------------------------------
-- Internal: fail-closed root resolution (authorization + exactly-one-per-kind)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._owner_qa_fixture_roots(
  OUT qa_user_id uuid,
  OUT qa_recruiter_profile_id uuid,
  OUT qa_agency_profile_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_total integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'owner_qa_fixture_reset_unauthenticated'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin(v_caller) THEN
    RAISE EXCEPTION 'owner_qa_fixture_reset_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.qa_fixture_roots r
  WHERE r.active
    AND r.revoked_at IS NULL
    AND r.qa_owner_user_id = v_caller;

  IF v_total <> 3 THEN
    RAISE EXCEPTION 'owner_qa_fixture_roots_unexpected_count: %', v_total
      USING ERRCODE = '22023';
  END IF;

  SELECT r.root_id INTO qa_user_id
  FROM public.qa_fixture_roots r
  WHERE r.active AND r.revoked_at IS NULL
    AND r.qa_owner_user_id = v_caller AND r.root_kind = 'user';

  SELECT r.root_id INTO qa_recruiter_profile_id
  FROM public.qa_fixture_roots r
  WHERE r.active AND r.revoked_at IS NULL
    AND r.qa_owner_user_id = v_caller AND r.root_kind = 'recruiter_profile';

  SELECT r.root_id INTO qa_agency_profile_id
  FROM public.qa_fixture_roots r
  WHERE r.active AND r.revoked_at IS NULL
    AND r.qa_owner_user_id = v_caller AND r.root_kind = 'agency_profile';

  IF qa_user_id IS NULL
     OR qa_recruiter_profile_id IS NULL
     OR qa_agency_profile_id IS NULL THEN
    RAISE EXCEPTION 'owner_qa_fixture_roots_incomplete'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

COMMENT ON FUNCTION public._owner_qa_fixture_roots() IS
  'Internal fail-closed resolution of the caller''s three active QA fixture roots. Super-admin only; raises on missing, duplicate, or inconsistent roots.';

REVOKE ALL ON FUNCTION public._owner_qa_fixture_roots() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._owner_qa_fixture_roots() FROM anon;
REVOKE ALL ON FUNCTION public._owner_qa_fixture_roots() FROM authenticated;

-- ---------------------------------------------------------------------------
-- Internal: the QA-related user identities whose notifications may descend
-- from QA fixture activity (QA driver, QA owner, recruiter-root owner,
-- agency-root owner). Used ONLY to narrow notification scoping further.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._owner_qa_fixture_related_users(
  _qa_user_id uuid,
  _qa_recruiter_profile_id uuid,
  _qa_agency_profile_id uuid,
  _qa_owner_user_id uuid
) RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $$
  SELECT ARRAY(
    SELECT DISTINCT x FROM unnest(ARRAY[
      _qa_user_id,
      _qa_owner_user_id,
      (SELECT rp.user_id FROM public.recruiter_profiles rp
        WHERE rp.id = _qa_recruiter_profile_id),
      (SELECT ap.owner_user_id FROM public.agency_profiles ap
        WHERE ap.id = _qa_agency_profile_id)
    ]) AS x
    WHERE x IS NOT NULL
  )
$$;

REVOKE ALL ON FUNCTION public._owner_qa_fixture_related_users(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._owner_qa_fixture_related_users(uuid, uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._owner_qa_fixture_related_users(uuid, uuid, uuid, uuid) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Internal: ambiguity guard. Descendant categories that O13 is NOT authorized
-- to remove must be empty, otherwise the reset fails BEFORE deleting anything.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._owner_qa_fixture_reset_guard(
  _qa_user_id uuid,
  _qa_recruiter_profile_id uuid,
  _qa_agency_profile_id uuid
) RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $$
DECLARE
  v_blocker text;
BEGIN
  SELECT b.label INTO v_blocker
  FROM (
    SELECT 'contracts' AS label, count(*) AS n
      FROM public.contracts c
     WHERE c.driver_user_id = _qa_user_id
        OR c.application_id IN (
             SELECT a.id FROM public.opportunity_applications a
              WHERE a.driver_user_id = _qa_user_id
                AND a.recruiter_id = _qa_recruiter_profile_id)
    UNION ALL
    SELECT 'opportunity_offers', count(*)
      FROM public.opportunity_offers o
     WHERE o.application_id IN (
             SELECT a.id FROM public.opportunity_applications a
              WHERE a.driver_user_id = _qa_user_id
                AND a.recruiter_id = _qa_recruiter_profile_id)
    UNION ALL
    SELECT 'recruiter_contact_requests', count(*)
      FROM public.recruiter_contact_requests rcr
     WHERE rcr.application_id IN (
             SELECT a.id FROM public.opportunity_applications a
              WHERE a.driver_user_id = _qa_user_id
                AND a.recruiter_id = _qa_recruiter_profile_id)
    UNION ALL
    SELECT 'dispatch_command_receipts', count(*)
      FROM public.dispatch_command_receipts d
     WHERE d.driver_user_id = _qa_user_id
    UNION ALL
    SELECT 'driver_settlement_events', count(*)
      FROM public.driver_settlement_events e
     WHERE e.settlement_id IN (
             SELECT s.id FROM public.driver_settlements s
              WHERE s.driver_user_id = _qa_user_id)
    UNION ALL
    SELECT 'assistant_audit_log', count(*)
      FROM public.assistant_audit_log l
     WHERE l.delegate_id IN (
             SELECT da.id FROM public.driver_assistants da
              WHERE da.driver_user_id = _qa_user_id)
  ) b
  WHERE b.n > 0
  ORDER BY 1
  LIMIT 1;

  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION 'owner_qa_fixture_reset_ambiguous_descendants: %', v_blocker
      USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._owner_qa_fixture_reset_guard(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._owner_qa_fixture_reset_guard(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._owner_qa_fixture_reset_guard(uuid, uuid, uuid) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Internal: authoritative scoping counts (shared by preview and verification)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._owner_qa_fixture_reset_counts(
  _qa_user_id uuid,
  _qa_recruiter_profile_id uuid,
  _qa_agency_profile_id uuid,
  _qa_owner_user_id uuid
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $$
  WITH apps AS (
    SELECT a.id FROM public.opportunity_applications a
     WHERE a.driver_user_id = _qa_user_id
       AND a.recruiter_id = _qa_recruiter_profile_id
  ), refs AS (
    SELECT dr.id FROM public.driver_referrals dr
     WHERE dr.recruiter_id = _qa_recruiter_profile_id
       AND (dr.referred_driver_user_id = _qa_user_id
            OR dr.referring_driver_id = _qa_user_id)
  ), assistants AS (
    SELECT da.id FROM public.driver_assistants da
     WHERE da.driver_user_id = _qa_user_id
  ), delegations AS (
    SELECT d.id FROM public.agency_delegation_requests d
     WHERE d.agency_id = _qa_agency_profile_id
       AND d.driver_user_id = _qa_user_id
  ), work_items AS (
    SELECT w.id FROM public.agency_work_items w
     WHERE w.agency_id = _qa_agency_profile_id
       AND w.driver_user_id = _qa_user_id
  ), settlements AS (
    SELECT s.id FROM public.driver_settlements s
     WHERE s.driver_user_id = _qa_user_id
  ), items AS (
    SELECT i.id FROM public.driver_settlement_items i
     WHERE i.settlement_id IN (SELECT id FROM settlements)
  ), related_users AS (
    SELECT public._owner_qa_fixture_related_users(
      _qa_user_id, _qa_recruiter_profile_id,
      _qa_agency_profile_id, _qa_owner_user_id) AS ids
  ), notifs AS (
    SELECT n.id FROM public.notifications n, related_users ru
     WHERE n.user_id = ANY (ru.ids)
       AND (
         (n.payload ->> 'application_id')::uuid IN (SELECT id FROM apps)
         OR (n.payload ->> 'assistant_id')::uuid IN (SELECT id FROM assistants)
         OR (n.payload ->> 'delegation_id')::uuid IN (SELECT id FROM delegations)
         OR (n.payload ->> 'work_item_id')::uuid IN (SELECT id FROM work_items)
         OR (n.payload ->> 'referral_id')::uuid IN (SELECT id FROM refs)
         OR (n.payload ->> 'settlement_id')::uuid IN (SELECT id FROM settlements)
       )
  )
  SELECT jsonb_build_object(
    'carrier_relationships', (SELECT count(*) FROM public.carrier_driver_relationships c
       WHERE c.driver_user_id = _qa_user_id
         AND c.recruiter_id = _qa_recruiter_profile_id),
    'assistant_relationships', (SELECT count(*) FROM assistants),
    'agency_delegations', (SELECT count(*) FROM delegations),
    'driver_profiles', (SELECT count(*) FROM public.driver_opportunity_profiles p
       WHERE p.user_id = _qa_user_id),
    'loads', (SELECT count(*) FROM public.loads l WHERE l.user_id = _qa_user_id),
    'expenses', (SELECT count(*) FROM public.expenses e WHERE e.user_id = _qa_user_id),
    'fuel_logs', (SELECT count(*) FROM public.fuel_logs f WHERE f.user_id = _qa_user_id),
    'applications', (SELECT count(*) FROM apps),
    'application_events', (SELECT count(*) FROM public.application_events ev
       WHERE ev.application_id IN (SELECT id FROM apps)),
    'referrals', (SELECT count(*) FROM refs),
    'agency_work_items', (SELECT count(*) FROM work_items),
    'settlements', (SELECT count(*) FROM settlements),
    'settlement_items', (SELECT count(*) FROM items),
    'settlement_matches', (SELECT count(*) FROM public.driver_settlement_matches m
       WHERE m.settlement_item_id IN (SELECT id FROM items)),
    'notifications', (SELECT count(*) FROM notifs),
    'lane_stats', (SELECT count(*) FROM public.lane_stats ls WHERE ls.user_id = _qa_user_id),
    'broker_stats', (SELECT count(*) FROM public.broker_stats bs WHERE bs.user_id = _qa_user_id),
    'operating_metrics', (SELECT count(*) FROM public.operating_metrics om WHERE om.user_id = _qa_user_id)
  )
$$;

REVOKE ALL ON FUNCTION public._owner_qa_fixture_reset_counts(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._owner_qa_fixture_reset_counts(uuid, uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._owner_qa_fixture_reset_counts(uuid, uuid, uuid, uuid) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Public RPC: preview (read-only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.owner_qa_fixture_reset_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $$
DECLARE
  v_u uuid;
  v_rp uuid;
  v_ap uuid;
  v_counts jsonb;
  v_total bigint := 0;
  v_key text;
BEGIN
  SELECT r.qa_user_id, r.qa_recruiter_profile_id, r.qa_agency_profile_id
    INTO v_u, v_rp, v_ap
  FROM public._owner_qa_fixture_roots() r;

  v_counts := public._owner_qa_fixture_reset_counts(v_u, v_rp, v_ap, auth.uid());

  FOR v_key IN SELECT jsonb_object_keys(v_counts) LOOP
    v_total := v_total + (v_counts ->> v_key)::bigint;
  END LOOP;

  RETURN v_counts
    || jsonb_build_object(
         'total_rows', v_total,
         'roots_intact', true
       );
END;
$$;

COMMENT ON FUNCTION public.owner_qa_fixture_reset_preview() IS
  'Owner-only read-only preview of the QA operational descendants that owner_qa_fixture_reset() would remove. Uses identical scoping predicates. Never touches billing, Stripe, Telegram, email, or the fixture root registry.';

REVOKE ALL ON FUNCTION public.owner_qa_fixture_reset_preview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_qa_fixture_reset_preview() FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_qa_fixture_reset_preview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_qa_fixture_reset_preview() TO service_role;

-- ---------------------------------------------------------------------------
-- Public RPC: reset (destructive, QA-descendant scoped, idempotent)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.owner_qa_fixture_reset()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $$
DECLARE
  v_u uuid;
  v_rp uuid;
  v_ap uuid;
  v_owner uuid := auth.uid();
  v_related uuid[];
  v_apps uuid[];
  v_refs uuid[];
  v_assistants uuid[];
  v_delegations uuid[];
  v_work_items uuid[];
  v_settlements uuid[];
  v_items uuid[];
  n_notifications integer := 0;
  n_matches integer := 0;
  n_items integer := 0;
  n_settlements integer := 0;
  n_work_items integer := 0;
  n_events integer := 0;
  n_apps integer := 0;
  n_refs integer := 0;
  n_profiles integer := 0;
  n_expenses integer := 0;
  n_fuel integer := 0;
  n_loads integer := 0;
  n_assistants integer := 0;
  n_delegations integer := 0;
  n_carrier integer := 0;
  n_lane integer := 0;
  n_broker integer := 0;
  n_metrics integer := 0;
  v_total bigint;
  v_roots_intact boolean;
BEGIN
  SELECT r.qa_user_id, r.qa_recruiter_profile_id, r.qa_agency_profile_id
    INTO v_u, v_rp, v_ap
  FROM public._owner_qa_fixture_roots() r;

  PERFORM public._owner_qa_fixture_reset_guard(v_u, v_rp, v_ap);

  v_related := public._owner_qa_fixture_related_users(v_u, v_rp, v_ap, v_owner);

  SELECT coalesce(array_agg(a.id), '{}')
    INTO v_apps
  FROM public.opportunity_applications a
  WHERE a.driver_user_id = v_u AND a.recruiter_id = v_rp;

  SELECT coalesce(array_agg(dr.id), '{}')
    INTO v_refs
  FROM public.driver_referrals dr
  WHERE dr.recruiter_id = v_rp
    AND (dr.referred_driver_user_id = v_u OR dr.referring_driver_id = v_u);

  SELECT coalesce(array_agg(da.id), '{}')
    INTO v_assistants
  FROM public.driver_assistants da
  WHERE da.driver_user_id = v_u;

  SELECT coalesce(array_agg(d.id), '{}')
    INTO v_delegations
  FROM public.agency_delegation_requests d
  WHERE d.agency_id = v_ap AND d.driver_user_id = v_u;

  SELECT coalesce(array_agg(w.id), '{}')
    INTO v_work_items
  FROM public.agency_work_items w
  WHERE w.agency_id = v_ap AND w.driver_user_id = v_u;

  SELECT coalesce(array_agg(s.id), '{}')
    INTO v_settlements
  FROM public.driver_settlements s
  WHERE s.driver_user_id = v_u;

  SELECT coalesce(array_agg(i.id), '{}')
    INTO v_items
  FROM public.driver_settlement_items i
  WHERE i.settlement_id = ANY (v_settlements);

  -- 1. Notifications descended from the rows being reset (payload-referenced).
  DELETE FROM public.notifications n
   WHERE n.user_id = ANY (v_related)
     AND (
       (n.payload ->> 'application_id')::uuid = ANY (v_apps)
       OR (n.payload ->> 'assistant_id')::uuid = ANY (v_assistants)
       OR (n.payload ->> 'delegation_id')::uuid = ANY (v_delegations)
       OR (n.payload ->> 'work_item_id')::uuid = ANY (v_work_items)
       OR (n.payload ->> 'referral_id')::uuid = ANY (v_refs)
       OR (n.payload ->> 'settlement_id')::uuid = ANY (v_settlements)
     );
  GET DIAGNOSTICS n_notifications = ROW_COUNT;

  -- 2. Settlement tree.
  DELETE FROM public.driver_settlement_matches m
   WHERE m.settlement_item_id = ANY (v_items);
  GET DIAGNOSTICS n_matches = ROW_COUNT;

  DELETE FROM public.driver_settlement_items i
   WHERE i.id = ANY (v_items);
  GET DIAGNOSTICS n_items = ROW_COUNT;

  DELETE FROM public.driver_settlements s
   WHERE s.id = ANY (v_settlements);
  GET DIAGNOSTICS n_settlements = ROW_COUNT;

  -- 3. Agency work items.
  DELETE FROM public.agency_work_items w
   WHERE w.id = ANY (v_work_items);
  GET DIAGNOSTICS n_work_items = ROW_COUNT;

  -- 4. Applications + events.
  DELETE FROM public.application_events ev
   WHERE ev.application_id = ANY (v_apps);
  GET DIAGNOSTICS n_events = ROW_COUNT;

  DELETE FROM public.opportunity_applications a
   WHERE a.id = ANY (v_apps);
  GET DIAGNOSTICS n_apps = ROW_COUNT;

  -- 5. Referrals descended from the QA driver + QA recruiter root.
  DELETE FROM public.driver_referrals dr
   WHERE dr.id = ANY (v_refs);
  GET DIAGNOSTICS n_refs = ROW_COUNT;

  -- 6. QA driver opportunity profile(s).
  DELETE FROM public.driver_opportunity_profiles p
   WHERE p.user_id = v_u;
  GET DIAGNOSTICS n_profiles = ROW_COUNT;

  -- 7. Operational driver rows (recompute triggers fire here).
  DELETE FROM public.expenses e WHERE e.user_id = v_u;
  GET DIAGNOSTICS n_expenses = ROW_COUNT;

  DELETE FROM public.fuel_logs f WHERE f.user_id = v_u;
  GET DIAGNOSTICS n_fuel = ROW_COUNT;

  DELETE FROM public.loads l WHERE l.user_id = v_u;
  GET DIAGNOSTICS n_loads = ROW_COUNT;

  -- 8. Relationships.
  DELETE FROM public.driver_assistants da WHERE da.id = ANY (v_assistants);
  GET DIAGNOSTICS n_assistants = ROW_COUNT;

  DELETE FROM public.agency_delegation_requests d
   WHERE d.id = ANY (v_delegations);
  GET DIAGNOSTICS n_delegations = ROW_COUNT;

  DELETE FROM public.carrier_driver_relationships c
   WHERE c.driver_user_id = v_u AND c.recruiter_id = v_rp;
  GET DIAGNOSTICS n_carrier = ROW_COUNT;

  -- 9. Derived aggregates left behind by the recompute triggers.
  DELETE FROM public.lane_stats ls WHERE ls.user_id = v_u;
  GET DIAGNOSTICS n_lane = ROW_COUNT;

  DELETE FROM public.broker_stats bs WHERE bs.user_id = v_u;
  GET DIAGNOSTICS n_broker = ROW_COUNT;

  DELETE FROM public.operating_metrics om WHERE om.user_id = v_u;
  GET DIAGNOSTICS n_metrics = ROW_COUNT;

  SELECT count(*) = 3 INTO v_roots_intact
  FROM public.qa_fixture_roots r
  WHERE r.active AND r.revoked_at IS NULL AND r.qa_owner_user_id = v_owner;

  IF NOT v_roots_intact THEN
    RAISE EXCEPTION 'owner_qa_fixture_roots_violated' USING ERRCODE = '22023';
  END IF;

  v_total := n_carrier + n_assistants + n_delegations + n_profiles + n_loads
    + n_expenses + n_fuel + n_apps + n_events + n_refs + n_work_items
    + n_settlements + n_items + n_matches + n_notifications + n_lane
    + n_broker + n_metrics;

  RETURN jsonb_build_object(
    'carrier_relationships', n_carrier,
    'assistant_relationships', n_assistants,
    'agency_delegations', n_delegations,
    'driver_profiles', n_profiles,
    'loads', n_loads,
    'expenses', n_expenses,
    'fuel_logs', n_fuel,
    'applications', n_apps,
    'application_events', n_events,
    'referrals', n_refs,
    'agency_work_items', n_work_items,
    'settlements', n_settlements,
    'settlement_items', n_items,
    'settlement_matches', n_matches,
    'notifications', n_notifications,
    'lane_stats', n_lane,
    'broker_stats', n_broker,
    'operating_metrics', n_metrics,
    'total_rows', v_total,
    'roots_intact', true
  );
END;
$$;

COMMENT ON FUNCTION public.owner_qa_fixture_reset() IS
  'Owner-only deterministic reset of QA operational descendants of the caller''s three active QA fixture roots. Idempotent, FK-safe, fail-closed. Preserves the roots, root identities, QA opportunities, billing, Stripe, Telegram, and email suppression state.';

REVOKE ALL ON FUNCTION public.owner_qa_fixture_reset() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_qa_fixture_reset() FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_qa_fixture_reset() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_qa_fixture_reset() TO service_role;
