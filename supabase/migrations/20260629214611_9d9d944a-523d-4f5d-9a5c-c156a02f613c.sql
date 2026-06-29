CREATE OR REPLACE FUNCTION public.driver_respond_to_work_item(_id uuid, _response text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _uid uuid := auth.uid();
  _w public.agency_work_items%ROWTYPE;
  _owner uuid;
  _title text;
  _body text;
  _payload jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  IF _response IS NULL OR length(trim(_response)) < 1 THEN
    RAISE EXCEPTION 'Response required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO _w FROM public.agency_work_items WHERE id = _id;
  IF NOT FOUND OR _w.driver_user_id <> _uid THEN
    RAISE EXCEPTION 'Work item not found' USING ERRCODE='42501';
  END IF;
  IF _w.status <> 'waiting_on_driver' THEN
    RAISE EXCEPTION 'Work item is not waiting on driver' USING ERRCODE='22023';
  END IF;

  UPDATE public.agency_work_items
     SET status = 'in_progress',
         last_driver_response = _response,
         last_driver_response_at = now(),
         updated_at = now()
   WHERE id = _id;

  SELECT owner_user_id INTO _owner FROM public.agency_profiles WHERE id = _w.agency_id;

  _title := 'Driver responded to a work item';
  _body  := 'The driver replied to: ' || COALESCE(_w.title, 'a work item');
  _payload := jsonb_build_object(
    'agency_id', _w.agency_id,
    'work_item_id', _id,
    'driver_user_id', _w.driver_user_id,
    'title', _w.title
  );

  IF _owner IS NOT NULL THEN
    PERFORM public.create_notification(
      _owner,
      'agency_work_item_driver_responded',
      _title,
      _body,
      _payload
    );
  END IF;

  IF _w.assigned_member_user_id IS NOT NULL
     AND _w.assigned_member_user_id <> COALESCE(_owner, _uid) THEN
    PERFORM public.create_notification(
      _w.assigned_member_user_id,
      'agency_work_item_driver_responded',
      _title,
      _body,
      _payload
    );
  END IF;

  BEGIN
    INSERT INTO public.agency_audit_log
      (agency_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (_w.agency_id, _uid, 'work_item_driver_responded', 'agency_work_item', _id,
            jsonb_build_object('title', _w.title));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.driver_respond_to_work_item(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_respond_to_work_item(uuid,text) TO authenticated;