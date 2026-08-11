-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase 1U-B — Agency console workflow integrity.
-- Scope: CREATE OR REPLACE public.list_agency_clients(uuid) only.
-- Adds a member-scoped read path so a non-owner/admin ACTIVE agency member can
-- discover only the driver clients explicitly delegated to that member.
-- No RLS, grants, tables, indexes, triggers, types, other functions, or data changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_agency_clients(_agency_id uuid)
RETURNS TABLE (
  driver_user_id uuid, driver_email text, driver_name text,
  member_user_id uuid, member_email text,
  package_id uuid, package_name text,
  last_activity_at timestamptz, delegation_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (d.driver_user_id)
         d.driver_user_id, u.email, p.display_name,
         d.member_user_id, d.member_invite_email,
         r.selected_package_id, pk.name,
         GREATEST(d.decided_at, d.updated_at), d.id
    FROM public.agency_delegation_requests d
    LEFT JOIN auth.users u ON u.id = d.driver_user_id
    LEFT JOIN public.profiles p ON p.user_id = d.driver_user_id
    LEFT JOIN public.agency_client_requests r ON r.id = d.client_request_id
    LEFT JOIN public.agency_service_packages pk ON pk.id = r.selected_package_id
   WHERE d.agency_id=_agency_id AND d.status='approved'
     AND (
       public.is_agency_owner_or_admin(_agency_id, auth.uid())
       OR (
         d.member_user_id = auth.uid()
         AND EXISTS (
           SELECT 1 FROM public.agency_members m
            WHERE m.agency_id = _agency_id
              AND m.member_user_id = auth.uid()
              AND m.status = 'active'
         )
       )
     )
   ORDER BY d.driver_user_id, d.decided_at DESC NULLS LAST;
$$;

COMMIT;
