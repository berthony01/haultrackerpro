-- CANDIDATE MIGRATION — Phase RB-3A-0A.
-- Canonical recruiter opportunity CREATION boundary.
--
-- WHY: opportunity creation is currently only a direct client INSERT guarded by
-- the auth.uid()-bound RLS policy "Recruiter inserts own opportunities". There is
-- no server-delegable canonical creation entry point, so no server-side actor
-- (e.g. a future Telegram Quick Post) can create an opportunity without either
-- bypassing RLS or duplicating business rules.
--
-- WHAT THIS DOES: adds exactly ONE SECURITY DEFINER function that becomes the
-- canonical creation path. It does NOT reimplement business rules:
--   * posting authority     -> public.current_user_can_recruiter_opportunity_action(
--                                 _recruiter_id, 'opportunities_create')
--                              (the SAME predicate as the RLS WITH CHECK)
--   * plan / active limits  -> trg_opportunities_billing_guard   (BEFORE INSERT)
--   * staff status rules    -> trg_opportunities_a_staff_action_guard
--   * publication rules     -> trg_opportunities_canonical_publication_guard
--   * field validation      -> trg_opportunities_guard
--   * featured / plan flags -> trg_opportunities_set_featured
-- All of those triggers still fire because this function performs an ordinary
-- INSERT into public.opportunities. Only the RLS WITH CHECK is bypassed (by
-- definer ownership), and it is re-asserted explicitly above.
--
-- EXPLICITLY NOT IN THIS PHASE:
--   * No service_role delegated-actor overload. The permission predicates are
--     auth.uid()-bound; a safe delegated actor requires extracting an
--     actor-parameterised core out of
--     public.current_user_can_manage_recruiter_opportunities /
--     public.recruiter_profile_can_manage_opportunities, which are depended on
--     across the recruiter authorization surface. That is a separate phase.
--   * No RLS/policy/grant/trigger/column/index change on public.opportunities.
--   * No Stripe, price, plan-name, or entitlement change.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_recruiter_opportunity(
  _recruiter_id uuid,
  _payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- Explicit write whitelist. Every other column of public.opportunities is
  -- server-managed (id, recruiter_id, admin_review_status, featured,
  -- view_count, created_at, updated_at, published_at) and can never be
  -- supplied by a caller.
  v_allowed CONSTANT text[] := ARRAY[
    'title','company_name','hiring_city','hiring_state','hiring_states',
    'driver_type','route_type','trailer_type','pay_model','cpm',
    'percentage_pay','flat_weekly_pay','estimated_weekly_gross',
    'estimated_weekly_miles','estimated_loaded_miles','estimated_deadhead_miles',
    'deadhead_paid','detention_pay','layover_pay','sign_on_bonus','fuel_paid_by',
    'insurance_deductions','escrow_required','escrow_amount','lease_payment',
    'maintenance_deductions','other_deductions','home_time','forced_dispatch',
    'pets_allowed','riders_allowed','equipment_year','benefits','description',
    'transparency_confirmed','status','canonical_version','employment_model',
    'team_configuration','percentage_basis_label',
    'percentage_weekly_revenue_basis','salary_amount','salary_frequency',
    'mixed_pay_components','other_pay_method_label','other_weekly_gross',
    'insurance_deduction_frequency','escrow_required_state',
    'escrow_amount_frequency','lease_payment_frequency',
    'maintenance_deduction_frequency','other_deduction_frequency',
    'typical_lanes','requirements','actual_benefits','min_years_experience',
    'required_cdl_class','required_endorsements'
  ];
  v_payload jsonb;
  v_key text;
  v_rec public.opportunities%ROWTYPE;
  v_id uuid;
  v_status text;
  v_title text;
  v_created timestamptz;
BEGIN
  -- Actor is derived from the session ONLY. No caller-supplied actor exists.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF _recruiter_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  v_payload := COALESCE(_payload, '{}'::jsonb);
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  -- Fail closed on ANY field outside the whitelist. No column injection.
  FOR v_key IN SELECT jsonb_object_keys(v_payload) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'unknown_field' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;
  END LOOP;

  -- Same predicate the RLS WITH CHECK uses. A caller-supplied _recruiter_id
  -- grants nothing by itself.
  IF NOT public.current_user_can_recruiter_opportunity_action(
       _recruiter_id,
       'opportunities_create'::public.recruiter_workspace_permission
     ) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- Absent keys must fall back to the COLUMN DEFAULTS of the NOT NULL columns,
  -- not to NULL. Nullable columns keep exact NULL semantics.
  v_rec := jsonb_populate_record(
    NULL::public.opportunities,
    -- Exact live column defaults of every NOT NULL writable column:
    --   hiring_states          text[]  NOT NULL DEFAULT '{}'
    --   escrow_required        boolean NOT NULL DEFAULT false
    --   transparency_confirmed boolean NOT NULL DEFAULT false
    --   status                 text    NOT NULL DEFAULT 'draft'
    --   mixed_pay_components   jsonb   NOT NULL DEFAULT '[]'
    --   required_endorsements  text[]  NOT NULL DEFAULT '{}'
    -- (title/company_name are NOT NULL with no default and must be supplied.)
    jsonb_build_object(
      'hiring_states', jsonb_build_array(),
      'escrow_required', false,
      'transparency_confirmed', false,
      'status', 'draft',
      'mixed_pay_components', jsonb_build_array(),
      'required_endorsements', jsonb_build_array()
    ) || v_payload
  );

  INSERT INTO public.opportunities (
    recruiter_id,
    title, company_name, hiring_city, hiring_state, hiring_states,
    driver_type, route_type, trailer_type, pay_model, cpm,
    percentage_pay, flat_weekly_pay, estimated_weekly_gross,
    estimated_weekly_miles, estimated_loaded_miles, estimated_deadhead_miles,
    deadhead_paid, detention_pay, layover_pay, sign_on_bonus, fuel_paid_by,
    insurance_deductions, escrow_required, escrow_amount, lease_payment,
    maintenance_deductions, other_deductions, home_time, forced_dispatch,
    pets_allowed, riders_allowed, equipment_year, benefits, description,
    transparency_confirmed, status, canonical_version, employment_model,
    team_configuration, percentage_basis_label,
    percentage_weekly_revenue_basis, salary_amount, salary_frequency,
    mixed_pay_components, other_pay_method_label, other_weekly_gross,
    insurance_deduction_frequency, escrow_required_state,
    escrow_amount_frequency, lease_payment_frequency,
    maintenance_deduction_frequency, other_deduction_frequency,
    typical_lanes, requirements, actual_benefits, min_years_experience,
    required_cdl_class, required_endorsements
  ) VALUES (
    _recruiter_id,
    v_rec.title, v_rec.company_name, v_rec.hiring_city, v_rec.hiring_state, v_rec.hiring_states,
    v_rec.driver_type, v_rec.route_type, v_rec.trailer_type, v_rec.pay_model, v_rec.cpm,
    v_rec.percentage_pay, v_rec.flat_weekly_pay, v_rec.estimated_weekly_gross,
    v_rec.estimated_weekly_miles, v_rec.estimated_loaded_miles, v_rec.estimated_deadhead_miles,
    v_rec.deadhead_paid, v_rec.detention_pay, v_rec.layover_pay, v_rec.sign_on_bonus, v_rec.fuel_paid_by,
    v_rec.insurance_deductions, v_rec.escrow_required, v_rec.escrow_amount, v_rec.lease_payment,
    v_rec.maintenance_deductions, v_rec.other_deductions, v_rec.home_time, v_rec.forced_dispatch,
    v_rec.pets_allowed, v_rec.riders_allowed, v_rec.equipment_year, v_rec.benefits, v_rec.description,
    v_rec.transparency_confirmed, v_rec.status, v_rec.canonical_version, v_rec.employment_model,
    v_rec.team_configuration, v_rec.percentage_basis_label,
    v_rec.percentage_weekly_revenue_basis, v_rec.salary_amount, v_rec.salary_frequency,
    v_rec.mixed_pay_components, v_rec.other_pay_method_label, v_rec.other_weekly_gross,
    v_rec.insurance_deduction_frequency, v_rec.escrow_required_state,
    v_rec.escrow_amount_frequency, v_rec.lease_payment_frequency,
    v_rec.maintenance_deduction_frequency, v_rec.other_deduction_frequency,
    v_rec.typical_lanes, v_rec.requirements, v_rec.actual_benefits, v_rec.min_years_experience,
    v_rec.required_cdl_class, v_rec.required_endorsements
  )
  RETURNING id, status, title, created_at
  INTO v_id, v_status, v_title, v_created;

  RETURN jsonb_build_object(
    'result_code', 'created',
    'opportunity_id', v_id,
    'status', v_status,
    'title', v_title,
    'created_at', v_created
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_recruiter_opportunity(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_recruiter_opportunity(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_recruiter_opportunity(uuid, jsonb) TO authenticated;

COMMIT;
