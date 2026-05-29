-- Phase 28C: Final scanner cleanup + write-path hardening

-- ============================================================
-- driver_referrals: remove direct UPDATE/INSERT; force RPC-only
-- ============================================================

-- Defensive: ensure no driver SELECT policy exists
DROP POLICY IF EXISTS "Referring driver views own referrals" ON public.driver_referrals;
DROP POLICY IF EXISTS "Referring driver views linked referrals" ON public.driver_referrals;
DROP POLICY IF EXISTS "Referred driver views linked referrals" ON public.driver_referrals;
DROP POLICY IF EXISTS "Driver views own referrals" ON public.driver_referrals;
DROP POLICY IF EXISTS "Driver views linked referrals" ON public.driver_referrals;

-- Driver UPDATE not used by any client flow; drop it.
DROP POLICY IF EXISTS "Referring driver updates own referral early" ON public.driver_referrals;

-- Replace open driver INSERT with RPC-only.
DROP POLICY IF EXISTS "Driver inserts own referral" ON public.driver_referrals;

-- Safe creation RPC: validates caller, inserts server-side, returns only id.
CREATE OR REPLACE FUNCTION public.create_driver_referral_safe(
  _opportunity_id uuid,
  _recruiter_id uuid,
  _referred_driver_name text DEFAULT NULL,
  _referred_driver_email text DEFAULT NULL,
  _referred_driver_phone text DEFAULT NULL,
  _referred_driver_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Validate opportunity is approved+active and recruiter matches
  SELECT EXISTS (
    SELECT 1
    FROM public.opportunities o
    JOIN public.recruiter_profiles rp ON rp.id = o.recruiter_id
    WHERE o.id = _opportunity_id
      AND o.recruiter_id = _recruiter_id
      AND o.status = 'active'
      AND o.admin_review_status = 'approved'
      AND rp.verification_status = 'approved'
      AND rp.status <> 'suspended'
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
$$;

REVOKE ALL ON FUNCTION public.create_driver_referral_safe(uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_driver_referral_safe(uuid, uuid, text, text, text, text) TO authenticated;

-- ============================================================
-- lead_magnet_signups: drop open INSERT; force RPC-only
-- ============================================================
DROP POLICY IF EXISTS "Anyone can submit lead" ON public.lead_magnet_signups;

-- Allow RPC to be called by anon + authenticated (SECURITY DEFINER bypasses RLS for insert).
GRANT EXECUTE ON FUNCTION public.submit_lead_magnet_signup(
  text, text, text, text, text, text, text, text, text, text, uuid
) TO anon, authenticated;

-- Strengthen RPC: stronger email regex, length limits, bundle_version allowlist.
CREATE OR REPLACE FUNCTION public.submit_lead_magnet_signup(
  _email text,
  _first_name text DEFAULT NULL,
  _bundle_name text DEFAULT 'Trucker Starter Kit',
  _bundle_version text DEFAULT 'free',
  _source_page text DEFAULT NULL,
  _utm_source text DEFAULT NULL,
  _utm_medium text DEFAULT NULL,
  _utm_campaign text DEFAULT NULL,
  _utm_content text DEFAULT NULL,
  _utm_term text DEFAULT NULL,
  _converted_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email_norm text := lower(btrim(coalesce(_email, '')));
  _fn text := NULLIF(btrim(coalesce(_first_name, '')), '');
  _bv text := COALESCE(NULLIF(btrim(_bundle_version), ''), 'free');
  _bn text := COALESCE(NULLIF(btrim(_bundle_name), ''), 'Trucker Starter Kit');
  _id uuid;
BEGIN
  IF _email_norm = '' OR length(_email_norm) > 255
     OR _email_norm !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE = '22023';
  END IF;

  IF _bv NOT IN ('free') THEN
    RAISE EXCEPTION 'Invalid bundle_version' USING ERRCODE = '22023';
  END IF;

  IF _fn IS NOT NULL THEN _fn := left(_fn, 100); END IF;
  _bn := left(_bn, 120);

  INSERT INTO public.lead_magnet_signups (
    email, first_name, bundle_name, bundle_version, source_page,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    download_sent_at, converted_user_id
  ) VALUES (
    _email_norm, _fn, _bn, _bv,
    NULLIF(left(coalesce(_source_page, ''), 500), ''),
    NULLIF(left(coalesce(_utm_source, ''), 200), ''),
    NULLIF(left(coalesce(_utm_medium, ''), 200), ''),
    NULLIF(left(coalesce(_utm_campaign, ''), 200), ''),
    NULLIF(left(coalesce(_utm_content, ''), 200), ''),
    NULLIF(left(coalesce(_utm_term, ''), 200), ''),
    now(), _converted_user_id
  )
  ON CONFLICT (email_lower, bundle_version) DO UPDATE SET
    first_name = COALESCE(EXCLUDED.first_name, public.lead_magnet_signups.first_name),
    source_page = COALESCE(EXCLUDED.source_page, public.lead_magnet_signups.source_page),
    utm_source = COALESCE(EXCLUDED.utm_source, public.lead_magnet_signups.utm_source),
    utm_medium = COALESCE(EXCLUDED.utm_medium, public.lead_magnet_signups.utm_medium),
    utm_campaign = COALESCE(EXCLUDED.utm_campaign, public.lead_magnet_signups.utm_campaign),
    utm_content = COALESCE(EXCLUDED.utm_content, public.lead_magnet_signups.utm_content),
    utm_term = COALESCE(EXCLUDED.utm_term, public.lead_magnet_signups.utm_term),
    converted_user_id = COALESCE(EXCLUDED.converted_user_id, public.lead_magnet_signups.converted_user_id),
    download_sent_at = now(),
    updated_at = now()
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;
