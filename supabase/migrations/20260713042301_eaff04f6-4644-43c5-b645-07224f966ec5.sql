-- Phase 1C-2 — Stripe webhook retry-safe idempotency (DEF-23)
-- Evolves public.stripe_webhook_events into a state-machine ledger and adds
-- three narrowly scoped SECURITY DEFINER RPCs (claim/complete/fail).

-- 1. Schema evolution -------------------------------------------------------

ALTER TABLE public.stripe_webhook_events
  ALTER COLUMN processed_at DROP NOT NULL,
  ALTER COLUMN processed_at DROP DEFAULT;

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS processing_status text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS result_code text,
  ADD COLUMN IF NOT EXISTS last_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Historical rows: preserve as terminally processed, never replayed.
UPDATE public.stripe_webhook_events
SET processing_status = 'processed',
    result_code       = COALESCE(result_code, 'legacy_processed')
WHERE processing_status IS NULL;

ALTER TABLE public.stripe_webhook_events
  ALTER COLUMN processing_status SET NOT NULL;

-- State consistency constraints.
ALTER TABLE public.stripe_webhook_events
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_status_ck,
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_attempt_ck,
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_result_code_ck,
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_error_code_ck,
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_processing_shape_ck,
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_processed_shape_ck,
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_failed_shape_ck;

ALTER TABLE public.stripe_webhook_events
  ADD CONSTRAINT stripe_webhook_events_status_ck
    CHECK (processing_status IN ('processing','processed','failed')),
  ADD CONSTRAINT stripe_webhook_events_attempt_ck
    CHECK (attempt_count >= 1),
  ADD CONSTRAINT stripe_webhook_events_result_code_ck
    CHECK (result_code IS NULL OR result_code IN ('applied','rejected','ignored','legacy_processed')),
  ADD CONSTRAINT stripe_webhook_events_error_code_ck
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
  ADD CONSTRAINT stripe_webhook_events_processing_shape_ck
    CHECK (processing_status <> 'processing' OR (
      claim_token IS NOT NULL
      AND processing_started_at IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND processed_at IS NULL
    )),
  ADD CONSTRAINT stripe_webhook_events_processed_shape_ck
    CHECK (processing_status <> 'processed' OR (
      processed_at IS NOT NULL
      AND result_code IS NOT NULL
      AND claim_token IS NULL
      AND lease_expires_at IS NULL
    )),
  ADD CONSTRAINT stripe_webhook_events_failed_shape_ck
    CHECK (processing_status <> 'failed' OR (
      last_failed_at IS NOT NULL
      AND last_error_code IS NOT NULL
      AND claim_token IS NULL
      AND lease_expires_at IS NULL
      AND processed_at IS NULL
    ));

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processing_lease
  ON public.stripe_webhook_events (lease_expires_at)
  WHERE processing_status = 'processing';

-- 2. Atomic claim RPC -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_lease_seconds integer
) RETURNS TABLE(result text, claim_token uuid, attempt integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease   integer;
  v_token   uuid := gen_random_uuid();
  v_now     timestamptz := now();
  v_row     public.stripe_webhook_events%ROWTYPE;
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) = 0 OR length(p_event_id) > 255 THEN
    RAISE EXCEPTION 'invalid_event_id';
  END IF;
  IF p_event_type IS NULL OR length(p_event_type) = 0 OR length(p_event_type) > 128 THEN
    RAISE EXCEPTION 'invalid_event_type';
  END IF;

  v_lease := GREATEST(30, LEAST(900, COALESCE(p_lease_seconds, 300)));

  -- Try atomic first-claim insert.
  BEGIN
    INSERT INTO public.stripe_webhook_events (
      stripe_event_id, event_type, processing_status, attempt_count,
      processing_started_at, lease_expires_at, claim_token,
      processed_at, result_code, updated_at
    ) VALUES (
      p_event_id, p_event_type, 'processing', 1,
      v_now, v_now + make_interval(secs => v_lease), v_token,
      NULL, NULL, v_now
    );
    result := 'claimed'; claim_token := v_token; attempt := 1;
    RETURN NEXT;
    RETURN;
  EXCEPTION WHEN unique_violation THEN
    NULL; -- fall through
  END;

  SELECT * INTO v_row FROM public.stripe_webhook_events
   WHERE stripe_event_id = p_event_id FOR UPDATE;

  -- Event-type conflict — check BEFORE any state change.
  IF v_row.event_type <> p_event_type THEN
    result := 'event_type_conflict'; claim_token := NULL; attempt := v_row.attempt_count;
    RETURN NEXT; RETURN;
  END IF;

  IF v_row.processing_status = 'processed' THEN
    result := 'already_processed'; claim_token := NULL; attempt := v_row.attempt_count;
    RETURN NEXT; RETURN;
  END IF;

  IF v_row.processing_status = 'processing'
     AND v_row.lease_expires_at > v_now THEN
    result := 'in_progress'; claim_token := NULL; attempt := v_row.attempt_count;
    RETURN NEXT; RETURN;
  END IF;

  -- Reclaim: failed OR expired-processing.
  UPDATE public.stripe_webhook_events
     SET processing_status      = 'processing',
         attempt_count          = v_row.attempt_count + 1,
         processing_started_at  = v_now,
         lease_expires_at       = v_now + make_interval(secs => v_lease),
         claim_token            = v_token,
         last_error_code        = NULL,
         updated_at             = v_now
   WHERE stripe_event_id = p_event_id;

  result := 'claimed'; claim_token := v_token; attempt := v_row.attempt_count + 1;
  RETURN NEXT;
END;
$$;

-- 3. Completion RPC ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_stripe_webhook_event(
  p_event_id text,
  p_claim_token uuid,
  p_result_code text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_event_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;
  IF p_result_code IS NULL OR p_result_code NOT IN ('applied','rejected','ignored') THEN
    RAISE EXCEPTION 'invalid_result_code';
  END IF;

  UPDATE public.stripe_webhook_events
     SET processing_status  = 'processed',
         processed_at       = now(),
         result_code        = p_result_code,
         claim_token        = NULL,
         lease_expires_at   = NULL,
         last_error_code    = NULL,
         updated_at         = now()
   WHERE stripe_event_id  = p_event_id
     AND claim_token      = p_claim_token
     AND processing_status = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- 4. Failure RPC ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fail_stripe_webhook_event(
  p_event_id text,
  p_claim_token uuid,
  p_error_code text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_event_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;
  IF p_error_code IS NULL OR p_error_code !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_error_code';
  END IF;

  UPDATE public.stripe_webhook_events
     SET processing_status = 'failed',
         last_failed_at    = now(),
         last_error_code   = p_error_code,
         claim_token       = NULL,
         lease_expires_at  = NULL,
         updated_at        = now()
   WHERE stripe_event_id  = p_event_id
     AND claim_token      = p_claim_token
     AND processing_status = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- 5. Privilege lockdown -----------------------------------------------------

REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text,text,integer)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_stripe_webhook_event(text,uuid,text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_stripe_webhook_event(text,uuid,text)      FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text,text,integer)  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_stripe_webhook_event(text,uuid,text)  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_stripe_webhook_event(text,uuid,text)      FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text,text,integer)   TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_stripe_webhook_event(text,uuid,text)   TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_stripe_webhook_event(text,uuid,text)       TO service_role;