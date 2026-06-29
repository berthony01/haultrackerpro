-- Phase 4A: driver-facing assistant listing enriched with agency delegation source.
-- Read-only, SECURITY DEFINER, strictly scoped to auth.uid() = driver_user_id.
-- For each driver_assistants row, attempts to find the most recent matching
-- agency_delegation_requests row (by member_user_id or by member_invite_email)
-- so the UI can render "via Agency X" and offer a true delegation revoke.

CREATE OR REPLACE FUNCTION public.list_my_assistants_with_source()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH my AS (
    SELECT da.*
      FROM public.driver_assistants da
     WHERE da.driver_user_id = _uid
  ),
  matched AS (
    SELECT
      m.id AS assistant_id,
      d.id AS delegation_id,
      d.agency_id,
      d.status AS delegation_status,
      d.created_at AS delegation_created_at,
      row_number() OVER (
        PARTITION BY m.id
        ORDER BY
          CASE d.status WHEN 'approved' THEN 0 WHEN 'pending_driver_approval' THEN 1 ELSE 2 END,
          d.created_at DESC
      ) AS rn
    FROM my m
    JOIN public.agency_delegation_requests d
      ON d.driver_user_id = _uid
     AND (
       (m.assistant_user_id IS NOT NULL AND d.member_user_id = m.assistant_user_id)
       OR (
         coalesce(m.invite_email,'') <> ''
         AND lower(btrim(coalesce(d.member_invite_email,''))) = lower(btrim(m.invite_email))
       )
     )
  )
  SELECT jsonb_build_object(
    'id', m.id,
    'assistant_user_id', m.assistant_user_id,
    'invite_email', m.invite_email,
    'status', m.status,
    'permissions', m.permissions,
    'invited_at', m.invited_at,
    'accepted_at', m.accepted_at,
    'revoked_at', m.revoked_at,
    'last_active_at', m.last_active_at,
    'source', CASE WHEN mt.delegation_id IS NOT NULL THEN 'agency' ELSE 'direct_invite' END,
    'agency_id', mt.agency_id,
    'agency_name', ap.name,
    'delegation_id', mt.delegation_id,
    'delegation_status', mt.delegation_status
  )
  FROM my m
  LEFT JOIN matched mt ON mt.assistant_id = m.id AND mt.rn = 1
  LEFT JOIN public.agency_profiles ap ON ap.id = mt.agency_id
  ORDER BY m.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_assistants_with_source() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_my_assistants_with_source() TO authenticated;