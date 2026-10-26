-- SOURCE CANDIDATE ONLY. Not applied, activated, scheduled, or deployed.
-- Phase3B: adds session freshness, context discovery, registered read-only
-- projections, bodyless usage reservation and service-only reply finalization.
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

-- Session freshness for THIS feature only. Reads the JWT session_id and the
-- matching auth.sessions row (id,user_id,not_after). No writes; auth.sessions
-- is never granted to clients. Missing/malformed/mismatched/expired fails closed.
CREATE FUNCTION public._assistant_session_valid() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
DECLARE _actor uuid := auth.uid(); _sid text := auth.jwt()->>'session_id';
BEGIN
 IF _actor IS NULL OR _sid IS NULL OR _sid !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN false; END IF;
 RETURN EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id=_sid::uuid AND s.user_id=_actor AND (s.not_after IS NULL OR s.not_after>statement_timestamp()));
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public._assistant_session_valid() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._assistant_session_valid() TO authenticated, service_role;

-- No actor argument. Canonical helpers are invoked internally; their ACLs stay unchanged.
CREATE FUNCTION public.assistant_scope_authorized(_scope text, _target uuid, _permissions text[])
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
DECLARE _actor uuid := auth.uid(); _permission text; _owner uuid;
BEGIN
 IF _actor IS NULL OR _target IS NULL OR NOT public._assistant_permissions_valid(_scope,_permissions) THEN RETURN false; END IF;
 IF NOT public._assistant_session_valid() THEN RETURN false; END IF;
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
 -- Fixed registry keys only; hrefs/labels are generated server-side, never stored from a model.
 sources text[] NOT NULL DEFAULT '{}' CHECK (array_position(sources,NULL) IS NULL AND sources <@ ARRAY['loads','expenses','opportunities','applications','conversations','packages','work_items','client_requests']::text[] AND (role='assistant' OR cardinality(sources)=0)),
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
COMMENT ON TABLE public.assistant_messages IS 'Private AI history candidate. Every body is untrusted content, never authorization. Assistant rows are written only by service-only finalization.';

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
 IF auth.uid() IS NULL OR NOT public._assistant_session_valid() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
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
 IF auth.uid() IS NULL OR NOT public._assistant_session_valid() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 DELETE FROM public.assistant_threads WHERE actor_user_id=auth.uid(); GET DIAGNOSTICS _count=ROW_COUNT; RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_clear_my_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_clear_my_history() TO authenticated, service_role;
CREATE FUNCTION public.assistant_purge_expired() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
DECLARE _count integer;
BEGIN
 DELETE FROM public.assistant_threads WHERE expires_at<=statement_timestamp(); GET DIAGNOSTICS _count=ROW_COUNT;
 -- Bodyless usage metadata has its own rolling 24h retention.
 DELETE FROM public.assistant_usage WHERE created_at<=statement_timestamp()-interval '24 hours';
 RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_purge_expired() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_purge_expired() TO service_role;

-- ===================== Phase3B integration candidate =====================
CREATE FUNCTION public.assistant_thread_live(_thread_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.assistant_threads t WHERE t.id=_thread_id AND t.actor_user_id=auth.uid()
  AND t.expires_at>statement_timestamp() AND public.assistant_scope_authorized(t.scope_kind,t.scope_target_id,t.required_permissions))
$$;
REVOKE ALL ON FUNCTION public.assistant_thread_live(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_thread_live(uuid) TO authenticated, service_role;

-- Exact per-context permissions: each domain must be individually authorized,
-- then the COMBINED set is revalidated (one relationship must carry all).
CREATE FUNCTION public._assistant_context_permissions(_scope text,_target uuid) RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
DECLARE _vocab text[]; _p text; _out text[]:='{}';
BEGIN
 _vocab := CASE _scope WHEN 'driver_self' THEN ARRAY['manage_loads','manage_expenses','view_reports','view_dashboard']
  WHEN 'driver_delegate' THEN ARRAY['manage_loads','manage_expenses','view_reports','view_dashboard']
  WHEN 'recruiter' THEN ARRAY['opportunities_view','applications_view','conversations_view']
  WHEN 'agency' THEN ARRAY['packages_view','client_requests_view','work_items_view_all'] ELSE NULL END;
 IF _vocab IS NULL OR _target IS NULL THEN RETURN NULL; END IF;
 FOREACH _p IN ARRAY _vocab LOOP
  IF public.assistant_scope_authorized(_scope,_target,ARRAY[_p]) THEN _out:=_out||_p; END IF;
 END LOOP;
 IF cardinality(_out)=0 OR NOT public.assistant_scope_authorized(_scope,_target,_out) THEN RETURN NULL; END IF;
 RETURN _out;
END;
$$;
REVOKE ALL ON FUNCTION public._assistant_context_permissions(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._assistant_context_permissions(text,uuid) TO service_role;

-- Context discovery. auth.uid only; no role/isPro inputs. Bounded pages with has_more.
CREATE FUNCTION public.assistant_list_contexts(_limit integer DEFAULT 50,_offset integer DEFAULT 0)
RETURNS TABLE(scope_kind text,target_id uuid,label text,permissions text[],has_more boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
#variable_conflict use_column
DECLARE _actor uuid:=auth.uid(); _lim integer:=least(greatest(coalesce(_limit,50),1),50); _off integer:=greatest(coalesce(_offset,0),0);
BEGIN
 IF _actor IS NULL OR NOT public._assistant_session_valid() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 WITH cand AS (
  SELECT 1 ord,'driver_self'::text k,_actor t
  UNION SELECT 2,'driver_delegate',da.driver_user_id FROM public.driver_assistants da WHERE da.assistant_user_id=_actor AND da.status='active' AND da.driver_user_id<>_actor
  UNION SELECT 3,'recruiter',rp.id FROM public.recruiter_profiles rp WHERE rp.user_id=_actor
  UNION SELECT 3,'recruiter',rm.recruiter_id FROM public.recruiter_members rm WHERE rm.member_user_id=_actor AND rm.status='active'
  UNION SELECT 4,'agency',ap.id FROM public.agency_profiles ap WHERE ap.owner_user_id=_actor
  UNION SELECT 4,'agency',am.agency_id FROM public.agency_members am WHERE am.member_user_id=_actor AND am.status='active'
 ), authz AS (
  SELECT c.ord,c.k,c.t,public._assistant_context_permissions(c.k,c.t) perms FROM cand c
 ), labelled AS (
  SELECT a.ord,a.k,a.t,a.perms,
   CASE a.k WHEN 'driver_self' THEN 'My driver workspace'
    WHEN 'driver_delegate' THEN coalesce(nullif(btrim((SELECT p.display_name FROM public.profiles p WHERE p.user_id=a.t)),''),'Managed driver')
    WHEN 'recruiter' THEN (SELECT rp.company_name FROM public.recruiter_profiles rp WHERE rp.id=a.t)
    ELSE (SELECT ap.name FROM public.agency_profiles ap WHERE ap.id=a.t) END lbl
  FROM authz a WHERE a.perms IS NOT NULL
 ), numbered AS (
  SELECT l.*, row_number() OVER (ORDER BY l.ord,l.lbl,l.t) rn, count(*) OVER () total FROM labelled l
 )
 SELECT n.k,n.t,n.lbl,n.perms,(n.total>_off+_lim) FROM numbered n WHERE n.rn>_off AND n.rn<=_off+_lim ORDER BY n.rn;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_list_contexts(integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_list_contexts(integer,integer) TO authenticated, service_role;

-- Create a thread for a discovered context; permissions derived server-side.
CREATE FUNCTION public.assistant_start_thread(_scope_kind text,_target_id uuid)
RETURNS TABLE(thread_id uuid,expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
#variable_conflict use_column
DECLARE _perms text[];
BEGIN
 IF auth.uid() IS NULL OR NOT public._assistant_session_valid() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 _perms:=public._assistant_context_permissions(_scope_kind,_target_id);
 IF _perms IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT c.thread_id,c.expires_at FROM public.assistant_create_thread(_scope_kind,_target_id,_perms) c;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_start_thread(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_start_thread(text,uuid) TO authenticated, service_role;

-- History pagination through RLS (SECURITY INVOKER) plus explicit actor filters.
CREATE FUNCTION public.assistant_list_threads(_before timestamptz DEFAULT NULL,_before_id uuid DEFAULT NULL,_limit integer DEFAULT 20)
RETURNS TABLE(id uuid,scope_kind text,scope_target_id uuid,created_at timestamptz,expires_at timestamptz,preview text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, auth AS $$
 SELECT t.id,t.scope_kind,t.scope_target_id,t.created_at,t.expires_at,
  (SELECT left(m.content,80) FROM public.assistant_messages m WHERE m.thread_id=t.id AND m.role='user' ORDER BY m.created_at,m.id LIMIT 1)
 FROM public.assistant_threads t
 WHERE t.actor_user_id=auth.uid() AND (_before IS NULL OR (t.created_at,t.id)<(_before,coalesce(_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 ORDER BY t.created_at DESC,t.id DESC LIMIT least(greatest(coalesce(_limit,20),1),50)+1
$$;
REVOKE ALL ON FUNCTION public.assistant_list_threads(timestamptz,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_list_threads(timestamptz,uuid,integer) TO authenticated, service_role;

CREATE FUNCTION public.assistant_list_messages(_thread_id uuid,_before timestamptz DEFAULT NULL,_before_id uuid DEFAULT NULL,_limit integer DEFAULT 30)
RETURNS TABLE(id uuid,role text,content text,sources text[],created_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, auth AS $$
 SELECT m.id,m.role,m.content,m.sources,m.created_at FROM public.assistant_messages m
 WHERE m.thread_id=_thread_id AND EXISTS (SELECT 1 FROM public.assistant_threads t WHERE t.id=_thread_id AND t.actor_user_id=auth.uid())
  AND (_before IS NULL OR (m.created_at,m.id)<(_before,coalesce(_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 ORDER BY m.created_at DESC,m.id DESC LIMIT least(greatest(coalesce(_limit,30),1),50)+1
$$;
REVOKE ALL ON FUNCTION public.assistant_list_messages(uuid,timestamptz,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_list_messages(uuid,timestamptz,uuid,integer) TO authenticated, service_role;

-- Registered source keys -> required thread domains. Fixed registry, no arbitrary tools.
CREATE FUNCTION public._assistant_source_allowed(_scope text,_perms text[],_key text) RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public AS $$
 SELECT CASE
  WHEN _scope IN ('driver_self','driver_delegate') AND _key='loads' THEN _perms && ARRAY['manage_loads','view_dashboard','view_reports']
  WHEN _scope IN ('driver_self','driver_delegate') AND _key='expenses' THEN _perms && ARRAY['manage_expenses','view_dashboard','view_reports']
  WHEN _scope='recruiter' AND _key='opportunities' THEN 'opportunities_view'=ANY(_perms)
  WHEN _scope='recruiter' AND _key='applications' THEN 'applications_view'=ANY(_perms)
  WHEN _scope='recruiter' AND _key='conversations' THEN 'conversations_view'=ANY(_perms)
  WHEN _scope='agency' AND _key='packages' THEN 'packages_view'=ANY(_perms)
  WHEN _scope='agency' AND _key='work_items' THEN 'work_items_view_all'=ANY(_perms)
  WHEN _scope='agency' AND _key='client_requests' THEN 'client_requests_view'=ANY(_perms)
  ELSE false END
$$;
REVOKE ALL ON FUNCTION public._assistant_source_allowed(text,text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._assistant_source_allowed(text,text[],text) TO service_role;

-- Read-only registered projections, bound to OWN live thread. Explicit target
-- predicate on every query. Newest 20 rows or grouped counts only.
CREATE FUNCTION public.assistant_thread_context(_thread_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
DECLARE _t public.assistant_threads; _out jsonb:='[]'::jsonb; _rows jsonb; _n integer; _tgt uuid;
BEGIN
 SELECT t.* INTO _t FROM public.assistant_threads t WHERE t.id=_thread_id AND t.actor_user_id=auth.uid();
 IF NOT FOUND OR _t.expires_at<=statement_timestamp() OR NOT public.assistant_scope_authorized(_t.scope_kind,_t.scope_target_id,_t.required_permissions) THEN
  RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 _tgt:=_t.scope_target_id;
 -- One ordering (date, created_at, id) ranks rows; only ranks 1..20 are kept and
 -- created_at/rank are stripped from the final allowed projection.
 IF public._assistant_source_allowed(_t.scope_kind,_t.required_permissions,'loads') THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x)-'created_at'-'rn' ORDER BY x.rn) FILTER (WHERE x.rn<=20),'[]'),count(*) INTO _rows,_n FROM (
   SELECT l.id,l.load_date,l.status,l.payment_status,l.estimated_pay,l.actual_pay_received,l.created_at,
    row_number() OVER (ORDER BY l.load_date DESC,l.created_at DESC,l.id DESC) rn FROM public.loads l
   WHERE l.user_id=_tgt ORDER BY l.load_date DESC,l.created_at DESC,l.id DESC LIMIT 21) x;
  _out:=_out||jsonb_build_object('key','loads','kind','recent','limit',20,'has_more',_n>20,'rows',_rows);
 END IF;
 IF public._assistant_source_allowed(_t.scope_kind,_t.required_permissions,'expenses') THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x)-'created_at'-'rn' ORDER BY x.rn) FILTER (WHERE x.rn<=20),'[]'),count(*) INTO _rows,_n FROM (
   SELECT e.id,e.expense_date,e.category,e.amount,e.expense_type,e.created_at,
    row_number() OVER (ORDER BY e.expense_date DESC,e.created_at DESC,e.id DESC) rn FROM public.expenses e
   WHERE e.user_id=_tgt ORDER BY e.expense_date DESC,e.created_at DESC,e.id DESC LIMIT 21) x;
  _out:=_out||jsonb_build_object('key','expenses','kind','recent','limit',20,'has_more',_n>20,'rows',_rows);
 END IF;
 IF public._assistant_source_allowed(_t.scope_kind,_t.required_permissions,'opportunities') THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC,x.id DESC),'[]'),count(*) INTO _rows,_n FROM (
   SELECT o.id,o.title,o.status,o.route_type,o.updated_at FROM public.opportunities o
   WHERE o.recruiter_id=_tgt ORDER BY o.updated_at DESC,o.id DESC LIMIT 21) x;
  _out:=_out||jsonb_build_object('key','opportunities','kind','recent','limit',20,'has_more',_n>20,'rows',CASE WHEN _n>20 THEN _rows-20 ELSE _rows END);
 END IF;
 IF public._assistant_source_allowed(_t.scope_kind,_t.required_permissions,'applications') THEN
  _out:=_out||jsonb_build_object('key','applications','kind','counts','counts',(SELECT coalesce(jsonb_object_agg(s.status,s.n),'{}') FROM
   (SELECT a.status,count(*) n FROM public.opportunity_applications a WHERE a.recruiter_id=_tgt GROUP BY a.status) s));
 END IF;
 IF public._assistant_source_allowed(_t.scope_kind,_t.required_permissions,'conversations') THEN
  _out:=_out||jsonb_build_object('key','conversations','kind','counts','counts',(SELECT coalesce(jsonb_object_agg(s.status,s.n),'{}') FROM
   (SELECT c.status,count(*) n FROM public.conversation_threads c WHERE c.recruiter_id=_tgt GROUP BY c.status) s));
 END IF;
 IF public._assistant_source_allowed(_t.scope_kind,_t.required_permissions,'packages') THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC),'[]'),count(*) INTO _rows,_n FROM (
   SELECT p.id,p.name,p.price_display_text,p.billing_frequency_display_text,p.is_active,p.created_at FROM public.agency_service_packages p
   WHERE p.agency_id=_tgt ORDER BY p.created_at DESC,p.id DESC LIMIT 21) x;
  _rows:=(SELECT coalesce(jsonb_agg(r-'created_at'),'[]') FROM jsonb_array_elements(_rows) r);
  _out:=_out||jsonb_build_object('key','packages','kind','recent','limit',20,'has_more',_n>20,'rows',CASE WHEN _n>20 THEN _rows-20 ELSE _rows END);
 END IF;
 IF public._assistant_source_allowed(_t.scope_kind,_t.required_permissions,'work_items') THEN
  _out:=_out||jsonb_build_object('key','work_items','kind','counts','counts',(SELECT coalesce(jsonb_object_agg(s.status,s.n),'{}') FROM
   (SELECT w.status::text status,count(*) n FROM public.agency_work_items w WHERE w.agency_id=_tgt GROUP BY w.status) s));
 END IF;
 IF public._assistant_source_allowed(_t.scope_kind,_t.required_permissions,'client_requests') THEN
  _out:=_out||jsonb_build_object('key','client_requests','kind','counts','counts',(SELECT coalesce(jsonb_object_agg(s.status,s.n),'{}') FROM
   (SELECT r.status::text status,count(*) n FROM public.agency_client_requests r WHERE r.agency_id=_tgt GROUP BY r.status) s));
 END IF;
 RETURN jsonb_build_object('as_of',statement_timestamp(),'scope_kind',_t.scope_kind,'sections',_out);
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_thread_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_thread_context(uuid) TO authenticated, service_role;

-- Bodyless usage reservation ledger. No prompt/reply text. Survives manual
-- transcript deletion (SET NULL); account deletion cascades through profile.
CREATE TABLE public.assistant_usage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
 thread_id uuid REFERENCES public.assistant_threads(id) ON DELETE SET NULL,
 request_id uuid NOT NULL,
 session_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','completed','failed')),
 lease_id uuid NOT NULL DEFAULT gen_random_uuid(),
 lease_expires_at timestamptz NOT NULL DEFAULT (statement_timestamp()+interval '60 seconds'),
 reply_message_id uuid REFERENCES public.assistant_messages(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 finished_at timestamptz,
 UNIQUE(actor_user_id,request_id)
);
REVOKE ALL ON TABLE public.assistant_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.assistant_usage TO service_role;
ALTER TABLE public.assistant_usage ENABLE ROW LEVEL SECURITY;
CREATE INDEX assistant_usage_actor_created_idx ON public.assistant_usage(actor_user_id,created_at);
COMMENT ON TABLE public.assistant_usage IS 'Bodyless AI attempt metadata, rolling 24h retention via service purge. Never stores prompts or replies.';

CREATE FUNCTION public._assistant_usage_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.created_at:=statement_timestamp(); NEW.lease_id:=gen_random_uuid(); NEW.lease_expires_at:=NEW.created_at+interval '60 seconds';
  NEW.state:='pending'; NEW.finished_at:=NULL; NEW.reply_message_id:=NULL;
 ELSIF NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id OR NEW.request_id IS DISTINCT FROM OLD.request_id
  OR NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
  OR NEW.lease_id IS DISTINCT FROM OLD.lease_id OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
  OR (NEW.thread_id IS DISTINCT FROM OLD.thread_id AND NEW.thread_id IS NOT NULL)
  OR (NEW.state IS DISTINCT FROM OLD.state AND OLD.state<>'pending') THEN
  RAISE EXCEPTION 'Immutable usage' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._assistant_usage_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._assistant_usage_guard() TO service_role;
CREATE TRIGGER assistant_usage_guard BEFORE INSERT OR UPDATE ON public.assistant_usage FOR EACH ROW EXECUTE FUNCTION public._assistant_usage_guard();

-- Atomic append + reservation under per-actor advisory lock. Candidate safety
-- defaults: 20 admitted per rolling 24h, 5 per rolling minute, 1 live lease.
CREATE FUNCTION public.assistant_reserve_turn(_thread_id uuid,_scope_kind text,_target_id uuid,_request_id uuid,_content text)
RETURNS TABLE(status text,reservation_id uuid,lease_id uuid,thread_id uuid,user_message_id uuid,reply_message_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
#variable_conflict use_column
DECLARE _actor uuid:=auth.uid(); _u public.assistant_usage; _thread uuid:=_thread_id; _msg uuid; _body text:=btrim(_content);
BEGIN
 IF _actor IS NULL OR NOT public._assistant_session_valid() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF _request_id IS NULL OR _body IS NULL OR char_length(_body) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Invalid message' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('assistant_usage:'||_actor::text,0));
 SELECT u.* INTO _u FROM public.assistant_usage u WHERE u.actor_user_id=_actor AND u.request_id=_request_id FOR UPDATE;
 IF FOUND THEN
  IF _u.thread_id IS NULL OR (_thread IS NOT NULL AND _thread<>_u.thread_id)
   OR (_thread IS NULL AND NOT EXISTS (SELECT 1 FROM public.assistant_threads t WHERE t.id=_u.thread_id AND t.scope_kind=_scope_kind AND t.scope_target_id=_target_id)) THEN
   RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='22023'; END IF;
  IF NOT public.assistant_thread_live(_u.thread_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assistant_messages m WHERE m.thread_id=_u.thread_id AND m.role='user' AND m.request_id=_request_id AND m.content=_body) THEN
   RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT CASE _u.state WHEN 'pending' THEN 'duplicate_pending' ELSE _u.state END,_u.id,NULL::uuid,_u.thread_id,NULL::uuid,_u.reply_message_id;
  RETURN;
 END IF;
 IF (SELECT count(*) FROM public.assistant_usage u WHERE u.actor_user_id=_actor AND u.created_at>statement_timestamp()-interval '24 hours')>=20 THEN
  RETURN QUERY SELECT 'limit_daily'::text,NULL::uuid,NULL::uuid,_thread,NULL::uuid,NULL::uuid; RETURN; END IF;
 IF (SELECT count(*) FROM public.assistant_usage u WHERE u.actor_user_id=_actor AND u.created_at>statement_timestamp()-interval '1 minute')>=5 THEN
  RETURN QUERY SELECT 'limit_minute'::text,NULL::uuid,NULL::uuid,_thread,NULL::uuid,NULL::uuid; RETURN; END IF;
 IF EXISTS (SELECT 1 FROM public.assistant_usage u WHERE u.actor_user_id=_actor AND u.state='pending' AND u.lease_expires_at>statement_timestamp()) THEN
  RETURN QUERY SELECT 'busy'::text,NULL::uuid,NULL::uuid,_thread,NULL::uuid,NULL::uuid; RETURN; END IF;
 IF _thread IS NULL THEN SELECT s.thread_id INTO _thread FROM public.assistant_start_thread(_scope_kind,_target_id) s; END IF;
 _msg:=public.assistant_add_user_message(_thread,_request_id,_body);
 INSERT INTO public.assistant_usage(actor_user_id,thread_id,request_id,session_id)
 VALUES (_actor,_thread,_request_id,(auth.jwt()->>'session_id')::uuid) RETURNING * INTO _u;
 RETURN QUERY SELECT 'reserved'::text,_u.id,_u.lease_id,_thread,_msg,NULL::uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_reserve_turn(uuid,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_reserve_turn(uuid,text,uuid,uuid,text) TO authenticated, service_role;

-- SERVICE-ONLY finalization. Actor/session/thread derived from the ledger; the
-- JWT claims are set transaction-locally for canonical auth.uid helpers and
-- restored on success and exception. Failure keeps admitted budget.
CREATE FUNCTION public.assistant_finalize_turn(_reservation_id uuid,_lease_id uuid,_success boolean,_content text,_sources text[])
RETURNS TABLE(status text,reply_message_id uuid) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
#variable_conflict use_column
DECLARE _u public.assistant_usage; _t public.assistant_threads; _ok boolean; _msg uuid; _body text:=btrim(_content); _k text;
 _old_sub text:=coalesce(current_setting('request.jwt.claim.sub',true),''); _old_claims text:=coalesce(current_setting('request.jwt.claims',true),'');
BEGIN
 SELECT u.* INTO _u FROM public.assistant_usage u WHERE u.id=_reservation_id FOR UPDATE;
 IF NOT FOUND OR _lease_id IS NULL OR _u.lease_id<>_lease_id THEN RAISE EXCEPTION 'Invalid reservation' USING ERRCODE='42501'; END IF;
 IF _u.state<>'pending' THEN RETURN QUERY SELECT ('already_'||_u.state)::text,_u.reply_message_id; RETURN; END IF;
 IF _u.lease_expires_at<=statement_timestamp() OR _u.thread_id IS NULL THEN
  UPDATE public.assistant_usage u SET state='failed',finished_at=statement_timestamp() WHERE u.id=_u.id;
  RETURN QUERY SELECT 'rejected'::text,NULL::uuid; RETURN; END IF;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub',_u.actor_user_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_u.actor_user_id,'session_id',_u.session_id,'role','authenticated')::text,true);
  _ok:=public.assistant_thread_live(_u.thread_id);
  PERFORM set_config('request.jwt.claim.sub',_old_sub,true); PERFORM set_config('request.jwt.claims',_old_claims,true);
 EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub',_old_sub,true); PERFORM set_config('request.jwt.claims',_old_claims,true);
  RAISE;
 END;
 SELECT t.* INTO _t FROM public.assistant_threads t WHERE t.id=_u.thread_id;
 IF NOT coalesce(_ok,false) OR NOT coalesce(_success,false) OR _body IS NULL OR char_length(_body) NOT BETWEEN 1 AND 8000
  OR _sources IS NULL OR array_position(_sources,NULL) IS NOT NULL THEN
  UPDATE public.assistant_usage u SET state='failed',finished_at=statement_timestamp() WHERE u.id=_u.id;
  RETURN QUERY SELECT CASE WHEN NOT coalesce(_ok,false) THEN 'rejected' WHEN NOT coalesce(_success,false) THEN 'failed' ELSE 'invalid' END::text,NULL::uuid; RETURN;
 END IF;
 FOREACH _k IN ARRAY _sources LOOP
  IF NOT public._assistant_source_allowed(_t.scope_kind,_t.required_permissions,_k) THEN
   UPDATE public.assistant_usage u SET state='failed',finished_at=statement_timestamp() WHERE u.id=_u.id;
   RETURN QUERY SELECT 'invalid'::text,NULL::uuid; RETURN;
  END IF;
 END LOOP;
 INSERT INTO public.assistant_messages(thread_id,role,content,request_id,sources)
 VALUES (_u.thread_id,'assistant',_body,_u.request_id,(SELECT coalesce(array_agg(DISTINCT s),'{}') FROM unnest(_sources) s)) RETURNING id INTO _msg;
 UPDATE public.assistant_usage u SET state='completed',finished_at=statement_timestamp(),reply_message_id=_msg WHERE u.id=_u.id;
 RETURN QUERY SELECT 'completed'::text,_msg;
END;
$$;
REVOKE ALL ON FUNCTION public.assistant_finalize_turn(uuid,uuid,boolean,text,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_finalize_turn(uuid,uuid,boolean,text,text[]) TO service_role;

-- No cron, scheduler, model spend, or operational writes.
COMMIT;
