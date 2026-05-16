-- 1) Backfill legacy 'contacted' rows
UPDATE public.opportunity_applications
SET status = 'contact_requested'
WHERE status = 'contacted';

-- 2) Replace status check constraint with full canonical workflow set
ALTER TABLE public.opportunity_applications
  DROP CONSTRAINT IF EXISTS opportunity_applications_status_chk;

ALTER TABLE public.opportunity_applications
  ADD CONSTRAINT opportunity_applications_status_chk
  CHECK (status = ANY (ARRAY[
    'new','viewed','contact_requested','call_scheduled',
    'waiting_documents','interviewing','offer_sent',
    'hired','rejected','withdrawn'
  ]));

-- 3) Tighten guard: enforce exact legal transitions (no broad rank jumps)
CREATE OR REPLACE FUNCTION public.opportunity_applications_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _allow_withdraw boolean;
  _allowed text[];
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

    -- Exact legal transitions (recruiter)
    _allowed := CASE OLD.status
      WHEN 'new'                THEN ARRAY['viewed','contact_requested','rejected']
      WHEN 'viewed'             THEN ARRAY['contact_requested','rejected']
      WHEN 'contact_requested'  THEN ARRAY['call_scheduled','rejected']
      WHEN 'contacted'          THEN ARRAY['call_scheduled','rejected']
      WHEN 'call_scheduled'     THEN ARRAY['waiting_documents','interviewing','rejected']
      WHEN 'waiting_documents'  THEN ARRAY['interviewing','rejected']
      WHEN 'interviewing'       THEN ARRAY['offer_sent','rejected']
      WHEN 'offer_sent'         THEN ARRAY['hired','rejected']
      ELSE ARRAY[]::text[]
    END;

    IF NOT (NEW.status = ANY (_allowed)) THEN
      RAISE EXCEPTION 'Illegal application status transition from % to %.', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
