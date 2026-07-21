-- Phase 1K-D: repair the single historical admin-recruiter opportunity
-- left unpublished by the pre-Phase-1K-C guard defect.
--
-- This migration is intentionally fail-closed and targets exactly one known row.
-- It does not fabricate the original publication time: published_at records the
-- actual repair/publication transaction time.
--
-- Expected automatic side effect: the existing review notification trigger
-- creates exactly one truthful "Opportunity approved" notification.
DO $phase1k_d$
DECLARE
  _target_id constant uuid := '28d75a1e-0d49-445a-82c8-01ba56432a93';
  _expected_recruiter_id constant uuid := 'f6b00b66-cd1c-4037-a382-8b1b9c629f3b';
  _expected_owner_user_id constant uuid := 'df860876-4c44-4f93-b31c-72ca9dbd9f3d';
  _expected_title constant text := 'Looking for OTR company drivers';
  _repair_ts timestamptz := transaction_timestamp();

  _before public.opportunities%ROWTYPE;
  _after public.opportunities%ROWTYPE;
  _guard_def text;
  _guard_security_definer boolean;
  _guard_config text[];
  _count integer;
  _row_count integer;
  _applications_before integer;
  _offers_before integer;
  _notifications_before integer;
BEGIN
  SELECT count(*)
    INTO _count
    FROM supabase_migrations.schema_migrations sm
   WHERE sm.version = '20260721000000'
     AND sm.name = '20260721000000_phase1k_admin_recruiter_opportunity_publication';

  IF _count <> 1 THEN
    RAISE EXCEPTION 'Phase 1K-D requires exactly one Phase 1K-C migration record; found %', _count;
  END IF;

  SELECT pg_get_functiondef(p.oid), p.prosecdef, p.proconfig
    INTO _guard_def, _guard_security_definer, _guard_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'opportunities_guard'
     AND pg_get_function_identity_arguments(p.oid) = '';

  IF _guard_def IS NULL
     OR _guard_security_definer IS NOT TRUE
     OR NOT (_guard_config @> ARRAY['search_path=public']::text[])
     OR position('_owns_recruiter_profile' IN _guard_def) = 0
     OR position('IF public.is_admin(auth.uid()) THEN' IN _guard_def) > 0
  THEN
    RAISE EXCEPTION 'Phase 1K-D requires the verified Phase 1K-C opportunities_guard';
  END IF;

  SELECT count(*)
    INTO _count
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.opportunities'::regclass
     AND NOT t.tgisinternal
     AND t.tgenabled = 'O'
     AND p.proname = 'opportunities_guard';

  IF _count <> 1 THEN
    RAISE EXCEPTION 'Phase 1K-D requires exactly one enabled opportunities_guard trigger; found %', _count;
  END IF;

  SELECT *
    INTO _before
    FROM public.opportunities o
   WHERE o.id = _target_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 1K-D target opportunity is missing';
  END IF;

  IF _before.recruiter_id IS DISTINCT FROM _expected_recruiter_id
     OR _before.title IS DISTINCT FROM _expected_title
     OR _before.status IS DISTINCT FROM 'active'
     OR _before.admin_review_status IS DISTINCT FROM 'pending'
     OR _before.published_at IS NOT NULL
     OR _before.featured IS DISTINCT FROM true
     OR _before.view_count IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION 'Phase 1K-D target opportunity state drifted';
  END IF;

  SELECT count(*)
    INTO _count
    FROM public.recruiter_profiles rp
   WHERE rp.id = _expected_recruiter_id
     AND rp.user_id = _expected_owner_user_id
     AND public.is_admin(rp.user_id)
     AND public.recruiter_profile_can_manage_opportunities(rp.id);

  IF _count <> 1 THEN
    RAISE EXCEPTION 'Phase 1K-D expected admin-owned eligible recruiter is not valid';
  END IF;

  SELECT count(*)
    INTO _count
    FROM public.opportunities o
    JOIN public.recruiter_profiles rp ON rp.id = o.recruiter_id
   WHERE o.status = 'active'
     AND o.admin_review_status = 'pending'
     AND o.published_at IS NULL
     AND public.is_admin(rp.user_id)
     AND public.recruiter_profile_can_manage_opportunities(rp.id);

  IF _count <> 1 THEN
    RAISE EXCEPTION 'Phase 1K-D requires exactly one affected opportunity; found %', _count;
  END IF;

  SELECT count(*)
    INTO _count
    FROM public.opportunities o
    JOIN public.recruiter_profiles rp ON rp.id = o.recruiter_id
   WHERE o.id = _target_id
     AND o.status = 'active'
     AND o.admin_review_status = 'pending'
     AND o.published_at IS NULL
     AND public.is_admin(rp.user_id)
     AND public.recruiter_profile_can_manage_opportunities(rp.id);

  IF _count <> 1 THEN
    RAISE EXCEPTION 'Phase 1K-D target is not the sole affected opportunity';
  END IF;

  SELECT count(*) INTO _applications_before
    FROM public.opportunity_applications oa
   WHERE oa.opportunity_id = _target_id;

  SELECT count(*) INTO _offers_before
    FROM public.opportunity_offers oo
   WHERE oo.opportunity_id = _target_id;

  SELECT count(*) INTO _notifications_before
    FROM public.notifications n
   WHERE n.user_id = _expected_owner_user_id
     AND n.type = 'opportunity_reviewed'
     AND n.payload ->> 'opportunity_id' = _target_id::text;

  IF _applications_before <> 0
     OR _offers_before <> 0
     OR _notifications_before <> 0
  THEN
    RAISE EXCEPTION
      'Phase 1K-D related-row inventory drifted (applications %, offers %, notifications %)',
      _applications_before, _offers_before, _notifications_before;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.notification_preferences np
     WHERE np.user_id = _expected_owner_user_id
  ) THEN
    RAISE EXCEPTION 'Phase 1K-D notification preference precondition drifted';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', _expected_owner_user_id::text, true);

  UPDATE public.opportunities
     SET admin_review_status = 'approved',
         published_at = _repair_ts
   WHERE id = _target_id
     AND recruiter_id = _expected_recruiter_id
     AND status = 'active'
     AND admin_review_status = 'pending'
     AND published_at IS NULL
     AND featured = true
     AND view_count = 0;

  GET DIAGNOSTICS _row_count = ROW_COUNT;

  IF _row_count <> 1 THEN
    RAISE EXCEPTION 'Phase 1K-D repaired % rows instead of exactly one', _row_count;
  END IF;

  SELECT *
    INTO STRICT _after
    FROM public.opportunities o
   WHERE o.id = _target_id;

  IF _after.recruiter_id IS DISTINCT FROM _expected_recruiter_id
     OR _after.title IS DISTINCT FROM _expected_title
     OR _after.status IS DISTINCT FROM 'active'
     OR _after.admin_review_status IS DISTINCT FROM 'approved'
     OR _after.published_at IS DISTINCT FROM _repair_ts
     OR _after.updated_at <= _before.updated_at
  THEN
    RAISE EXCEPTION 'Phase 1K-D repaired row failed required postconditions';
  END IF;

  IF (to_jsonb(_after) - ARRAY['admin_review_status', 'published_at', 'updated_at']::text[])
       IS DISTINCT FROM
     (to_jsonb(_before) - ARRAY['admin_review_status', 'published_at', 'updated_at']::text[])
  THEN
    RAISE EXCEPTION 'Phase 1K-D changed non-authorized opportunity columns';
  END IF;

  SELECT count(*) INTO _count
    FROM public.opportunity_applications oa
   WHERE oa.opportunity_id = _target_id;

  IF _count <> _applications_before THEN
    RAISE EXCEPTION 'Phase 1K-D changed opportunity applications';
  END IF;

  SELECT count(*) INTO _count
    FROM public.opportunity_offers oo
   WHERE oo.opportunity_id = _target_id;

  IF _count <> _offers_before THEN
    RAISE EXCEPTION 'Phase 1K-D changed opportunity offers';
  END IF;

  SELECT count(*) INTO _count
    FROM public.notifications n
   WHERE n.user_id = _expected_owner_user_id
     AND n.type = 'opportunity_reviewed'
     AND n.title = 'Opportunity approved'
     AND n.body = 'Your opportunity "' || _expected_title || '" was approved.'
     AND n.payload ->> 'opportunity_id' = _target_id::text
     AND n.payload ->> 'admin_review_status' = 'approved';

  IF _count <> _notifications_before + 1 THEN
    RAISE EXCEPTION 'Phase 1K-D expected exactly one approval notification; found %', _count;
  END IF;

  SELECT count(*)
    INTO _count
    FROM public.opportunities o
    JOIN public.recruiter_profiles rp ON rp.id = o.recruiter_id
   WHERE o.status = 'active'
     AND o.admin_review_status = 'pending'
     AND o.published_at IS NULL
     AND public.is_admin(rp.user_id)
     AND public.recruiter_profile_can_manage_opportunities(rp.id);

  IF _count <> 0 THEN
    RAISE EXCEPTION 'Phase 1K-D affected opportunity inventory did not reach zero';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$phase1k_d$;
