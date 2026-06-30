
CREATE OR REPLACE FUNCTION public.assert_agency_limit(_agency_id uuid, _action text)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE lim record; used integer; plan_label text;
BEGIN
  SELECT * INTO lim FROM public.get_effective_agency_limits(_agency_id);
  plan_label := public._agency_plan_label(lim.plan_key);

  -- Phase 8B: hard block when billing is cancelled. Cancelled agencies can
  -- still browse, manage billing, and revoke -- but cannot create new active
  -- service packages, send new member invites, or activate new clients.
  IF lim.status = 'cancelled' THEN
    RAISE EXCEPTION
      'Agency billing is cancelled. Restart your % plan from the Plan & Limits card to continue this action.',
      plan_label USING ERRCODE = 'P0001';
  END IF;

  IF _action = 'create_service_package' THEN
    IF lim.service_package_limit IS NULL THEN RETURN; END IF;
    SELECT count(*) INTO used FROM public.agency_service_packages
      WHERE agency_id = _agency_id AND is_active = true;
    IF used >= lim.service_package_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % active service packages. Upgrade your agency plan to add more.',
        plan_label, lim.service_package_limit USING ERRCODE = 'P0001';
    END IF;

  ELSIF _action = 'invite_member' THEN
    IF lim.member_limit IS NULL THEN RETURN; END IF;
    SELECT count(*) INTO used FROM public.agency_members
      WHERE agency_id = _agency_id AND status IN ('pending','active');
    IF used >= lim.member_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % agency members. Upgrade your agency plan to invite more.',
        plan_label, lim.member_limit USING ERRCODE = 'P0001';
    END IF;

  ELSIF _action = 'activate_client' THEN
    IF lim.active_client_limit IS NULL THEN RETURN; END IF;
    SELECT count(DISTINCT d.driver_user_id) INTO used FROM public.agency_delegation_requests d
      WHERE d.agency_id = _agency_id AND d.status = 'approved';
    IF used >= lim.active_client_limit THEN
      RAISE EXCEPTION 'Your % plan allows up to % active driver clients. Upgrade your agency plan to take on more.',
        plan_label, lim.active_client_limit USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown agency limit action: %', _action USING ERRCODE = '22023';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.assert_agency_limit(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_agency_limit(uuid, text) FROM anon, authenticated;

COMMENT ON FUNCTION public.assert_agency_limit(uuid, text) IS
  'Phase 8B: internal helper. Blocks billable mutations when entitlement status is cancelled; otherwise enforces plan limits. Callable only from SECURITY DEFINER RPCs.';
