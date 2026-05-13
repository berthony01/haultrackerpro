CREATE OR REPLACE FUNCTION public.withdraw_opportunity_application(application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.opportunity_applications;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _row FROM public.opportunity_applications WHERE id = application_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002';
  END IF;

  IF _row.driver_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _row.status IN ('hired','rejected') THEN
    RAISE EXCEPTION 'Cannot withdraw a hired or rejected application' USING ERRCODE = '22023';
  END IF;

  IF _row.status = 'withdrawn' THEN
    RETURN;
  END IF;

  UPDATE public.opportunity_applications
  SET status = 'withdrawn', updated_at = now()
  WHERE id = application_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.withdraw_opportunity_application(uuid) TO authenticated;