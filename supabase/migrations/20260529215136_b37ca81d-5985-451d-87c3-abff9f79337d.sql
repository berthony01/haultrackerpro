-- Phase 28D — final scanner reconciliation: lead-magnet abuse guard + defensive cleanups.

-- 1) Defensive: ensure no driver-side SELECT policy exists on driver_referrals.
--    Drivers MUST go through public.list_my_driver_referrals().
DROP POLICY IF EXISTS "Driver views own referrals" ON public.driver_referrals;
DROP POLICY IF EXISTS "Referring driver views own referrals" ON public.driver_referrals;
DROP POLICY IF EXISTS "Drivers view own referrals" ON public.driver_referrals;

-- 2) Defensive: ensure no direct submitter INSERT policy on lead_magnet_signups.
--    Writes MUST go through public.submit_lead_magnet_signup().
DROP POLICY IF EXISTS "Anyone can submit lead" ON public.lead_magnet_signups;
DROP POLICY IF EXISTS "Anyone can insert lead" ON public.lead_magnet_signups;
DROP POLICY IF EXISTS "Public can submit leads" ON public.lead_magnet_signups;

-- 3) Add a rate-limit guard to submit_lead_magnet_signup.
--    Reject if the same normalized email has been submitted >5 times in the last 1 hour.
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
  _recent_count int;
BEGIN
  IF _email_norm = '' OR length(_email_norm) > 255
     OR _email_norm !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE = '22023';
  END IF;

  IF _bv NOT IN ('free') THEN
    RAISE EXCEPTION 'Invalid bundle_version' USING ERRCODE = '22023';
  END IF;

  -- Abuse guard: limit submissions per email/hour.
  SELECT count(*) INTO _recent_count
  FROM public.lead_magnet_signups
  WHERE email_lower = _email_norm
    AND updated_at > (now() - interval '1 hour');

  IF _recent_count >= 5 THEN
    RAISE EXCEPTION 'Too many submissions for this email. Try again later.'
      USING ERRCODE = '54000';
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

REVOKE ALL ON FUNCTION public.submit_lead_magnet_signup(
  text, text, text, text, text, text, text, text, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_lead_magnet_signup(
  text, text, text, text, text, text, text, text, text, text, uuid
) TO anon, authenticated;
