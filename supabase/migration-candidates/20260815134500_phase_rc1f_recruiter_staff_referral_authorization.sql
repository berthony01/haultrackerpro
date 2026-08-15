-- Phase RC-1F — Recruiter staff referral authorization.
--
-- THIRD operational consumer of the RC-1B recruiter staff permission contract.
-- Authorizes exactly three permission keys against a selected recruiter
-- workspace:
--   referrals_view, referrals_manage_status, referral_terms_manage
--
-- Security contract:
--   * ONE canonical recruiter workspace/profile. Staff never receive a
--     recruiter_profiles row.
--   * OWNER referral semantics are preserved exactly: the owner branch keeps
--     using public.is_recruiter_owner(auth.uid(), _recruiter_id). Owner
--     referral access is NOT tightened to full posting readiness.
--   * STAFF requires BOTH a posting-ready / non-suspended workspace
--     (public.recruiter_profile_can_manage_opportunities) AND the explicit
--     RC-1B boolean permission on an ACTIVE membership. Role labels
--     (recruiter_admin / recruiter_staff) alone grant nothing.
--   * Direct SELECT/UPDATE RLS on public.driver_referrals stays OWNER-ONLY.
--     No staff SELECT policy is added; staff reads/writes go through narrow
--     SECURITY DEFINER RPCs.
--   * Direct ALL/manage RLS on public.recruiter_referral_settings stays
--     OWNER-ONLY. Staff terms access goes through narrow RPCs.
--   * No contract, application, opportunity, report, settlement, billing,
--     team, Agency, or Stripe permission is granted here.
--   * applications_manage_notes remains unrelated and dormant.
--   * Referral bonuses remain EXTERNAL. No payment processing is added.
--
-- FROZEN — NOT replaced by this migration:
--   public.bridge_application_to_referral(), public.create_driver_referral_safe(...),
--   public.driver_referrals_before_insert(), public.notify_referral_insert(),
--   public.notify_referral_status_update(), public.current_user_has_recruiter_permission(...),
--   public.recruiter_profile_can_manage_opportunities(...), public.is_recruiter_owner(...).

-- ---------------------------------------------------------------------------
-- A) Permission-aware referral action helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_referral_action(
  _recruiter_id uuid,
  _permission public.recruiter_workspace_permission
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND _recruiter_id IS NOT NULL
    AND _permission IS NOT NULL
    AND _permission IN (
      'referrals_view'::public.recruiter_workspace_permission,
      'referrals_manage_status'::public.recruiter_workspace_permission,
      'referral_terms_manage'::public.recruiter_workspace_permission
    )
    AND (
      public.is_recruiter_owner(auth.uid(), _recruiter_id)
      OR (
        public.recruiter_profile_can_manage_opportunities(_recruiter_id)
        AND public.current_user_has_recruiter_permission(_recruiter_id, _permission)
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.current_user_can_recruiter_referral_action(uuid, public.recruiter_workspace_permission) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_recruiter_referral_action(uuid, public.recruiter_workspace_permission) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_recruiter_referral_action(uuid, public.recruiter_workspace_permission) TO authenticated;

-- ---------------------------------------------------------------------------
-- B) Staff-safe referral read path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_recruiter_referrals_safe(
  _recruiter_id uuid
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'id', r.id,
    'opportunity_id', r.opportunity_id,
    'recruiter_id', r.recruiter_id,
    'referring_driver_id', r.referring_driver_id,
    'referred_driver_user_id', r.referred_driver_user_id,
    'referred_driver_name', r.referred_driver_name,
    'referred_driver_email', r.referred_driver_email,
    'referred_driver_phone', r.referred_driver_phone,
    'referred_driver_note', r.referred_driver_note,
    'status', r.status,
    'last_status_at', r.last_status_at,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'opportunities', CASE
      WHEN o.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', o.id,
        'title', o.title,
        'company_name', o.company_name
      )
    END
  )
  FROM public.driver_referrals r
  LEFT JOIN public.opportunities o ON o.id = r.opportunity_id
  WHERE r.recruiter_id = _recruiter_id
    AND public.current_user_can_recruiter_referral_action(
      _recruiter_id,
      'referrals_view'::public.recruiter_workspace_permission
    )
  ORDER BY r.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.list_recruiter_referrals_safe(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_recruiter_referrals_safe(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_recruiter_referrals_safe(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- C) RLS-safe authorized referral context
-- ---------------------------------------------------------------------------
-- Returns only the recruiter_id, and only when the caller already passes the
-- requested RC-1F referral action for the referral's workspace. Exposes no
-- referral contact fields and cannot enumerate unauthorized rows.
CREATE OR REPLACE FUNCTION public.recruiter_referral_authorized_context(
  _referral_id uuid,
  _permission public.recruiter_workspace_permission
)
RETURNS TABLE(recruiter_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT r.recruiter_id
  FROM public.driver_referrals r
  WHERE r.id = _referral_id
    AND auth.uid() IS NOT NULL
    AND public.current_user_can_recruiter_referral_action(r.recruiter_id, _permission);
$function$;

REVOKE ALL ON FUNCTION public.recruiter_referral_authorized_context(uuid, public.recruiter_workspace_permission) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recruiter_referral_authorized_context(uuid, public.recruiter_workspace_permission) FROM anon;
GRANT EXECUTE ON FUNCTION public.recruiter_referral_authorized_context(uuid, public.recruiter_workspace_permission) TO authenticated;

-- ---------------------------------------------------------------------------
-- D) Staff-safe referral status write path
-- ---------------------------------------------------------------------------
-- Direct UPDATE cannot target a row without a matching SELECT policy, and the
-- recruiter direct policies intentionally stay owner-only. This RPC authorizes
-- workspace + permission, changes ONLY status, scopes by referral id AND
-- recruiter_id, and leaves the existing before-update trigger and status
-- constraint authoritative for allowed statuses and immutable fields.
CREATE OR REPLACE FUNCTION public.update_recruiter_referral_status(
  _recruiter_id uuid,
  _referral_id uuid,
  _status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _updated integer := 0;
BEGIN
  IF auth.uid() IS NULL OR _recruiter_id IS NULL OR _referral_id IS NULL OR _status IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.current_user_can_recruiter_referral_action(
    _recruiter_id,
    'referrals_manage_status'::public.recruiter_workspace_permission
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.driver_referrals r
     SET status = _status
   WHERE r.id = _referral_id
     AND r.recruiter_id = _recruiter_id;

  GET DIAGNOSTICS _updated = ROW_COUNT;
  RETURN _updated = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_recruiter_referral_status(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_recruiter_referral_status(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_recruiter_referral_status(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- E) driver_referrals_before_update() — minimal staff status authorization
-- ---------------------------------------------------------------------------
-- Every admin, bridge, immutable-field, referred_driver_user_id, referring
-- driver, recruiter allowed-status, and last_status_at behavior is preserved
-- verbatim. The ONLY change: a non-owner may use the recruiter-controlled
-- status path when current_user_can_recruiter_referral_action(
--   OLD.recruiter_id, 'referrals_manage_status') is true. Role presets alone
-- still do nothing, and no permission may mutate a non-status field.
CREATE OR REPLACE FUNCTION public.driver_referrals_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_admin boolean := public.is_admin(_uid);
  _is_recruiter_owner boolean := false;
  _is_staff_status_authorized boolean := false;
  _is_referring_driver boolean := (_uid IS NOT NULL AND _uid = OLD.referring_driver_id);
  _is_bridge boolean := (COALESCE(current_setting('app.referral_bridge_update', true), 'false') = 'true');
  _recruiter_allowed text[] := ARRAY[
    'recruiter_contacted','application_started','interview_scheduled',
    'offer_sent','contract_sent','hired',
    'waiting_period_started','waiting_period_completed',
    'eligible_for_bonus','marked_paid_externally','closed_not_hired'
  ];
  _bridge_allowed text[] := ARRAY[
    'application_started','interview_scheduled','offer_sent',
    'hired','closed_not_hired'
  ];
  _protected text[] := ARRAY[
    'waiting_period_started','waiting_period_completed',
    'eligible_for_bonus','marked_paid_externally'
  ];
BEGIN
  IF _is_admin THEN
    NEW.referred_driver_name  := NULLIF(btrim(NEW.referred_driver_name),  '');
    NEW.referred_driver_email := NULLIF(lower(btrim(NEW.referred_driver_email)), '');
    NEW.referred_driver_phone := NULLIF(btrim(NEW.referred_driver_phone), '');
    NEW.referred_driver_note  := NULLIF(btrim(NEW.referred_driver_note),  '');
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.last_status_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- Lock immutable ownership / contact fields for all non-admin paths.
  NEW.opportunity_id      := OLD.opportunity_id;
  NEW.recruiter_id        := OLD.recruiter_id;
  NEW.referring_driver_id := OLD.referring_driver_id;
  NEW.referred_driver_name  := OLD.referred_driver_name;
  NEW.referred_driver_email := OLD.referred_driver_email;
  NEW.referred_driver_phone := OLD.referred_driver_phone;
  NEW.referred_driver_note  := OLD.referred_driver_note;

  IF _is_bridge THEN
    -- Bridge path: may set referred_driver_user_id if it was NULL (safe link),
    -- and may advance status only within the bridge whitelist.
    IF OLD.referred_driver_user_id IS NULL THEN
      -- keep whatever NEW.referred_driver_user_id is (may be set by bridge)
      NULL;
    ELSE
      NEW.referred_driver_user_id := OLD.referred_driver_user_id;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- Never downgrade recruiter-controlled payout states from the bridge.
      IF OLD.status = ANY(_protected) THEN
        NEW.status := OLD.status;
      ELSIF NEW.status IS NULL OR NOT (NEW.status = ANY(_bridge_allowed)) THEN
        -- Disallowed bridge status -> ignore the change
        NEW.status := OLD.status;
      END IF;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.last_status_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- Non-bridge paths cannot move referred_driver_user_id.
  NEW.referred_driver_user_id := OLD.referred_driver_user_id;

  SELECT public.is_recruiter_owner(_uid, OLD.recruiter_id) INTO _is_recruiter_owner;

  -- Phase RC-1F — non-owner staff may use the recruiter-controlled status path
  -- ONLY with the explicit referrals_manage_status permission on a
  -- posting-ready workspace. Nothing else about this path changes.
  IF NOT _is_recruiter_owner THEN
    SELECT public.current_user_can_recruiter_referral_action(
      OLD.recruiter_id,
      'referrals_manage_status'::public.recruiter_workspace_permission
    ) INTO _is_staff_status_authorized;
  END IF;

  IF _is_recruiter_owner OR _is_staff_status_authorized THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IS NULL OR NOT (NEW.status = ANY(_recruiter_allowed)) THEN
        RAISE EXCEPTION 'Recruiters may only update recruiter-controlled referral statuses.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF _is_referring_driver THEN
    -- Driver-side updates cannot change status from this trigger path.
    NEW.status := OLD.status;
  ELSE
    NEW.status := OLD.status;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_status_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- F) driver_referrals_emit_event() — staff actor classification
-- ---------------------------------------------------------------------------
-- Admin and driver actor precedence, INSERT/UPDATE payloads, and every event
-- shape are preserved. Owner changes still record actor_role='recruiter'. The
-- ONLY addition: an authorized staff status action under
-- referrals_manage_status also records actor_role='recruiter' with the actual
-- staff auth.uid(). Arbitrary workspace members are never classified.
CREATE OR REPLACE FUNCTION public.driver_referrals_emit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _role text := 'system';
  _is_recruiter boolean := false;
BEGIN
  IF _actor IS NOT NULL THEN
    IF public.is_admin(_actor) THEN
      _role := 'admin';
    ELSIF _actor = NEW.referring_driver_id OR _actor = NEW.referred_driver_user_id THEN
      _role := 'driver';
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.recruiter_profiles rp
        WHERE rp.id = NEW.recruiter_id AND rp.user_id = _actor
      ) INTO _is_recruiter;
      IF NOT _is_recruiter THEN
        -- Phase RC-1F — authorized staff status actor.
        SELECT public.current_user_can_recruiter_referral_action(
          NEW.recruiter_id,
          'referrals_manage_status'::public.recruiter_workspace_permission
        ) INTO _is_recruiter;
      END IF;
      IF _is_recruiter THEN _role := 'recruiter'; END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.referral_status_events (referral_id, actor_id, actor_role, old_status, new_status)
    VALUES (NEW.id, _actor, _role, NULL, NEW.status);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.referral_status_events (referral_id, actor_id, actor_role, old_status, new_status)
    VALUES (NEW.id, _actor, _role, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- G) referral_status_events — staff view branch
-- ---------------------------------------------------------------------------
-- Only the parties policy is replaced. The admin view policy and the event
-- INSERT policy are untouched. The staff branch resolves through the RLS-safe
-- authorized context so it works even though driver_referrals has no staff
-- SELECT policy.
DROP POLICY IF EXISTS "Referral parties view referral events" ON public.referral_status_events;
CREATE POLICY "Referral parties view referral events"
ON public.referral_status_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.driver_referrals r
    WHERE r.id = referral_status_events.referral_id
      AND (
        r.referring_driver_id = auth.uid()
        OR r.referred_driver_user_id = auth.uid()
        OR public.is_recruiter_owner(auth.uid(), r.recruiter_id)
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.recruiter_referral_authorized_context(
      referral_status_events.referral_id,
      'referrals_view'::public.recruiter_workspace_permission
    ) ctx
    WHERE public.current_user_can_recruiter_referral_action(
      ctx.recruiter_id,
      'referrals_view'::public.recruiter_workspace_permission
    )
  )
);

-- ---------------------------------------------------------------------------
-- H) Staff-safe referral settings RPCs
-- ---------------------------------------------------------------------------
-- Base-table RLS on public.recruiter_referral_settings is NOT broadened; the
-- recruiter direct policy remains owner-only.
CREATE OR REPLACE FUNCTION public.get_recruiter_referral_settings_for_workspace(
  _recruiter_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT CASE
    WHEN NOT (
      public.current_user_can_recruiter_referral_action(
        _recruiter_id, 'referrals_view'::public.recruiter_workspace_permission)
      OR public.current_user_can_recruiter_referral_action(
        _recruiter_id, 'referral_terms_manage'::public.recruiter_workspace_permission)
    ) THEN NULL
    ELSE (
      SELECT jsonb_build_object(
        'id', s.id,
        'recruiter_id', s.recruiter_id,
        'referral_bonus_enabled', s.referral_bonus_enabled,
        'bonus_amount', s.bonus_amount,
        'payment_trigger', s.payment_trigger,
        'waiting_period_days', s.waiting_period_days,
        'bonus_terms', s.bonus_terms,
        'external_payment_disclaimer', s.external_payment_disclaimer,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      )
      FROM public.recruiter_referral_settings s
      WHERE s.recruiter_id = _recruiter_id
    )
  END;
$function$;

REVOKE ALL ON FUNCTION public.get_recruiter_referral_settings_for_workspace(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_recruiter_referral_settings_for_workspace(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_recruiter_referral_settings_for_workspace(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_recruiter_referral_settings_for_workspace(
  _recruiter_id uuid,
  _referral_bonus_enabled boolean,
  _bonus_amount numeric,
  _payment_trigger text,
  _waiting_period_days integer,
  _bonus_terms text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _enabled boolean := COALESCE(_referral_bonus_enabled, false);
  _amount numeric := NULL;
  _trigger text := NULL;
  _wait integer := NULL;
  _terms text := NULL;
  _row public.recruiter_referral_settings;
BEGIN
  IF auth.uid() IS NULL OR _recruiter_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.current_user_can_recruiter_referral_action(
    _recruiter_id,
    'referral_terms_manage'::public.recruiter_workspace_permission
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _enabled THEN
    IF _bonus_amount IS NOT NULL THEN
      IF _bonus_amount < 0 THEN
        RAISE EXCEPTION 'Bonus amount must be a non-negative number' USING ERRCODE = '22023';
      END IF;
      _amount := _bonus_amount;
    END IF;

    IF _waiting_period_days IS NOT NULL THEN
      IF _waiting_period_days < 0 THEN
        RAISE EXCEPTION 'Waiting period must be a non-negative whole number' USING ERRCODE = '22023';
      END IF;
      _wait := _waiting_period_days;
    END IF;

    IF _payment_trigger IS NOT NULL THEN
      IF _payment_trigger NOT IN ('on_hire','after_waiting_period','recruiter_defined','other') THEN
        RAISE EXCEPTION 'Invalid payment trigger' USING ERRCODE = '22023';
      END IF;
      _trigger := _payment_trigger;
    END IF;

    _terms := NULLIF(btrim(COALESCE(_bonus_terms, '')), '');
    IF _terms IS NOT NULL THEN
      _terms := left(_terms, 1000);
    END IF;
  END IF;

  -- external_payment_disclaimer is NEVER caller-settable.
  INSERT INTO public.recruiter_referral_settings AS s (
    recruiter_id,
    referral_bonus_enabled,
    bonus_amount,
    payment_trigger,
    waiting_period_days,
    bonus_terms
  )
  VALUES (_recruiter_id, _enabled, _amount, _trigger, _wait, _terms)
  ON CONFLICT (recruiter_id) DO UPDATE
    SET referral_bonus_enabled = EXCLUDED.referral_bonus_enabled,
        bonus_amount           = EXCLUDED.bonus_amount,
        payment_trigger        = EXCLUDED.payment_trigger,
        waiting_period_days    = EXCLUDED.waiting_period_days,
        bonus_terms            = EXCLUDED.bonus_terms
  RETURNING * INTO _row;

  RETURN jsonb_build_object(
    'id', _row.id,
    'recruiter_id', _row.recruiter_id,
    'referral_bonus_enabled', _row.referral_bonus_enabled,
    'bonus_amount', _row.bonus_amount,
    'payment_trigger', _row.payment_trigger,
    'waiting_period_days', _row.waiting_period_days,
    'bonus_terms', _row.bonus_terms,
    'external_payment_disclaimer', _row.external_payment_disclaimer,
    'created_at', _row.created_at,
    'updated_at', _row.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_recruiter_referral_settings_for_workspace(uuid, boolean, numeric, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_recruiter_referral_settings_for_workspace(uuid, boolean, numeric, text, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_recruiter_referral_settings_for_workspace(uuid, boolean, numeric, text, integer, text) TO authenticated;
