CREATE OR REPLACE FUNCTION public.get_agency_member_permissions(_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _stored jsonb;
  _result jsonb := '{}'::jsonb;
  _key public.agency_workspace_permission;
BEGIN
  IF _uid IS NULL OR _member_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Canonical Agency owner only. Stored permissions and descriptive role
  -- labels never grant read authority over another member's permission map.
  SELECT m.workspace_permissions
    INTO _stored
    FROM public.agency_members m
   WHERE m.id = _member_id
     AND m.role <> 'agency_owner'
     AND m.status IN ('pending', 'active')
     AND EXISTS (
       SELECT 1
         FROM public.agency_profiles ap
        WHERE ap.id = m.agency_id
          AND ap.owner_user_id = _uid
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _stored IS NULL OR jsonb_typeof(_stored) <> 'object' THEN
    _stored := '{}'::jsonb;
  END IF;

  -- Always return a COMPLETE canonical map: every current enum key, exact
  -- boolean. Absent or malformed stored values resolve to false.
  FOR _key IN
    SELECT unnest(enum_range(NULL::public.agency_workspace_permission))
  LOOP
    _result := _result || jsonb_build_object(
      _key::text,
      COALESCE(
        CASE
          WHEN jsonb_typeof(_stored -> (_key::text)) = 'boolean'
            THEN (_stored ->> (_key::text))::boolean
          ELSE false
        END,
        false
      )
    );
  END LOOP;

  RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.get_agency_member_permissions(uuid) IS
  'RW-1: canonical-agency-owner-only read of one non-owner membership complete workspace permission map. Read-only; grants nothing.';

REVOKE ALL ON FUNCTION public.get_agency_member_permissions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_agency_member_permissions(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_agency_member_permissions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_member_permissions(uuid) TO service_role;