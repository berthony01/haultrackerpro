-- Phase TG-2E3-O7 — QA fixture isolation (CANDIDATE ONLY).
--
-- Suppresses ACTIVE registered QA fixture roots (public.qa_fixture_roots, O6)
-- from normal public/customer discovery, while preserving the registered QA
-- owner's ability to exercise the very same discovery surface against its own
-- fixtures.
--
-- THIS FILE GRANTS NOTHING AND CHANGES NO ENTITLEMENT.
-- * No new tables, views, functions, policies, triggers, indexes.
-- * No GRANT / REVOKE. The O6 helper ACL stays exactly as accepted: direct
--   EXECUTE denied to PUBLIC/anon/authenticated, allowed to service_role. The
--   seven functions below are SECURITY DEFINER and call the helper internally
--   under their definer context.
-- * No plan/tier/Stripe/Telegram/email logic.
-- * With zero rows in public.qa_fixture_roots, public.is_qa_fixture_root()
--   returns false for every input, so every predicate below collapses to the
--   pre-O7 behavior. O7 is inert until a root is registered (O9).
--
-- Each function is re-created with its exact pre-O7 signature, return type,
-- language, volatility, SECURITY DEFINER flag, search_path, ordering, limits,
-- validation and error semantics. The ONLY logic change is the narrow
-- exclusion predicate:
--
--   AND (
--     NOT public.is_qa_fixture_root('<root_kind>', <root_id>)
--     OR (auth.uid() IS NOT NULL
--         AND public.is_qa_fixture_root('<root_kind>', <root_id>, auth.uid()))
--   )
--
-- The explicit `auth.uid() IS NOT NULL` guard is required and fail-closed: the
-- O6 helper treats a NULL _qa_owner_user_id as "any owner", so without the
-- guard an anonymous caller would match every registered root. With it, an
-- anonymous caller can never take the owner escape and active fixtures stay
-- hidden on the public agency surfaces.

-- ---------------------------------------------------------------------------
-- 1) Driver-facing opportunity discovery
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_driver_visible_opportunities(
  _state text DEFAULT NULL::text,
  _driver_type text DEFAULT NULL::text,
  _route_type text DEFAULT NULL::text
)
RETURNS SETOF opportunities
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT o.*
  FROM public.opportunities o
  WHERE auth.uid() IS NOT NULL
    AND o.status = 'active'
    AND o.admin_review_status = 'approved'
    AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
    AND (
      NOT public.is_qa_fixture_root('recruiter_profile', o.recruiter_id)
      OR (auth.uid() IS NOT NULL AND public.is_qa_fixture_root('recruiter_profile', o.recruiter_id, auth.uid()))
    )
    AND (_state IS NULL OR o.hiring_state = _state)
    AND (_driver_type IS NULL OR o.driver_type = _driver_type)
    AND (_route_type IS NULL OR o.route_type = _route_type)
  ORDER BY o.featured DESC NULLS LAST, o.published_at DESC NULLS LAST;
$function$;

-- ---------------------------------------------------------------------------
-- 2) Opportunity row-level access predicate (consumed by the existing,
--    UNMODIFIED `opportunities` SELECT policy for authenticated drivers)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_can_access_opportunity(
  _opportunity_id uuid,
  _recruiter_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.opportunities o
    WHERE auth.uid() IS NOT NULL
      AND o.id = _opportunity_id
      AND o.recruiter_id = _recruiter_id
      AND o.status = 'active'
      AND o.admin_review_status = 'approved'
      AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
      AND (
        NOT public.is_qa_fixture_root('recruiter_profile', o.recruiter_id)
        OR (auth.uid() IS NOT NULL AND public.is_qa_fixture_root('recruiter_profile', o.recruiter_id, auth.uid()))
      )
  );
$function$;

-- ---------------------------------------------------------------------------
-- 3) Driver referral routing
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_driver_referral_safe(
  _opportunity_id uuid,
  _recruiter_id uuid,
  _referred_driver_name text DEFAULT NULL::text,
  _referred_driver_email text DEFAULT NULL::text,
  _referred_driver_phone text DEFAULT NULL::text,
  _referred_driver_note text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _name text := NULLIF(btrim(coalesce(_referred_driver_name, '')), '');
  _email text := NULLIF(lower(btrim(coalesce(_referred_driver_email, ''))), '');
  _phone text := NULLIF(btrim(coalesce(_referred_driver_phone, '')), '');
  _note text := NULLIF(btrim(coalesce(_referred_driver_note, '')), '');
  _id uuid;
  _opp_ok boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _name IS NULL AND _email IS NULL AND _phone IS NULL THEN
    RAISE EXCEPTION 'Referral requires at least a name, email, or phone' USING ERRCODE = '22023';
  END IF;

  IF _email IS NOT NULL AND (length(_email) > 255 OR position('@' in _email) = 0) THEN
    RAISE EXCEPTION 'Invalid referred driver email' USING ERRCODE = '22023';
  END IF;

  IF _phone IS NOT NULL AND length(_phone) > 40 THEN
    RAISE EXCEPTION 'Invalid referred driver phone' USING ERRCODE = '22023';
  END IF;

  IF _note IS NOT NULL THEN
    _note := left(_note, 1000);
  END IF;
  IF _name IS NOT NULL THEN
    _name := left(_name, 200);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.opportunities o
    WHERE o.id = _opportunity_id
      AND o.recruiter_id = _recruiter_id
      AND o.status = 'active'
      AND o.admin_review_status = 'approved'
      AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
      AND (
        NOT public.is_qa_fixture_root('recruiter_profile', o.recruiter_id)
        OR (auth.uid() IS NOT NULL AND public.is_qa_fixture_root('recruiter_profile', o.recruiter_id, auth.uid()))
      )
  ) INTO _opp_ok;

  IF NOT _opp_ok THEN
    RAISE EXCEPTION 'Opportunity not available for referrals' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.driver_referrals (
    opportunity_id, recruiter_id, referring_driver_id,
    referred_driver_name, referred_driver_email, referred_driver_phone, referred_driver_note
  ) VALUES (
    _opportunity_id, _recruiter_id, _uid,
    _name, _email, _phone, _note
  )
  RETURNING id INTO _id;

  RETURN _id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A referral with this contact already exists for this opportunity'
      USING ERRCODE = '23505';
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4-6) Agency public surfaces
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_agency_slug(_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ap.id FROM public.agency_profiles ap
   WHERE ap.slug = lower(trim(_slug)) AND ap.status = 'active'
     AND (SELECT l.status FROM public.get_effective_agency_limits(ap.id) l)
         IN ('manual_beta','active','trialing','past_due')
     AND (
       NOT public.is_qa_fixture_root('agency_profile', ap.id)
       OR (auth.uid() IS NOT NULL AND public.is_qa_fixture_root('agency_profile', ap.id, auth.uid()))
     )
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_agency_public_view(_agency_id uuid)
RETURNS TABLE(id uuid, name text, description text, contact_email text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ap.id, ap.name, ap.description, ap.contact_email, ap.status::text
    FROM public.agency_profiles ap
   WHERE ap.id = _agency_id AND ap.status = 'active'
     AND (SELECT l.status FROM public.get_effective_agency_limits(ap.id) l)
         IN ('manual_beta','active','trialing','past_due')
     AND (
       NOT public.is_qa_fixture_root('agency_profile', ap.id)
       OR (auth.uid() IS NOT NULL AND public.is_qa_fixture_root('agency_profile', ap.id, auth.uid()))
     );
$function$;

CREATE OR REPLACE FUNCTION public.list_agency_packages_public(_agency_id uuid)
RETURNS SETOF agency_service_packages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT * FROM public.agency_service_packages
   WHERE agency_id = _agency_id AND is_active = true
     AND EXISTS (SELECT 1 FROM public.agency_profiles ap
                  WHERE ap.id = _agency_id AND ap.status = 'active')
     AND (SELECT l.status FROM public.get_effective_agency_limits(_agency_id) l)
         IN ('manual_beta','active','trialing','past_due')
     AND (
       NOT public.is_qa_fixture_root('agency_profile', _agency_id)
       OR (auth.uid() IS NOT NULL AND public.is_qa_fixture_root('agency_profile', _agency_id, auth.uid()))
     )
   ORDER BY sort_order ASC, created_at ASC;
$function$;

-- ---------------------------------------------------------------------------
-- 7) Customer-visible weekly driver leaderboard
--    Fixture users are removed BEFORE ranking so rank math for normal drivers
--    is unaffected by synthetic QA identities.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_weekly_driver_leaderboard(_limit integer DEFAULT 10)
RETURNS TABLE(
  user_id uuid,
  weekly_points integer,
  total_points integer,
  parking_points integer,
  load_points integer,
  streak_days integer,
  tier text,
  rank integer,
  masked_display_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH visible AS (
    SELECT d.*
    FROM public.driver_points d
    WHERE (
      NOT public.is_qa_fixture_root('user', d.user_id)
      OR (auth.uid() IS NOT NULL AND public.is_qa_fixture_root('user', d.user_id, auth.uid()))
    )
  ), ranked AS (
    SELECT
      d.user_id,
      d.weekly_points,
      d.total_points,
      d.parking_points,
      d.load_points,
      d.streak_days,
      d.last_activity_date,
      CASE
        WHEN d.total_points >= 400 THEN 'Platinum'
        WHEN d.total_points >= 150 THEN 'Gold'
        WHEN d.total_points >= 50 THEN 'Silver'
        ELSE 'Bronze'
      END AS tier,
      ROW_NUMBER() OVER (
        ORDER BY d.weekly_points DESC,
                 d.total_points DESC,
                 d.last_activity_date ASC NULLS LAST
      )::int AS rank,
      CASE
        WHEN p.handle_public = true AND p.driver_handle IS NOT NULL THEN
          p.driver_handle ||
          CASE WHEN p.handle_emoji IS NOT NULL THEN ' ' || p.handle_emoji ELSE '' END
        ELSE
          'Driver #' || lpad((abs(hashtext(d.user_id::text)) % 10000)::text, 4, '0')
      END AS masked_display_name
    FROM visible d
    LEFT JOIN public.profiles p ON p.user_id = d.user_id
  )
  SELECT user_id, weekly_points, total_points, parking_points, load_points,
         streak_days, tier, rank, masked_display_name
  FROM ranked
  WHERE weekly_points > 0 OR user_id = auth.uid()
  ORDER BY rank
  LIMIT GREATEST(1, LEAST(_limit, 100));
$function$;