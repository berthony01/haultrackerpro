-- =====================================================================
-- PHASE TG-2E3-O2 — SERVER-AWARE OWNER QA ENTITLEMENT (CANDIDATE ONLY)
--
-- NOT APPLIED LIVE BY THIS PHASE. Staged candidate for independent review.
--
-- Purpose
--   Let the platform owner (admin_users.role = 'super_admin') test REAL
--   server-gated plan behaviour (driver Pro, recruiter tiers, agency limits)
--   without touching Stripe, subscriptions, recruiter_billing_profiles, or
--   agency_entitlements.
--
-- Hard boundaries (unchanged by this candidate)
--   * No RLS policy on any pre-existing table is modified.
--   * No permission / relationship / membership / delegation function is
--     modified (current_user_can_*, *_has_permission, assistant_*, agency
--     membership, carrier-driver, Telegram identity / chat / actor bridge,
--     idempotency).
--   * No billing table row is ever written by QA mode.
--   * Exactly four pre-existing functions are replaced, and only to add a
--     surgical QA branch:
--       public.driver_has_active_pro(uuid)
--       public.effective_recruiter_tier(uuid)
--       public.get_effective_agency_limits(uuid)
--       public.opportunities_billing_guard()
--   * QA state is server-resident, 60-minute, super-admin-only, and applies
--     ONLY to the authenticated super-admin's own entities.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. QA SESSION TABLE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_qa_sessions (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  domain     text        NOT NULL,
  persona    text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT owner_qa_sessions_domain_check
    CHECK (domain IN ('driver', 'recruiter', 'agency')),
  CONSTRAINT owner_qa_sessions_persona_check
    CHECK (
      (domain = 'driver'    AND persona IN ('free', 'pro_monthly', 'pro_yearly'))
      OR (domain = 'recruiter' AND persona IN ('free_verified', 'starter', 'growth', 'fleet'))
      OR (domain = 'agency'  AND persona IN ('assistant_free', 'agency_starter', 'agency_team', 'agency_growth'))
    ),
  CONSTRAINT owner_qa_sessions_expiry_check
    CHECK (expires_at > created_at)
);

COMMENT ON TABLE public.owner_qa_sessions IS
  'Owner QA Mode: server-resident, super-admin-only, expiring plan persona overlay. Never billing data.';

REVOKE ALL ON TABLE public.owner_qa_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.owner_qa_sessions FROM anon;
REVOKE ALL ON TABLE public.owner_qa_sessions FROM authenticated;
GRANT SELECT ON TABLE public.owner_qa_sessions TO authenticated;
GRANT ALL    ON TABLE public.owner_qa_sessions TO service_role;

ALTER TABLE public.owner_qa_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_qa_sessions_owner_select ON public.owner_qa_sessions;
CREATE POLICY owner_qa_sessions_owner_select
  ON public.owner_qa_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND public.is_super_admin(auth.uid()));
-- No INSERT / UPDATE / DELETE policy: clients can never write QA state.

-- ---------------------------------------------------------------------
-- B. INTERNAL PRIMITIVE — not browser callable
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._owner_qa_persona_for(_user_id uuid)
RETURNS TABLE(domain text, persona text, expires_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
  SELECT s.domain, s.persona, s.expires_at
  FROM public.owner_qa_sessions s
  WHERE _user_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND _user_id = auth.uid()
    AND public.is_super_admin(auth.uid())
    AND s.user_id = _user_id
    AND s.enabled = true
    AND s.expires_at > now()
$function$;

REVOKE ALL ON FUNCTION public._owner_qa_persona_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._owner_qa_persona_for(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._owner_qa_persona_for(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._owner_qa_persona_for(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- C. AUTHENTICATED READ RPC
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_owner_qa_persona()
RETURNS TABLE(domain text, persona text, expires_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
  SELECT q.domain, q.persona, q.expires_at
  FROM public._owner_qa_persona_for(auth.uid()) q
$function$;

REVOKE ALL ON FUNCTION public.current_owner_qa_persona() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_owner_qa_persona() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_owner_qa_persona() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- D. OWNER MUTATION — set / switch persona
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_owner_qa_persona(_domain text, _persona text)
RETURNS TABLE(domain text, persona text, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _uid     uuid := auth.uid();
  _expires timestamptz := now() + interval '60 minutes';
  _valid   boolean;
BEGIN
  IF _uid IS NULL OR NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION 'owner_qa_not_authorized' USING ERRCODE = '42501';
  END IF;

  _valid := (
    (_domain = 'driver'    AND _persona IN ('free', 'pro_monthly', 'pro_yearly'))
    OR (_domain = 'recruiter' AND _persona IN ('free_verified', 'starter', 'growth', 'fleet'))
    OR (_domain = 'agency'  AND _persona IN ('assistant_free', 'agency_starter', 'agency_team', 'agency_growth'))
  );

  IF _domain IS NULL OR _persona IS NULL OR NOT _valid THEN
    RAISE EXCEPTION 'owner_qa_persona_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.owner_qa_sessions AS s (user_id, domain, persona, enabled, created_at, updated_at, expires_at)
  VALUES (_uid, _domain, _persona, true, now(), now(), _expires)
  ON CONFLICT (user_id) DO UPDATE
     SET domain     = EXCLUDED.domain,
         persona    = EXCLUDED.persona,
         enabled    = true,
         updated_at = now(),
         expires_at = EXCLUDED.expires_at;

  INSERT INTO public.admin_audit_log (admin_user_id, action, target_user_id, metadata)
  VALUES (
    _uid,
    'owner_qa_persona_set',
    _uid,
    jsonb_build_object('domain', _domain, 'persona', _persona, 'expires_at', _expires)
  );

  RETURN QUERY SELECT _domain, _persona, _expires;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_owner_qa_persona(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_owner_qa_persona(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_owner_qa_persona(text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- E. OWNER MUTATION — disable (return to actual account)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.disable_owner_qa_persona()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _uid      uuid := auth.uid();
  _prior    public.owner_qa_sessions;
  _disabled boolean := false;
BEGIN
  IF _uid IS NULL OR NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION 'owner_qa_not_authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.owner_qa_sessions
     SET enabled = false, updated_at = now()
   WHERE user_id = _uid AND enabled = true
  RETURNING * INTO _prior;

  _disabled := FOUND;

  IF _disabled THEN
    INSERT INTO public.admin_audit_log (admin_user_id, action, target_user_id, metadata)
    VALUES (
      _uid,
      'owner_qa_persona_disabled',
      _uid,
      jsonb_build_object('domain', _prior.domain, 'persona', _prior.persona)
    );
  END IF;

  RETURN _disabled;
END;
$function$;

REVOKE ALL ON FUNCTION public.disable_owner_qa_persona() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disable_owner_qa_persona() FROM anon;
GRANT EXECUTE ON FUNCTION public.disable_owner_qa_persona() TO authenticated, service_role;

-- =====================================================================
-- F. CENTRAL SERVER OVERLAYS — exactly four existing functions replaced.
--    All non-QA logic preserved semantically byte-for-byte.
-- =====================================================================

-- F1. driver_has_active_pro ------------------------------------------
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

-- F2. effective_recruiter_tier ---------------------------------------
CREATE OR REPLACE FUNCTION public.effective_recruiter_tier(_recruiter_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _owner_id       uuid;
  _recruiter_tier text := NULL;
  _agency_tier    text := NULL;
  _qa_persona     text := NULL;
BEGIN
  IF _recruiter_id IS NULL THEN
    RETURN 'free_standard';
  END IF;

  SELECT rp.user_id INTO _owner_id
  FROM public.recruiter_profiles rp
  WHERE rp.id = _recruiter_id;

  IF _owner_id IS NULL THEN
    RETURN 'free_standard';
  END IF;

  -- Owner QA overlay: only for a recruiter profile owned by the caller.
  IF _owner_id = auth.uid() THEN
    SELECT q.persona INTO _qa_persona
    FROM public._owner_qa_persona_for(auth.uid()) q
    WHERE q.domain = 'recruiter';

    IF _qa_persona IS NOT NULL THEN
      -- Neutralizes actual recruiter/agency dual-paid conflict for THIS
      -- evaluation only. No billing row is read-modified or written.
      IF _qa_persona = 'free_verified' THEN
        RETURN 'free_standard';
      END IF;
      RETURN _qa_persona;
    END IF;
  END IF;

  SELECT b.plan INTO _recruiter_tier
  FROM public.recruiter_billing_profiles b
  WHERE b.recruiter_id = _recruiter_id
    AND b.plan IN ('starter', 'growth', 'fleet')
    AND b.status IN ('active', 'trialing')
  ORDER BY CASE b.plan
             WHEN 'fleet'   THEN 3
             WHEN 'growth'  THEN 2
             WHEN 'starter' THEN 1
             ELSE 0
           END DESC
  LIMIT 1;

  SELECT CASE ae.plan_key
           WHEN 'agency_starter' THEN 'starter'
           WHEN 'agency_team'    THEN 'growth'
           WHEN 'agency_growth'  THEN 'fleet'
         END
    INTO _agency_tier
  FROM public.agency_profiles ap
  JOIN public.agency_members am
    ON am.agency_id = ap.id
   AND am.member_user_id = _owner_id
   AND am.role::text = 'agency_owner'
   AND am.status::text = 'active'
  JOIN public.agency_entitlements ae
    ON ae.agency_id = ap.id
  WHERE ap.owner_user_id = _owner_id
    AND ae.plan_key IN ('agency_starter', 'agency_team', 'agency_growth')
    AND ae.source IN ('stripe', 'manual', 'admin_seed')
    AND ae.status IN ('active', 'trialing')
  ORDER BY CASE ae.plan_key
             WHEN 'agency_growth'  THEN 3
             WHEN 'agency_team'    THEN 2
             WHEN 'agency_starter' THEN 1
             ELSE 0
           END DESC
  LIMIT 1;

  IF _recruiter_tier IS NOT NULL AND _agency_tier IS NOT NULL THEN
    RETURN 'conflict';
  END IF;

  RETURN COALESCE(_recruiter_tier, _agency_tier, 'free_standard');
END;
$function$;

-- F3. get_effective_agency_limits ------------------------------------
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
  -- Owner QA overlay: only for an agency owned by the caller.
  SELECT ap.owner_user_id INTO _owner_id
  FROM public.agency_profiles ap
  WHERE ap.id = _agency_id;

  IF _owner_id IS NOT NULL AND _owner_id = auth.uid() THEN
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

-- F4. opportunities_billing_guard ------------------------------------
CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _lock_namespace     constant integer := 1971001;
  _limit              integer;
  _active_count       integer;
  _is_becoming_active boolean := false;
  _authorized         boolean;
  _qa_recruiter_self  boolean := false;
BEGIN
  IF public.is_admin(auth.uid()) THEN
    -- Owner QA Mode: a super-admin testing a recruiter persona on their OWN
    -- recruiter entity must NOT take the admin billing bypass, so the
    -- selected paid tier is enforced honestly. Every other admin keeps the
    -- existing bypass exactly as before.
    _qa_recruiter_self := (
      public.is_super_admin(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public._owner_qa_persona_for(auth.uid()) q
        WHERE q.domain = 'recruiter'
      )
      AND EXISTS (
        SELECT 1 FROM public.recruiter_profiles rp
        WHERE rp.id = NEW.recruiter_id
          AND rp.user_id = auth.uid()
      )
    );

    IF NOT _qa_recruiter_self THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _authorized := public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_create'::public.recruiter_workspace_permission
    );
  ELSE
    _authorized := public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_edit'::public.recruiter_workspace_permission
    ) OR public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_change_status'::public.recruiter_workspace_permission
    );
  END IF;

  IF NOT _authorized THEN
    RAISE EXCEPTION 'Complete your recruiter profile to publish opportunities.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    _is_becoming_active := (NEW.status = 'active');
  ELSIF TG_OP = 'UPDATE' THEN
    _is_becoming_active := (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active');
  END IF;

  IF NOT _is_becoming_active THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(_lock_namespace, hashtext(NEW.recruiter_id::text));

  _limit := public.effective_recruiter_active_opportunity_limit(NEW.recruiter_id);

  IF _limit IS NULL OR _limit <= 0 THEN
    RAISE EXCEPTION 'Active opportunity activation is blocked.'
      USING ERRCODE = '23514',
            DETAIL  = '{"code": "business_entitlement_conflict"}';
  END IF;

  SELECT COUNT(*)::int INTO _active_count
  FROM public.opportunities o
  WHERE o.recruiter_id = NEW.recruiter_id
    AND o.status = 'active'
    AND o.id IS DISTINCT FROM NEW.id;

  IF _active_count >= _limit THEN
    RAISE EXCEPTION 'Active opportunity limit reached.'
      USING ERRCODE = '23514',
            DETAIL  = json_build_object(
                        'code', 'active_opportunity_limit_reached',
                        'limit', _limit,
                        'active_count', _active_count
                      )::text;
  END IF;

  RETURN NEW;
END;
$function$;
