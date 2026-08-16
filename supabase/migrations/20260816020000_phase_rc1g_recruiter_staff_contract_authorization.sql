-- Phase RC-1G — Recruiter staff contract authorization.
--
-- FOURTH operational consumer of the RC-1B recruiter staff permission
-- contract, after opportunities (RC-1D), applications (RC-1E) and referrals
-- (RC-1F). Authorizes exactly two permission keys against a selected
-- recruiter workspace:
--   contracts_view, contracts_manage
--
-- Security contract:
--   * ONE canonical recruiter workspace/profile. Staff never receive a
--     recruiter_profiles row and never become contracts.recruiter_user_id.
--   * OWNER contract semantics are preserved exactly. The owner branch keeps
--     using public.is_recruiter_owner(auth.uid(), _recruiter_id) and owner
--     direct-read RLS is NOT tightened to the new staff entitlement helper.
--   * STAFF requires ALL of:
--       - posting-ready / non-suspended workspace
--         (public.recruiter_profile_can_manage_opportunities), AND
--       - the explicit RC-1B boolean permission on an ACTIVE membership
--         (public.current_user_has_recruiter_permission), AND
--       - a STANDALONE recruiter/carrier billing row for that recruiter
--         workspace at plan growth|fleet with status active|trialing,
--         preserving the existing contract Edge Function entitlement rule.
--     Role labels (recruiter_admin / recruiter_staff) alone grant nothing.
--   * Agency-included recruiter entitlement is deliberately NOT consulted and
--     is NOT extended to recruiter staff. Agency-included recruiting stays
--     owner-only. No Agency table/function/policy is touched here.
--   * contracts_manage does NOT implicitly grant contracts_view. The keys stay
--     independent, consistent with the existing permission contract.
--   * Staff receive SELECT-only RLS. No staff INSERT/UPDATE/DELETE policy is
--     added to any contract table or to storage.objects. Recruiter-side
--     contract mutations continue to run through the existing service-role
--     Edge Functions, which authorize staff via contracts_manage.
--   * contracts_manage covers ONLY recruiter-side workflow (start
--     upload/replace, confirm upload, trigger parse, trigger AI review). It
--     grants no driver review/approval, no driver signature, no contract
--     status override, no admin force-analysis, no application hire
--     authority, no contract deletion, no recruiter-review insertion, and no
--     billing management.
--
-- FROZEN — NOT replaced or redefined by this migration:
--   public.opportunity_applications_require_contract_for_hire(),
--   public.is_application_party(...), public.contracts_field_guard(),
--   public.contracts_status_client_lock(), public.contracts_status_guard(),
--   public.contract_versions_field_guard(), public.contract_signatures_validate(),
--   public.contract_audit_log_guard(), public.notify_contract_change(),
--   public.current_user_has_recruiter_permission(...),
--   public.recruiter_profile_can_manage_opportunities(...),
--   public.is_recruiter_owner(...), public.is_admin(...).

-- ---------------------------------------------------------------------------
-- A) Permission-aware contract action helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_contract_action(
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
      'contracts_view'::public.recruiter_workspace_permission,
      'contracts_manage'::public.recruiter_workspace_permission
    )
    AND (
      -- Canonical owner branch — unchanged semantics.
      public.is_recruiter_owner(auth.uid(), _recruiter_id)
      OR (
        -- Non-owner STAFF branch. No role shortcut anywhere.
        public.recruiter_profile_can_manage_opportunities(_recruiter_id)
        AND public.current_user_has_recruiter_permission(_recruiter_id, _permission)
        AND EXISTS (
          SELECT 1
          FROM public.recruiter_billing_profiles b
          WHERE b.recruiter_id = _recruiter_id
            AND b.plan IN ('growth', 'fleet')
            AND b.status IN ('active', 'trialing') -- trial-allowlist
        )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.current_user_can_recruiter_contract_action(uuid, public.recruiter_workspace_permission) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_recruiter_contract_action(uuid, public.recruiter_workspace_permission) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_recruiter_contract_action(uuid, public.recruiter_workspace_permission) TO authenticated;

-- ---------------------------------------------------------------------------
-- B) RLS-safe authorization contexts
-- ---------------------------------------------------------------------------
-- These return ONLY authorization context (recruiter workspace / application
-- ids). They never return contract content, extracted text, document data,
-- driver contact data, audit metadata, or billing data, and they cannot
-- enumerate rows the caller is not already authorized for.
CREATE OR REPLACE FUNCTION public.recruiter_contract_authorized_context(
  _contract_id uuid,
  _permission public.recruiter_workspace_permission
)
RETURNS TABLE(recruiter_id uuid, application_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT c.recruiter_id, c.application_id
  FROM public.contracts c
  WHERE c.id = _contract_id
    AND auth.uid() IS NOT NULL
    AND public.current_user_can_recruiter_contract_action(c.recruiter_id, _permission);
$function$;

REVOKE ALL ON FUNCTION public.recruiter_contract_authorized_context(uuid, public.recruiter_workspace_permission) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recruiter_contract_authorized_context(uuid, public.recruiter_workspace_permission) FROM anon;
GRANT EXECUTE ON FUNCTION public.recruiter_contract_authorized_context(uuid, public.recruiter_workspace_permission) TO authenticated;

CREATE OR REPLACE FUNCTION public.recruiter_contract_application_context(
  _application_id uuid,
  _permission public.recruiter_workspace_permission
)
RETURNS TABLE(recruiter_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT oa.recruiter_id
  FROM public.opportunity_applications oa
  WHERE oa.id = _application_id
    AND auth.uid() IS NOT NULL
    AND public.current_user_can_recruiter_contract_action(oa.recruiter_id, _permission);
$function$;

REVOKE ALL ON FUNCTION public.recruiter_contract_application_context(uuid, public.recruiter_workspace_permission) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recruiter_contract_application_context(uuid, public.recruiter_workspace_permission) FROM anon;
GRANT EXECUTE ON FUNCTION public.recruiter_contract_application_context(uuid, public.recruiter_workspace_permission) TO authenticated;

-- ---------------------------------------------------------------------------
-- C) Staff SELECT-ONLY RLS on contract tables
-- ---------------------------------------------------------------------------
-- Every existing owner / driver / admin policy is left in place untouched.
-- These are ADDITIVE, SELECT-only, and resolve exclusively through the
-- RLS-safe context helpers above.
DROP POLICY IF EXISTS "RC1G staff view workspace contracts" ON public.contracts;
CREATE POLICY "RC1G staff view workspace contracts"
ON public.contracts
FOR SELECT
TO authenticated
USING (
  public.current_user_can_recruiter_contract_action(
    contracts.recruiter_id,
    'contracts_view'::public.recruiter_workspace_permission
  )
);

DROP POLICY IF EXISTS "RC1G staff view workspace contract versions" ON public.contract_versions;
CREATE POLICY "RC1G staff view workspace contract versions"
ON public.contract_versions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.recruiter_contract_authorized_context(
      contract_versions.contract_id,
      'contracts_view'::public.recruiter_workspace_permission
    )
  )
);

DROP POLICY IF EXISTS "RC1G staff view workspace contract reviews" ON public.contract_reviews;
CREATE POLICY "RC1G staff view workspace contract reviews"
ON public.contract_reviews
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.recruiter_contract_authorized_context(
      contract_reviews.contract_id,
      'contracts_view'::public.recruiter_workspace_permission
    )
  )
);

DROP POLICY IF EXISTS "RC1G staff view workspace contract clauses" ON public.contract_clauses;
CREATE POLICY "RC1G staff view workspace contract clauses"
ON public.contract_clauses
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.recruiter_contract_authorized_context(
      contract_clauses.contract_id,
      'contracts_view'::public.recruiter_workspace_permission
    )
  )
);

DROP POLICY IF EXISTS "RC1G staff view workspace contract signatures" ON public.contract_signatures;
CREATE POLICY "RC1G staff view workspace contract signatures"
ON public.contract_signatures
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.recruiter_contract_authorized_context(
      contract_signatures.contract_id,
      'contracts_view'::public.recruiter_workspace_permission
    )
  )
);

DROP POLICY IF EXISTS "RC1G staff view workspace contract audit log" ON public.contract_audit_log;
CREATE POLICY "RC1G staff view workspace contract audit log"
ON public.contract_audit_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.recruiter_contract_authorized_context(
      contract_audit_log.contract_id,
      'contracts_view'::public.recruiter_workspace_permission
    )
  )
);

-- Storage: additive staff SELECT only. The existing parties-read, recruiter
-- INSERT, and admin-manage policies are untouched. Object paths are
-- contracts/{application_id}/{contract_id}/{version_id}/filename.
DROP POLICY IF EXISTS "RC1G staff read workspace contract objects" ON storage.objects;
CREATE POLICY "RC1G staff read workspace contract objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'contract-documents'
  AND (storage.foldername(name))[1] = 'contracts'
  AND EXISTS (
    SELECT 1
    FROM public.recruiter_contract_application_context(
      ((storage.foldername(name))[2])::uuid,
      'contracts_view'::public.recruiter_workspace_permission
    )
  )
);

-- ---------------------------------------------------------------------------
-- D) Staff-safe contract pipeline read path
-- ---------------------------------------------------------------------------
-- Narrow projection for the staff Contracts page ONLY. Includes applications
-- that are still awaiting a contract. Deliberately EXCLUDES: driver phone /
-- email / contact snapshots, admin notes, messages, contact requests, billing
-- data, recruiter private fields, extracted contract text, signature IP /
-- user-agent / evidence, and audit metadata.
CREATE OR REPLACE FUNCTION public.list_recruiter_contract_pipeline_safe(
  _recruiter_id uuid
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'application_id', oa.id,
    'application_status', oa.status,
    'driver_profile', CASE
      WHEN dop.id IS NULL THEN NULL
      ELSE jsonb_build_object('id', dop.id, 'full_name', dop.full_name)
    END,
    'opportunity', CASE
      WHEN o.id IS NULL THEN NULL
      ELSE jsonb_build_object('id', o.id, 'title', o.title, 'company_name', o.company_name)
    END,
    'contract_id', c.id,
    'contract_status', c.status,
    'current_version_id', c.current_version_id,
    'risk_tier', c.risk_tier,
    'contract_updated_at', c.updated_at,
    'has_driver_signature', COALESCE(
      (
        SELECT true
        FROM public.contract_signatures s
        WHERE s.contract_id = c.id
          AND s.signer_role = 'driver'
          AND s.signed_at IS NOT NULL
        LIMIT 1
      ),
      false
    )
  )
  FROM public.opportunity_applications oa
  LEFT JOIN public.opportunities o ON o.id = oa.opportunity_id
  LEFT JOIN public.driver_opportunity_profiles dop ON dop.id = oa.driver_profile_id
  LEFT JOIN public.contracts c ON c.application_id = oa.id
  WHERE oa.recruiter_id = _recruiter_id
    AND public.current_user_can_recruiter_contract_action(
      _recruiter_id,
      'contracts_view'::public.recruiter_workspace_permission
    )
  ORDER BY COALESCE(c.updated_at, oa.created_at) DESC;
$function$;

REVOKE ALL ON FUNCTION public.list_recruiter_contract_pipeline_safe(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_recruiter_contract_pipeline_safe(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_recruiter_contract_pipeline_safe(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- E) get_application_contract_summary — additive staff view branch
-- ---------------------------------------------------------------------------
-- The existing application-party / admin branch and the response shape are
-- preserved byte-for-byte. public.is_application_party() is NOT redefined.
-- The ONLY change is an additional staff contracts_view branch resolved
-- through the RLS-safe application context.
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
     AND NOT public.is_admin(_uid)
     AND NOT EXISTS (
       SELECT 1
       FROM public.recruiter_contract_application_context(
         _application_id,
         'contracts_view'::public.recruiter_workspace_permission
       )
     ) THEN
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

REVOKE ALL ON FUNCTION public.get_application_contract_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_application_contract_summary(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_application_contract_summary(uuid) TO authenticated;
