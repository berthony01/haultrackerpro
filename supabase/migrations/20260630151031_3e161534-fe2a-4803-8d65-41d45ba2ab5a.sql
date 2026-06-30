
-- 1. Explicit agency delegation link on driver_assistants
ALTER TABLE public.driver_assistants
  ADD COLUMN IF NOT EXISTS agency_delegation_id uuid
    REFERENCES public.agency_delegation_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS driver_assistants_agency_delegation_id_idx
  ON public.driver_assistants(agency_delegation_id)
  WHERE agency_delegation_id IS NOT NULL;

-- Backfill: link existing driver_assistants rows to their approved delegation
-- only when the match is unambiguous (exactly one approved delegation per
-- (driver, assistant)).
WITH candidates AS (
  SELECT da.id AS da_id, d.id AS deleg_id,
         count(*) OVER (PARTITION BY da.id) AS n
    FROM public.driver_assistants da
    JOIN public.agency_delegation_requests d
      ON d.driver_user_id = da.driver_user_id
     AND d.status = 'approved'
     AND (
       (da.assistant_user_id IS NOT NULL AND d.member_user_id = da.assistant_user_id)
       OR lower(btrim(coalesce(d.member_invite_email,''))) = lower(btrim(da.invite_email))
     )
   WHERE da.agency_delegation_id IS NULL
)
UPDATE public.driver_assistants da
   SET agency_delegation_id = c.deleg_id
  FROM candidates c
 WHERE c.da_id = da.id AND c.n = 1;

-- 2. Tighten agency_profiles writes — drop broad FOR ALL policy.
DROP POLICY IF EXISTS agency_profiles_owner_all ON public.agency_profiles;

-- Owner can still SELECT (covered by existing member_select via is_agency_member)
-- and UPDATE their own profile fields. INSERT and DELETE are blocked by RLS;
-- they go through create_agency / update_my_agency (status='disabled' soft-delete).
CREATE POLICY agency_profiles_owner_update
  ON public.agency_profiles
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Belt-and-suspenders: also keep an owner SELECT in case is_agency_member helper
-- ever lags behind owner row insertion inside create_agency.
CREATE POLICY agency_profiles_owner_select
  ON public.agency_profiles
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

-- 3. Direct-assistant server-side limits + agency-aware accept_assistant_invite.
CREATE OR REPLACE FUNCTION public.invite_assistant(_email text, _permissions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _email_norm text := lower(btrim(coalesce(_email,'')));
  _token text;
  _token_hash text;
  _row public.driver_assistants;
  _existing public.driver_assistants;
  _allowed_keys text[] := ARRAY[
    'manage_loads','manage_expenses','manage_fuel',
    'view_reports','export_reports','view_dashboard',
    'manage_settings_limited'
  ];
  _clean jsonb := '{}'::jsonb;
  _k text;
  _is_pro boolean;
  _direct_max int;
  _direct_count int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT
    public.is_admin(_uid)
    OR EXISTS (
      SELECT 1 FROM public.subscriptions s
       WHERE s.user_id = _uid AND s.status = 'active'
         AND s.plan_key IN ('pro_monthly','pro_yearly')
    )
  INTO _is_pro;

  IF NOT _is_pro THEN
    RAISE EXCEPTION 'Inviting assistants requires Pro. Upgrade to invite an assistant.'
      USING ERRCODE = '42501';
  END IF;

  IF _email_norm = '' OR length(_email_norm) > 255
     OR _email_norm !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = _uid AND lower(u.email) = _email_norm
  ) THEN
    RAISE EXCEPTION 'You cannot invite yourself' USING ERRCODE = '22023';
  END IF;

  -- Allow re-issuing token for an existing pending/active row for the same email.
  SELECT * INTO _existing
    FROM public.driver_assistants
   WHERE driver_user_id = _uid
     AND lower(invite_email) = _email_norm
     AND status IN ('pending','active')
   LIMIT 1;

  -- Enforce direct-assistant slot limit (excludes agency-delegated rows).
  _direct_max := 1;  -- Pro = 1 direct slot (active+pending combined).
  SELECT count(*) INTO _direct_count
    FROM public.driver_assistants
   WHERE driver_user_id = _uid
     AND status IN ('pending','active')
     AND agency_delegation_id IS NULL
     AND (_existing.id IS NULL OR id <> _existing.id);

  IF _direct_count >= _direct_max THEN
    RAISE EXCEPTION 'Your Pro plan includes 1 direct assistant. Revoke the current assistant before inviting another.'
      USING ERRCODE = '42501';
  END IF;

  FOREACH _k IN ARRAY _allowed_keys LOOP
    IF COALESCE((_permissions ->> _k)::boolean, false) THEN
      _clean := _clean || jsonb_build_object(_k, true);
    END IF;
  END LOOP;

  _token := encode(gen_random_bytes(24), 'hex');
  _token_hash := encode(digest(_token, 'sha256'), 'hex');

  INSERT INTO public.driver_assistants
    (driver_user_id, invite_email, invite_token_hash, status, permissions)
  VALUES (_uid, _email_norm, _token_hash, 'pending', _clean)
  ON CONFLICT (driver_user_id, lower(invite_email))
    WHERE status IN ('pending','active')
  DO UPDATE SET
    permissions       = EXCLUDED.permissions,
    invite_token_hash = EXCLUDED.invite_token_hash,
    invited_at        = now(),
    updated_at        = now()
  RETURNING * INTO _row;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES
    (_row.id, _uid, _uid, 'invite_created', 'driver_assistants', _row.id,
     jsonb_build_object('invite_email', _row.invite_email, 'permissions', _clean));

  RETURN jsonb_build_object(
    'id', _row.id,
    'invite_token', _token,
    'invite_email', _row.invite_email,
    'status', _row.status
  );
END;
$$;

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

  -- Re-check the driver's direct assistant cap at activation time so old
  -- pending invites cannot push a driver past the limit.
  IF _row.agency_delegation_id IS NULL THEN
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

-- 4. Idempotent create_agency that always provisions a beta entitlement row.
CREATE OR REPLACE FUNCTION public.create_agency(
  _name text,
  _description text DEFAULT NULL,
  _contact_email text DEFAULT NULL
)
RETURNS public.agency_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.agency_profiles;
  _existing public.agency_profiles;
  _defaults jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;

  -- Idempotent: if user already owns an agency, return it.
  SELECT * INTO _existing FROM public.agency_profiles
    WHERE owner_user_id = _uid LIMIT 1;
  IF FOUND THEN
    RETURN _existing;
  END IF;

  IF _name IS NULL OR length(btrim(_name)) < 2 OR length(_name) > 120 THEN
    RAISE EXCEPTION 'Agency name must be 2–120 characters' USING ERRCODE='22023';
  END IF;
  IF _contact_email IS NOT NULL AND _contact_email <> ''
     AND lower(_contact_email) !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid contact email' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.agency_profiles(owner_user_id, name, description, contact_email)
  VALUES (_uid, btrim(_name),
          NULLIF(btrim(coalesce(_description,'')),''),
          NULLIF(lower(btrim(coalesce(_contact_email,''))),''))
  RETURNING * INTO _row;

  INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, role, status, accepted_at)
  VALUES (_row.id, _uid,
          COALESCE((SELECT lower(email) FROM auth.users WHERE id = _uid),'owner@local'),
          'agency_owner','active', now());

  _defaults := public._agency_plan_defaults('agency_starter');
  INSERT INTO public.agency_entitlements
    (agency_id, plan_key, status, source,
     active_client_limit, member_limit, service_package_limit)
  VALUES (_row.id, 'agency_starter', 'manual_beta', 'manual',
          (_defaults->>'active_client_limit')::int,
          (_defaults->>'member_limit')::int,
          (_defaults->>'service_package_limit')::int)
  ON CONFLICT (agency_id) DO NOTHING;

  RETURN _row;
END;
$$;

-- 5. get_my_agency: prioritize owned > admin > member, never random.
CREATE OR REPLACE FUNCTION public.get_my_agency()
RETURNS TABLE(
  id uuid, owner_user_id uuid, name text, description text,
  contact_email text, status public.agency_status,
  created_at timestamp with time zone, updated_at timestamp with time zone,
  my_role public.agency_member_role
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ap.id, ap.owner_user_id, ap.name, ap.description, ap.contact_email,
         ap.status, ap.created_at, ap.updated_at, am.role
    FROM public.agency_profiles ap
    JOIN public.agency_members am ON am.agency_id = ap.id
     AND am.member_user_id = auth.uid()
     AND am.status = 'active'
   WHERE auth.uid() IS NOT NULL
   ORDER BY
     CASE am.role
       WHEN 'agency_owner'  THEN 0
       WHEN 'agency_admin'  THEN 1
       WHEN 'agency_member' THEN 2
       ELSE 3
     END,
     ap.created_at ASC
   LIMIT 1;
$$;

-- 6. driver_decide_delegation now stamps the explicit delegation link.
CREATE OR REPLACE FUNCTION public.driver_decide_delegation(_id uuid, _approve boolean)
RETURNS public.agency_delegation_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _d public.agency_delegation_requests;
  _da public.driver_assistants;
  _email_norm text;
  _already_client boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO _d FROM public.agency_delegation_requests WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delegation not found' USING ERRCODE='42704'; END IF;
  IF _d.driver_user_id <> _uid THEN RAISE EXCEPTION 'Only the driver can decide' USING ERRCODE='42501'; END IF;
  IF _d.status <> 'pending_driver_approval' THEN RAISE EXCEPTION 'Already decided' USING ERRCODE='22023'; END IF;

  IF NOT _approve THEN
    UPDATE public.agency_delegation_requests SET status='declined', decided_at=now()
      WHERE id=_id RETURNING * INTO _d;
    INSERT INTO public.agency_audit_log
      (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
    VALUES (_uid,_d.agency_id,_d.driver_user_id,_d.member_user_id,
            'delegation_declined_by_driver','agency_delegation_request',_d.id,'{}'::jsonb);
    RETURN _d;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.agency_members
     WHERE agency_id=_d.agency_id AND member_user_id=_d.member_user_id AND status='active'
  ) THEN RAISE EXCEPTION 'Agency member is no longer active' USING ERRCODE='22023'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.agency_delegation_requests
     WHERE agency_id = _d.agency_id
       AND driver_user_id = _d.driver_user_id
       AND status = 'approved'
       AND id <> _d.id
  ) INTO _already_client;

  IF NOT _already_client THEN
    PERFORM public.assert_agency_limit(_d.agency_id, 'activate_client');
  END IF;

  _email_norm := lower(btrim(_d.member_invite_email));

  INSERT INTO public.driver_assistants
    (driver_user_id, assistant_user_id, invite_email, status, permissions,
     accepted_at, agency_delegation_id)
  VALUES (_uid, _d.member_user_id, _email_norm, 'active', _d.requested_permissions,
          now(), _d.id)
  ON CONFLICT (driver_user_id, lower(invite_email))
    WHERE status IN ('pending','active')
  DO UPDATE SET
    status              = 'active',
    assistant_user_id   = EXCLUDED.assistant_user_id,
    permissions         = EXCLUDED.permissions,
    accepted_at         = COALESCE(public.driver_assistants.accepted_at, now()),
    revoked_at          = NULL,
    agency_delegation_id = EXCLUDED.agency_delegation_id,
    updated_at          = now()
  RETURNING * INTO _da;

  UPDATE public.agency_delegation_requests SET status='approved', decided_at=now()
    WHERE id=_id RETURNING * INTO _d;

  IF _d.client_request_id IS NOT NULL THEN
    UPDATE public.agency_client_requests
       SET status='converted_to_client', decided_at=now(), decided_by_user_id=_uid
     WHERE id=_d.client_request_id;
  END IF;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES (_da.id, _uid, _d.member_user_id, 'delegation_approved', 'driver_assistants', _da.id,
          jsonb_build_object('agency_id', _d.agency_id, 'delegation_id', _d.id));

  INSERT INTO public.agency_audit_log
    (actor_user_id, agency_id, driver_user_id, target_user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid,_d.agency_id,_d.driver_user_id,_d.member_user_id,
          'delegation_approved_by_driver','agency_delegation_request',_d.id,
          jsonb_build_object('driver_assistants_id', _da.id));
  RETURN _d;
END;
$$;

-- 7. list_my_assistants_with_source now prefers the explicit link and only
-- falls back to email-matching for legacy unlinked rows.
CREATE OR REPLACE FUNCTION public.list_my_assistants_with_source()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH my AS (
    SELECT da.* FROM public.driver_assistants da WHERE da.driver_user_id = _uid
  ),
  -- Authoritative: the explicit foreign key.
  linked AS (
    SELECT m.id AS assistant_id,
           d.id AS delegation_id,
           d.agency_id,
           d.status AS delegation_status,
           1 AS rn
      FROM my m
      JOIN public.agency_delegation_requests d ON d.id = m.agency_delegation_id
  ),
  -- Legacy fallback for rows whose agency_delegation_id was never backfilled.
  fallback AS (
    SELECT m.id AS assistant_id,
           d.id AS delegation_id,
           d.agency_id,
           d.status AS delegation_status,
           row_number() OVER (
             PARTITION BY m.id
             ORDER BY
               CASE d.status WHEN 'approved' THEN 0 WHEN 'pending_driver_approval' THEN 1 ELSE 2 END,
               d.created_at DESC
           ) AS rn
      FROM my m
      JOIN public.agency_delegation_requests d
        ON d.driver_user_id = _uid
       AND m.agency_delegation_id IS NULL
       AND (
         (m.assistant_user_id IS NOT NULL AND d.member_user_id = m.assistant_user_id)
         OR (
           coalesce(m.invite_email,'') <> ''
           AND lower(btrim(coalesce(d.member_invite_email,''))) = lower(btrim(m.invite_email))
         )
       )
  ),
  matched AS (
    SELECT * FROM linked
    UNION ALL
    SELECT * FROM fallback WHERE rn = 1
  )
  SELECT jsonb_build_object(
    'id', m.id,
    'assistant_user_id', m.assistant_user_id,
    'invite_email', m.invite_email,
    'status', m.status,
    'permissions', m.permissions,
    'invited_at', m.invited_at,
    'accepted_at', m.accepted_at,
    'revoked_at', m.revoked_at,
    'last_active_at', m.last_active_at,
    'source', CASE WHEN mt.delegation_id IS NOT NULL THEN 'agency' ELSE 'direct_invite' END,
    'agency_id', mt.agency_id,
    'agency_name', ap.name,
    'delegation_id', mt.delegation_id,
    'delegation_status', mt.delegation_status
  )
  FROM my m
  LEFT JOIN matched mt ON mt.assistant_id = m.id
  LEFT JOIN public.agency_profiles ap ON ap.id = mt.agency_id
  ORDER BY m.created_at DESC;
END;
$$;
