
CREATE OR REPLACE FUNCTION public.accept_assistant_invite(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _hash text;
  _email text;
  _row public.driver_assistants;
  _direct_count int;
  _driver_is_pro boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _token IS NULL OR length(_token) < 16 THEN
    RAISE EXCEPTION 'Invalid token' USING ERRCODE = '22023';
  END IF;

  _hash := encode(digest(_token, 'sha256'), 'hex');
  SELECT lower(u.email) INTO _email FROM auth.users u WHERE u.id = _uid;

  SELECT * INTO _row FROM public.driver_assistants
   WHERE invite_token_hash = _hash AND status = 'pending'
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or already used' USING ERRCODE = 'P0002';
  END IF;
  IF _row.invite_email <> _email THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address' USING ERRCODE = '42501';
  END IF;
  IF _row.driver_user_id = _uid THEN
    RAISE EXCEPTION 'You cannot accept your own invitation' USING ERRCODE = '22023';
  END IF;

  -- Direct-invite-only checks: driver Pro status + slot cap. Agency-delegated
  -- rows bypass both because the driver explicitly approved that delegation.
  IF _row.agency_delegation_id IS NULL THEN
    SELECT
      public.is_admin(_row.driver_user_id)
      OR EXISTS (
        SELECT 1 FROM public.subscriptions s
         WHERE s.user_id = _row.driver_user_id
           AND s.status = 'active'
           AND s.plan_key IN ('pro_monthly','pro_yearly')
      )
    INTO _driver_is_pro;

    IF NOT _driver_is_pro THEN
      RAISE EXCEPTION 'This driver no longer has Pro. Direct assistant access requires Pro.'
        USING ERRCODE = '42501';
    END IF;

    -- Re-check the driver's direct assistant cap at activation time so old
    -- pending invites cannot push a driver past the limit.
    SELECT count(*) INTO _direct_count
      FROM public.driver_assistants
     WHERE driver_user_id = _row.driver_user_id
       AND status = 'active'
       AND agency_delegation_id IS NULL
       AND id <> _row.id;
    IF _direct_count >= 1 THEN
      RAISE EXCEPTION 'The driver already has an active direct assistant. Ask them to revoke the current one before accepting this invitation.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.driver_assistants
     SET assistant_user_id = _uid,
         status            = 'active',
         accepted_at       = now(),
         invite_token_hash = NULL,
         updated_at        = now()
   WHERE id = _row.id
  RETURNING * INTO _row;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES
    (_row.id, _row.driver_user_id, _uid, 'invite_accepted', 'driver_assistants', _row.id, '{}'::jsonb);

  RETURN jsonb_build_object(
    'id', _row.id,
    'driver_user_id', _row.driver_user_id,
    'status', _row.status
  );
END;
$$;
