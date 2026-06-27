
CREATE TEMP TABLE _phase3c_results (test text, expected text, actual text, pass boolean);

DO $$
DECLARE
  _opp uuid; _rec uuid;
  _referrer uuid := gen_random_uuid();
  _ref2 uuid := gen_random_uuid();
  _ap1 uuid := gen_random_uuid();
  _ap2 uuid := gen_random_uuid();
  _ap3 uuid := gen_random_uuid();
  _ap4 uuid := gen_random_uuid();
  _ref_linked uuid; _ref_email uuid;
  _ref_dup1 uuid; _ref_dup2 uuid; _ref_bonus uuid;
  _app1 uuid; _app4 uuid;
  _status text; _has_user boolean; _events int;
BEGIN
  SELECT id, recruiter_id INTO _opp, _rec FROM public.opportunities
    WHERE admin_review_status='approved' AND status='active' LIMIT 1;
  IF _opp IS NULL THEN
    SELECT id, recruiter_id INTO _opp, _rec FROM public.opportunities LIMIT 1;
  END IF;

  INSERT INTO auth.users (id,email,instance_id,aud,role) VALUES
    (_referrer,'p3c-referrer@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (_ref2,'p3c-ref2@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (_ap1,'p3c-ap1@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (_ap2,'p3c-ap2@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (_ap3,'p3c-ap3@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (_ap4,'p3c-ap4@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  INSERT INTO public.admin_users (user_id,email,role) VALUES
    (_referrer,'p3c-referrer@test.local','admin'),
    (_ref2,'p3c-ref2@test.local','admin') ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claim.sub', _referrer::text, true);

  -- A
  INSERT INTO public.driver_referrals(opportunity_id,recruiter_id,referring_driver_id,referred_driver_user_id,referred_driver_name,status)
  VALUES (_opp,_rec,_referrer,_ap1,'A One','referral_sent') RETURNING id INTO _ref_linked;
  INSERT INTO public.opportunity_applications(opportunity_id,recruiter_id,driver_user_id,application_type,status)
  VALUES (_opp,_rec,_ap1,'apply','new') RETURNING id INTO _app1;
  SELECT status INTO _status FROM public.driver_referrals WHERE id=_ref_linked;
  INSERT INTO _phase3c_results VALUES ('A linked referral advances','application_started',_status,_status='application_started');
  SELECT count(*) INTO _events FROM public.referral_status_events WHERE referral_id=_ref_linked;
  INSERT INTO _phase3c_results VALUES ('A events written (>=2)','>=2',_events::text,_events>=2);

  -- B email-only
  INSERT INTO public.driver_referrals(opportunity_id,recruiter_id,referring_driver_id,referred_driver_email,status)
  VALUES (_opp,_rec,_referrer,'p3c-ap2@test.local','referral_sent') RETURNING id INTO _ref_email;
  INSERT INTO public.opportunity_applications(opportunity_id,recruiter_id,driver_user_id,application_type,status)
  VALUES (_opp,_rec,_ap2,'apply','new');
  SELECT status, referred_driver_user_id IS NOT NULL INTO _status,_has_user FROM public.driver_referrals WHERE id=_ref_email;
  INSERT INTO _phase3c_results VALUES ('B email-only advances','application_started',_status,_status='application_started');
  INSERT INTO _phase3c_results VALUES ('B email-only safe-links user','true',_has_user::text,_has_user);

  -- C dup referrers
  INSERT INTO public.driver_referrals(opportunity_id,recruiter_id,referring_driver_id,referred_driver_user_id,status,created_at)
  VALUES (_opp,_rec,_referrer,_ap3,'referral_sent',now()-interval '2 days') RETURNING id INTO _ref_dup1;
  INSERT INTO public.driver_referrals(opportunity_id,recruiter_id,referring_driver_id,referred_driver_user_id,status,created_at)
  VALUES (_opp,_rec,_ref2,_ap3,'referral_sent',now()-interval '1 day') RETURNING id INTO _ref_dup2;
  INSERT INTO public.opportunity_applications(opportunity_id,recruiter_id,driver_user_id,application_type,status)
  VALUES (_opp,_rec,_ap3,'apply','new');
  INSERT INTO _phase3c_results VALUES ('C earliest credited','application_started',
    (SELECT status FROM public.driver_referrals WHERE id=_ref_dup1),
    (SELECT status FROM public.driver_referrals WHERE id=_ref_dup1)='application_started');
  INSERT INTO _phase3c_results VALUES ('C later NOT credited','referral_sent',
    (SELECT status FROM public.driver_referrals WHERE id=_ref_dup2),
    (SELECT status FROM public.driver_referrals WHERE id=_ref_dup2)='referral_sent');

  -- D bonus protection (fresh user ap4)
  INSERT INTO public.driver_referrals(opportunity_id,recruiter_id,referring_driver_id,referred_driver_user_id,status)
  VALUES (_opp,_rec,_referrer,_ap4,'eligible_for_bonus') RETURNING id INTO _ref_bonus;
  INSERT INTO public.opportunity_applications(opportunity_id,recruiter_id,driver_user_id,application_type,status)
  VALUES (_opp,_rec,_ap4,'apply','new') RETURNING id INTO _app4;
  -- application insert just fired bridge with 'application_started' -> must NOT downgrade eligible_for_bonus
  INSERT INTO _phase3c_results VALUES ('D bonus protected on INSERT bridge','eligible_for_bonus',
    (SELECT status FROM public.driver_referrals WHERE id=_ref_bonus),
    (SELECT status FROM public.driver_referrals WHERE id=_ref_bonus)='eligible_for_bonus');
  -- Now reject the application -> must still NOT downgrade to closed_not_hired
  UPDATE public.opportunity_applications SET status='rejected' WHERE id=_app4;
  INSERT INTO _phase3c_results VALUES ('D bonus protected on rejection','eligible_for_bonus',
    (SELECT status FROM public.driver_referrals WHERE id=_ref_bonus),
    (SELECT status FROM public.driver_referrals WHERE id=_ref_bonus)='eligible_for_bonus');
  -- And the original linked referral can close on its application rejection
  UPDATE public.opportunity_applications SET status='rejected' WHERE id=_app1;
  INSERT INTO _phase3c_results VALUES ('D non-protected closes on reject','closed_not_hired',
    (SELECT status FROM public.driver_referrals WHERE id=_ref_linked),
    (SELECT status FROM public.driver_referrals WHERE id=_ref_linked)='closed_not_hired');

  -- cleanup
  DELETE FROM public.opportunity_applications WHERE driver_user_id IN (_ap1,_ap2,_ap3,_ap4);
  DELETE FROM public.driver_referrals WHERE referring_driver_id IN (_referrer,_ref2);
  DELETE FROM public.admin_users WHERE user_id IN (_referrer,_ref2);
  DELETE FROM auth.users WHERE id IN (_referrer,_ref2,_ap1,_ap2,_ap3,_ap4);
END $$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM _phase3c_results LOOP
    RAISE NOTICE '[%] % | expected=% | actual=%',
      CASE WHEN r.pass THEN 'PASS' ELSE 'FAIL' END, r.test, r.expected, r.actual;
  END LOOP;
END $$;
