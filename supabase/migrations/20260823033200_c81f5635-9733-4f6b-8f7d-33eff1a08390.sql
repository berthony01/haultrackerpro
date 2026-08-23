-- Phase RW-2 — Owner QA relationship & workspace scenarios.
--
-- Reuses the EXISTING public.qa_fixture_roots registry, the EXISTING Owner QA
-- persona overlay, and the EXISTING operational reset RPC. No new table,
-- column, enum, index, policy or trigger is created here. No billing, Stripe,
-- subscription or Telegram row is ever written by RW-2.
--
-- Vocabulary is locked to exactly eight scenario keys:
--   assistant_none, assistant_one, assistant_many,
--   agency_owner_populated, agency_admin, agency_member,
--   recruiter_staff_one, recruiter_admin_multi

-- ---------------------------------------------------------------------------
-- 1. BASE fixture roots — the exact-three invariant now applies to BASE roots
--    only. RW-2 auxiliary roots are marked with a 'RW-2:' note prefix and are
--    excluded here so the existing reset/guard contract is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._owner_qa_fixture_roots(
  OUT qa_user_id uuid, OUT qa_recruiter_profile_id uuid, OUT qa_agency_profile_id uuid
)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_total integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'owner_qa_fixture_reset_unauthenticated'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin(v_caller) THEN
    RAISE EXCEPTION 'owner_qa_fixture_reset_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.qa_fixture_roots r
  WHERE r.active
    AND r.revoked_at IS NULL
    AND r.qa_owner_user_id = v_caller
    AND COALESCE(r.note, '') NOT LIKE 'RW-2:%';

  IF v_total <> 3 THEN
    RAISE EXCEPTION 'owner_qa_fixture_roots_unexpected_count: %', v_total
      USING ERRCODE = '22023';
  END IF;

  SELECT r.root_id INTO qa_user_id
  FROM public.qa_fixture_roots r
  WHERE r.active AND r.revoked_at IS NULL
    AND r.qa_owner_user_id = v_caller AND r.root_kind = 'user'
    AND COALESCE(r.note, '') NOT LIKE 'RW-2:%';

  SELECT r.root_id INTO qa_recruiter_profile_id
  FROM public.qa_fixture_roots r
  WHERE r.active AND r.revoked_at IS NULL
    AND r.qa_owner_user_id = v_caller AND r.root_kind = 'recruiter_profile'
    AND COALESCE(r.note, '') NOT LIKE 'RW-2:%';

  SELECT r.root_id INTO qa_agency_profile_id
  FROM public.qa_fixture_roots r
  WHERE r.active AND r.revoked_at IS NULL
    AND r.qa_owner_user_id = v_caller AND r.root_kind = 'agency_profile'
    AND COALESCE(r.note, '') NOT LIKE 'RW-2:%';

  IF qa_user_id IS NULL
     OR qa_recruiter_profile_id IS NULL
     OR qa_agency_profile_id IS NULL THEN
    RAISE EXCEPTION 'owner_qa_fixture_roots_incomplete'
      USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Internal helper — COMPLETE permission maps derived from the live enums.
--    Never invents keys: every enum label is emitted with an exact boolean.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._owner_qa_rw2_perm_map(_enum text, _true_keys text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    jsonb_object_agg(
      e.enumlabel::text,
      e.enumlabel::text = ANY (COALESCE(_true_keys, '{}'::text[]))
    ),
    '{}'::jsonb
  )
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
    AND t.typname = _enum
    AND _enum IN ('agency_workspace_permission', 'recruiter_workspace_permission');
$function$;

REVOKE ALL ON FUNCTION public._owner_qa_rw2_perm_map(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._owner_qa_rw2_perm_map(text, text[]) FROM anon;
REVOKE ALL ON FUNCTION public._owner_qa_rw2_perm_map(text, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._owner_qa_rw2_perm_map(text, text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Internal helper — the RW-2 auxiliary synthetic identity.
--    Reuses this QA owner's existing RW-2 'user' root when present (even if
--    inactive). Otherwise creates exactly ONE new non-login-capable synthetic
--    auth user. It NEVER searches for, adopts, or mutates arbitrary existing
--    accounts, and the synthetic id/email is never returned to any client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._owner_qa_rw2_ensure_aux_user()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_aux uuid;
  v_email text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'owner_qa_relationship_scenario_unauthorized'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_super_admin(v_caller) THEN
    RAISE EXCEPTION 'owner_qa_relationship_scenario_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  -- Reuse: an existing RW-2 auxiliary user root for THIS QA owner, any state.
  SELECT r.root_id INTO v_aux
  FROM public.qa_fixture_roots r
  WHERE r.qa_owner_user_id = v_caller
    AND r.root_kind = 'user'
    AND COALESCE(r.note, '') LIKE 'RW-2:%'
  ORDER BY r.created_at
  LIMIT 1;

  IF v_aux IS NOT NULL
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_aux) THEN
    RETURN v_aux;
  END IF;

  -- Create exactly one synthetic, non-login-capable identity.
  v_aux := gen_random_uuid();
  v_email := 'rw2-owner-qa-' || replace(v_aux::text, '-', '') || '@haultrackerpro.invalid';

  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, banned_until
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_aux, 'authenticated', 'authenticated', v_email,
    NULL, now(),
    jsonb_build_object('provider', 'owner_qa_rw2_fixture',
                       'providers', jsonb_build_array('owner_qa_rw2_fixture')),
    jsonb_build_object('display_name', 'RW-2 Owner QA Auxiliary',
                       'owner_qa_fixture', true,
                       'owner_qa_phase', 'RW-2'),
    now(), now(), now() + interval '100 years'
  );
  -- Deliberately NO auth.identities row and NO usable password: this identity
  -- can never sign in. Existing auth.users triggers provision its normal
  -- synthetic profile/settings/free subscription/driver capability.

  INSERT INTO public.qa_fixture_roots (
    root_kind, root_id, qa_owner_user_id, active, note, registered_by_user_id, revoked_at
  ) VALUES (
    'user', v_aux, v_caller, false, 'RW-2:aux_user', v_caller, now()
  )
  ON CONFLICT (root_kind, root_id) DO NOTHING;

  RETURN v_aux;
END;
$function$;

REVOKE ALL ON FUNCTION public._owner_qa_rw2_ensure_aux_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._owner_qa_rw2_ensure_aux_user() FROM anon;
REVOKE ALL ON FUNCTION public._owner_qa_rw2_ensure_aux_user() FROM authenticated;
GRANT EXECUTE ON FUNCTION public._owner_qa_rw2_ensure_aux_user() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Read-only scenario state. Safe summary fields only: never a UUID, email,
--    token, plan, price or billing identifier.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_qa_relationship_scenario_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_note text;
  v_scenario text;
  n_drivers integer := 0;
  v_agency_role text;
  n_agency_perms integer := 0;
  n_rec_workspaces integer := 0;
  v_rec_roles text[] := '{}'::text[];
BEGIN
  IF v_caller IS NULL OR NOT public.is_super_admin(v_caller) THEN
    RAISE EXCEPTION 'owner_qa_relationship_scenario_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT r.note INTO v_note
  FROM public.qa_fixture_roots r
  WHERE r.qa_owner_user_id = v_caller
    AND r.root_kind = 'user'
    AND r.active AND r.revoked_at IS NULL
    AND COALESCE(r.note, '') LIKE 'RW-2:scenario=%'
  LIMIT 1;

  IF v_note IS NOT NULL THEN
    v_scenario := substring(v_note FROM 'RW-2:scenario=(.*)$');
  END IF;

  -- Direct assistant relationships the QA owner holds over registered QA
  -- driver roots (agency-delegated rows are intentionally excluded).
  SELECT count(*) INTO n_drivers
  FROM public.driver_assistants da
  WHERE da.assistant_user_id = v_caller
    AND da.status = 'active'
    AND da.revoked_at IS NULL
    AND da.agency_delegation_id IS NULL
    AND da.driver_user_id IN (
      SELECT r.root_id FROM public.qa_fixture_roots r
      WHERE r.qa_owner_user_id = v_caller AND r.root_kind = 'user'
        AND r.active AND r.revoked_at IS NULL
    );

  SELECT m.role::text,
         (SELECT count(*) FROM jsonb_each(m.workspace_permissions) kv
            WHERE kv.value = 'true'::jsonb)
    INTO v_agency_role, n_agency_perms
  FROM public.agency_members m
  WHERE m.member_user_id = v_caller
    AND m.status = 'active'
    AND m.agency_id IN (
      SELECT r.root_id FROM public.qa_fixture_roots r
      WHERE r.qa_owner_user_id = v_caller AND r.root_kind = 'agency_profile'
        AND r.active AND r.revoked_at IS NULL
    )
  LIMIT 1;

  SELECT count(*), COALESCE(array_agg(x.role ORDER BY x.role), '{}'::text[])
    INTO n_rec_workspaces, v_rec_roles
  FROM (
    SELECT m.role::text AS role
    FROM public.recruiter_members m
    WHERE m.member_user_id = v_caller
      AND m.status = 'active'
      AND m.recruiter_id IN (
        SELECT r.root_id FROM public.qa_fixture_roots r
        WHERE r.qa_owner_user_id = v_caller AND r.root_kind = 'recruiter_profile'
          AND r.active AND r.revoked_at IS NULL
      )
  ) x;

  RETURN jsonb_build_object(
    'active', v_scenario IS NOT NULL,
    'scenario', v_scenario,
    'assistant_driver_count', n_drivers,
    'agency_role', v_agency_role,
    'agency_permission_count', COALESCE(n_agency_perms, 0),
    'recruiter_workspace_count', n_rec_workspaces,
    'recruiter_roles', to_jsonb(v_rec_roles)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.owner_qa_relationship_scenario_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_qa_relationship_scenario_state() FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_qa_relationship_scenario_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_qa_relationship_scenario_state() TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Clear — restores the BASE QA topology and deactivates RW-2 auxiliaries
--    while preserving the synthetic identities for reuse.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_qa_clear_relationship_scenario()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_base_user uuid;
  v_base_rec uuid;
  v_base_agency uuid;
  v_aux_user uuid;
  v_aux_rec uuid;
  v_email text;
  n_assistants integer := 0;
  n_agency integer := 0;
  n_recruiter integer := 0;
  n_roots integer := 0;
BEGIN
  IF v_caller IS NULL OR NOT public.is_super_admin(v_caller) THEN
    RAISE EXCEPTION 'owner_qa_relationship_scenario_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT r.qa_user_id, r.qa_recruiter_profile_id, r.qa_agency_profile_id
    INTO v_base_user, v_base_rec, v_base_agency
  FROM public._owner_qa_fixture_roots() r;

  SELECT r.root_id INTO v_aux_user
  FROM public.qa_fixture_roots r
  WHERE r.qa_owner_user_id = v_caller AND r.root_kind = 'user'
    AND COALESCE(r.note, '') LIKE 'RW-2:%'
  LIMIT 1;

  SELECT r.root_id INTO v_aux_rec
  FROM public.qa_fixture_roots r
  WHERE r.qa_owner_user_id = v_caller AND r.root_kind = 'recruiter_profile'
    AND COALESCE(r.note, '') LIKE 'RW-2:%'
  LIMIT 1;

  SELECT u.email::text INTO v_email FROM auth.users u WHERE u.id = v_caller;

  -- (a) Scenario assistant rows under registered QA driver roots only.
  DELETE FROM public.driver_assistants da
  WHERE da.assistant_user_id = v_caller
    AND da.agency_delegation_id IS NULL
    AND da.driver_user_id IN (v_base_user, v_aux_user);
  GET DIAGNOSTICS n_assistants = ROW_COUNT;

  -- (b) BASE agency restored to the canonical QA owner topology.
  UPDATE public.agency_profiles
     SET owner_user_id = v_caller, updated_at = now()
   WHERE id = v_base_agency AND owner_user_id <> v_caller;

  DELETE FROM public.agency_members m
   WHERE m.agency_id = v_base_agency
     AND m.member_user_id IN (v_base_user, v_aux_user);
  GET DIAGNOSTICS n_agency = ROW_COUNT;

  UPDATE public.agency_members m
     SET role = 'agency_owner', status = 'active', revoked_at = NULL,
         accepted_at = COALESCE(m.accepted_at, now()), updated_at = now()
   WHERE m.agency_id = v_base_agency AND m.member_user_id = v_caller;
  IF NOT FOUND THEN
    INSERT INTO public.agency_members (
      agency_id, member_user_id, invite_email, role, status, accepted_at
    ) VALUES (
      v_base_agency, v_caller, v_email, 'agency_owner', 'active', now()
    );
  END IF;

  -- (c) BASE recruiter restored to the canonical QA owner topology.
  UPDATE public.recruiter_profiles
     SET user_id = v_caller, updated_at = now()
   WHERE id = v_base_rec AND user_id <> v_caller;

  DELETE FROM public.recruiter_members m
   WHERE m.recruiter_id = v_base_rec
     AND m.member_user_id IN (v_base_user, v_aux_user);
  GET DIAGNOSTICS n_recruiter = ROW_COUNT;

  UPDATE public.recruiter_members m
     SET role = 'recruiter_owner', status = 'active', revoked_at = NULL,
         accepted_at = COALESCE(m.accepted_at, now()), updated_at = now()
   WHERE m.recruiter_id = v_base_rec AND m.member_user_id = v_caller;
  IF NOT FOUND THEN
    INSERT INTO public.recruiter_members (
      recruiter_id, member_user_id, invite_email, role, status, accepted_at
    ) VALUES (
      v_base_rec, v_caller, v_email::citext, 'recruiter_owner', 'active', now()
    );
  END IF;

  -- (d) The QA owner leaves the auxiliary recruiter workspace. The auxiliary
  --     synthetic owner membership, profile and identity are preserved.
  IF v_aux_rec IS NOT NULL THEN
    DELETE FROM public.recruiter_members m
     WHERE m.recruiter_id = v_aux_rec AND m.member_user_id = v_caller;
  END IF;

  -- (e) Deactivate RW-2 roots; never delete the root records or identities.
  UPDATE public.qa_fixture_roots r
     SET active = false,
         revoked_at = COALESCE(r.revoked_at, now()),
         note = CASE r.root_kind WHEN 'user' THEN 'RW-2:aux_user'
                                 ELSE 'RW-2:aux_recruiter' END,
         updated_at = now()
   WHERE r.qa_owner_user_id = v_caller
     AND COALESCE(r.note, '') LIKE 'RW-2:%'
     AND r.active;
  GET DIAGNOSTICS n_roots = ROW_COUNT;

  RETURN jsonb_build_object(
    'cleared', true,
    'assistant_rows_removed', n_assistants,
    'agency_memberships_removed', n_agency,
    'recruiter_memberships_removed', n_recruiter,
    'auxiliary_roots_deactivated', n_roots,
    'state', public.owner_qa_relationship_scenario_state()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.owner_qa_clear_relationship_scenario() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_qa_clear_relationship_scenario() FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_qa_clear_relationship_scenario() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_qa_clear_relationship_scenario() TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Apply — deterministic, allowlisted, reversible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_qa_apply_relationship_scenario(_scenario text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_base_user uuid;
  v_base_rec uuid;
  v_base_agency uuid;
  v_aux_user uuid;
  v_aux_rec uuid;
  v_email text;
  v_aux_email text;
  v_base_email text;
BEGIN
  IF v_caller IS NULL OR NOT public.is_super_admin(v_caller) THEN
    RAISE EXCEPTION 'owner_qa_relationship_scenario_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF _scenario IS NULL OR _scenario NOT IN (
    'assistant_none', 'assistant_one', 'assistant_many',
    'agency_owner_populated', 'agency_admin', 'agency_member',
    'recruiter_staff_one', 'recruiter_admin_multi'
  ) THEN
    RAISE EXCEPTION 'owner_qa_relationship_scenario_invalid'
      USING ERRCODE = '22023';
  END IF;

  -- (1) Reverse any prior RW-2 scenario, (2) then run the EXISTING operational
  -- reset while the auxiliaries are inactive so its 3-root guard holds.
  PERFORM public.owner_qa_clear_relationship_scenario();
  PERFORM public.owner_qa_fixture_reset();

  SELECT r.qa_user_id, r.qa_recruiter_profile_id, r.qa_agency_profile_id
    INTO v_base_user, v_base_rec, v_base_agency
  FROM public._owner_qa_fixture_roots() r;

  v_aux_user := public._owner_qa_rw2_ensure_aux_user();

  SELECT u.email::text INTO v_email FROM auth.users u WHERE u.id = v_caller;
  SELECT u.email::text INTO v_aux_email FROM auth.users u WHERE u.id = v_aux_user;
  SELECT u.email::text INTO v_base_email FROM auth.users u WHERE u.id = v_base_user;

  -- (5) Activate the auxiliary user root and record the exact active scenario.
  UPDATE public.qa_fixture_roots r
     SET active = true, revoked_at = NULL,
         note = 'RW-2:scenario=' || _scenario, updated_at = now()
   WHERE r.qa_owner_user_id = v_caller AND r.root_kind = 'user'
     AND r.root_id = v_aux_user;

  -- (6) Seed only the relationships the selected scenario needs.
  IF _scenario = 'assistant_one' OR _scenario = 'assistant_many' THEN
    INSERT INTO public.driver_assistants (
      driver_user_id, assistant_user_id, invite_email, status, accepted_at, permissions
    ) VALUES (
      v_base_user, v_caller, v_email, 'active', now(),
      jsonb_build_object('view_dashboard', true, 'manage_loads', true)
    );
  END IF;

  IF _scenario = 'assistant_many' THEN
    INSERT INTO public.driver_assistants (
      driver_user_id, assistant_user_id, invite_email, status, accepted_at, permissions
    ) VALUES (
      v_aux_user, v_caller, v_email, 'active', now(),
      jsonb_build_object('manage_fuel', true, 'view_reports', true)
    );
  END IF;

  IF _scenario = 'agency_owner_populated' THEN
    -- QA owner stays the canonical agency owner; the team is populated with a
    -- synthetic active admin. Role labels stay descriptive only.
    INSERT INTO public.agency_members (
      agency_id, member_user_id, invite_email, role, status, accepted_at, workspace_permissions
    ) VALUES (
      v_base_agency, v_base_user, v_base_email, 'agency_admin', 'active', now(),
      public._owner_qa_rw2_perm_map('agency_workspace_permission', ARRAY[
        'packages_view','packages_manage','client_requests_view','client_requests_manage',
        'clients_view','delegations_view','delegations_manage','work_items_view_all',
        'work_items_manage','team_view'
      ])
    );
  END IF;

  IF _scenario IN ('agency_admin', 'agency_member') THEN
    UPDATE public.agency_profiles
       SET owner_user_id = v_base_user, updated_at = now()
     WHERE id = v_base_agency;

    DELETE FROM public.agency_members m
     WHERE m.agency_id = v_base_agency
       AND m.member_user_id IN (v_base_user, v_caller);

    INSERT INTO public.agency_members (
      agency_id, member_user_id, invite_email, role, status, accepted_at, workspace_permissions
    ) VALUES (
      v_base_agency, v_base_user, v_base_email, 'agency_owner', 'active', now(),
      public._owner_qa_rw2_perm_map('agency_workspace_permission', ARRAY[
        'packages_view','packages_manage','client_requests_view','client_requests_manage',
        'clients_view','delegations_view','delegations_manage','work_items_view_all',
        'work_items_manage','audit_view','team_view'
      ])
    );

    IF _scenario = 'agency_admin' THEN
      INSERT INTO public.agency_members (
        agency_id, member_user_id, invite_email, role, status, accepted_at, workspace_permissions
      ) VALUES (
        v_base_agency, v_caller, v_email, 'agency_admin', 'active', now(),
        public._owner_qa_rw2_perm_map('agency_workspace_permission', ARRAY[
          'packages_view','packages_manage','client_requests_view','client_requests_manage',
          'clients_view','delegations_view','delegations_manage','work_items_view_all',
          'work_items_manage','team_view'
        ])
      );
    ELSE
      INSERT INTO public.agency_members (
        agency_id, member_user_id, invite_email, role, status, accepted_at, workspace_permissions
      ) VALUES (
        v_base_agency, v_caller, v_email, 'agency_member', 'active', now(),
        public._owner_qa_rw2_perm_map('agency_workspace_permission', ARRAY[
          'packages_view','client_requests_view','clients_view','delegations_view',
          'work_items_view_all','team_view'
        ])
      );
    END IF;
  END IF;

  IF _scenario IN ('recruiter_staff_one', 'recruiter_admin_multi') THEN
    UPDATE public.recruiter_profiles
       SET user_id = v_base_user, updated_at = now()
     WHERE id = v_base_rec;

    DELETE FROM public.recruiter_members m
     WHERE m.recruiter_id = v_base_rec
       AND m.member_user_id IN (v_base_user, v_caller);

    INSERT INTO public.recruiter_members (
      recruiter_id, member_user_id, invite_email, role, status, accepted_at, permissions
    ) VALUES (
      v_base_rec, v_base_user, v_base_email::citext, 'recruiter_owner', 'active', now(),
      public._owner_qa_rw2_perm_map('recruiter_workspace_permission', ARRAY[
        'opportunities_view','opportunities_create','opportunities_edit',
        'opportunities_change_status','opportunities_delete','applications_view',
        'applications_manage_status','applications_request_contact','applications_manage_notes',
        'contracts_view','contracts_manage','referrals_view','referrals_manage_status',
        'referral_terms_manage','reports_view','reports_export','settlements_view',
        'settlements_prepare','settlements_finalize','team_view','team_manage',
        'loads_view','loads_dispatch','loads_update_status'
      ])
    );
  END IF;

  IF _scenario = 'recruiter_staff_one' THEN
    INSERT INTO public.recruiter_members (
      recruiter_id, member_user_id, invite_email, role, status, accepted_at, permissions
    ) VALUES (
      v_base_rec, v_caller, v_email::citext, 'recruiter_staff', 'active', now(),
      public._owner_qa_rw2_perm_map('recruiter_workspace_permission', ARRAY[
        'opportunities_view','applications_view','applications_manage_status',
        'applications_manage_notes','contracts_view','referrals_view','reports_view',
        'settlements_view','loads_view','team_view'
      ])
    );
  END IF;

  IF _scenario = 'recruiter_admin_multi' THEN
    INSERT INTO public.recruiter_members (
      recruiter_id, member_user_id, invite_email, role, status, accepted_at, permissions
    ) VALUES (
      v_base_rec, v_caller, v_email::citext, 'recruiter_admin', 'active', now(),
      public._owner_qa_rw2_perm_map('recruiter_workspace_permission', ARRAY[
        'opportunities_view','opportunities_create','opportunities_edit',
        'opportunities_change_status','applications_view','applications_manage_status',
        'applications_request_contact','applications_manage_notes','contracts_view',
        'contracts_manage','referrals_view','referrals_manage_status','referral_terms_manage',
        'reports_view','reports_export','settlements_view','settlements_prepare',
        'team_view','loads_view','loads_dispatch','loads_update_status'
      ])
    );

    -- Auxiliary recruiter workspace, owned by the RW-2 synthetic identity.
    SELECT r.root_id INTO v_aux_rec
    FROM public.qa_fixture_roots r
    WHERE r.qa_owner_user_id = v_caller AND r.root_kind = 'recruiter_profile'
      AND COALESCE(r.note, '') LIKE 'RW-2:%'
    LIMIT 1;

    IF v_aux_rec IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.recruiter_profiles p WHERE p.id = v_aux_rec) THEN
      INSERT INTO public.recruiter_profiles (
        user_id, recruiter_name, recruiter_email, company_name, status, verification_status
      ) VALUES (
        v_aux_user, 'RW-2 Owner QA Auxiliary Recruiter', v_aux_email,
        'RW-2 Owner QA Auxiliary Carrier', 'active', 'verified'
      )
      RETURNING id INTO v_aux_rec;
    ELSE
      UPDATE public.recruiter_profiles
         SET user_id = v_aux_user, status = 'active', updated_at = now()
       WHERE id = v_aux_rec;
    END IF;

    INSERT INTO public.qa_fixture_roots (
      root_kind, root_id, qa_owner_user_id, active, note, registered_by_user_id, revoked_at
    ) VALUES (
      'recruiter_profile', v_aux_rec, v_caller, true, 'RW-2:aux_recruiter', v_caller, NULL
    )
    ON CONFLICT (root_kind, root_id) DO UPDATE
      SET active = true, revoked_at = NULL, note = 'RW-2:aux_recruiter', updated_at = now();

    DELETE FROM public.recruiter_members m
     WHERE m.recruiter_id = v_aux_rec AND m.member_user_id = v_caller;

    INSERT INTO public.recruiter_members (
      recruiter_id, member_user_id, invite_email, role, status, accepted_at, permissions
    ) VALUES (
      v_aux_rec, v_caller, v_email::citext, 'recruiter_admin', 'active', now(),
      public._owner_qa_rw2_perm_map('recruiter_workspace_permission', ARRAY[
        'opportunities_view','opportunities_create','opportunities_edit','applications_view',
        'applications_manage_status','applications_manage_notes','contracts_view',
        'referrals_view','reports_view','settlements_view','team_view','loads_view'
      ])
    );
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'scenario', _scenario,
    'state', public.owner_qa_relationship_scenario_state()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.owner_qa_apply_relationship_scenario(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_qa_apply_relationship_scenario(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_qa_apply_relationship_scenario(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_qa_apply_relationship_scenario(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Recruiter team seat limit — narrow Owner QA entitlement overlay ONLY.
--    The production billing path below is preserved byte-for-byte in meaning:
--    conflict => 1, owner-scoped standalone recruiter billing lookup, only
--    active/trialing starter/growth/fleet, default 1, nonexistent => 0.
--    The QA branch never reads or writes a billing row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recruiter_team_seat_limit(_recruiter_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _owner_id uuid;
  _plan text;
  _qa_persona text;
BEGIN
  IF _recruiter_id IS NULL THEN RETURN 0; END IF;
  SELECT rp.user_id INTO _owner_id FROM public.recruiter_profiles rp WHERE rp.id = _recruiter_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Owner QA overlay: entitlement simulation only, for a super_admin caller,
  -- on their OWN active registered QA recruiter fixture root, and only while a
  -- recruiter-domain Owner QA persona is active.
  IF auth.uid() IS NOT NULL
     AND public.is_super_admin(auth.uid())
     AND EXISTS (
       SELECT 1 FROM public.qa_fixture_roots r
       WHERE r.root_kind = 'recruiter_profile'
         AND r.root_id = _recruiter_id
         AND r.qa_owner_user_id = auth.uid()
         AND r.active
         AND r.revoked_at IS NULL
     )
  THEN
    SELECT q.persona INTO _qa_persona
    FROM public._owner_qa_persona_for(auth.uid()) q
    WHERE q.domain = 'recruiter';

    IF _qa_persona IS NOT NULL THEN
      RETURN CASE _qa_persona
        WHEN 'free_verified' THEN 1
        WHEN 'starter' THEN 2
        WHEN 'growth' THEN 5
        WHEN 'fleet' THEN 15
        ELSE 1
      END;
    END IF;
  END IF;

  IF public.effective_recruiter_tier(_recruiter_id) = 'conflict' THEN RETURN 1; END IF;
  SELECT b.plan INTO _plan
  FROM public.recruiter_billing_profiles b
  WHERE b.recruiter_id = _recruiter_id
    AND b.user_id = _owner_id
    AND b.plan IN ('starter','growth','fleet')
    AND b.status IN ('active','trialing')
  ORDER BY CASE b.plan WHEN 'fleet' THEN 3 WHEN 'growth' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END DESC
  LIMIT 1;
  RETURN CASE _plan WHEN 'starter' THEN 2 WHEN 'growth' THEN 5 WHEN 'fleet' THEN 15 ELSE 1 END;
END;
$function$;