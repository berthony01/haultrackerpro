-- 1. Generated lowercase email column for uniqueness (idempotent)
ALTER TABLE public.lead_magnet_signups
  ADD COLUMN IF NOT EXISTS email_lower text
  GENERATED ALWAYS AS (lower(email)) STORED;

-- 2. Unique constraint on (email_lower, bundle_version)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'lead_magnet_signups_email_bundle_unique'
  ) THEN
    CREATE UNIQUE INDEX lead_magnet_signups_email_bundle_unique
      ON public.lead_magnet_signups (email_lower, bundle_version);
  END IF;
END $$;

-- 3. SECURITY DEFINER helper for duplicate-safe submission.
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
  _email_norm text := lower(trim(_email));
  _id uuid;
BEGIN
  IF _email_norm IS NULL OR _email_norm = '' OR position('@' in _email_norm) = 0 THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.lead_magnet_signups (
    email, first_name, bundle_name, bundle_version, source_page,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    download_sent_at, converted_user_id
  ) VALUES (
    _email_norm, NULLIF(trim(coalesce(_first_name,'')), ''),
    coalesce(_bundle_name, 'Trucker Starter Kit'),
    coalesce(_bundle_version, 'free'),
    _source_page,
    _utm_source, _utm_medium, _utm_campaign, _utm_content, _utm_term,
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

GRANT EXECUTE ON FUNCTION public.submit_lead_magnet_signup(
  text, text, text, text, text, text, text, text, text, text, uuid
) TO anon, authenticated;