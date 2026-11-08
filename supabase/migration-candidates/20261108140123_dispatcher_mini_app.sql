-- CANDIDATE ONLY. Never applied by this bundle. Existing canonical functions,
-- tables, RLS, scheduled dates and financial triggers are left untouched.
BEGIN;

CREATE FUNCTION public.dispatch_mini_assert_scope(_recruiter_id uuid, _relationship_id uuid DEFAULT NULL, _permission public.recruiter_workspace_permission DEFAULT 'loads_view')
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE _uid uuid := auth.uid(); _driver uuid;
BEGIN
 IF _uid IS NULL OR _permission NOT IN ('loads_view','loads_dispatch','loads_update_status') THEN RAISE EXCEPTION 'dispatch_not_authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.recruiter_profiles WHERE id=_recruiter_id AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'dispatch_not_authorized' USING ERRCODE='42501'; END IF;
 -- A suspended/revoked personal capability is not replaced by team membership.
 IF EXISTS(SELECT 1 FROM public.user_capabilities WHERE user_id=_uid AND capability='recruiter' AND status<>'active') THEN RAISE EXCEPTION 'dispatch_not_authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.recruiter_members WHERE recruiter_id=_recruiter_id AND member_user_id=_uid FOR SHARE;
 IF NOT public.current_user_has_recruiter_permission(_recruiter_id,'loads_view') OR NOT public.current_user_has_recruiter_permission(_recruiter_id,_permission) THEN RAISE EXCEPTION 'dispatch_not_authorized' USING ERRCODE='42501'; END IF;
 IF _relationship_id IS NOT NULL THEN
  SELECT driver_user_id INTO _driver FROM public.carrier_driver_relationships WHERE id=_relationship_id AND recruiter_id=_recruiter_id AND status='active' FOR SHARE;
  IF NOT FOUND OR NOT public.current_user_can_dispatch_load_action(_recruiter_id,_relationship_id,_driver,_permission) THEN RAISE EXCEPTION 'dispatch_not_authorized' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN _driver;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_mini_assert_scope(uuid,uuid,public.recruiter_workspace_permission) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dispatch_mini_assert_scope(uuid,uuid,public.recruiter_workspace_permission) TO authenticated;

CREATE FUNCTION public.dispatch_mini_read(_recruiter_id uuid, _relationship_id uuid DEFAULT NULL, _bucket text DEFAULT 'active', _status text DEFAULT NULL, _offset integer DEFAULT 0, _limit integer DEFAULT 25, _as_of date DEFAULT CURRENT_DATE, _driver_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE _week_day text; _week date; _result jsonb;
BEGIN
 PERFORM public.dispatch_mini_assert_scope(_recruiter_id,_relationship_id,'loads_view');
 IF _bucket IS NULL OR _bucket NOT IN ('active','history') OR _offset IS NULL OR _offset<0 OR _driver_offset IS NULL OR _driver_offset<0 OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 OR _as_of IS NULL OR (_status IS NOT NULL AND _status NOT IN ('pending','en_route','completed','cancelled')) THEN RAISE EXCEPTION 'dispatch_invalid_filter'; END IF;
 SELECT dispatch_week_start_day INTO _week_day FROM public.recruiter_profiles WHERE id=_recruiter_id;
 _week := _as_of - ((extract(dow FROM _as_of)::int - array_position(ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'],_week_day)+1+7)%7);
 IF _week IS NULL THEN RAISE EXCEPTION 'dispatch_invalid_week_start_day'; END IF;
 WITH roster AS (
  SELECT r.id relationship_id,r.driver_user_id,coalesce(nullif(p.display_name,''),'Connected driver') display_name
  FROM public.carrier_driver_relationships r LEFT JOIN public.profiles p ON p.user_id=r.driver_user_id
  WHERE r.recruiter_id=_recruiter_id AND r.status='active'
   AND public.current_user_can_dispatch_load_action(_recruiter_id,r.id,r.driver_user_id,'loads_view')
 ), roster_page AS (SELECT * FROM roster ORDER BY display_name,relationship_id LIMIT 50 OFFSET _driver_offset),
 scoped AS (
  SELECT l.id,r.relationship_id,r.display_name,l.load_reference,l.pickup_location,l.dropoff_location,l.load_date,l.dropoff_date,l.status,l.loaded_miles,l.deadhead_miles,l.total_miles,l.estimated_pay,
   (SELECT (e.metadata->>'actual_delivery_date')::date FROM public.load_events e WHERE e.load_id=l.id AND e.driver_user_id=l.user_id AND e.recruiter_id=_recruiter_id AND e.carrier_driver_relationship_id=r.relationship_id AND e.event_type='updated' AND e.source_channel='web' AND e.metadata->>'dispatch_mini_version'='1' AND e.metadata->>'action'='update_status' AND e.to_status='completed' AND e.metadata->>'actual_delivery_date' ~ '^\d{4}-\d{2}-\d{2}$' ORDER BY e.created_at DESC,e.id DESC LIMIT 1) actual_delivery_date,
   -- Same symmetric two-mile rule as the shared client mileage helper; do not repair rows.
   CASE WHEN coalesce(l.loaded_miles,0)+coalesce(l.deadhead_miles,0)>0 AND (coalesce(l.total_miles,0)<=0 OR abs(l.total_miles-(coalesce(l.loaded_miles,0)+coalesce(l.deadhead_miles,0)))>2) THEN coalesce(l.loaded_miles,0)+coalesce(l.deadhead_miles,0) ELSE coalesce(l.total_miles,coalesce(l.loaded_miles,0)+coalesce(l.deadhead_miles,0)) END miles
  FROM public.loads l JOIN roster r ON r.relationship_id=l.carrier_driver_relationship_id AND r.driver_user_id=l.user_id
  WHERE _relationship_id IS NULL OR r.relationship_id=_relationship_id
 ), filtered AS (
  SELECT * FROM scoped WHERE ((_bucket='active' AND status IN ('pending','en_route')) OR (_bucket='history' AND status IN ('completed','cancelled'))) AND (_status IS NULL OR status=_status)
 ), page AS (SELECT * FROM filtered ORDER BY load_date DESC,id DESC LIMIT _limit OFFSET _offset), summaries AS (
  SELECT r.relationship_id,r.display_name,
   count(s.id) FILTER(WHERE s.status='completed' AND s.actual_delivery_date=_as_of) daily_count,
   coalesce(sum(s.miles) FILTER(WHERE s.status='completed' AND s.actual_delivery_date=_as_of),0) daily_miles,
   count(s.id) FILTER(WHERE s.status='completed' AND s.actual_delivery_date BETWEEN _week AND _week+6) weekly_count,
   coalesce(sum(s.miles) FILTER(WHERE s.status='completed' AND s.actual_delivery_date BETWEEN _week AND _week+6),0) weekly_miles,
   count(s.id) FILTER(WHERE s.status='completed') completed_count,
   coalesce(sum(s.miles) FILTER(WHERE s.status='completed'),0) completed_miles,
   count(s.id) FILTER(WHERE s.status='completed' AND s.actual_delivery_date IS NULL) unconfirmed_count,
   coalesce(sum(s.miles) FILTER(WHERE s.status='completed' AND s.actual_delivery_date IS NULL),0) unconfirmed_miles,
   count(s.id) FILTER(WHERE s.status IN ('pending','en_route')) active_count,
   coalesce(sum(s.miles) FILTER(WHERE s.status IN ('pending','en_route')),0) active_miles,
   count(s.id) FILTER(WHERE s.status='cancelled') cancelled_count,
   coalesce(sum(s.miles) FILTER(WHERE s.status='cancelled'),0) cancelled_miles
  FROM roster r LEFT JOIN scoped s ON s.relationship_id=r.relationship_id
  WHERE (_relationship_id IS NOT NULL AND r.relationship_id=_relationship_id) OR (_relationship_id IS NULL AND r.relationship_id IN (SELECT relationship_id FROM roster_page))
  GROUP BY r.relationship_id,r.display_name
 ) SELECT jsonb_build_object('loads',coalesce((SELECT jsonb_agg(to_jsonb(page)-'miles') FROM page),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'drivers',coalesce((SELECT jsonb_agg(to_jsonb(roster_page)-'driver_user_id') FROM roster_page),'[]'::jsonb),'driver_total',(SELECT count(*) FROM roster),'summaries',coalesce((SELECT jsonb_agg(to_jsonb(summaries)) FROM summaries),'[]'::jsonb),'week_start',_week) INTO _result;
 RETURN _result;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_mini_read(uuid,uuid,text,text,integer,integer,date,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dispatch_mini_read(uuid,uuid,text,text,integer,integer,date,integer) TO authenticated;

CREATE FUNCTION public.dispatch_mini_create(_recruiter_id uuid, _relationship_id uuid, _idempotency_key uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE _driver uuid; _uid uuid:=auth.uid(); _key text:='mini:'||_idempotency_key::text; _receipt public.dispatch_command_receipts%ROWTYPE; _row public.loads%ROWTYPE; _prior jsonb;
BEGIN
 _driver:=public.dispatch_mini_assert_scope(_recruiter_id,_relationship_id,'loads_dispatch');
 IF _driver IS NULL OR _idempotency_key IS NULL OR _payload IS NULL OR jsonb_typeof(_payload)<>'object' OR _payload->>'relationship_id' IS DISTINCT FROM _relationship_id::text THEN RAISE EXCEPTION 'dispatch_invalid_payload'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE k NOT IN ('relationship_id','load_reference','pickup_location','dropoff_location','load_date','dropoff_date','loaded_miles','deadhead_miles','total_miles','pay_model','rate_per_mile','deadhead_rate_per_mile','flat_rate_amount','manual_amount','wait_fee','detention_fee','other_fees','estimated_pay','notes')) THEN RAISE EXCEPTION 'dispatch_invalid_payload'; END IF;
 IF coalesce(_payload->>'load_reference','') !~ '^[A-Z0-9][A-Z0-9_-]{3,23}$' OR _payload->>'load_reference' !~ '[0-9]' THEN RAISE EXCEPTION 'dispatch_invalid_load_reference'; END IF;
 IF coalesce((_payload->>'loaded_miles')::numeric,0)+coalesce((_payload->>'deadhead_miles')::numeric,0)>0 AND _payload->>'total_miles' IS NOT NULL AND abs((_payload->>'total_miles')::numeric-(coalesce((_payload->>'loaded_miles')::numeric,0)+coalesce((_payload->>'deadhead_miles')::numeric,0)))>2 THEN RAISE EXCEPTION 'dispatch_mileage_conflict'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_recruiter_id::text||':'||_key,0));
 SELECT * INTO _receipt FROM public.dispatch_command_receipts WHERE recruiter_id=_recruiter_id AND idempotency_key=_key FOR UPDATE;
 IF FOUND THEN
  SELECT metadata->'payload' INTO _prior FROM public.load_events WHERE load_id=_receipt.load_id AND actor_user_id=_uid AND metadata->>'intent_key'=_key AND metadata->>'dispatch_mini_version'='1' AND metadata->>'action'='create_load';
  IF _receipt.actor_user_id IS DISTINCT FROM _uid OR _receipt.action<>'create_load' OR _receipt.carrier_driver_relationship_id<>_relationship_id OR _receipt.driver_user_id<>_driver OR _receipt.source_channel<>'web' OR _prior IS DISTINCT FROM _payload THEN RAISE EXCEPTION 'dispatch_idempotency_conflict'; END IF;
  RETURN jsonb_build_object('id',_receipt.load_id,'status','pending','replayed',true);
 END IF;
 _row:=public.dispatch_create_driver_load(_recruiter_id,_relationship_id,_driver,_key,'web',(_payload->>'load_date')::date,_payload->>'pickup_location',_payload->>'dropoff_location',_payload->>'load_reference',(_payload->>'dropoff_date')::date,(_payload->>'loaded_miles')::numeric,(_payload->>'deadhead_miles')::numeric,(_payload->>'total_miles')::numeric,(_payload->>'rate_per_mile')::numeric,_payload->>'pay_model',CASE WHEN _payload->>'pay_model'='manual' THEN (_payload->>'manual_amount')::numeric ELSE (_payload->>'flat_rate_amount')::numeric END,(_payload->>'deadhead_rate_per_mile')::numeric,(_payload->>'wait_fee')::numeric,(_payload->>'detention_fee')::numeric,(_payload->>'other_fees')::numeric,(_payload->>'estimated_pay')::numeric,_payload->>'notes');
 INSERT INTO public.load_events(load_id,driver_user_id,recruiter_id,carrier_driver_relationship_id,actor_user_id,event_type,source_channel,to_status,metadata) VALUES(_row.id,_driver,_recruiter_id,_relationship_id,_uid,'updated','web','pending',jsonb_build_object('dispatch_mini_version','1','action','create_load','intent_key',_key,'payload',_payload));
 RETURN jsonb_build_object('id',_row.id,'status',_row.status,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.dispatch_mini_create(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dispatch_mini_create(uuid,uuid,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.dispatch_mini_status(_recruiter_id uuid, _relationship_id uuid, _load_id uuid, _expected_status text, _new_status text, _actual_delivery_date date, _local_today date, _idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE _driver uuid; _uid uuid:=auth.uid(); _key text:='mini:'||_idempotency_key::text; _row public.loads%ROWTYPE; _receipt public.dispatch_command_receipts%ROWTYPE; _prior jsonb; _payload jsonb;
BEGIN
 _driver:=public.dispatch_mini_assert_scope(_recruiter_id,_relationship_id,'loads_update_status');
 IF _driver IS NULL OR _idempotency_key IS NULL OR _new_status IS NULL OR _new_status NOT IN ('completed','cancelled') OR _expected_status IS NULL OR _expected_status NOT IN ('pending','en_route') THEN RAISE EXCEPTION 'dispatch_invalid_status'; END IF;
 _payload:=jsonb_build_object('load_id',_load_id,'relationship_id',_relationship_id,'expected_status',_expected_status,'new_status',_new_status,'actual_delivery_date',_actual_delivery_date);
 -- Same lock order for all wrapper intents, then exact load row lock.
 PERFORM pg_advisory_xact_lock(hashtextextended(_recruiter_id::text||':'||_key,0));
 SELECT * INTO _row FROM public.loads WHERE id=_load_id AND user_id=_driver AND carrier_driver_relationship_id=_relationship_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'dispatch_load_not_found'; END IF;
 SELECT * INTO _receipt FROM public.dispatch_command_receipts WHERE recruiter_id=_recruiter_id AND idempotency_key=_key FOR UPDATE;
 IF FOUND THEN
  SELECT metadata->'payload' INTO _prior FROM public.load_events WHERE load_id=_load_id AND actor_user_id=_uid AND metadata->>'intent_key'=_key AND metadata->>'dispatch_mini_version'='1' AND metadata->>'action'='update_status';
  IF _receipt.actor_user_id IS DISTINCT FROM _uid OR _receipt.action<>'update_status' OR _receipt.load_id IS DISTINCT FROM _load_id OR _receipt.carrier_driver_relationship_id<>_relationship_id OR _receipt.driver_user_id<>_driver OR _receipt.source_channel<>'web' OR _receipt.requested_status IS DISTINCT FROM _new_status OR _prior IS DISTINCT FROM _payload THEN RAISE EXCEPTION 'dispatch_idempotency_conflict'; END IF;
  RETURN jsonb_build_object('id',_row.id,'status',_row.status,'replayed',true);
 END IF;
 IF _row.status IS DISTINCT FROM _expected_status THEN RAISE EXCEPTION 'dispatch_stale_status'; END IF;
 -- Local day may differ from UTC by one day, never accept arbitrary future clocks.
 IF _local_today IS NULL OR _local_today NOT BETWEEN (clock_timestamp() AT TIME ZONE 'UTC')::date-1 AND (clock_timestamp() AT TIME ZONE 'UTC')::date+1 THEN RAISE EXCEPTION 'dispatch_invalid_local_date'; END IF;
 IF (_new_status='completed' AND (_actual_delivery_date IS NULL OR _actual_delivery_date<_row.load_date OR _actual_delivery_date>_local_today)) OR (_new_status='cancelled' AND _actual_delivery_date IS NOT NULL) THEN RAISE EXCEPTION 'dispatch_invalid_delivery_date'; END IF;
 _row:=public.dispatch_update_driver_load_status(_recruiter_id,_relationship_id,_driver,_load_id,_new_status,_key,'web');
 INSERT INTO public.load_events(load_id,driver_user_id,recruiter_id,carrier_driver_relationship_id,actor_user_id,event_type,source_channel,from_status,to_status,metadata) VALUES(_row.id,_driver,_recruiter_id,_relationship_id,_uid,'updated','web',_expected_status,_new_status,jsonb_build_object('dispatch_mini_version','1','action','update_status','intent_key',_key,'payload',_payload,'actual_delivery_date',_actual_delivery_date));
 RETURN jsonb_build_object('id',_row.id,'status',_row.status,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.dispatch_mini_status(uuid,uuid,uuid,text,text,date,date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dispatch_mini_status(uuid,uuid,uuid,text,text,date,date,uuid) TO authenticated;
COMMIT;