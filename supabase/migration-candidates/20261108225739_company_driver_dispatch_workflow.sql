-- Reviewed candidate only. Do not apply or promote without release approval.
BEGIN;

-- Email requests never look up whether an account exists. A verified recipient
-- explicitly accepts in their own driver workspace. No email is sent by SQL.
CREATE TABLE public.company_driver_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
 email text NOT NULL CHECK (email=lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','revoked')),
 created_by_user_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 responded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 relationship_id uuid REFERENCES public.carrier_driver_relationships(id) ON DELETE SET NULL,
 UNIQUE(recruiter_id,email)
);
CREATE INDEX company_driver_invites_recipient ON public.company_driver_invites(email,status,expires_at);
ALTER TABLE public.company_driver_invites ENABLE ROW LEVEL SECURITY;
-- RPC-only table. Even authenticated clients have no direct read/write grant.
REVOKE ALL ON public.company_driver_invites FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.company_driver_owner_eligible(_recruiter_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.recruiter_profiles rp
  JOIN public.recruiter_billing_profiles rb ON rb.recruiter_id=rp.id AND rb.user_id=rp.user_id
  WHERE rp.id=_recruiter_id AND rp.status='active'
   AND rb.plan IN ('starter','growth','fleet') AND rb.status IN ('active','trialing')
   AND NOT EXISTS (SELECT 1 FROM public.user_capabilities c WHERE c.user_id=rp.user_id AND c.capability='recruiter' AND c.status<>'active')
   AND NOT EXISTS (
    SELECT 1 FROM public.agency_profiles ap
    JOIN public.agency_members am ON am.agency_id=ap.id AND am.member_user_id=rp.user_id AND am.role='agency_owner' AND am.status='active'
    JOIN public.agency_entitlements ae ON ae.agency_id=ap.id AND ae.plan_key IN ('agency_starter','agency_team','agency_growth') AND ae.status IN ('active','trialing')
    WHERE ap.owner_user_id=rp.user_id
   )
 );
$$;
REVOKE ALL ON FUNCTION public.company_driver_owner_eligible(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.company_driver_invite(_recruiter_id uuid,_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE _uid uuid:=auth.uid(); _norm text:=lower(btrim(_email)); _row public.company_driver_invites;
BEGIN
 IF _uid IS NULL OR NOT public.settlement_current_user_can_administer_carrier(_recruiter_id) OR NOT public.company_driver_owner_eligible(_recruiter_id) THEN
  RAISE EXCEPTION 'company_connection_not_authorized' USING ERRCODE='42501';
 END IF;
 IF _norm IS NULL OR length(_norm)>254 OR _norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'company_connection_invalid_email' USING ERRCODE='22023'; END IF;
 -- Serialize the workspace budget and duplicate-email request together.
 PERFORM pg_advisory_xact_lock(hashtextextended('company-driver:'||_recruiter_id::text,0));
 SELECT * INTO _row FROM public.company_driver_invites WHERE recruiter_id=_recruiter_id AND email=_norm FOR UPDATE;
 IF FOUND AND (
  (_row.status='accepted' AND EXISTS(SELECT 1 FROM public.carrier_driver_relationships WHERE id=_row.relationship_id AND status='active'))
  OR (_row.status='pending' AND _row.expires_at>now())
 ) THEN
  RETURN jsonb_build_object('id',_row.id,'email',_row.email,'status',_row.status,'expires_at',_row.expires_at);
 END IF;
 IF (SELECT count(*) FROM public.company_driver_invites WHERE recruiter_id=_recruiter_id AND updated_at>now()-interval '24 hours')>=100 THEN RAISE EXCEPTION 'company_connection_request_limit'; END IF;
 INSERT INTO public.company_driver_invites(recruiter_id,email,created_by_user_id)
 VALUES(_recruiter_id,_norm,_uid)
 ON CONFLICT(recruiter_id,email) DO UPDATE
 SET id=gen_random_uuid(),status='pending',created_by_user_id=_uid,updated_at=now(),
     expires_at=now()+interval '7 days',responded_by_user_id=NULL,relationship_id=NULL
 RETURNING * INTO _row;
 RETURN jsonb_build_object('id',_row.id,'email',_row.email,'status',_row.status,'expires_at',_row.expires_at);
END $$;

CREATE FUNCTION public.company_driver_connections(_recruiter_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE _uid uuid:=auth.uid(); _email text; _invites jsonb; _relationships jsonb;
BEGIN
 IF _uid IS NULL THEN RAISE EXCEPTION 'company_connection_not_authorized' USING ERRCODE='42501'; END IF;
 IF _recruiter_id IS NOT NULL THEN
  -- Management is for the canonical company owner. Load-only staff never gain
  -- recruitment, settlement, account lookup or relationship management access.
  IF NOT EXISTS(SELECT 1 FROM public.recruiter_profiles WHERE id=_recruiter_id AND user_id=_uid) THEN RAISE EXCEPTION 'company_connection_not_authorized' USING ERRCODE='42501'; END IF;
 ELSE
  SELECT lower(btrim(email)) INTO _email FROM auth.users WHERE id=_uid AND email_confirmed_at IS NOT NULL;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'status',CASE WHEN i.status='pending' AND i.expires_at<=now() THEN 'expired' ELSE i.status END,'expires_at',i.expires_at,'company_name',rp.company_name) ORDER BY i.updated_at DESC),'[]'::jsonb)
 INTO _invites FROM public.company_driver_invites i JOIN public.recruiter_profiles rp ON rp.id=i.recruiter_id
 WHERE (_recruiter_id IS NOT NULL AND i.recruiter_id=_recruiter_id) OR (_recruiter_id IS NULL AND i.email=_email AND i.status='pending' AND i.expires_at>now());
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'company_name',rp.company_name,'driver_name',coalesce(nullif(p.display_name,''),'Connected driver'),'status',r.status,'invited_at',r.invited_at) ORDER BY r.invited_at DESC),'[]'::jsonb)
 INTO _relationships FROM public.carrier_driver_relationships r JOIN public.recruiter_profiles rp ON rp.id=r.recruiter_id LEFT JOIN public.profiles p ON p.user_id=r.driver_user_id
 WHERE (_recruiter_id IS NOT NULL AND r.recruiter_id=_recruiter_id) OR (_recruiter_id IS NULL AND r.driver_user_id=_uid);
 RETURN jsonb_build_object('invites',_invites,'relationships',_relationships,'can_invite',_recruiter_id IS NOT NULL AND public.settlement_current_user_can_administer_carrier(_recruiter_id) AND public.company_driver_owner_eligible(_recruiter_id));
END $$;

CREATE FUNCTION public.company_driver_respond(_invite_id uuid,_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE _uid uuid:=auth.uid(); _email text; _row public.company_driver_invites; _rel public.carrier_driver_relationships;
BEGIN
 IF _uid IS NULL OR _accept IS NULL THEN RAISE EXCEPTION 'company_connection_not_authorized' USING ERRCODE='42501'; END IF;
 -- Do not trust JWT email/user_metadata. Read the currently verified identity.
 SELECT lower(btrim(email)) INTO _email FROM auth.users WHERE id=_uid AND email_confirmed_at IS NOT NULL FOR SHARE;
 SELECT * INTO _row FROM public.company_driver_invites WHERE id=_invite_id FOR UPDATE;
 IF NOT FOUND OR _email IS NULL OR _row.email IS DISTINCT FROM _email OR NOT EXISTS(SELECT 1 FROM public.user_capabilities WHERE user_id=_uid AND capability='driver' AND status='active') THEN
  RAISE EXCEPTION 'company_connection_not_authorized' USING ERRCODE='42501';
 END IF;
 IF _row.status IN ('accepted','declined') AND _row.responded_by_user_id=_uid AND ((_row.status='accepted')=_accept) THEN
  RETURN jsonb_build_object('status',_row.status,'relationship_id',_row.relationship_id,'replayed',true);
 END IF;
 IF _row.status<>'pending' OR _row.expires_at<=now() THEN RAISE EXCEPTION 'company_connection_expired_or_handled'; END IF;
 IF NOT _accept THEN
  UPDATE public.company_driver_invites SET status='declined',responded_by_user_id=_uid,updated_at=now() WHERE id=_row.id;
  RETURN jsonb_build_object('status','declined');
 END IF;
 -- Recheck current business eligibility at acceptance, not just invitation.
 PERFORM 1 FROM public.recruiter_profiles WHERE id=_row.recruiter_id FOR SHARE;
 IF NOT public.company_driver_owner_eligible(_row.recruiter_id) THEN RAISE EXCEPTION 'company_connection_company_unavailable'; END IF;
 INSERT INTO public.carrier_driver_relationships(recruiter_id,driver_user_id,status,created_by_user_id)
 VALUES(_row.recruiter_id,_uid,'invited',_row.created_by_user_id)
 ON CONFLICT(recruiter_id,driver_user_id) DO NOTHING;
 SELECT * INTO _rel FROM public.carrier_driver_relationships WHERE recruiter_id=_row.recruiter_id AND driver_user_id=_uid FOR UPDATE;
 IF _rel.status IN ('inactive','ended') THEN
  UPDATE public.carrier_driver_relationships SET status='invited',invited_at=now(),accepted_at=NULL,ended_at=NULL,updated_at=now() WHERE id=_rel.id;
 END IF;
 -- Preserve the existing canonical self-acceptance and its audit timestamps.
 _rel:=public.settlement_accept_my_carrier_relationship(_rel.id);
 UPDATE public.company_driver_invites SET status='accepted',responded_by_user_id=_uid,relationship_id=_rel.id,updated_at=now() WHERE id=_row.id;
 RETURN jsonb_build_object('status','accepted','relationship_id',_rel.id,'replayed',false);
END $$;

CREATE FUNCTION public.company_driver_revoke(_recruiter_id uuid,_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Cleanup remains available after billing expires.
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.recruiter_profiles WHERE id=_recruiter_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'company_connection_not_authorized' USING ERRCODE='42501'; END IF;
 UPDATE public.company_driver_invites SET status='revoked',updated_at=now() WHERE id=_invite_id AND recruiter_id=_recruiter_id AND status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'company_connection_expired_or_handled'; END IF;
END $$;

-- The driver and previously authorized driver assistants get the SAME load
-- rows and a narrow actual-delivery projection. Dispatch staff are not driver
-- assistants. No private expense, tax setting, or payment privilege is added.
CREATE FUNCTION public.driver_loads_page(_driver_user_id uuid,_from date DEFAULT NULL,_to date DEFAULT NULL,_offset integer DEFAULT 0,_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE _uid uuid:=auth.uid(); _result jsonb;
BEGIN
 IF _uid IS NULL OR _driver_user_id IS NULL OR (
  _uid=_driver_user_id OR public.assistant_has_permission(_uid,_driver_user_id,'manage_loads') OR public.assistant_has_permission(_uid,_driver_user_id,'view_reports') OR public.assistant_has_permission(_uid,_driver_user_id,'view_dashboard') OR public.assistant_has_permission(_uid,_driver_user_id,'export_reports')
 ) IS NOT TRUE THEN RAISE EXCEPTION 'driver_loads_not_authorized' USING ERRCODE='42501'; END IF;
 IF _offset IS NULL OR _offset<0 OR _offset>50000 OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 1000 OR (_from IS NOT NULL AND _to IS NOT NULL AND _from>_to) THEN RAISE EXCEPTION 'driver_loads_invalid_range' USING ERRCODE='22023'; END IF;
 WITH dated AS (
  SELECT l.*,d.actual_delivery_date,rp.company_name AS dispatch_company_name
  FROM public.loads l
  LEFT JOIN public.carrier_driver_relationships r ON r.id=l.carrier_driver_relationship_id AND r.driver_user_id=l.user_id
  LEFT JOIN public.recruiter_profiles rp ON rp.id=r.recruiter_id
  LEFT JOIN LATERAL (
   SELECT (e.metadata->>'actual_delivery_date')::date AS actual_delivery_date
   FROM public.load_events e
   WHERE l.status='completed' AND e.load_id=l.id AND e.driver_user_id=l.user_id
    AND e.recruiter_id=r.recruiter_id AND e.carrier_driver_relationship_id=r.id
    AND e.event_type='updated' AND e.source_channel='web' AND e.to_status='completed'
    AND e.metadata->>'dispatch_mini_version'='1' AND e.metadata->>'action'='update_status'
    AND e.metadata->>'actual_delivery_date' ~ '^\d{4}-\d{2}-\d{2}$'
    AND pg_input_is_valid(e.metadata->>'actual_delivery_date','date')
   ORDER BY e.created_at DESC,e.id DESC LIMIT 1
  ) d ON l.status='completed'
  WHERE l.user_id=_driver_user_id
 ), filtered AS (
  SELECT * FROM dated WHERE (_from IS NULL OR coalesce(actual_delivery_date,dropoff_date,load_date)>=_from) AND (_to IS NULL OR coalesce(actual_delivery_date,dropoff_date,load_date)<=_to)
 ), page AS (SELECT * FROM filtered ORDER BY coalesce(actual_delivery_date,dropoff_date,load_date) DESC,created_at DESC,id DESC LIMIT _limit OFFSET _offset)
 SELECT jsonb_build_object('loads',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),'totalCount',(SELECT count(*) FROM filtered)) INTO _result;
 RETURN _result;
END $$;

REVOKE ALL ON FUNCTION public.company_driver_invite(uuid,text),public.company_driver_connections(uuid),public.company_driver_respond(uuid,boolean),public.company_driver_revoke(uuid,uuid),public.driver_loads_page(uuid,date,date,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.company_driver_invite(uuid,text),public.company_driver_connections(uuid),public.company_driver_respond(uuid,boolean),public.company_driver_revoke(uuid,uuid),public.driver_loads_page(uuid,date,date,integer,integer) TO authenticated;
COMMIT;
