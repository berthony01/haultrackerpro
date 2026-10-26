-- SOURCE CANDIDATE ONLY. Not applied, activated, scheduled, or connected to AI.
-- Requires existing canonical helpers and public.profiles(user_id) UNIQUE.
BEGIN;

CREATE FUNCTION public._assistant_permissions_valid(_scope text, _permissions text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, auth AS $$
 SELECT _permissions IS NOT NULL AND cardinality(_permissions) > 0
 AND array_position(_permissions, NULL) IS NULL
 AND cardinality(_permissions) = (SELECT count(DISTINCT p) FROM unnest(_permissions) p)
 AND CASE _scope
 WHEN 'driver_self' THEN _permissions <@ ARRAY['manage_loads','manage_expenses','view_reports','view_dashboard']::text[]
 WHEN 'driver_delegate' THEN _permissions <@ ARRAY['manage_loads','manage_expenses','view_reports','view_dashboard']::text[]
 WHEN 'recruiter' THEN _permissions <@ ARRAY['opportunities_view','applications_view','conversations_view']::text[]
 WHEN 'agency' THEN _permissions <@ ARRAY['packages_view','client_requests_view','work_items_view_all']::text[]
 ELSE false END
$$;
REVOKE ALL ON FUNCTION public._assistant_permissions_valid(text,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._assistant_permissions_valid(text,text[]) TO service_role;

-- No actor argument. Canonical helpers are invoked internally; their ACLs stay unchanged.
CREATE FUNCTION public.assistant_scope_authorized(_scope text, _target uuid, _permissions text[])
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
DECLARE _actor uuid := auth.uid(); _permission text; _owner uuid;
BEGIN
 IF _actor IS NULL OR _target IS NULL OR NOT public._assistant_permissions_valid(_scope,_permissions) THEN RETURN false; END IF;
 IF _scope IN ('driver_self','driver_delegate') THEN
  IF NOT EXISTS (SELECT 1 FROM public.user_capabilities c WHERE c.user_id=_target AND c.capability='driver' AND c.status='active') THEN RETURN false; END IF;
  IF _scope='driver_self' THEN RETURN _target=_actor AND public.driver_has_active_pro(_target); END IF;
  IF _target=_actor THEN RETURN false; END IF;
  -- One exact relationship must carry ALL domains. Membership alone is insufficient.
  IF NOT EXISTS (
   SELECT 1 FROM public.driver_assistants da
   WHERE da.driver_user_id=_target AND da.assistant_user_id=_actor AND da.status='active'
   AND NOT EXISTS (SELECT 1 FROM unnest(_permissions) p WHERE jsonb_typeof(da.permissions->p) IS DISTINCT FROM 'boolean' OR (da.permissions->p) IS DISTINCT FROM to_jsonb(true))
   AND CASE WHEN da.agency_delegation_id IS NULL THEN public.driver_has_active_pro(_target)
    ELSE EXISTS (
     SELECT 1 FROM public.agency_delegation_requests dr JOIN public.agency_entitlements ae ON ae.agency_id=dr.agency_id
     WHERE dr.id=da.agency_delegation_id AND dr.driver_user_id=_target AND dr.member_user_id=_actor AND dr.status='approved'
     AND public._agency_member_paid_operational_authority(dr.agency_id,_actor)
     AND ae.plan_key IN ('agency_starter','agency_team','agency_growth') AND ae.source IN ('stripe','manual','admin_seed') AND ae.status IN ('active','trialing')
     AND NOT EXISTS (SELECT 1 FROM unnest(_permissions) p WHERE jsonb_typeof(dr.requested_permissions->p) IS DISTINCT FROM 'boolean' OR (dr.requested_permissions->p) IS DISTINCT FROM to_jsonb(true))
    ) END
  ) THEN RETURN false; END IF;
  FOREACH _permission IN ARRAY _permissions LOOP
   IF NOT public.assistant_has_permission(_actor,_target,_permission) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
 ELSIF _scope='recruiter' THEN
  SELECT rp.user_id INTO _owner FROM public.recruiter_profiles rp WHERE rp.id=_target;
  IF NOT EXISTS (SELECT 1 FROM public.user_capabilities c WHERE c.user_id=_owner AND c.capability='recruiter' AND c.status='active')
   OR NOT public.recruiter_profile_can_manage_opportunities(_target)
   OR public.effective_recruiter_tier(_target) NOT IN ('starter','growth','fleet') THEN RETURN false; END IF;
  FOREACH _permission IN ARRAY _permissions LOOP
   IF NOT public.current_user_has_recruiter_permission(_target,_permission::public.recruiter_workspace_permission) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
 ELSIF _scope='agency' THEN
  IF NOT public._agency_member_paid_operational_authority(_target,_actor)
   OR NOT EXISTS (SELECT 1 FROM public.agency_entitlements ae WHERE ae.agency_id=_target
    AND ae.plan_key IN ('agency_starter','agency_team','agency_growth') AND ae.source IN ('stripe','manual','admin_seed') AND ae.status IN ('active','trialing')) THEN RETURN false; END IF;
  FOREACH _permission IN ARRAY _permissions LOOP
   IF NOT public.current_user_has_agency_permission(_target,_permission::public.agency_workspace_permission) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
 END IF;
 RETURN false;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_scope_authorized(text,uuid,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_scope_authorized(text,uuid,text[]) TO authenticated, service_role;

CREATE TABLE public.assistant_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
 scope_kind text NOT NULL CHECK (scope_kind IN ('driver_self','driver_delegate','recruiter','agency')),
 scope_target_id uuid NOT NULL,
 required_permissions text[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT (statement_timestamp()+interval '720 hours')
);
REVOKE ALL ON TABLE public.assistant_threads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.assistant_threads TO authenticated;
GRANT ALL ON TABLE public.assistant_threads TO service_role;
ALTER TABLE public.assistant_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_threads_actor_read ON public.assistant_threads FOR SELECT TO authenticated
 USING (actor_user_id=auth.uid() AND expires_at>statement_timestamp() AND public.assistant_scope_authorized(scope_kind,scope_target_id,required_permissions));
CREATE INDEX assistant_threads_actor_created_idx ON public.assistant_threads(actor_user_id,created_at);
CREATE INDEX assistant_threads_expires_idx ON public.assistant_threads(expires_at);

-- Server-generated creation time, fixed 720-hour lifetime, immutable context.
CREATE FUNCTION public._assistant_thread_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
BEGIN
 IF NOT public._assistant_permissions_valid(NEW.scope_kind,NEW.required_permissions) THEN RAISE EXCEPTION 'Invalid scope' USING ERRCODE='22023'; END IF;
 IF TG_OP='INSERT' THEN
  NEW.created_at:=statement_timestamp(); NEW.expires_at:=NEW.created_at+interval '720 hours';
 ELSIF NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
  OR NEW.scope_target_id IS DISTINCT FROM OLD.scope_target_id OR NEW.required_permissions IS DISTINCT FROM OLD.required_permissions
  OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
  RAISE EXCEPTION 'Immutable thread' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._assistant_thread_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._assistant_thread_guard() TO service_role;
CREATE TRIGGER assistant_thread_guard BEFORE INSERT OR UPDATE ON public.assistant_threads FOR EACH ROW EXECUTE FUNCTION public._assistant_thread_guard();

CREATE TABLE public.assistant_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 thread_id uuid NOT NULL REFERENCES public.assistant_threads(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('user','assistant')),
 content text NOT NULL CHECK (content=btrim(content) AND char_length(content) BETWEEN 1 AND 8000),
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(thread_id,role,request_id)
);
REVOKE ALL ON TABLE public.assistant_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.assistant_messages TO authenticated;
GRANT ALL ON TABLE public.assistant_messages TO service_role;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_messages_actor_read ON public.assistant_messages FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.assistant_threads t WHERE t.id=thread_id));
CREATE INDEX assistant_messages_thread_created_idx ON public.assistant_messages(thread_id,created_at,id);
COMMENT ON TABLE public.assistant_messages IS 'Private AI history candidate. Every body is untrusted content, never authorization. No reply orchestration is implemented.';

CREATE FUNCTION public.assistant_create_thread(_scope_kind text,_target_id uuid,_required_permissions text[])
RETURNS TABLE(thread_id uuid,expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
DECLARE _actor uuid:=auth.uid();
BEGIN
 IF _actor IS NULL OR NOT public.assistant_scope_authorized(_scope_kind,_target_id,_required_permissions) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.profiles p WHERE p.user_id=_actor FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 RETURN QUERY INSERT INTO public.assistant_threads AS t(actor_user_id,scope_kind,scope_target_id,required_permissions)
 VALUES (_actor,_scope_kind,_target_id,_required_permissions) RETURNING t.id,t.expires_at;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_create_thread(text,uuid,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_create_thread(text,uuid,text[]) TO authenticated, service_role;

CREATE FUNCTION public.assistant_add_user_message(_thread_id uuid,_request_id uuid,_content text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE _thread public.assistant_threads; _message public.assistant_messages; _body text:=btrim(_content);
BEGIN
 SELECT t.* INTO _thread FROM public.assistant_threads t WHERE t.id=_thread_id AND t.actor_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR _thread.expires_at<=statement_timestamp() OR NOT public.assistant_scope_authorized(_thread.scope_kind,_thread.scope_target_id,_thread.required_permissions) THEN
  RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF _request_id IS NULL OR _body IS NULL OR char_length(_body) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION 'Invalid message' USING ERRCODE='22023'; END IF;
 SELECT m.* INTO _message FROM public.assistant_messages m WHERE m.thread_id=_thread_id AND m.role='user' AND m.request_id=_request_id;
 IF FOUND THEN
  IF _message.content IS DISTINCT FROM _body THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='22023'; END IF;
  RETURN _message.id;
 END IF;
 INSERT INTO public.assistant_messages(thread_id,role,content,request_id) VALUES (_thread_id,'user',_body,_request_id) RETURNING * INTO _message;
 RETURN _message.id;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_add_user_message(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_add_user_message(uuid,uuid,text) TO authenticated, service_role;

CREATE FUNCTION public.assistant_delete_thread(_thread_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 DELETE FROM public.assistant_threads WHERE id=_thread_id AND actor_user_id=auth.uid();
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_delete_thread(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_delete_thread(uuid) TO authenticated, service_role;
CREATE FUNCTION public.assistant_clear_my_history() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
DECLARE _count integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 DELETE FROM public.assistant_threads WHERE actor_user_id=auth.uid(); GET DIAGNOSTICS _count=ROW_COUNT; RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_clear_my_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_clear_my_history() TO authenticated, service_role;
CREATE FUNCTION public.assistant_purge_expired() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
DECLARE _count integer;
BEGIN
 DELETE FROM public.assistant_threads WHERE expires_at<=statement_timestamp(); GET DIAGNOSTICS _count=ROW_COUNT; RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_purge_expired() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_purge_expired() TO service_role;
-- No cron, assistant-reply RPC, data tools, model spend, or operational writes.
COMMIT;
