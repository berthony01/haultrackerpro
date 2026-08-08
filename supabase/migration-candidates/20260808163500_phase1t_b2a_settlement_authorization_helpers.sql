-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase 1T-B2A — Settlement authorization helper contract (read-only helpers).
--
-- Scope: exactly six new SECURITY DEFINER, read-only (STABLE) helper functions
-- that answer a single question — "is the CURRENT caller authorized?" — for the
-- settlement surface introduced by the Phase 1T-B1 candidate.
--
-- Deliberately NOT in this candidate:
--   * ZERO RLS policies (Phase 1T-B2B), ZERO triggers, ZERO mutation RPCs;
--   * ZERO table/column/constraint/index/enum/view DDL;
--   * ZERO DML or backfill;
--   * no calculation logic, no UI, no Stripe, no pricing.
--
-- Contract properties enforced below:
--   * identity is always derived from auth.uid(); no caller-supplied actor id,
--     no client-settable GUC, no email lookup, ever;
--   * no dynamic SQL;
--   * no admin / service-role bypass branch — service_role may EXECUTE these
--     helpers, but gets no special authorization answer from them;
--   * every unknown, malformed, missing, or differently-cased input fails closed
--     to false; permission and plan/status vocabularies are exact allowlists;
--   * helpers reveal only a boolean, never billing or profile details.
--
-- Product rules preserved (matching the accepted Phase 1T-A contract):
--   * a Free recipient driver keeps visibility of delivered company statements;
--     downgrade never hides historical or self-created records;
--   * active driver Pro is required only for driver-imported advanced management;
--   * carrier settlement management requires a STANDALONE paid recruiter billing
--     row — agency-included recruiter premium never qualifies;
--   * agency settlement management requires a paid or grandfathered (manual_beta)
--     agency entitlement plus an approved, permission-scoped delegation;
--   * the accepted dual-paid-business conflict stays fail-closed, and remains an
--     OWNER-scoped rule only.
--
-- This candidate intentionally does NOT use IF NOT EXISTS: a re-apply must fail
-- loudly rather than mask drift.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) settlement_current_user_can_manage_driver_import()
--    Advanced driver-side management (manual import) requires the CURRENT user
--    to hold an active Pro subscription. Admin status and email are never Pro.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_current_user_can_manage_driver_import()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.subscriptions s
       WHERE s.user_id = auth.uid()
         AND s.plan_key IN ('pro_monthly', 'pro_yearly')
         AND s.status = 'active'
     );
$$;

-- ---------------------------------------------------------------------------
-- 2) settlement_current_user_can_administer_carrier(_recruiter_id)
--    Carrier business administration: the caller must own the recruiter profile
--    AND hold a standalone paid recruiter billing row. An agency-included
--    recruiter premium cannot satisfy this because no recruiter_billing_profiles
--    paid row exists for it. A paid agency OWNER context for the same user is a
--    dual-paid-business conflict and fails closed; manual_beta is NOT a paid
--    agency plan_key status here and therefore never creates that conflict.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_current_user_can_administer_carrier(
  _recruiter_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT auth.uid() IS NOT NULL
     AND _recruiter_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.recruiter_profiles rp
       WHERE rp.id = _recruiter_id
         AND rp.user_id = auth.uid()
     )
     AND EXISTS (
       SELECT 1
       FROM public.recruiter_billing_profiles rb
       WHERE rb.recruiter_id = _recruiter_id
         AND rb.user_id = auth.uid()
         AND rb.plan IN ('starter', 'growth', 'fleet')
         AND rb.status IN ('active', 'trialing')
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.agency_profiles ap
       JOIN public.agency_members am
         ON am.agency_id = ap.id
        AND am.member_user_id = auth.uid()
        AND am.role = 'agency_owner'
        AND am.status = 'active'
       JOIN public.agency_entitlements ae
         ON ae.agency_id = ap.id
        AND ae.plan_key IN ('agency_starter', 'agency_team', 'agency_growth')
        AND ae.status IN ('active', 'trialing')
       WHERE ap.owner_user_id = auth.uid()
     );
$$;

-- ---------------------------------------------------------------------------
-- 3) settlement_current_user_can_manage_carrier(_recruiter_id, _relationship_id,
--    _driver_user_id)
--    Managing a specific driver's carrier settlement additionally requires the
--    EXACT active relationship triple. No fuzzy, business-name, or email match.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_current_user_can_manage_carrier(
  _recruiter_id uuid,
  _relationship_id uuid,
  _driver_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT _relationship_id IS NOT NULL
     AND _driver_user_id IS NOT NULL
     AND public.settlement_current_user_can_administer_carrier(_recruiter_id)
     AND EXISTS (
       SELECT 1
       FROM public.carrier_driver_relationships r
       WHERE r.id = _relationship_id
         AND r.recruiter_id = _recruiter_id
         AND r.driver_user_id = _driver_user_id
         AND r.status = 'active'
     );
$$;

-- ---------------------------------------------------------------------------
-- 4) settlement_current_user_can_assist_driver(_driver_user_id, _permission,
--    _require_pro)
--    DIRECT driver-granted assistant context ONLY: the qualifying row must have
--    agency_delegation_id IS NULL. An agency-generated driver_assistants row (a
--    non-null agency_delegation_id) must go through the agency authorization
--    path and can never satisfy this helper. The permission vocabulary is an
--    exact allowlist and the stored permission must be JSON boolean true exactly
--    — the string "true", the number 1, null, and a missing key all fail closed.
--    When _require_pro is true the TARGET driver (never the assistant) must hold
--    active Pro; basic viewing is never gated on the driver's plan.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_current_user_can_assist_driver(
  _driver_user_id uuid,
  _permission text,
  _require_pro boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT auth.uid() IS NOT NULL
     AND _driver_user_id IS NOT NULL
     AND _permission IS NOT NULL
     AND _permission IN ('settlements_view', 'settlements_manage', 'settlements_finalize')
     AND EXISTS (
       SELECT 1
       FROM public.driver_assistants da
       WHERE da.driver_user_id = _driver_user_id
         AND da.assistant_user_id = auth.uid()
         AND da.status = 'active'
          AND da.agency_delegation_id IS NULL
          AND jsonb_typeof(da.permissions -> _permission) = 'boolean'
          AND (da.permissions -> _permission) = to_jsonb(true)
     )
     AND (
       _require_pro IS NOT TRUE
       OR EXISTS (
         SELECT 1
         FROM public.subscriptions s
         WHERE s.user_id = _driver_user_id
           AND s.plan_key IN ('pro_monthly', 'pro_yearly')
           AND s.status = 'active'
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- 5) settlement_current_user_can_manage_agency(_agency_id, _driver_user_id,
--    _permission)
--    Agency-side preparation/finalization. Requires an active agency profile, an
--    active membership for the CURRENT user, a paid or grandfathered (manual_beta)
--    entitlement, and an APPROVED delegation naming this same member, this same
--    driver, and carrying the requested permission as JSON boolean true exactly.
--    The driver's own Free/Pro state never gates this helper.
--    The dual-paid-business conflict is OWNER-scoped: a non-owner member's
--    unrelated personal recruiter subscription must not block agency work.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_current_user_can_manage_agency(
  _agency_id uuid,
  _driver_user_id uuid,
  _permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT auth.uid() IS NOT NULL
     AND _agency_id IS NOT NULL
     AND _driver_user_id IS NOT NULL
     AND _permission IS NOT NULL
     AND _permission IN ('settlements_manage', 'settlements_finalize')
     AND EXISTS (
       SELECT 1
       FROM public.agency_profiles ap
       WHERE ap.id = _agency_id
         AND ap.status = 'active'
     )
     AND EXISTS (
       SELECT 1
       FROM public.agency_members am
       WHERE am.agency_id = _agency_id
         AND am.member_user_id = auth.uid()
         AND am.status = 'active'
     )
     AND EXISTS (
       SELECT 1
       FROM public.agency_entitlements ae
       WHERE ae.agency_id = _agency_id
         AND ae.plan_key IN ('agency_starter', 'agency_team', 'agency_growth')
         AND ae.status IN ('active', 'trialing', 'manual_beta')
     )
     AND EXISTS (
       SELECT 1
       FROM public.agency_delegation_requests dr
       WHERE dr.agency_id = _agency_id
         AND dr.driver_user_id = _driver_user_id
         AND dr.member_user_id = auth.uid()
         AND dr.status = 'approved'
         AND jsonb_typeof(dr.requested_permissions -> _permission) = 'boolean'
         AND (dr.requested_permissions -> _permission) = to_jsonb(true)
     )
     AND NOT (
       EXISTS (
         SELECT 1
         FROM public.agency_members am2
         WHERE am2.agency_id = _agency_id
           AND am2.member_user_id = auth.uid()
           AND am2.status = 'active'
           AND am2.role = 'agency_owner'
       )
       AND EXISTS (
         SELECT 1
         FROM public.recruiter_billing_profiles rb
         WHERE rb.user_id = auth.uid()
           AND rb.plan IN ('starter', 'growth', 'fleet')
           AND rb.status IN ('active', 'trialing')
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- 6) settlement_current_user_can_view_settlement(_settlement_id)
--    READ access only. Historical/read access is deliberately NOT gated on a
--    current paid subscription, a current active carrier relationship, or a
--    current agency entitlement — those gates apply to CREATE/MANAGE only.
--
--    Status vocabularies below are exact allowlists on purpose: a permissive
--    `status <> 'draft'` shortcut would silently admit an unknown/malformed
--    future status, so delivered business statuses are enumerated explicitly.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.settlement_current_user_can_view_settlement(
  _settlement_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.driver_settlements ds
    WHERE ds.id = _settlement_id
      AND auth.uid() IS NOT NULL
      AND _settlement_id IS NOT NULL
      AND ds.source IN ('carrier_issued', 'agency_prepared', 'driver_imported')
      AND ds.status IN ('draft', 'finalized', 'voided', 'superseded')
      AND (
        -- A. RECIPIENT DRIVER
        (
          ds.driver_user_id = auth.uid()
          AND (
            (
              ds.source IN ('carrier_issued', 'agency_prepared')
              AND ds.status IN ('finalized', 'superseded', 'voided')
            )
            OR (
              ds.source = 'driver_imported'
              AND ds.status IN ('draft', 'finalized', 'superseded', 'voided')
            )
          )
        )

        -- B. CARRIER ISSUER HISTORY (all statuses, no current billing needed)
        OR (
          ds.source = 'carrier_issued'
          AND ds.carrier_recruiter_profile_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.recruiter_profiles rp
            WHERE rp.id = ds.carrier_recruiter_profile_id
              AND rp.user_id = auth.uid()
          )
        )

        -- C. AGENCY PREPARER HISTORY (all statuses, no current entitlement needed)
        OR (
          ds.source = 'agency_prepared'
          AND ds.agency_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.agency_members am
            WHERE am.agency_id = ds.agency_id
              AND am.member_user_id = auth.uid()
              AND am.status = 'active'
          )
          AND EXISTS (
            SELECT 1
            FROM public.agency_delegation_requests dr
            WHERE dr.agency_id = ds.agency_id
              AND dr.driver_user_id = ds.driver_user_id
              AND dr.member_user_id = auth.uid()
              AND dr.status = 'approved'
              AND (
                (jsonb_typeof(dr.requested_permissions -> 'settlements_view') = 'boolean'
                  AND (dr.requested_permissions -> 'settlements_view') = to_jsonb(true))
                OR (jsonb_typeof(dr.requested_permissions -> 'settlements_manage') = 'boolean'
                  AND (dr.requested_permissions -> 'settlements_manage') = to_jsonb(true))
                OR (jsonb_typeof(dr.requested_permissions -> 'settlements_finalize') = 'boolean'
                  AND (dr.requested_permissions -> 'settlements_finalize') = to_jsonb(true))
              )
          )
        )

        -- D. DELEGATED DRIVER-SIDE VIEW (never sees a business-sourced draft)
        OR (
          (
            (
              ds.source IN ('carrier_issued', 'agency_prepared')
              AND ds.status IN ('finalized', 'superseded', 'voided')
            )
            OR (
              ds.source = 'driver_imported'
              AND ds.status IN ('draft', 'finalized', 'superseded', 'voided')
            )
          )
          AND (
            EXISTS (
              SELECT 1
              FROM public.driver_assistants da
              WHERE da.driver_user_id = ds.driver_user_id
                AND da.assistant_user_id = auth.uid()
                AND da.status = 'active'
                AND jsonb_typeof(da.permissions -> 'settlements_view') = 'boolean'
                AND (da.permissions -> 'settlements_view') = to_jsonb(true)
            )
            OR EXISTS (
              SELECT 1
              FROM public.agency_delegation_requests dr
              JOIN public.agency_members am
                ON am.agency_id = dr.agency_id
               AND am.member_user_id = auth.uid()
               AND am.status = 'active'
              WHERE dr.driver_user_id = ds.driver_user_id
                AND dr.member_user_id = auth.uid()
                AND dr.status = 'approved'
                AND jsonb_typeof(dr.requested_permissions -> 'settlements_view') = 'boolean'
                AND (dr.requested_permissions -> 'settlements_view') = to_jsonb(true)
            )
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- ACL contract: these helpers answer only "is the CURRENT caller authorized?".
-- anon and PUBLIC get nothing; authenticated and service_role may execute.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.settlement_current_user_can_manage_driver_import() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_current_user_can_manage_driver_import() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_current_user_can_administer_carrier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_current_user_can_administer_carrier(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_current_user_can_manage_carrier(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_current_user_can_manage_carrier(uuid, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_current_user_can_assist_driver(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_current_user_can_assist_driver(uuid, text, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_current_user_can_manage_agency(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_current_user_can_manage_agency(uuid, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_current_user_can_view_settlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_current_user_can_view_settlement(uuid) TO authenticated, service_role;

COMMIT;
