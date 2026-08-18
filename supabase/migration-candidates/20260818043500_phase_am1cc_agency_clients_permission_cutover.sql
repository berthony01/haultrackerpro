-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase AM-1C-C — Agency Clients permission consumer cutover.
-- Scope: CREATE OR REPLACE public.list_agency_clients(uuid) ONLY.
--
-- Broad Agency client visibility moves from the role-label helper
-- public.is_agency_owner_or_admin to the AM-1B workspace permission
-- current_user_has_agency_permission(_agency_id,'clients_view'). The canonical
-- Agency owner remains implicitly authorized because the AM-1B resolver grants
-- the owner every workspace permission.
--
-- The narrow assigned-member branch is preserved byte-for-byte in behavior: an
-- ACTIVE Agency member who is the assigned member on an approved delegation
-- still sees only their own assigned client(s), with no role requirement and no
-- clients_view requirement.
--
-- clients_view is READ-ONLY workspace authority. It does not grant delegation
-- creation or revocation, Driver Assistant authority, work-item authority,
-- settlement authority, or any driver-account operation. Delegation
-- authorization (revoke_agency_delegation and friends) is untouched here and
-- belongs to the later Delegations consumer cutover.
--
-- No RLS policies, grants, tables, indexes, triggers, types, other functions,
-- or data are changed.

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
       public.current_user_has_agency_permission(_agency_id,'clients_view')
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
