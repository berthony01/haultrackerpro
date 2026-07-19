CREATE OR REPLACE FUNCTION public.create_agency(
  _name text,
  _description text DEFAULT NULL,
  _contact_email text DEFAULT NULL
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
  _defaults record;
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

  SELECT * INTO _defaults FROM public._agency_plan_defaults('agency_starter');
  INSERT INTO public.agency_entitlements
    (agency_id, plan_key, status, source,
     active_client_limit, member_limit, service_package_limit)
  VALUES (_row.id, 'agency_starter', 'manual_beta', 'manual',
          _defaults.active_client_limit,
          _defaults.member_limit,
          _defaults.service_package_limit)
  ON CONFLICT (agency_id) DO NOTHING;

  RETURN _row;
END;
$$;