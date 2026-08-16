-- Phase RC-1H — Recruiter staff reporting authorization.
--
-- FIFTH operational consumer of the RC-1B recruiter staff permission
-- contract, after opportunities (RC-1D), applications (RC-1E), referrals
-- (RC-1F) and contracts (RC-1G). Authorizes exactly two permission keys:
--   reports_view, reports_export
--
-- Security contract:
--   * STAFF-ONLY path. The canonical recruiter OWNER is explicitly EXCLUDED
--     from this helper so the owner cannot bypass the existing owner report
--     entitlement path (which may be Agency-included) through staff RPCs.
--   * STAFF requires ALL of:
--       - non-owner caller, AND
--       - posting-ready / non-suspended workspace
--         (public.recruiter_profile_can_manage_opportunities), AND
--       - the explicit RC-1B boolean permission on an ACTIVE membership
--         (public.current_user_has_recruiter_permission), AND
--       - a STANDALONE recruiter/carrier billing row for that recruiter
--         workspace at plan growth|fleet with status active|trialing.
--     Role labels alone grant nothing.
--   * Agency-included recruiter entitlement is deliberately NOT consulted and
--     NOT extended to recruiter staff. No Agency table/function is touched.
--   * reports_export does NOT imply reports_view. The export wrapper requires
--     BOTH keys; reports_export alone authorizes nothing.
--   * NO RLS policy is created, altered or dropped by this migration on
--     opportunities, opportunity_applications, application_events,
--     recruiter_contact_requests, contracts, or any other table. Reporting
--     reads happen only through SECURITY DEFINER wrappers and therefore do
--     NOT depend on (or widen) opportunities_view / applications_view /
--     contracts_view operational permissions.
--   * The payload is a minimal aggregate-input projection. It contains no
--     driver identity/contact data, no notes/messages, no contract text or
--     AI findings, no signature evidence, no audit metadata, and no
--     billing/Stripe/subscription data whatsoever.
--
-- FROZEN — NOT replaced or redefined by this migration:
--   public.current_user_has_recruiter_permission(...),
--   public.recruiter_profile_can_manage_opportunities(...),
--   public.is_recruiter_owner(...),
--   public.current_user_can_recruiter_opportunity_action(...),
--   public.current_user_can_recruiter_application_action(...),
--   public.current_user_can_recruiter_referral_action(...),
--   public.current_user_can_recruiter_contract_action(...),
--   all owner report paths.

-- ---------------------------------------------------------------------------
-- A) Staff-only reporting action helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_staff_report_action(
  _recruiter_id uuid,
  _permission public.recruiter_workspace_permission
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND _recruiter_id IS NOT NULL
    AND _permission IS NOT NULL
    AND _permission IN (
      'reports_view'::public.recruiter_workspace_permission,
      'reports_export'::public.recruiter_workspace_permission
    )
    -- Canonical owner is excluded from the STAFF report path entirely.
    AND NOT public.is_recruiter_owner(auth.uid(), _recruiter_id)
    -- Non-owner STAFF branch. No role shortcut anywhere.
    AND public.recruiter_profile_can_manage_opportunities(_recruiter_id)
    AND public.current_user_has_recruiter_permission(_recruiter_id, _permission)
    AND EXISTS (
      SELECT 1
      FROM public.recruiter_billing_profiles b
      WHERE b.recruiter_id = _recruiter_id
        AND b.plan IN ('growth', 'fleet')
        AND b.status IN ('active', 'trialing') -- trial-allowlist
    );
$function$;

REVOKE ALL ON FUNCTION public.current_user_can_recruiter_staff_report_action(uuid, public.recruiter_workspace_permission) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_recruiter_staff_report_action(uuid, public.recruiter_workspace_permission) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_recruiter_staff_report_action(uuid, public.recruiter_workspace_permission) TO authenticated;

-- ---------------------------------------------------------------------------
-- B) INTERNAL report payload builder — grants NOTHING on its own
-- ---------------------------------------------------------------------------
-- Callers MUST authorize before invoking this. It is not executable by
-- PUBLIC, anon, or authenticated; only the SECURITY DEFINER wrappers below
-- (owned by the definer role) may call it.
CREATE OR REPLACE FUNCTION public._build_recruiter_staff_report_payload(
  _recruiter_id uuid,
  _from date,
  _to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _profile public.recruiter_profiles%ROWTYPE;
  _opportunities jsonb;
  _applications jsonb;
  _events jsonb;
  _contact_requests jsonb;
  _contracts jsonb;
  _active_count integer;
BEGIN
  SELECT * INTO _profile
  FROM public.recruiter_profiles rp
  WHERE rp.id = _recruiter_id;

  IF _profile.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'title', o.title,
          'status', o.status,
          'view_count', o.view_count,
          'published_at', o.published_at
        )
      ),
      '[]'::jsonb
    ),
    COUNT(*) FILTER (WHERE o.status = 'active')
  INTO _opportunities, _active_count
  FROM public.opportunities o
  WHERE o.recruiter_id = _recruiter_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', oa.id,
        'opportunity_id', oa.opportunity_id,
        'status', oa.status,
        'created_at', oa.created_at,
        'updated_at', oa.updated_at
      )
    ),
    '[]'::jsonb
  )
  INTO _applications
  FROM public.opportunity_applications oa
  WHERE oa.recruiter_id = _recruiter_id
    AND oa.created_at >= _from::timestamptz
    AND oa.created_at < (_to + 1)::timestamptz;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'application_id', ae.application_id,
        'event_type', ae.event_type,
        'created_at', ae.created_at
      )
    ),
    '[]'::jsonb
  )
  INTO _events
  FROM public.application_events ae
  JOIN public.opportunity_applications oa ON oa.id = ae.application_id
  WHERE oa.recruiter_id = _recruiter_id
    AND ae.created_at >= _from::timestamptz
    AND ae.created_at < (_to + 1)::timestamptz;

  -- Workspace-scoped (via application ownership), NOT recruiter_user_id =
  -- auth.uid(). No driver identity, notes, or contact payload is returned.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', cr.id,
        'status', cr.status,
        'created_at', cr.created_at
      )
    ),
    '[]'::jsonb
  )
  INTO _contact_requests
  FROM public.recruiter_contact_requests cr
  JOIN public.opportunity_applications oa ON oa.id = cr.application_id
  WHERE oa.recruiter_id = _recruiter_id
    AND cr.created_at >= _from::timestamptz
    AND cr.created_at < (_to + 1)::timestamptz;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'application_id', c.application_id,
        'status', c.status,
        'updated_at', c.updated_at
      )
    ),
    '[]'::jsonb
  )
  INTO _contracts
  FROM public.contracts c
  WHERE c.recruiter_id = _recruiter_id;

  RETURN jsonb_build_object(
    'header', jsonb_build_object(
      'companyName', _profile.company_name,
      'recruiterName', _profile.recruiter_name,
      'verificationStatus', _profile.verification_status,
      'audience', 'staff',
      -- Neutral legacy-compatibility values ONLY. No plan label, no billing
      -- status, no Stripe/subscription/entitlement-source data is exposed.
      'plan', 'workspace',
      'planStatus', 'authorized',
      'activeLimit', 0,
      'activeCount', COALESCE(_active_count, 0)
    ),
    'range', jsonb_build_object(
      'from', to_char(_from, 'YYYY-MM-DD'),
      'to', to_char(_to, 'YYYY-MM-DD'),
      'label', to_char(_from, 'YYYY-MM-DD') || ' to ' || to_char(_to, 'YYYY-MM-DD')
    ),
    'opportunities', _opportunities,
    'applications', _applications,
    'events', _events,
    'contactRequests', _contact_requests,
    'contracts', _contracts
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._build_recruiter_staff_report_payload(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._build_recruiter_staff_report_payload(uuid, date, date) FROM anon;
REVOKE ALL ON FUNCTION public._build_recruiter_staff_report_payload(uuid, date, date) FROM authenticated;

-- ---------------------------------------------------------------------------
-- C) Authorized public wrappers — identical payload shape
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_recruiter_staff_report_view_data(
  _recruiter_id uuid,
  _from date,
  _to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Invalid report range' USING ERRCODE = '22023';
  END IF;
  -- Non-enumerating: unauthorized and nonexistent workspaces are identical.
  IF NOT public.current_user_can_recruiter_staff_report_action(
       _recruiter_id,
       'reports_view'::public.recruiter_workspace_permission
     ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN public._build_recruiter_staff_report_payload(_recruiter_id, _from, _to);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_recruiter_staff_report_view_data(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_recruiter_staff_report_view_data(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_recruiter_staff_report_view_data(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_recruiter_staff_report_export_data(
  _recruiter_id uuid,
  _from date,
  _to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Invalid report range' USING ERRCODE = '22023';
  END IF;
  -- Export requires BOTH keys. reports_export alone is insufficient.
  IF NOT public.current_user_can_recruiter_staff_report_action(
       _recruiter_id,
       'reports_view'::public.recruiter_workspace_permission
     ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.current_user_can_recruiter_staff_report_action(
       _recruiter_id,
       'reports_export'::public.recruiter_workspace_permission
     ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN public._build_recruiter_staff_report_payload(_recruiter_id, _from, _to);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_recruiter_staff_report_export_data(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_recruiter_staff_report_export_data(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_recruiter_staff_report_export_data(uuid, date, date) TO authenticated;
