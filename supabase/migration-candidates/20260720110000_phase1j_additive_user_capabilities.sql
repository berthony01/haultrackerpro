-- Phase 1J-A — Additive driver/recruiter capability foundation.
--
-- Server-authoritative "which workspaces may this account enter?" layer.
-- Every authenticated account holds driver capability. Recruiter capability
-- is ADDITIVE — it never removes driver capability, never grants billing,
-- and is derived exclusively from server state (recruiter_profiles +
-- profiles.intended_role) using the canonical Phase 1F completeness rule
-- (public.recruiter_profile_can_manage_opportunities).
--
-- This candidate is READ-ONLY relative to existing canonical migrations.
-- It does not alter M1, M2, handle_new_user, or any billing/subscription
-- table. UI routing/gating is deliberately deferred to a later phase.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.user_capability_type AS ENUM ('driver','recruiter');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.user_capability_status AS ENUM ('setup','active','suspended','revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_capabilities (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability    public.user_capability_type NOT NULL,
  status        public.user_capability_status NOT NULL,
  activated_at  timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, capability)
);

-- Grants: authenticated reads only. No direct writes. service_role admin.
REVOKE ALL ON public.user_capabilities FROM PUBLIC;
REVOKE ALL ON public.user_capabilities FROM anon;
REVOKE ALL ON public.user_capabilities FROM authenticated;
GRANT SELECT ON public.user_capabilities TO authenticated;
GRANT ALL ON public.user_capabilities TO service_role;

ALTER TABLE public.user_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_capabilities_self_select ON public.user_capabilities;
CREATE POLICY user_capabilities_self_select
  ON public.user_capabilities
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- updated_at maintenance (reuses public.update_updated_at_column if present,
-- otherwise creates a local equivalent).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    CREATE FUNCTION public.update_updated_at_column()
    RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
    BEGIN NEW.updated_at = now(); RETURN NEW; END; $fn$;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_user_capabilities_updated_at ON public.user_capabilities;
CREATE TRIGGER trg_user_capabilities_updated_at
  BEFORE UPDATE ON public.user_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. Internal recruiter-derivation helper (never callable by clients).
--
--    Given a user_id, compute the recruiter capability status implied by
--    that user's recruiter_profiles row (if any), using the canonical
--    completeness rule established in Phase 1F. Returns NULL only when the
--    user has NO recruiter_profiles row — the caller must then decide
--    whether an existing capability row is preserved or a new `setup` row
--    should be seeded. This helper NEVER inspects profiles.intended_role;
--    intent is handled exclusively by the profiles trigger below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._derive_recruiter_capability_status(_user_id uuid)
RETURNS public.user_capability_status
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rp public.recruiter_profiles;
BEGIN
  SELECT * INTO _rp FROM public.recruiter_profiles WHERE user_id = _user_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF _rp.status = 'suspended' OR _rp.verification_status = 'suspended' THEN
    RETURN 'suspended'::public.user_capability_status;
  END IF;

  IF public.recruiter_profile_can_manage_opportunities(_rp.id) THEN
    RETURN 'active'::public.user_capability_status;
  END IF;

  RETURN 'setup'::public.user_capability_status;
END;
$$;

REVOKE ALL ON FUNCTION public._derive_recruiter_capability_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._derive_recruiter_capability_status(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._derive_recruiter_capability_status(uuid) TO service_role;

-- Internal sync — upsert recruiter capability from a recruiter_profiles row.
-- NEVER removes a recruiter capability. NEVER touches driver capability.
-- Revoked is sticky and cannot be overwritten by profile changes.
-- Preserves activated_at across transitions.
CREATE OR REPLACE FUNCTION public._sync_recruiter_capability(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _desired  public.user_capability_status;
  _existing public.user_capability_status;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;

  SELECT status INTO _existing
    FROM public.user_capabilities
   WHERE user_id = _user_id AND capability = 'recruiter';

  -- Revoked is terminal and cannot be reversed by any profile-derived path.
  IF _existing = 'revoked' THEN
    RETURN;
  END IF;

  _desired := public._derive_recruiter_capability_status(_user_id);

  -- No recruiter_profiles row present. Never remove an existing capability;
  -- keep whatever the current status is (setup row from begin_recruiter_setup
  -- or intent, active row that has not yet been deleted, etc.).
  IF _desired IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_capabilities (user_id, capability, status, activated_at)
  VALUES (
    _user_id,
    'recruiter'::public.user_capability_type,
    _desired,
    CASE WHEN _desired = 'active' THEN now() ELSE NULL END
  )
  ON CONFLICT (user_id, capability) DO UPDATE
    SET status = EXCLUDED.status,
        activated_at = CASE
          WHEN EXCLUDED.status = 'active' AND public.user_capabilities.activated_at IS NULL
            THEN now()
          ELSE public.user_capabilities.activated_at
        END,
        updated_at = now()
    WHERE public.user_capabilities.status <> 'revoked';
END;
$$;

REVOKE ALL ON FUNCTION public._sync_recruiter_capability(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._sync_recruiter_capability(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sync_recruiter_capability(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Trigger — recruiter_profiles INSERT/UPDATE/DELETE
--
--    Deletion policy (independent of profiles.intended_role):
--      revoked   → stays revoked
--      suspended → stays suspended
--      active    → demoted to setup (profile source of truth is gone)
--      setup     → stays setup
--      (no row)  → seed setup
--    Driver capability is never touched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._recruiter_profile_capability_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing public.user_capability_status;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    SELECT status INTO _existing
      FROM public.user_capabilities
     WHERE user_id = OLD.user_id AND capability = 'recruiter';

    IF NOT FOUND THEN
      INSERT INTO public.user_capabilities (user_id, capability, status, activated_at)
      VALUES (OLD.user_id, 'recruiter'::public.user_capability_type,
                            'setup'::public.user_capability_status, NULL)
      ON CONFLICT (user_id, capability) DO NOTHING;
    ELSIF _existing = 'active' THEN
      UPDATE public.user_capabilities
         SET status = 'setup'::public.user_capability_status,
             updated_at = now()
       WHERE user_id = OLD.user_id AND capability = 'recruiter';
    END IF;
    -- suspended, revoked, setup: leave untouched.
    RETURN OLD;
  END IF;

  PERFORM public._sync_recruiter_capability(NEW.user_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._recruiter_profile_capability_sync() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._recruiter_profile_capability_sync() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._recruiter_profile_capability_sync() TO service_role;

DROP TRIGGER IF EXISTS trg_recruiter_profile_capability_sync ON public.recruiter_profiles;
CREATE TRIGGER trg_recruiter_profile_capability_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.recruiter_profiles
  FOR EACH ROW EXECUTE FUNCTION public._recruiter_profile_capability_sync();

-- ---------------------------------------------------------------------------
-- 5. Trigger — profiles.intended_role sync (one-way, additive only)
--
--    Setting intended_role = 'recruiter' MAY seed a setup row when none
--    exists. Clearing intent (null, 'driver', anything else) NEVER removes
--    or demotes an existing capability. Revoked stays revoked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._profile_intent_capability_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.intended_role = 'recruiter' THEN
    INSERT INTO public.user_capabilities (user_id, capability, status, activated_at)
    VALUES (NEW.user_id, 'recruiter'::public.user_capability_type,
                          'setup'::public.user_capability_status, NULL)
    ON CONFLICT (user_id, capability) DO NOTHING;
  END IF;

  -- Any other intent value: no-op. One-way trigger.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._profile_intent_capability_sync() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._profile_intent_capability_sync() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._profile_intent_capability_sync() TO service_role;

DROP TRIGGER IF EXISTS trg_profile_intent_capability_sync ON public.profiles;
CREATE TRIGGER trg_profile_intent_capability_sync
  AFTER INSERT OR UPDATE OF intended_role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._profile_intent_capability_sync();

-- ---------------------------------------------------------------------------
-- 6. Driver provisioning — every new auth.users row gets driver/active.
--
--    A dedicated AFTER INSERT trigger is added ON auth.users. It never
--    alters or replaces the existing handle_new_user() trigger; both fire
--    independently and both are idempotent for driver capability.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._provision_driver_capability_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_capabilities (user_id, capability, status, activated_at)
  VALUES (NEW.id, 'driver'::public.user_capability_type,
                  'active'::public.user_capability_status, now())
  ON CONFLICT (user_id, capability) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._provision_driver_capability_for_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._provision_driver_capability_for_new_user() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._provision_driver_capability_for_new_user() TO service_role;

DROP TRIGGER IF EXISTS trg_provision_driver_capability ON auth.users;
CREATE TRIGGER trg_provision_driver_capability
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public._provision_driver_capability_for_new_user();

-- ---------------------------------------------------------------------------
-- 7. Public RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_user_capabilities()
RETURNS TABLE (
  capability   public.user_capability_type,
  status       public.user_capability_status,
  activated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT uc.capability, uc.status, uc.activated_at
      FROM public.user_capabilities uc
     WHERE uc.user_id = _uid
     ORDER BY uc.capability;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_user_capabilities() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_user_capabilities() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_user_capabilities() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_recruiter_setup()
RETURNS public.user_capability_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing public.user_capability_status;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO _existing
    FROM public.user_capabilities
   WHERE user_id = _uid AND capability = 'recruiter'
   FOR UPDATE;

  IF FOUND AND _existing IN ('active','suspended','revoked') THEN
    -- Never unsuspend, never demote an active recruiter, never reverse revoked.
    RETURN _existing;
  END IF;

  INSERT INTO public.user_capabilities (user_id, capability, status, activated_at)
  VALUES (_uid, 'recruiter'::public.user_capability_type,
                'setup'::public.user_capability_status, NULL)
  ON CONFLICT (user_id, capability) DO UPDATE
    SET status = 'setup'::public.user_capability_status,
        updated_at = now()
    WHERE public.user_capabilities.status NOT IN ('active','suspended','revoked');

  SELECT status INTO _existing
    FROM public.user_capabilities
   WHERE user_id = _uid AND capability = 'recruiter';

  RETURN _existing;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_recruiter_setup() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.begin_recruiter_setup() FROM anon;
GRANT EXECUTE ON FUNCTION public.begin_recruiter_setup() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Backfill
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _r record;
BEGIN
  -- Driver capability for every profile.user_id.
  FOR _r IN SELECT DISTINCT user_id FROM public.profiles WHERE user_id IS NOT NULL LOOP
    INSERT INTO public.user_capabilities (user_id, capability, status, activated_at)
    VALUES (_r.user_id, 'driver', 'active', now())
    ON CONFLICT (user_id, capability) DO NOTHING;
  END LOOP;

  -- Recruiter capability from recruiter_profiles.
  FOR _r IN SELECT user_id FROM public.recruiter_profiles LOOP
    PERFORM public._sync_recruiter_capability(_r.user_id);
  END LOOP;

  -- Intent-only recruiters (no profile row yet).
  FOR _r IN
    SELECT p.user_id
      FROM public.profiles p
      LEFT JOIN public.recruiter_profiles rp ON rp.user_id = p.user_id
     WHERE p.intended_role = 'recruiter' AND rp.user_id IS NULL
  LOOP
    PERFORM public._sync_recruiter_capability(_r.user_id);
  END LOOP;
END $$;
