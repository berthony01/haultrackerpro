
-- Phase C: controlled recruiter contact requests

CREATE TABLE IF NOT EXISTS public.recruiter_contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.opportunity_applications(id) ON DELETE CASCADE,
  recruiter_user_id uuid NOT NULL,
  driver_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  recruiter_note text,
  driver_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT recruiter_contact_requests_status_chk
    CHECK (status IN ('pending','approved','declined','expired'))
);

CREATE INDEX IF NOT EXISTS idx_rcr_application ON public.recruiter_contact_requests(application_id);
CREATE INDEX IF NOT EXISTS idx_rcr_driver ON public.recruiter_contact_requests(driver_user_id);
CREATE INDEX IF NOT EXISTS idx_rcr_recruiter ON public.recruiter_contact_requests(recruiter_user_id);

-- Only one pending request per application
CREATE UNIQUE INDEX IF NOT EXISTS uq_rcr_one_pending_per_app
  ON public.recruiter_contact_requests(application_id)
  WHERE status = 'pending';

ALTER TABLE public.recruiter_contact_requests ENABLE ROW LEVEL SECURITY;

-- Drivers read their own
CREATE POLICY "rcr_driver_select"
ON public.recruiter_contact_requests
FOR SELECT
TO authenticated
USING (driver_user_id = auth.uid());

-- Recruiters read their own (verified via recruiter_profile ownership of the application)
CREATE POLICY "rcr_recruiter_select"
ON public.recruiter_contact_requests
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.opportunity_applications oa
    JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id
    WHERE oa.id = recruiter_contact_requests.application_id
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  )
);

-- Admins read all
CREATE POLICY "rcr_admin_all"
ON public.recruiter_contact_requests
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- No direct INSERT/UPDATE/DELETE from clients — must go through RPCs.

-- updated_at trigger
CREATE TRIGGER trg_rcr_updated_at
BEFORE UPDATE ON public.recruiter_contact_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Emit application_events on contact-request lifecycle
CREATE OR REPLACE FUNCTION public.rcr_emit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event text;
  _actor_type text := 'system';
  _actor uuid := auth.uid();
  _meta jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _event := 'contact_request_created';
    _actor_type := 'recruiter';
    _actor := COALESCE(_actor, NEW.recruiter_user_id);
    IF NEW.recruiter_note IS NOT NULL THEN
      _meta := jsonb_build_object('note', NEW.recruiter_note);
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'approved' THEN
      _event := 'contact_request_approved';
      _actor_type := 'driver';
      _actor := COALESCE(_actor, NEW.driver_user_id);
    ELSIF NEW.status = 'declined' THEN
      _event := 'contact_request_declined';
      _actor_type := 'driver';
      _actor := COALESCE(_actor, NEW.driver_user_id);
    ELSIF NEW.status = 'expired' THEN
      _event := 'contact_request_expired';
      _actor_type := 'system';
    ELSE
      RETURN NEW;
    END IF;
    IF NEW.driver_note IS NOT NULL THEN
      _meta := jsonb_build_object('note', NEW.driver_note);
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.application_events
    (application_id, actor_type, actor_user_id, event_type, metadata)
  VALUES
    (NEW.application_id, _actor_type, _actor, _event, _meta);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rcr_emit_event
AFTER INSERT OR UPDATE ON public.recruiter_contact_requests
FOR EACH ROW EXECUTE FUNCTION public.rcr_emit_event();

-- Recruiter creates a contact request
CREATE OR REPLACE FUNCTION public.request_driver_contact(
  application_id uuid,
  recruiter_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _app public.opportunity_applications;
  _rp public.recruiter_profiles;
  _note text;
  _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _app FROM public.opportunity_applications WHERE id = application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO _rp FROM public.recruiter_profiles WHERE id = _app.recruiter_id;
  IF NOT FOUND OR _rp.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _rp.verification_status <> 'approved'
     OR _rp.status = 'suspended'
     OR _rp.verification_status = 'suspended' THEN
    RAISE EXCEPTION 'Recruiter must be approved and active' USING ERRCODE = '42501';
  END IF;

  IF _app.status IN ('hired','rejected','withdrawn') THEN
    RAISE EXCEPTION 'Application is closed' USING ERRCODE = '22023';
  END IF;

  -- Block duplicate pending (unique partial index also enforces this)
  IF EXISTS (
    SELECT 1 FROM public.recruiter_contact_requests
    WHERE application_id = _app.id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A contact request is already pending for this application' USING ERRCODE = '22023';
  END IF;

  -- Block re-request after decline unless admin re-opens
  IF EXISTS (
    SELECT 1 FROM public.recruiter_contact_requests
    WHERE application_id = _app.id AND status = 'declined'
  ) THEN
    RAISE EXCEPTION 'Driver previously declined contact for this application' USING ERRCODE = '22023';
  END IF;

  _note := NULLIF(left(coalesce(recruiter_note, ''), 300), '');

  INSERT INTO public.recruiter_contact_requests
    (application_id, recruiter_user_id, driver_user_id, status, recruiter_note)
  VALUES
    (_app.id, auth.uid(), _app.driver_user_id, 'pending', _note)
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- Driver approves or declines
CREATE OR REPLACE FUNCTION public.respond_to_contact_request(
  request_id uuid,
  decision text,
  driver_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.recruiter_contact_requests;
  _note text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF decision NOT IN ('approved','declined') THEN
    RAISE EXCEPTION 'Invalid decision' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _row FROM public.recruiter_contact_requests WHERE id = request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact request not found' USING ERRCODE = 'P0002';
  END IF;

  IF _row.driver_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _row.status <> 'pending' THEN
    RAISE EXCEPTION 'Contact request already resolved' USING ERRCODE = '22023';
  END IF;

  _note := NULLIF(left(coalesce(driver_note, ''), 300), '');

  UPDATE public.recruiter_contact_requests
  SET status = decision,
      driver_note = _note,
      responded_at = now(),
      updated_at = now()
  WHERE id = request_id;
END;
$$;

-- Lazy expiration helper (7 days)
CREATE OR REPLACE FUNCTION public.expire_stale_contact_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  UPDATE public.recruiter_contact_requests
  SET status = 'expired',
      responded_at = now(),
      updated_at = now()
  WHERE status = 'pending'
    AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
