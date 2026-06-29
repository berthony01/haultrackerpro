
-- Phase 4C: Agency slugs, work-queue deep links, waiting-on-driver workflow

-- 1) citext for case-insensitive slugs
CREATE EXTENSION IF NOT EXISTS citext;

-- 2) Slug column on agency_profiles
ALTER TABLE public.agency_profiles
  ADD COLUMN IF NOT EXISTS slug citext;

CREATE UNIQUE INDEX IF NOT EXISTS agency_profiles_slug_uidx
  ON public.agency_profiles(slug) WHERE slug IS NOT NULL;

-- Slug format validation trigger (lowercase, 3-40 chars, [a-z0-9-], not starting/ending with -)
CREATE OR REPLACE FUNCTION public.tg_validate_agency_slug()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.slug IS NOT NULL THEN
    IF NOT (NEW.slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$') THEN
      RAISE EXCEPTION 'Slug must be 3-40 chars, lowercase letters, digits, or dashes (no leading/trailing dash).' USING ERRCODE='22023';
    END IF;
    -- Reserve a few system words
    IF NEW.slug IN ('admin','api','auth','agency','driver','assistant','request','requests','new','settings') THEN
      RAISE EXCEPTION 'Reserved slug' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS agency_profiles_validate_slug ON public.agency_profiles;
CREATE TRIGGER agency_profiles_validate_slug
  BEFORE INSERT OR UPDATE OF slug ON public.agency_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_agency_slug();

-- 3) RPC: owner sets agency slug
CREATE OR REPLACE FUNCTION public.set_agency_slug(_agency_id uuid, _slug text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _uid uuid := auth.uid();
  _normalized text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  IF NOT public.is_agency_owner(_agency_id, _uid) THEN
    RAISE EXCEPTION 'Not the agency owner' USING ERRCODE='42501';
  END IF;
  _normalized := NULLIF(lower(trim(_slug)), '');
  UPDATE public.agency_profiles
    SET slug = _normalized, updated_at = now()
  WHERE id = _agency_id;
  RETURN _normalized;
END $$;
REVOKE ALL ON FUNCTION public.set_agency_slug(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_agency_slug(uuid,text) TO authenticated;

-- 4) RPC: resolve slug -> agency public view (any authenticated user)
CREATE OR REPLACE FUNCTION public.resolve_agency_slug(_slug text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.agency_profiles
   WHERE slug = lower(trim(_slug)) AND status = 'active'
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.resolve_agency_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_agency_slug(text) TO authenticated, anon;

-- 5) Driver response note on work items
ALTER TABLE public.agency_work_items
  ADD COLUMN IF NOT EXISTS last_driver_response text,
  ADD COLUMN IF NOT EXISTS last_driver_response_at timestamptz;

-- 6) RPC: list_my_waiting_work_items (driver-side)
CREATE OR REPLACE FUNCTION public.list_my_waiting_work_items()
RETURNS TABLE (
  id uuid, agency_id uuid, agency_name text, title text, description text,
  type public.agency_work_item_type, priority public.agency_work_item_priority,
  due_date date, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT w.id, w.agency_id, ap.name, w.title, w.description, w.type, w.priority,
         w.due_date, w.created_at, w.updated_at
    FROM public.agency_work_items w
    JOIN public.agency_profiles ap ON ap.id = w.agency_id
   WHERE w.driver_user_id = auth.uid()
     AND w.status = 'waiting_on_driver'
   ORDER BY w.updated_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_my_waiting_work_items() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_waiting_work_items() TO authenticated;

-- 7) RPC: get a single waiting item by id for the driver (for deep links)
CREATE OR REPLACE FUNCTION public.get_my_waiting_work_item(_id uuid)
RETURNS TABLE (
  id uuid, agency_id uuid, agency_name text, title text, description text,
  type public.agency_work_item_type, priority public.agency_work_item_priority,
  status public.agency_work_item_status,
  due_date date, last_driver_response text, last_driver_response_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT w.id, w.agency_id, ap.name, w.title, w.description, w.type, w.priority,
         w.status, w.due_date, w.last_driver_response, w.last_driver_response_at,
         w.created_at, w.updated_at
    FROM public.agency_work_items w
    JOIN public.agency_profiles ap ON ap.id = w.agency_id
   WHERE w.id = _id AND w.driver_user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_my_waiting_work_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_waiting_work_item(uuid) TO authenticated;

-- 8) RPC: driver responds to waiting work item (sets status back to in_progress + notifies)
CREATE OR REPLACE FUNCTION public.driver_respond_to_work_item(_id uuid, _response text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _uid uuid := auth.uid();
  _w public.agency_work_items%ROWTYPE;
  _owner uuid;
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

  -- Notify the agency owner
  IF _owner IS NOT NULL THEN
    PERFORM public.create_notification(
      _owner, 'agency_work_item_driver_responded', 'agency_work_item', _id,
      jsonb_build_object('agency_id', _w.agency_id, 'work_item_id', _id, 'title', _w.title)
    );
  END IF;
  -- Notify assigned member if different
  IF _w.assigned_member_user_id IS NOT NULL AND _w.assigned_member_user_id <> COALESCE(_owner, _uid) THEN
    PERFORM public.create_notification(
      _w.assigned_member_user_id, 'agency_work_item_driver_responded',
      'agency_work_item', _id,
      jsonb_build_object('agency_id', _w.agency_id, 'work_item_id', _id, 'title', _w.title)
    );
  END IF;

  -- Audit (best effort)
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

-- 9) Allow driver to SELECT a work item that has their last response (still visible
--    after they push it back to in_progress, so the deep-link page can confirm).
DROP POLICY IF EXISTS awi_driver_responded_select ON public.agency_work_items;
CREATE POLICY awi_driver_responded_select ON public.agency_work_items
  FOR SELECT TO authenticated
  USING (driver_user_id = auth.uid()
         AND last_driver_response_at IS NOT NULL
         AND last_driver_response_at > now() - interval '7 days');
