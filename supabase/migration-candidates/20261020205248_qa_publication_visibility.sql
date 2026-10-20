-- Read-only display metadata. Does not grant driver visibility or authority.
CREATE FUNCTION public.get_recruiter_qa_publication_context(_recruiter_id uuid)
RETURNS TABLE(recruiter_id uuid, is_qa_fixture boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _recruiter_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.current_user_can_recruiter_opportunity_action(
    _recruiter_id, 'opportunities_view'::public.recruiter_workspace_permission
  ) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp WHERE rp.id = _recruiter_id
  ) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT _recruiter_id,
    public.is_qa_fixture_root('recruiter_profile', _recruiter_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_recruiter_qa_publication_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recruiter_qa_publication_context(uuid) TO authenticated, service_role;
