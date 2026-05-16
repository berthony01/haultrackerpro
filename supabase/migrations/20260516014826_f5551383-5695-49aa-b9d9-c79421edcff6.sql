
-- =========================================================
-- PHASE A: Status expansion + guard update
-- =========================================================

-- Migrate legacy 'contacted' rows to new 'contact_requested'
UPDATE public.opportunity_applications
SET status = 'contact_requested'
WHERE status = 'contacted';

-- Replace status guard with new 8-stage forward-only ladder
CREATE OR REPLACE FUNCTION public.opportunity_applications_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _old_rank int;
  _new_rank int;
  _allow_withdraw boolean;
BEGIN
  -- Admins bypass restrictions
  IF public.is_admin(auth.uid()) THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Block edits to protected fields
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
     OR NEW.driver_user_id IS DISTINCT FROM OLD.driver_user_id
     OR NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id
     OR NEW.driver_profile_id IS DISTINCT FROM OLD.driver_profile_id
     OR NEW.application_type IS DISTINCT FROM OLD.application_type
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.preferred_contact_method IS DISTINCT FROM OLD.preferred_contact_method
     OR NEW.driver_phone_snapshot IS DISTINCT FROM OLD.driver_phone_snapshot
     OR NEW.driver_email_snapshot IS DISTINCT FROM OLD.driver_email_snapshot
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Recruiters may only update application status.'
      USING ERRCODE = '42501';
  END IF;

  -- Status change rules
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    _allow_withdraw := (current_setting('app.allow_driver_withdraw', true) = 'true');

    IF _allow_withdraw AND NEW.status = 'withdrawn' THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;

    -- Block any change from a terminal status
    IF OLD.status IN ('withdrawn','hired','rejected') THEN
      RAISE EXCEPTION 'Terminal application status cannot be changed.'
        USING ERRCODE = '42501';
    END IF;

    -- Recruiters (and non-RPC callers) cannot set withdrawn
    IF NEW.status = 'withdrawn' THEN
      RAISE EXCEPTION 'Only the driver can withdraw an application.'
        USING ERRCODE = '42501';
    END IF;

    -- Forward-only 8-stage ladder
    _old_rank := CASE OLD.status
      WHEN 'new' THEN 1
      WHEN 'viewed' THEN 2
      WHEN 'contact_requested' THEN 3
      WHEN 'contacted' THEN 3
      WHEN 'call_scheduled' THEN 4
      WHEN 'waiting_documents' THEN 5
      WHEN 'interviewing' THEN 6
      WHEN 'offer_sent' THEN 7
      WHEN 'hired' THEN 8
      WHEN 'rejected' THEN 8
      ELSE 0
    END;

    _new_rank := CASE NEW.status
      WHEN 'new' THEN 1
      WHEN 'viewed' THEN 2
      WHEN 'contact_requested' THEN 3
      WHEN 'call_scheduled' THEN 4
      WHEN 'waiting_documents' THEN 5
      WHEN 'interviewing' THEN 6
      WHEN 'offer_sent' THEN 7
      WHEN 'hired' THEN 8
      WHEN 'rejected' THEN 8
      ELSE 0
    END;

    IF _new_rank = 0 THEN
      RAISE EXCEPTION 'Invalid application status.'
        USING ERRCODE = '22023';
    END IF;

    IF _new_rank < _old_rank THEN
      RAISE EXCEPTION 'Application status cannot move backward.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- =========================================================
-- PHASE B: application_events table + RLS + trigger + RPC
-- =========================================================

CREATE TABLE IF NOT EXISTS public.application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.opportunity_applications(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('driver','recruiter','system','admin')),
  actor_user_id uuid,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_events_app_created
  ON public.application_events (application_id, created_at DESC);

ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Driver views own application events" ON public.application_events;
CREATE POLICY "Driver views own application events"
ON public.application_events FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.opportunity_applications oa
  WHERE oa.id = application_events.application_id
    AND oa.driver_user_id = auth.uid()
));

DROP POLICY IF EXISTS "Recruiter views events for own applications" ON public.application_events;
CREATE POLICY "Recruiter views events for own applications"
ON public.application_events FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.opportunity_applications oa
  JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id
  WHERE oa.id = application_events.application_id
    AND rp.user_id = auth.uid()
    AND rp.status <> 'suspended'
    AND rp.verification_status <> 'suspended'
));

DROP POLICY IF EXISTS "Admins view all application events" ON public.application_events;
CREATE POLICY "Admins view all application events"
ON public.application_events FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

-- No INSERT/UPDATE/DELETE policies => only SECURITY DEFINER code can write.

-- Emit trigger: insert on application_applications create, update on status change
CREATE OR REPLACE FUNCTION public.application_events_emit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor_type text := 'system';
  _actor uuid := auth.uid();
  _is_driver boolean := false;
  _is_recruiter boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.application_events (application_id, actor_type, actor_user_id, event_type, metadata)
    VALUES (NEW.id, 'driver', NEW.driver_user_id, 'application_created', '{}'::jsonb);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF _actor IS NOT NULL THEN
      IF _actor = NEW.driver_user_id THEN
        _is_driver := true;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.recruiter_profiles rp
          WHERE rp.id = NEW.recruiter_id AND rp.user_id = _actor
        ) INTO _is_recruiter;
      END IF;
    END IF;

    IF public.is_admin(_actor) THEN
      _actor_type := 'admin';
    ELSIF _is_driver THEN
      _actor_type := 'driver';
    ELSIF _is_recruiter THEN
      _actor_type := 'recruiter';
    ELSE
      _actor_type := 'system';
    END IF;

    INSERT INTO public.application_events (application_id, actor_type, actor_user_id, event_type, metadata)
    VALUES (NEW.id, _actor_type, _actor, NEW.status, jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_application_events_emit_ins ON public.opportunity_applications;
CREATE TRIGGER trg_application_events_emit_ins
AFTER INSERT ON public.opportunity_applications
FOR EACH ROW EXECUTE FUNCTION public.application_events_emit();

DROP TRIGGER IF EXISTS trg_application_events_emit_upd ON public.opportunity_applications;
CREATE TRIGGER trg_application_events_emit_upd
AFTER UPDATE OF status ON public.opportunity_applications
FOR EACH ROW EXECUTE FUNCTION public.application_events_emit();

-- Driver structured response RPC (does NOT change status)
CREATE OR REPLACE FUNCTION public.record_driver_application_response(
  application_id uuid,
  response_type text,
  note text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.opportunity_applications;
  _event_type text;
  _note text;
  _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF response_type NOT IN ('still_interested','request_callback','need_more_info','not_interested') THEN
    RAISE EXCEPTION 'Invalid response type' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _row FROM public.opportunity_applications WHERE id = application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002';
  END IF;

  IF _row.driver_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _row.status IN ('hired','rejected','withdrawn') THEN
    RAISE EXCEPTION 'Application is closed' USING ERRCODE = '22023';
  END IF;

  _event_type := 'driver_' || response_type;
  _note := NULLIF(left(coalesce(note, ''), 200), '');

  INSERT INTO public.application_events (application_id, actor_type, actor_user_id, event_type, metadata)
  VALUES (
    application_id,
    'driver',
    auth.uid(),
    _event_type,
    CASE WHEN _note IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('note', _note) END
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$function$;

-- Backfill application_created events for existing applications missing one
INSERT INTO public.application_events (application_id, actor_type, actor_user_id, event_type, created_at)
SELECT oa.id, 'driver', oa.driver_user_id, 'application_created', oa.created_at
FROM public.opportunity_applications oa
WHERE NOT EXISTS (
  SELECT 1 FROM public.application_events ae
  WHERE ae.application_id = oa.id AND ae.event_type = 'application_created'
);
