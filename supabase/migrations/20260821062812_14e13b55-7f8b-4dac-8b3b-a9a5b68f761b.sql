-- =====================================================================
-- PHASE TG-2E3-O8 — OWNER QA CROSS-WORKSPACE ENTITLEMENT COMPLETION
-- CANDIDATE ONLY. NOT APPLIED LIVE BY THIS PHASE.
--
-- Purpose
--   Complete Owner QA server-side *entitlement evaluation* across the
--   synthetic managed-driver path and the Agency operational path.
--
-- Hard boundaries
--   * Nothing here bypasses permissions, membership, delegation, RLS,
--     billing, Stripe, or relationship authorization. It only substitutes
--     the EFFECTIVE plan/entitlement evaluation for registered QA fixture
--     roots owned by the current active super_admin QA owner.
--   * No table / view / policy / trigger / index / grant / revoke.
--   * Exactly four pre-existing functions are CREATE OR REPLACE'd:
--       public.driver_has_active_pro(uuid)
--       public.get_effective_agency_limits(uuid)
--       public._agency_member_paid_operational_authority(uuid,uuid)
--       public.settlement_current_user_can_manage_agency(uuid,uuid,text)
--     Signature, return type, language, volatility, SECURITY DEFINER,
--     search_path and ownership are preserved exactly.
--   * O6's public.is_qa_fixture_root(text,uuid,uuid) EXECUTE ACL is NOT
--     broadened. These callers are SECURITY DEFINER, so the existing
--     service_role-only grant remains sufficient.
--   * No billing / subscription / entitlement / admin row is ever written.
--
-- Dependencies (must already be applied): O2 Owner QA, O6 QA fixture root
-- registry.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. DRIVER — synthetic managed-driver QA branch
--
-- Existing self-QA branch preserved byte-for-byte. A synthetic-target
-- branch is added AFTER it and BEFORE the original admin/subscription
-- fallback. It requires an authenticated caller, a target that is NOT the
-- caller, an ACTIVE `user` fixture root owned by that exact caller, and an
-- active driver-domain Owner QA persona (which itself already requires the
-- caller to be a super_admin with a live, unexpired QA session).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_has_active_pro(_driver uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _qa_persona text;
BEGIN
  -- Owner QA overlay: only ever for the caller's OWN driver identity.
  IF _driver IS NOT NULL AND _driver = auth.uid() THEN
    SELECT q.persona INTO _qa_persona
    FROM public._owner_qa_persona_for(auth.uid()) q
    WHERE q.domain = 'driver';

    IF _qa_persona IS NOT NULL THEN
      RETURN _qa_persona IN ('pro_monthly', 'pro_yearly');
    END IF;
  END IF;

  -- Owner QA overlay (O8): synthetic managed-driver fixture owned by the
  -- authenticated QA owner. Never the owner's own identity, never another
  -- owner's fixture, never an inactive/revoked root.
  IF _driver IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND _driver <> auth.uid()
     AND public.is_qa_fixture_root('user', _driver, auth.uid())
  THEN
    _qa_persona := NULL;

    SELECT q.persona INTO _qa_persona
    FROM public._owner_qa_persona_for(auth.uid()) q
    WHERE q.domain = 'driver';

    IF _qa_persona IS NOT NULL THEN
      RETURN _qa_persona IN ('pro_monthly', 'pro_yearly');
    END IF;
  END IF;

  -- Original behaviour, unchanged.
  RETURN
    _driver IS NOT NULL
    AND (
      public.is_admin(_driver)
      OR EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = _driver
          AND s.status = 'active'
          AND s.plan_key IN ('pro_monthly', 'pro_yearly')
      )
    );
END;
$function$;

-- ---------------------------------------------------------------------
-- B. AGENCY — central O6 root gate on the existing Owner QA branch
--
-- The QA plan mapping and limit derivation are unchanged. The branch is
-- only NARROWED: in addition to the existing "agency owned by auth.uid()"
-- requirement and an active agency-domain persona, the agency must also be
-- an ACTIVE registered `agency_profile` fixture root owned by that same
-- caller. Otherwise the original real-entitlement / fail-closed behaviour
-- applies verbatim.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_effective_agency_limits(_agency_id uuid)
RETURNS TABLE(plan_key text, status text, member_limit integer, active_client_limit integer, service_package_limit integer, has_entitlement_row boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ent public.agency_entitlements;
  defaults record;
  _owner_id uuid;
  _qa_persona text;
BEGIN
  -- Owner QA overlay: only for an agency owned by the caller AND registered
  -- as an ACTIVE QA fixture root belonging to that same caller (O8 gate).
  SELECT ap.owner_user_id INTO _owner_id
  FROM public.agency_profiles ap
  WHERE ap.id = _agency_id;

  IF _owner_id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND _owner_id = auth.uid()
     AND public.is_qa_fixture_root('agency_profile', _agency_id, auth.uid())
  THEN
    SELECT q.persona INTO _qa_persona
    FROM public._owner_qa_persona_for(auth.uid()) q
    WHERE q.domain = 'agency';

    IF _qa_persona IS NOT NULL THEN
      IF _qa_persona = 'assistant_free' THEN
        -- Fail closed exactly like a missing entitlement row.
        SELECT * INTO defaults FROM public._agency_plan_defaults('agency_starter');
        RETURN QUERY SELECT 'agency_starter'::text, 'cancelled'::text,
          defaults.member_limit, defaults.active_client_limit, defaults.service_package_limit, false;
        RETURN;
      END IF;

      SELECT * INTO defaults FROM public._agency_plan_defaults(_qa_persona);
      RETURN QUERY SELECT _qa_persona::text, 'active'::text,
        defaults.member_limit, defaults.active_client_limit, defaults.service_package_limit, true;
      RETURN;
    END IF;
  END IF;

  -- Original behaviour, unchanged.
  SELECT * INTO ent FROM public.agency_entitlements WHERE agency_id = _agency_id;
  IF NOT FOUND THEN
    -- Fail closed. A missing entitlement row is NOT beta access.
    SELECT * INTO defaults FROM public._agency_plan_defaults('agency_starter');
    RETURN QUERY SELECT 'agency_starter'::text, 'cancelled'::text,
      defaults.member_limit, defaults.active_client_limit, defaults.service_package_limit, false;
    RETURN;
  END IF;
  SELECT * INTO defaults FROM public._agency_plan_defaults(ent.plan_key);
  RETURN QUERY SELECT ent.plan_key, ent.status,
    COALESCE(ent.member_limit, defaults.member_limit),
    COALESCE(ent.active_client_limit, defaults.active_client_limit),
    COALESCE(ent.service_package_limit, defaults.service_package_limit),
    true;
END;
$function$;

-- ---------------------------------------------------------------------
-- C. AGENCY OPERATIONAL AUTHORITY — consume the centralized resolver
--
-- Membership, agency status, ownership, seat/workspace limit and every
-- other check are preserved EXACTLY. Only the raw agency_entitlements
-- paid-status read is replaced by the centralized effective resolver. The
-- accepted status set is unchanged: manual_beta | active | trialing |
-- past_due. `cancelled` (and a missing entitlement row, which the resolver
-- reports as `cancelled`) remains rejected.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._agency_member_paid_operational_authority(_agency_id uuid, _uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_owner boolean;
  _ent_ok boolean;
BEGIN
  IF _agency_id IS NULL OR _uid IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.agency_profiles ap WHERE ap.id=_agency_id AND ap.status='active') THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.agency_members am WHERE am.agency_id=_agency_id AND am.member_user_id=_uid AND am.status='active') THEN RETURN false; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.get_effective_agency_limits(_agency_id) l
    WHERE l.status IN ('manual_beta','active','trialing','past_due')
  ) INTO _ent_ok;
  IF NOT _ent_ok THEN RETURN false; END IF;
  SELECT EXISTS(SELECT 1 FROM public.agency_profiles ap WHERE ap.id=_agency_id AND ap.owner_user_id=_uid) INTO _is_owner;
  IF _is_owner THEN RETURN true; END IF;
  RETURN public.agency_team_workspace_within_limit(_agency_id);
END;
$function$;

-- ---------------------------------------------------------------------
-- D. SETTLEMENT AGENCY AUTHORITY — consume the centralized resolver
--
-- Every membership / delegation / permission / action / recruiter-conflict
-- check is preserved EXACTLY, including the call into
-- _agency_member_paid_operational_authority. Only the redundant direct
-- agency_entitlements plan/status test is replaced. Settlement keeps its
-- STRICTER status set: active | trialing | manual_beta. `past_due` is NOT
-- newly admitted.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settlement_current_user_can_manage_agency(_agency_id uuid, _driver_user_id uuid, _permission text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$ SELECT auth.uid() IS NOT NULL AND _agency_id IS NOT NULL AND _driver_user_id IS NOT NULL AND _permission IS NOT NULL AND _permission IN ('settlements_manage','settlements_finalize') AND EXISTS(SELECT 1 FROM public.agency_profiles ap WHERE ap.id=_agency_id AND ap.status='active') AND EXISTS(SELECT 1 FROM public.agency_members am WHERE am.agency_id=_agency_id AND am.member_user_id=auth.uid() AND am.status='active') AND EXISTS(SELECT 1 FROM public.get_effective_agency_limits(_agency_id) l WHERE l.plan_key IN ('agency_starter','agency_team','agency_growth') AND l.status IN ('active','trialing','manual_beta')) AND public._agency_member_paid_operational_authority(_agency_id,auth.uid()) AND EXISTS(SELECT 1 FROM public.agency_delegation_requests dr WHERE dr.agency_id=_agency_id AND dr.driver_user_id=_driver_user_id AND dr.member_user_id=auth.uid() AND dr.status='approved' AND jsonb_typeof(dr.requested_permissions->_permission)='boolean' AND (dr.requested_permissions->_permission)=to_jsonb(true)) AND NOT(EXISTS(SELECT 1 FROM public.agency_members am2 WHERE am2.agency_id=_agency_id AND am2.member_user_id=auth.uid() AND am2.status='active' AND am2.role='agency_owner') AND EXISTS(SELECT 1 FROM public.recruiter_billing_profiles rb WHERE rb.user_id=auth.uid() AND rb.plan IN ('starter','growth','fleet') AND rb.status IN ('active','trialing'))); $function$;