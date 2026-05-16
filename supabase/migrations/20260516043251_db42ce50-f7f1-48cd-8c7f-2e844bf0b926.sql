CREATE OR REPLACE FUNCTION public.request_driver_contact(application_id uuid, recruiter_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _app public.opportunity_applications;
  _rp public.recruiter_profiles;
  _note text;
  _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _app FROM public.opportunity_applications WHERE id = application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO _rp FROM public.recruiter_profiles WHERE id = _app.recruiter_id;
  IF NOT FOUND OR _rp.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _rp.verification_status <> 'approved'
     OR _rp.status = 'suspended'
     OR _rp.verification_status = 'suspended' THEN
    RAISE EXCEPTION 'Recruiter must be approved and active' USING ERRCODE = '42501';
  END IF;

  IF _app.status IN ('hired','rejected','withdrawn') THEN
    RAISE EXCEPTION 'Application is closed' USING ERRCODE = '22023';
  END IF;

  -- Block duplicate when any request already exists in pending/approved/declined state.
  -- Expired requests intentionally remain allowed for later re-request behavior.
  IF EXISTS (
    SELECT 1 FROM public.recruiter_contact_requests
    WHERE application_id = _app.id
      AND status IN ('pending','approved','declined')
  ) THEN
    RAISE EXCEPTION 'Contact request already exists for this application' USING ERRCODE = '22023';
  END IF;

  _note := NULLIF(left(coalesce(recruiter_note, ''), 300), '');

  INSERT INTO public.recruiter_contact_requests
    (application_id, recruiter_user_id, driver_user_id, status, recruiter_note)
  VALUES
    (_app.id, auth.uid(), _app.driver_user_id, 'pending', _note)
  RETURNING id INTO _id;

  RETURN _id;
END;
$function$;