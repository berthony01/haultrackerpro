-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- =====================================================================
-- Phase 1S-A2 — Agency paid-plan enforcement with beta grandfathering.
--
-- Defect being repaired:
--   1. public.agency_entitlements.status defaulted to 'manual_beta', so any
--      row inserted without an explicit status silently received open beta
--      access.
--   2. public.create_agency() inserted a 'manual_beta' Agency Starter
--      entitlement for every brand-new agency, granting paid-plan capacity
--      without any billing relationship.
--   3. public.get_effective_agency_limits() returned 'manual_beta' Starter
--      for a MISSING entitlement row, so absence of billing read as beta
--      access.
--
-- Behavior after this candidate:
--   * New agencies get a Starter *placeholder* in status 'cancelled'
--     (source 'manual', NULL overrides, no Stripe identity). The existing
--     agency checkout function fills stripe_customer_id and the webhook
--     upserts plan/status/source/subscription — unchanged.
--   * A missing entitlement row fails closed as Starter/'cancelled'.
--   * assert_agency_limit() blocks the three billable actions when the
--     effective status is 'cancelled', with one truthful message that is
--     correct for both never-started and previously cancelled billing.
--   * The two existing production rows with status 'manual_beta' are
--     GRANDFATHERED: this candidate contains no UPDATE, DELETE, or backfill
--     of any kind and never rewrites an existing entitlement row.
--
-- Scope guarantees: no new table, no new column, no policy/RLS/index/trigger
-- change, no grant change (CREATE OR REPLACE preserves existing ACLs), no
-- Stripe change.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Column default: absence of an explicit status must fail closed.
-- ---------------------------------------------------------------------
ALTER TABLE public.agency_entitlements ALTER COLUMN status SET DEFAULT 'cancelled'::text;

-- ---------------------------------------------------------------------
-- 2. create_agency: placeholder entitlement is 'cancelled', not beta.
--    Authentication, idempotent existing-agency return, validations,
--    profile creation, and owner membership creation are preserved
--    exactly.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agency(
  _name text,
  _description text DEFAULT NULL::text,
  _contact_email text DEFAULT NULL::text
)
RETURNS public.agency_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.agency_profiles;
  _existing public.agency_profiles;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;

  -- Idempotent: if user already owns an agency, return it.
  SELECT * INTO _existing FROM public.agency_profiles
    WHERE owner_user_id = _uid LIMIT 1;
  IF FOUND THEN
    RETURN _existing;
  END IF;

  IF _name IS NULL OR length(btrim(_name)) < 2 OR length(_name) > 120 THEN
    RAISE EXCEPTION 'Agency name must be 2–120 characters' USING ERRCODE='22023';
  END IF;
  IF _contact_email IS NOT NULL AND btrim(_contact_email) <> ''
     AND lower(btrim(_contact_email)) !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid contact email' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.agency_profiles(owner_user_id, name, description, contact_email)
  VALUES (_uid, btrim(_name),
          NULLIF(btrim(coalesce(_description,'')),''),
          NULLIF(lower(btrim(coalesce(_contact_email,''))),''))
  RETURNING * INTO _row;

  INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, role, status, accepted_at)
  VALUES (_row.id, _uid,
          COALESCE((SELECT lower(email) FROM auth.users WHERE id = _uid),'owner@local'),
          'agency_owner','active', now());

  -- Placeholder only. No paid capacity until Stripe activates the plan.
  -- Overrides stay NULL so plan defaults always apply. ON CONFLICT DO
  -- NOTHING guarantees an existing entitlement row is never rewritten.
  INSERT INTO public.agency_entitlements
    (agency_id, plan_key, status, source,
     active_client_limit, member_limit, service_package_limit)
  VALUES (_row.id, 'agency_starter', 'cancelled', 'manual',
          NULL, NULL, NULL)
  ON CONFLICT (agency_id) DO NOTHING;

  RETURN _row;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. get_effective_agency_limits: a missing row fails closed.
--    Existing rows keep their exact current behavior (own plan/status,
--    explicit overrides falling back to plan defaults).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_effective_agency_limits(_agency_id uuid)
RETURNS TABLE(
  plan_key text, status text,
  member_limit integer, active_client_limit integer, service_package_limit integer,
  has_entitlement_row boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ent public.agency_entitlements; defaults record;
BEGIN
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
END $$;

-- ---------------------------------------------------------------------
-- 4. assert_agency_limit: one truthful billing-not-active block that is
--    correct for never-started AND previously cancelled billing.
--    manual_beta / active / trialing behavior is unchanged; all three
--    action counters and their ceilings are unchanged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_agency_limit(_agency_id uuid, _action text)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE lim record; used integer; plan_label text;
BEGIN
  SELECT * INTO lim FROM public.get_effective_agency_limits(_agency_id);
  plan_label := public._agency_plan_label(lim.plan_key);

  -- Phase 1S-A2: hard block before counting when billing is not active.
  -- Covers never-started placeholders and previously cancelled plans with
  -- the same truthful copy. Grandfathered manual_beta rows are unaffected.
  IF lim.status = 'cancelled' THEN
    RAISE EXCEPTION
      'Agency billing is not active. Start or restart your % plan from the Plan & Limits card to continue this action.',
      plan_label USING ERRCODE = 'P0001';
  END IF;

  IF _action = 'create_service_package' THEN
    IF lim.service_package_limit IS NULL THEN RETURN; END IF;
    SELECT count(*) INTO used FROM public.agency_service_packages
      WHERE agency_id = _agency_id AND is_active = true;
    IF used >= lim.service_package_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % active service packages. Upgrade your agency plan to add more.',
        plan_label, lim.service_package_limit USING ERRCODE = 'P0001';
    END IF;

  ELSIF _action = 'invite_member' THEN
    IF lim.member_limit IS NULL THEN RETURN; END IF;
    SELECT count(*) INTO used FROM public.agency_members
      WHERE agency_id = _agency_id AND status IN ('pending','active');
    IF used >= lim.member_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % agency members. Upgrade your agency plan to invite more.',
        plan_label, lim.member_limit USING ERRCODE = 'P0001';
    END IF;

  ELSIF _action = 'activate_client' THEN
    IF lim.active_client_limit IS NULL THEN RETURN; END IF;
    SELECT count(DISTINCT d.driver_user_id) INTO used FROM public.agency_delegation_requests d
      WHERE d.agency_id = _agency_id AND d.status = 'approved';
    IF used >= lim.active_client_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % active driver clients. Upgrade your agency plan to take on more.',
        plan_label, lim.active_client_limit USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown agency limit action: %', _action USING ERRCODE = '22023';
  END IF;
END $$;

COMMIT;
