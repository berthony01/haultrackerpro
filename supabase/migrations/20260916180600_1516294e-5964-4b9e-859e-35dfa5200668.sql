-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase HP-3A — Safe public opportunity teaser RPC (additive function only).
--
-- Scope: CREATE exactly one read-only SECURITY DEFINER function,
-- public.list_public_opportunity_teasers, returning a bounded, PII-free
-- projection of opportunities that are ALREADY eligible for authenticated
-- drivers. No table, column, policy, grant, trigger, index, enum, data write,
-- or backfill is performed. No existing function is modified.
--
-- Eligibility is NOT re-authored here: the function reuses the existing
-- server-side helpers public.recruiter_profile_can_manage_opportunities and
-- public.is_qa_fixture_root, matching the authenticated driver-visible path
-- (public.list_driver_visible_opportunities / public.driver_can_access_opportunity).
-- QA fixture rows are unconditionally excluded because an anonymous caller has
-- no identity that could own a fixture root.
--
-- Deliberately NOT returned: recruiter_id, any public.recruiter_profiles
-- column, status, admin_review_status, view_count, transparency_confirmed,
-- created_at, updated_at, description, benefits, actual_benefits, requirements
-- free text, and the full deduction block. The recruiter's free-text
-- requirements are reduced to a single derived boolean, has_additional_requirements,
-- so the signed-out surface can honestly disclose that additional recruiter
-- requirements exist without disclosing their content.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_public_opportunity_teasers(
  _state text DEFAULT NULL,
  _driver_type text DEFAULT NULL,
  _route_type text DEFAULT NULL,
  _opportunity_id uuid DEFAULT NULL,
  _limit integer DEFAULT 24
)
RETURNS TABLE (
  id uuid,
  title text,
  company_name text,
  hiring_city text,
  hiring_state text,
  hiring_states text[],
  driver_type text,
  route_type text,
  trailer_type text,
  employment_model text,
  team_configuration text,
  home_time text,
  pay_model text,
  cpm numeric,
  percentage_pay numeric,
  percentage_basis_label text,
  flat_weekly_pay numeric,
  salary_amount numeric,
  salary_frequency text,
  other_pay_method_label text,
  estimated_weekly_gross numeric,
  estimated_weekly_miles numeric,
  estimated_loaded_miles numeric,
  estimated_deadhead_miles numeric,
  deadhead_paid boolean,
  sign_on_bonus numeric,
  min_years_experience numeric,
  required_cdl_class text,
  required_endorsements text[],
  typical_lanes text,
  published_at timestamptz,
  featured boolean,
  has_additional_requirements boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    o.id,
    o.title,
    o.company_name,
    o.hiring_city,
    o.hiring_state,
    o.hiring_states,
    o.driver_type,
    o.route_type,
    o.trailer_type,
    o.employment_model,
    o.team_configuration,
    o.home_time,
    o.pay_model,
    o.cpm,
    o.percentage_pay,
    o.percentage_basis_label,
    o.flat_weekly_pay,
    o.salary_amount,
    o.salary_frequency,
    o.other_pay_method_label,
    o.estimated_weekly_gross,
    o.estimated_weekly_miles,
    o.estimated_loaded_miles,
    o.estimated_deadhead_miles,
    o.deadhead_paid,
    o.sign_on_bonus,
    o.min_years_experience,
    o.required_cdl_class,
    o.required_endorsements,
    o.typical_lanes,
    o.published_at,
    o.featured,
    (btrim(coalesce(o.requirements, '')) <> '') AS has_additional_requirements
  FROM public.opportunities o
  WHERE o.status = 'active'
    AND o.admin_review_status = 'approved'
    AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
    AND NOT public.is_qa_fixture_root('recruiter_profile', o.recruiter_id)
    AND (_opportunity_id IS NULL OR o.id = _opportunity_id)
    AND (
      _state IS NULL
      OR o.hiring_state = _state
      OR _state = ANY (o.hiring_states)
    )
    AND (_driver_type IS NULL OR o.driver_type = _driver_type)
    AND (_route_type IS NULL OR o.route_type = _route_type)
  ORDER BY o.featured DESC NULLS LAST, o.published_at DESC NULLS LAST
  LIMIT least(greatest(coalesce(_limit, 24), 1), 50);
$function$;

REVOKE ALL ON FUNCTION public.list_public_opportunity_teasers(text, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_opportunity_teasers(text, text, text, uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.list_public_opportunity_teasers(text, text, text, uuid, integer) TO authenticated;

COMMIT;