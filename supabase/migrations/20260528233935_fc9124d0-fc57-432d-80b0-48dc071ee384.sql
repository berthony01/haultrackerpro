-- Phase 28A: close remaining direct base-table PII access paths.

-- 1. Drop broad recruiter SELECT on opportunity_applications. Recruiters
--    must read applications through list_recruiter_applications_safe()
--    (which gates phone/email by consent + approved contact request) or
--    through the per-application RPC below for contract summary use.
DROP POLICY IF EXISTS "Recruiter views applications for own opportunities"
  ON public.opportunity_applications;

-- 2. Drop recruiter self SELECT on recruiter_profiles. Recruiters must read
--    their own profile through get_my_recruiter_profile_safe() so internal
--    moderation columns (admin_notes, verified_by) never leave the server.
DROP POLICY IF EXISTS "Recruiter views own profile"
  ON public.recruiter_profiles;

-- 3. Lightweight RPC used by useUserRole to detect recruiter role without
--    needing direct SELECT on recruiter_profiles.
CREATE OR REPLACE FUNCTION public.is_current_user_recruiter()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE auth.uid() IS NOT NULL AND rp.user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_current_user_recruiter() TO authenticated;

-- 4. RPC for recruiter reports: returns ONLY the non-PII fields the report
--    aggregator needs. No phone/email snapshots, no driver messages.
CREATE OR REPLACE FUNCTION public.list_recruiter_application_summaries(_recruiter_id uuid)
RETURNS TABLE (
  id uuid,
  opportunity_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id AND rp.user_id = _uid
      AND rp.status <> 'suspended' AND rp.verification_status <> 'suspended'
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT oa.id, oa.opportunity_id, oa.status, oa.created_at, oa.updated_at
  FROM public.opportunity_applications oa
  WHERE oa.recruiter_id = _recruiter_id
  ORDER BY oa.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_recruiter_application_summaries(uuid) TO authenticated;

-- 5. RPC for ContractSummaryPanel: returns the limited application +
--    recruiter + opportunity fields the panel renders, gated by the existing
--    is_application_party() helper so both driver and recruiter parties can
--    see it WITHOUT exposing phone/email snapshots or admin_notes.
CREATE OR REPLACE FUNCTION public.get_application_contract_summary(_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_application_party(_uid, _application_id)
     AND NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', oa.id,
    'status', oa.status,
    'recruiter_id', oa.recruiter_id,
    'driver_user_id', oa.driver_user_id,
    'driver_profile_id', oa.driver_profile_id,
    'opportunities', CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', o.id, 'title', o.title, 'company_name', o.company_name,
      'hiring_city', o.hiring_city, 'hiring_state', o.hiring_state,
      'pay_model', o.pay_model, 'cpm', o.cpm,
      'percentage_pay', o.percentage_pay,
      'flat_weekly_pay', o.flat_weekly_pay,
      'estimated_weekly_gross', o.estimated_weekly_gross
    ) END,
    'driver_profile', CASE WHEN dop.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', dop.id, 'full_name', dop.full_name
    ) END,
    'recruiter', CASE WHEN rp.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', rp.id,
      'company_name', rp.company_name,
      'recruiter_name', rp.recruiter_name,
      'verification_status', rp.verification_status,
      'status', rp.status,
      'mc_number', rp.mc_number,
      'dot_number', rp.dot_number,
      'company_city', rp.company_city,
      'company_state', rp.company_state
    ) END
  )
  INTO _row
  FROM public.opportunity_applications oa
  LEFT JOIN public.opportunities o ON o.id = oa.opportunity_id
  LEFT JOIN public.driver_opportunity_profiles dop ON dop.id = oa.driver_profile_id
  LEFT JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id
  WHERE oa.id = _application_id;

  RETURN _row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_application_contract_summary(uuid) TO authenticated;