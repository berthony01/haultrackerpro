-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase TG-1 — Canonical Dispatch Load Foundation.
--
-- Locked contract:
--   * `public.loads` stays the SINGLE canonical driver load table. This phase
--     creates NO parallel Telegram load table and NO Telegram-specific
--     storage, webhook, or API surface.
--   * Direct `public.loads` RLS is NOT broadened. Driver ownership plus the
--     existing Driver Assistant policies remain exactly as they are. Company
--     dispatch happens only through the SECURITY DEFINER RPCs below.
--   * Recruiter staff authorization stays explicit-permission based through
--     `public.recruiter_workspace_permission` and
--     `public.current_user_has_recruiter_permission`. Role labels grant
--     nothing; there is no role shortcut anywhere in this file.
--   * Settlement tables, functions and RLS are untouched. No settlement item
--     is auto-created and no payroll is finalized here.
--   * Financial mileage is COMPLETED-only. Assigned (pending/en_route) miles
--     are reported separately and are never folded into completed totals.

-- ---------------------------------------------------------------------------
-- A. Permission vocabulary — APPEND ONLY
-- ---------------------------------------------------------------------------
-- Enum additions are committed separately so later statements may safely
-- reference the new labels.
BEGIN;
ALTER TYPE public.recruiter_workspace_permission ADD VALUE IF NOT EXISTS 'loads_view';
ALTER TYPE public.recruiter_workspace_permission ADD VALUE IF NOT EXISTS 'loads_dispatch';
ALTER TYPE public.recruiter_workspace_permission ADD VALUE IF NOT EXISTS 'loads_update_status';
COMMIT;

BEGIN;

-- ---------------------------------------------------------------------------
-- B. Company-side employment date
-- ---------------------------------------------------------------------------
-- Company authority for the hire date. The driver's personal
-- `user_settings.company_start_date` is NOT company authority and is not read.
ALTER TABLE public.carrier_driver_relationships
  ADD COLUMN IF NOT EXISTS employment_start_date date NULL;

-- ---------------------------------------------------------------------------
-- C. Company dispatch / pay-period settings foundation (no UI in TG-1)
-- ---------------------------------------------------------------------------
ALTER TABLE public.recruiter_profiles
  ADD COLUMN IF NOT EXISTS dispatch_week_start_day text NOT NULL DEFAULT 'sunday';
ALTER TABLE public.recruiter_profiles
  ADD COLUMN IF NOT EXISTS pay_period_cadence text NOT NULL DEFAULT 'weekly';
ALTER TABLE public.recruiter_profiles
  ADD COLUMN IF NOT EXISTS pay_period_anchor_date date NULL;

ALTER TABLE public.recruiter_profiles
  DROP CONSTRAINT IF EXISTS recruiter_profiles_dispatch_week_start_day_check;
ALTER TABLE public.recruiter_profiles
  ADD CONSTRAINT recruiter_profiles_dispatch_week_start_day_check
  CHECK (dispatch_week_start_day = ANY (ARRAY[
    'sunday','monday','tuesday','wednesday','thursday','friday','saturday'
  ]));

ALTER TABLE public.recruiter_profiles
  DROP CONSTRAINT IF EXISTS recruiter_profiles_pay_period_cadence_check;
ALTER TABLE public.recruiter_profiles
  ADD CONSTRAINT recruiter_profiles_pay_period_cadence_check
  CHECK (pay_period_cadence = ANY (ARRAY['weekly','biweekly']));

-- Shape rule: weekly may omit the anchor; biweekly REQUIRES one.
ALTER TABLE public.recruiter_profiles
  DROP CONSTRAINT IF EXISTS recruiter_profiles_pay_period_anchor_shape_check;
ALTER TABLE public.recruiter_profiles
  ADD CONSTRAINT recruiter_profiles_pay_period_anchor_shape_check
  CHECK (
    pay_period_cadence <> 'biweekly' OR pay_period_anchor_date IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- D. Canonical loads extension — no parallel table
-- ---------------------------------------------------------------------------
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS carrier_driver_relationship_id uuid NULL
  REFERENCES public.carrier_driver_relationships(id) ON DELETE SET NULL;
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS load_reference text NULL;
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS origin_channel text NOT NULL DEFAULT 'web';

ALTER TABLE public.loads
  DROP CONSTRAINT IF EXISTS loads_load_reference_length_check;
ALTER TABLE public.loads
  ADD CONSTRAINT loads_load_reference_length_check
  CHECK (load_reference IS NULL OR char_length(load_reference) <= 200);

ALTER TABLE public.loads
  DROP CONSTRAINT IF EXISTS loads_origin_channel_check;
ALTER TABLE public.loads
  ADD CONSTRAINT loads_origin_channel_check
  CHECK (origin_channel = ANY (ARRAY['web','telegram','import','api']));

-- Four-state operational vocabulary. `en_route` is added; nothing is removed.
ALTER TABLE public.loads DROP CONSTRAINT IF EXISTS loads_status_check;
ALTER TABLE public.loads
  ADD CONSTRAINT loads_status_check
  CHECK (status = ANY (ARRAY['pending','en_route','completed','cancelled']));

-- Company-linked retrieval by relationship / status / effective chronology.
CREATE INDEX IF NOT EXISTS idx_loads_relationship_status_effective_date
  ON public.loads (carrier_driver_relationship_id, status, (COALESCE(dropoff_date, load_date)) DESC)
  WHERE carrier_driver_relationship_id IS NOT NULL;

-- NOTE: existing ownership (`user_id`) and existing direct RLS policies on
-- public.loads are deliberately NOT modified by this migration.

-- ---------------------------------------------------------------------------
-- E. Append-only load audit events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.load_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_id uuid NULL REFERENCES public.recruiter_profiles(id) ON DELETE SET NULL,
  carrier_driver_relationship_id uuid NULL REFERENCES public.carrier_driver_relationships(id) ON DELETE SET NULL,
  actor_user_id uuid NULL,
  event_type text NOT NULL CHECK (event_type = ANY (ARRAY['created','status_changed','updated'])),
  source_channel text NOT NULL CHECK (source_channel = ANY (ARRAY['web','telegram','import','api'])),
  from_status text NULL CHECK (from_status IS NULL OR from_status = ANY (ARRAY['pending','en_route','completed','cancelled'])),
  to_status text NULL CHECK (to_status IS NULL OR to_status = ANY (ARRAY['pending','en_route','completed','cancelled'])),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.load_events TO authenticated;
GRANT ALL ON public.load_events TO service_role;

ALTER TABLE public.load_events ENABLE ROW LEVEL SECURITY;

-- Driver read only. No client INSERT/UPDATE/DELETE policy exists anywhere:
-- every write goes through the SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS "Drivers read their own load events" ON public.load_events;
CREATE POLICY "Drivers read their own load events"
  ON public.load_events FOR SELECT
  TO authenticated
  USING (auth.uid() = driver_user_id);

CREATE INDEX IF NOT EXISTS idx_load_events_load_created ON public.load_events (load_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_load_events_driver_created ON public.load_events (driver_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_load_events_relationship_created ON public.load_events (carrier_driver_relationship_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- F. Generic dispatch idempotency receipts (NOT Telegram-specific storage)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispatch_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  carrier_driver_relationship_id uuid NOT NULL REFERENCES public.carrier_driver_relationships(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  action text NOT NULL CHECK (action = ANY (ARRAY['create_load','update_status'])),
  load_id uuid NULL REFERENCES public.loads(id) ON DELETE SET NULL,
  actor_user_id uuid NOT NULL,
  source_channel text NOT NULL CHECK (source_channel = ANY (ARRAY['web','telegram','api'])),
  requested_status text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_command_receipts_recruiter_key_unique UNIQUE (recruiter_id, idempotency_key)
);

-- Generic dispatch command state (NOT Telegram-specific): binds a consumed
-- idempotency key to the exact target status it was issued for, so the same
-- key can never be replayed for a DIFFERENT requested status.
ALTER TABLE public.dispatch_command_receipts
  ADD COLUMN IF NOT EXISTS requested_status text NULL;

ALTER TABLE public.dispatch_command_receipts
  DROP CONSTRAINT IF EXISTS dispatch_command_receipts_requested_status_check;
ALTER TABLE public.dispatch_command_receipts
  ADD CONSTRAINT dispatch_command_receipts_requested_status_check
  CHECK (
    requested_status IS NULL
    OR requested_status = ANY (ARRAY['pending','en_route','completed','cancelled'])
  );

-- Shape rule: create_load carries no target status; update_status must.
ALTER TABLE public.dispatch_command_receipts
  DROP CONSTRAINT IF EXISTS dispatch_command_receipts_action_status_shape_check;
ALTER TABLE public.dispatch_command_receipts
  ADD CONSTRAINT dispatch_command_receipts_action_status_shape_check
  CHECK (
    (action = 'create_load' AND requested_status IS NULL)
    OR (action = 'update_status' AND requested_status IS NOT NULL)
  );

GRANT ALL ON public.dispatch_command_receipts TO service_role;

ALTER TABLE public.dispatch_command_receipts ENABLE ROW LEVEL SECURITY;
-- Deliberately ZERO client policies: internal to SECURITY DEFINER RPCs only.

CREATE INDEX IF NOT EXISTS idx_dispatch_receipts_relationship
  ON public.dispatch_command_receipts (carrier_driver_relationship_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- G. Dispatch authorization helper — explicit permission only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_can_dispatch_load_action(
  _recruiter_id uuid,
  _relationship_id uuid,
  _driver_user_id uuid,
  _permission public.recruiter_workspace_permission
) RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL
     OR _recruiter_id IS NULL
     OR _relationship_id IS NULL
     OR _driver_user_id IS NULL
     OR _permission IS NULL THEN
    RETURN false;
  END IF;

  -- Exact three-key dispatch vocabulary. Any other workspace permission is
  -- rejected here even if the caller legitimately holds it.
  IF _permission::text NOT IN ('loads_view','loads_dispatch','loads_update_status') THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
     WHERE rp.id = _recruiter_id AND rp.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.carrier_driver_relationships r
     WHERE r.id = _relationship_id
       AND r.status = 'active'
       AND r.recruiter_id = _recruiter_id
       AND r.driver_user_id = _driver_user_id
  ) THEN
    RETURN false;
  END IF;

  -- No role shortcut: explicit permission resolution is the only authority.
  RETURN public.current_user_has_recruiter_permission(_recruiter_id, _permission);
END;
$function$;

REVOKE ALL ON FUNCTION public.current_user_can_dispatch_load_action(uuid,uuid,uuid,public.recruiter_workspace_permission) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_dispatch_load_action(uuid,uuid,uuid,public.recruiter_workspace_permission) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_dispatch_load_action(uuid,uuid,uuid,public.recruiter_workspace_permission) TO authenticated;

-- ---------------------------------------------------------------------------
-- H. Canonical operating-miles helper — exact mirror of resolveOperatingMiles
-- ---------------------------------------------------------------------------
-- Mirrors src/lib/mileageMath.ts::resolveOperatingMiles EXACTLY:
--   non-finite (NaN / Infinity / -Infinity) / negative / null inputs are
--   coerced to 0 via explicit ::text special-value detection;
--   componentTotal = loaded + deadhead;
--   if componentTotal > 0:
--     stored <= 0                      -> componentTotal
--     loaded > 0 AND stored < loaded   -> componentTotal
--     stored < componentTotal - 2      -> componentTotal
--     otherwise                        -> stored
--   else stored > 0 -> stored, else 0.
CREATE OR REPLACE FUNCTION public.canonical_load_operating_miles(
  _loaded numeric,
  _deadhead numeric,
  _stored_total numeric
) RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  _tolerance constant numeric := 2;
  _l numeric;
  _d numeric;
  _s numeric;
  _component numeric;
BEGIN
  -- PostgreSQL numeric NaN compares EQUAL to itself, so self-equality is NOT a
  -- usable non-finite test. Special values are detected explicitly by text.
  _l := CASE WHEN _loaded IS NULL OR _loaded::text IN ('NaN','Infinity','-Infinity') OR _loaded < 0 THEN 0 ELSE _loaded END;
  _d := CASE WHEN _deadhead IS NULL OR _deadhead::text IN ('NaN','Infinity','-Infinity') OR _deadhead < 0 THEN 0 ELSE _deadhead END;
  _s := CASE WHEN _stored_total IS NULL OR _stored_total::text IN ('NaN','Infinity','-Infinity') OR _stored_total < 0 THEN 0 ELSE _stored_total END;
  _component := _l + _d;

  IF _component > 0 THEN
    IF _s <= 0 THEN RETURN _component; END IF;
    IF _l > 0 AND _s < _l THEN RETURN _component; END IF;
    IF _s < _component - _tolerance THEN RETURN _component; END IF;
    RETURN _s;
  END IF;

  IF _s > 0 THEN RETURN _s; END IF;
  RETURN 0;
END;
$function$;

-- ---------------------------------------------------------------------------
-- I. Company load creation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_create_driver_load(
  _recruiter_id uuid,
  _relationship_id uuid,
  _driver_user_id uuid,
  _idempotency_key text,
  _source_channel text,
  _load_date date,
  _pickup_location text,
  _dropoff_location text,
  _load_reference text DEFAULT NULL,
  _dropoff_date date DEFAULT NULL,
  _loaded_miles numeric DEFAULT 0,
  _deadhead_miles numeric DEFAULT 0,
  _total_miles numeric DEFAULT NULL,
  _rate_per_mile numeric DEFAULT 0,
  _pay_model text DEFAULT NULL,
  _flat_rate_amount numeric DEFAULT NULL,
  _deadhead_rate_per_mile numeric DEFAULT NULL,
  _wait_fee numeric DEFAULT 0,
  _detention_fee numeric DEFAULT 0,
  _other_fees numeric DEFAULT 0,
  _estimated_pay numeric DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS public.loads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _key text := btrim(COALESCE(_idempotency_key, ''));
  _ref text := NULLIF(btrim(COALESCE(_load_reference, '')), '');
  _pickup text := btrim(COALESCE(_pickup_location, ''));
  _dropoff text := btrim(COALESCE(_dropoff_location, ''));
  _notes_clean text := NULLIF(btrim(COALESCE(_notes, '')), '');
  _receipt public.dispatch_command_receipts%ROWTYPE;
  _row public.loads%ROWTYPE;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'dispatch_not_authorized'; END IF;

  IF NOT public.current_user_can_dispatch_load_action(
       _recruiter_id, _relationship_id, _driver_user_id, 'loads_dispatch'
     ) THEN
    RAISE EXCEPTION 'dispatch_not_authorized';
  END IF;

  IF _source_channel IS NULL OR _source_channel NOT IN ('web','telegram','api') THEN
    RAISE EXCEPTION 'dispatch_invalid_source_channel';
  END IF;

  IF char_length(_key) < 1 OR char_length(_key) > 200 THEN
    RAISE EXCEPTION 'dispatch_invalid_idempotency_key';
  END IF;

  -- Idempotent replay: identical (recruiter, key) with identical context.
  SELECT * INTO _receipt
    FROM public.dispatch_command_receipts
   WHERE recruiter_id = _recruiter_id AND idempotency_key = _key
   FOR UPDATE;

  IF FOUND THEN
    IF _receipt.action <> 'create_load'
       OR _receipt.carrier_driver_relationship_id <> _relationship_id
       OR _receipt.driver_user_id <> _driver_user_id
       OR _receipt.source_channel <> _source_channel THEN
      RAISE EXCEPTION 'dispatch_idempotency_conflict';
    END IF;
    SELECT * INTO _row FROM public.loads WHERE id = _receipt.load_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'dispatch_idempotency_conflict'; END IF;
    RETURN _row;
  END IF;

  -- Validation ------------------------------------------------------------
  IF _ref IS NOT NULL AND char_length(_ref) > 200 THEN
    RAISE EXCEPTION 'dispatch_invalid_load_reference';
  END IF;
  IF _pickup = '' OR char_length(_pickup) > 200
     OR _dropoff = '' OR char_length(_dropoff) > 200 THEN
    RAISE EXCEPTION 'dispatch_invalid_location';
  END IF;
  IF _notes_clean IS NOT NULL AND char_length(_notes_clean) > 5000 THEN
    RAISE EXCEPTION 'dispatch_invalid_notes';
  END IF;
  IF _load_date IS NULL THEN RAISE EXCEPTION 'dispatch_invalid_load_date'; END IF;
  IF _dropoff_date IS NOT NULL AND _dropoff_date < _load_date THEN
    RAISE EXCEPTION 'dispatch_invalid_dropoff_date';
  END IF;
  IF _pay_model IS NOT NULL AND _pay_model NOT IN
     ('loaded_miles_only','total_miles','loaded_plus_deadhead','flat_rate','manual') THEN
    RAISE EXCEPTION 'dispatch_invalid_pay_model';
  END IF;

  -- Finite / nonnegative / practical upper bounds. NaN and +/-Infinity are
  -- rejected explicitly by text: numeric NaN = NaN is TRUE in PostgreSQL,
  -- so self-equality can never detect a special value.
  IF NOT (
    (_loaded_miles IS NULL OR (_loaded_miles::text NOT IN ('NaN','Infinity','-Infinity') AND _loaded_miles >= 0 AND _loaded_miles <= 100000))
    AND (_deadhead_miles IS NULL OR (_deadhead_miles::text NOT IN ('NaN','Infinity','-Infinity') AND _deadhead_miles >= 0 AND _deadhead_miles <= 100000))
    AND (_total_miles IS NULL OR (_total_miles::text NOT IN ('NaN','Infinity','-Infinity') AND _total_miles >= 0 AND _total_miles <= 100000))
    AND (_rate_per_mile IS NULL OR (_rate_per_mile::text NOT IN ('NaN','Infinity','-Infinity') AND _rate_per_mile >= 0 AND _rate_per_mile <= 1000))
    AND (_flat_rate_amount IS NULL OR (_flat_rate_amount::text NOT IN ('NaN','Infinity','-Infinity') AND _flat_rate_amount >= 0 AND _flat_rate_amount <= 1000000))
    AND (_deadhead_rate_per_mile IS NULL OR (_deadhead_rate_per_mile::text NOT IN ('NaN','Infinity','-Infinity') AND _deadhead_rate_per_mile >= 0 AND _deadhead_rate_per_mile <= 1000))
    AND (_wait_fee IS NULL OR (_wait_fee::text NOT IN ('NaN','Infinity','-Infinity') AND _wait_fee >= 0 AND _wait_fee <= 1000000))
    AND (_detention_fee IS NULL OR (_detention_fee::text NOT IN ('NaN','Infinity','-Infinity') AND _detention_fee >= 0 AND _detention_fee <= 1000000))
    AND (_other_fees IS NULL OR (_other_fees::text NOT IN ('NaN','Infinity','-Infinity') AND _other_fees >= 0 AND _other_fees <= 1000000))
    AND (_estimated_pay IS NULL OR (_estimated_pay::text NOT IN ('NaN','Infinity','-Infinity') AND _estimated_pay >= 0 AND _estimated_pay <= 1000000))
  ) THEN
    RAISE EXCEPTION 'dispatch_invalid_numeric_value';
  END IF;

  -- Insert exactly one canonical load. Caller-supplied ownership, status,
  -- payment or provenance fields are impossible: they are not parameters.
  INSERT INTO public.loads (
    user_id, carrier_driver_relationship_id, origin_channel, load_reference,
    status, load_date, dropoff_date, pickup_location, dropoff_location,
    loaded_miles, deadhead_miles, total_miles, rate_per_mile, pay_model,
    flat_rate_amount, deadhead_rate_per_mile, wait_fee, detention_fee,
    other_fees, estimated_pay, notes, created_by_user_id, updated_by_user_id
  ) VALUES (
    _driver_user_id, _relationship_id, _source_channel, _ref,
    'pending', _load_date, _dropoff_date, _pickup, _dropoff,
    COALESCE(_loaded_miles, 0), COALESCE(_deadhead_miles, 0), _total_miles,
    COALESCE(_rate_per_mile, 0), _pay_model,
    _flat_rate_amount, _deadhead_rate_per_mile, COALESCE(_wait_fee, 0),
    COALESCE(_detention_fee, 0), COALESCE(_other_fees, 0), _estimated_pay,
    _notes_clean, _uid, _uid
  ) RETURNING * INTO _row;

  _new_id := _row.id;

  INSERT INTO public.dispatch_command_receipts (
    recruiter_id, carrier_driver_relationship_id, driver_user_id,
    idempotency_key, action, load_id, actor_user_id, source_channel,
    requested_status
  ) VALUES (
    _recruiter_id, _relationship_id, _driver_user_id,
    _key, 'create_load', _new_id, _uid, _source_channel,
    NULL
  );

  INSERT INTO public.load_events (
    load_id, driver_user_id, recruiter_id, carrier_driver_relationship_id,
    actor_user_id, event_type, source_channel, from_status, to_status
  ) VALUES (
    _new_id, _driver_user_id, _recruiter_id, _relationship_id,
    _uid, 'created', _source_channel, NULL, 'pending'
  );

  RETURN _row;
EXCEPTION
  WHEN unique_violation THEN
    -- Concurrent duplicate: the winning transaction owns the receipt row.
    SELECT * INTO _receipt
      FROM public.dispatch_command_receipts
     WHERE recruiter_id = _recruiter_id AND idempotency_key = _key;
    IF NOT FOUND
       OR _receipt.action <> 'create_load'
       OR _receipt.carrier_driver_relationship_id <> _relationship_id
       OR _receipt.driver_user_id <> _driver_user_id
       OR _receipt.source_channel <> _source_channel
       OR _receipt.requested_status IS NOT NULL THEN
      RAISE EXCEPTION 'dispatch_idempotency_conflict';
    END IF;
    SELECT * INTO _row FROM public.loads WHERE id = _receipt.load_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'dispatch_idempotency_conflict'; END IF;
    RETURN _row;
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_create_driver_load(uuid,uuid,uuid,text,text,date,text,text,text,date,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_create_driver_load(uuid,uuid,uuid,text,text,date,text,text,text,date,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.dispatch_create_driver_load(uuid,uuid,uuid,text,text,date,text,text,text,date,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- J. Company load status lifecycle
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_update_driver_load_status(
  _recruiter_id uuid,
  _relationship_id uuid,
  _driver_user_id uuid,
  _load_id uuid,
  _new_status text,
  _idempotency_key text,
  _source_channel text
) RETURNS public.loads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _key text := btrim(COALESCE(_idempotency_key, ''));
  _receipt public.dispatch_command_receipts%ROWTYPE;
  _row public.loads%ROWTYPE;
  _from text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'dispatch_not_authorized'; END IF;

  IF NOT public.current_user_can_dispatch_load_action(
       _recruiter_id, _relationship_id, _driver_user_id, 'loads_update_status'
     ) THEN
    RAISE EXCEPTION 'dispatch_not_authorized';
  END IF;

  IF _source_channel IS NULL OR _source_channel NOT IN ('web','telegram','api') THEN
    RAISE EXCEPTION 'dispatch_invalid_source_channel';
  END IF;
  IF char_length(_key) < 1 OR char_length(_key) > 200 THEN
    RAISE EXCEPTION 'dispatch_invalid_idempotency_key';
  END IF;
  IF _new_status IS NULL OR _new_status NOT IN ('pending','en_route','completed','cancelled') THEN
    RAISE EXCEPTION 'dispatch_invalid_status';
  END IF;

  SELECT * INTO _receipt
    FROM public.dispatch_command_receipts
   WHERE recruiter_id = _recruiter_id AND idempotency_key = _key
   FOR UPDATE;

  IF FOUND THEN
    IF _receipt.action <> 'update_status'
       OR _receipt.carrier_driver_relationship_id <> _relationship_id
       OR _receipt.driver_user_id <> _driver_user_id
       OR _receipt.source_channel <> _source_channel
       OR _receipt.load_id IS DISTINCT FROM _load_id
       OR _receipt.requested_status IS DISTINCT FROM _new_status THEN
      RAISE EXCEPTION 'dispatch_idempotency_conflict';
    END IF;
    SELECT * INTO _row FROM public.loads WHERE id = _load_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'dispatch_load_not_found'; END IF;
    RETURN _row;
  END IF;

  SELECT * INTO _row
    FROM public.loads
   WHERE id = _load_id
     AND user_id = _driver_user_id
     AND carrier_driver_relationship_id = _relationship_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispatch_load_not_found'; END IF;

  _from := _row.status;

  IF _from = _new_status THEN
    -- Idempotent no-op: the load is already at the requested status. The
    -- command key is still CONSUMED (receipt recorded) so it can never be
    -- replayed later for a different target status. No load_events row is
    -- written because nothing changed.
    INSERT INTO public.dispatch_command_receipts (
      recruiter_id, carrier_driver_relationship_id, driver_user_id,
      idempotency_key, action, load_id, actor_user_id, source_channel,
      requested_status
    ) VALUES (
      _recruiter_id, _relationship_id, _driver_user_id,
      _key, 'update_status', _load_id, _uid, _source_channel,
      _new_status
    );
    RETURN _row;
  END IF;

  IF _from IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'dispatch_invalid_status_transition';
  END IF;
  IF _from = 'pending' AND _new_status NOT IN ('en_route','completed','cancelled') THEN
    RAISE EXCEPTION 'dispatch_invalid_status_transition';
  END IF;
  IF _from = 'en_route' AND _new_status NOT IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'dispatch_invalid_status_transition';
  END IF;

  UPDATE public.loads
     SET status = _new_status,
         updated_by_user_id = _uid
   WHERE id = _load_id
   RETURNING * INTO _row;

  INSERT INTO public.dispatch_command_receipts (
    recruiter_id, carrier_driver_relationship_id, driver_user_id,
    idempotency_key, action, load_id, actor_user_id, source_channel,
    requested_status
  ) VALUES (
    _recruiter_id, _relationship_id, _driver_user_id,
    _key, 'update_status', _load_id, _uid, _source_channel,
    _new_status
  );

  INSERT INTO public.load_events (
    load_id, driver_user_id, recruiter_id, carrier_driver_relationship_id,
    actor_user_id, event_type, source_channel, from_status, to_status
  ) VALUES (
    _load_id, _driver_user_id, _recruiter_id, _relationship_id,
    _uid, 'status_changed', _source_channel, _from, _new_status
  );

  RETURN _row;
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO _receipt
      FROM public.dispatch_command_receipts
     WHERE recruiter_id = _recruiter_id AND idempotency_key = _key;
    IF NOT FOUND
       OR _receipt.action <> 'update_status'
       OR _receipt.carrier_driver_relationship_id <> _relationship_id
       OR _receipt.driver_user_id <> _driver_user_id
       OR _receipt.source_channel <> _source_channel
       OR _receipt.load_id IS DISTINCT FROM _load_id
       OR _receipt.requested_status IS DISTINCT FROM _new_status THEN
      RAISE EXCEPTION 'dispatch_idempotency_conflict';
    END IF;
    SELECT * INTO _row FROM public.loads WHERE id = _load_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'dispatch_load_not_found'; END IF;
    RETURN _row;
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_update_driver_load_status(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_update_driver_load_status(uuid,uuid,uuid,uuid,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.dispatch_update_driver_load_status(uuid,uuid,uuid,uuid,text,text,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- K. Canonical company mileage summary — COMPLETED-only financial totals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_carrier_driver_mileage_summary(
  _recruiter_id uuid,
  _relationship_id uuid,
  _driver_user_id uuid,
  _as_of date DEFAULT current_date
) RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _as date := COALESCE(_as_of, current_date);
  _week_start_day text;
  _cadence text;
  _anchor date;
  _employment date;
  _start_dow int;
  _week_start date;
  _week_end date;
  _pp_start date;
  _pp_end date;
  _month_start date := date_trunc('month', _as)::date;
  _month_end date := (date_trunc('month', _as) + interval '1 month - 1 day')::date;
  _last_month_start date := (date_trunc('month', _as) - interval '1 month')::date;
  _last_month_end date := (date_trunc('month', _as) - interval '1 day')::date;
  _year_start date := date_trunc('year', _as)::date;
  _year_end date := (date_trunc('year', _as) + interval '1 year - 1 day')::date;
  _periods numeric;
BEGIN
  IF NOT public.current_user_can_dispatch_load_action(
       _recruiter_id, _relationship_id, _driver_user_id, 'loads_view'
     ) THEN
    RAISE EXCEPTION 'dispatch_not_authorized';
  END IF;

  SELECT rp.dispatch_week_start_day, rp.pay_period_cadence, rp.pay_period_anchor_date
    INTO _week_start_day, _cadence, _anchor
    FROM public.recruiter_profiles rp
   WHERE rp.id = _recruiter_id;

  SELECT r.employment_start_date INTO _employment
    FROM public.carrier_driver_relationships r
   WHERE r.id = _relationship_id;

  _start_dow := CASE _week_start_day
    WHEN 'sunday' THEN 0 WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2
    WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5
    WHEN 'saturday' THEN 6 ELSE NULL END;
  IF _start_dow IS NULL THEN RAISE EXCEPTION 'dispatch_invalid_week_start_day'; END IF;

  _week_start := _as - ((EXTRACT(dow FROM _as)::int - _start_dow + 7) % 7);
  _week_end := _week_start + 6;

  IF _cadence = 'weekly' THEN
    _pp_start := _week_start;
    _pp_end := _week_end;
  ELSIF _cadence = 'biweekly' THEN
    -- Fail closed rather than guessing an anchor.
    IF _anchor IS NULL THEN RAISE EXCEPTION 'dispatch_missing_pay_period_anchor'; END IF;
    _periods := floor((_as - _anchor)::numeric / 14);
    _pp_start := _anchor + (_periods * 14)::int;
    _pp_end := _pp_start + 13;
  ELSE
    RAISE EXCEPTION 'dispatch_invalid_pay_period_cadence';
  END IF;

  RETURN (
    WITH scoped AS (
      SELECT l.status,
             COALESCE(l.dropoff_date, l.load_date) AS effective_date,
             public.canonical_load_operating_miles(l.loaded_miles, l.deadhead_miles, l.total_miles) AS miles
        FROM public.loads l
       WHERE l.carrier_driver_relationship_id = _relationship_id
         AND l.user_id = _driver_user_id
    ),
    done AS (SELECT * FROM scoped WHERE status = 'completed')
    SELECT jsonb_build_object(
      'as_of', _as,
      'employment_start_date', _employment,
      'week_start_day', _week_start_day,
      'pay_period_cadence', _cadence,
      'pay_period_start', _pp_start,
      'pay_period_end', _pp_end,
      'week_completed_miles',
        COALESCE((SELECT sum(miles) FROM done WHERE effective_date BETWEEN _week_start AND _week_end), 0),
      'current_pay_period_completed_miles',
        COALESCE((SELECT sum(miles) FROM done WHERE effective_date BETWEEN _pp_start AND _pp_end), 0),
      'month_completed_miles',
        COALESCE((SELECT sum(miles) FROM done WHERE effective_date BETWEEN _month_start AND _month_end), 0),
      'last_month_completed_miles',
        COALESCE((SELECT sum(miles) FROM done WHERE effective_date BETWEEN _last_month_start AND _last_month_end), 0),
      'year_completed_miles',
        COALESCE((SELECT sum(miles) FROM done WHERE effective_date BETWEEN _year_start AND _year_end), 0),
      -- All company-linked completed loads, regardless of employment_start_date.
      'company_completed_miles', COALESCE((SELECT sum(miles) FROM done), 0),
      -- Assigned work only. NEVER added into completed financial totals.
      'active_assigned_miles',
        COALESCE((SELECT sum(miles) FROM scoped WHERE status IN ('pending','en_route')), 0),
      'week_completed_load_count',
        (SELECT count(*) FROM done WHERE effective_date BETWEEN _week_start AND _week_end),
      'week_cancelled_load_count',
        (SELECT count(*) FROM scoped WHERE status = 'cancelled' AND effective_date BETWEEN _week_start AND _week_end),
      'active_load_count',
        (SELECT count(*) FROM scoped WHERE status IN ('pending','en_route'))
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_carrier_driver_mileage_summary(uuid,uuid,uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_carrier_driver_mileage_summary(uuid,uuid,uuid,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_carrier_driver_mileage_summary(uuid,uuid,uuid,date) TO authenticated;

COMMIT;
