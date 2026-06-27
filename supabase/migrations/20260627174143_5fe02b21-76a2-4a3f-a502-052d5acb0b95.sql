
DROP TABLE IF EXISTS public._phase3c_results;

DO $$
DECLARE
  _rec_user uuid := gen_random_uuid();
  _referrer uuid := gen_random_uuid();
  _driver   uuid := gen_random_uuid();
  _rec_id uuid; _opp uuid; _ref uuid; _app uuid;
  _phone text := '555-0100-PHONE-ONLY';
  _status text; _linked uuid;
BEGIN
  INSERT INTO auth.users(id, email, created_at, updated_at, instance_id, aud, role) VALUES
    (_rec_user, 'p3c_rec_'||_rec_user||'@test.local', now(), now(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (_referrer, 'p3c_ref_'||_referrer||'@test.local', now(), now(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (_driver,   'p3c_drv_'||_driver  ||'@test.local', now(), now(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  INSERT INTO public.recruiter_profiles(user_id, recruiter_name, company_name, verification_status)
    VALUES (_rec_user, 'P3C Tester', 'PhoneOnly Test Co', 'approved')
    RETURNING id INTO _rec_id;

  ALTER TABLE public.opportunities DISABLE TRIGGER trg_opportunities_billing_guard;
  ALTER TABLE public.opportunities DISABLE TRIGGER trg_opportunities_guard;
  INSERT INTO public.opportunities(recruiter_id, title, company_name, status, admin_review_status, hiring_city, hiring_state)
    VALUES (_rec_id, 'Phone-only Bridge Test', 'PhoneOnly Test Co', 'active', 'approved', 'Dallas', 'TX')
    RETURNING id INTO _opp;
  ALTER TABLE public.opportunities ENABLE TRIGGER trg_opportunities_billing_guard;
  ALTER TABLE public.opportunities ENABLE TRIGGER trg_opportunities_guard;

  ALTER TABLE public.driver_referrals DISABLE TRIGGER trg_driver_referrals_before_insert;
  INSERT INTO public.driver_referrals(opportunity_id, recruiter_id, referring_driver_id, referred_driver_phone, status)
    VALUES (_opp, _rec_id, _referrer, _phone, 'referral_sent')
    RETURNING id INTO _ref;
  ALTER TABLE public.driver_referrals ENABLE TRIGGER trg_driver_referrals_before_insert;

  INSERT INTO public.driver_opportunity_profiles(user_id, phone, email)
    VALUES (_driver, _phone, 'p3c_drv_'||_driver||'@test.local');

  INSERT INTO public.opportunity_applications(opportunity_id, driver_user_id, recruiter_id, application_type, status)
    VALUES (_opp, _driver, _rec_id, 'apply', 'new')
    RETURNING id INTO _app;

  SELECT status, referred_driver_user_id INTO _status, _linked
    FROM public.driver_referrals WHERE id = _ref;

  RAISE NOTICE 'phone-only bridge: status=% linked=% expected=application_started/%', _status, _linked, _driver;

  DELETE FROM public.opportunity_applications WHERE id = _app;
  DELETE FROM public.referral_status_events   WHERE referral_id = _ref;
  DELETE FROM public.driver_referrals         WHERE id = _ref;
  DELETE FROM public.driver_opportunity_profiles WHERE user_id = _driver;
  DELETE FROM public.opportunities            WHERE id = _opp;
  DELETE FROM public.recruiter_profiles       WHERE id = _rec_id;
  DELETE FROM auth.users WHERE id IN (_rec_user, _referrer, _driver);

  IF _status <> 'application_started' THEN
    RAISE EXCEPTION 'Phone-only bridge FAIL: status=%', _status;
  END IF;
  IF _linked IS DISTINCT FROM _driver THEN
    RAISE EXCEPTION 'Phone-only bridge FAIL: linked=% expected=%', _linked, _driver;
  END IF;

  RAISE NOTICE 'Phone-only bridge PASS';
END $$;
