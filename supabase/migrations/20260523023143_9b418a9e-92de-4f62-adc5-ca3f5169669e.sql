
-- ============================================================
-- Phase 6: Driver-to-Driver Referral Tracking Foundation
-- Tracking-only. Platform does NOT process referral payments.
-- ============================================================

-- ---------- driver_referrals ----------
CREATE TABLE public.driver_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  referring_driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_driver_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  referred_driver_name text,
  referred_driver_email text,
  referred_driver_phone text,
  referred_driver_note text,
  status text NOT NULL DEFAULT 'referral_sent',
  last_status_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_referrals_status_chk CHECK (status IN (
    'referral_sent','driver_viewed','driver_requested_info',
    'recruiter_contacted','application_started','interview_scheduled',
    'offer_sent','contract_sent','hired',
    'waiting_period_started','waiting_period_completed',
    'eligible_for_bonus','marked_paid_externally','closed_not_hired'
  )),
  CONSTRAINT driver_referrals_has_contact_chk CHECK (
    referred_driver_user_id IS NOT NULL
    OR COALESCE(NULLIF(trim(referred_driver_name),''), NULL) IS NOT NULL
    OR COALESCE(NULLIF(trim(referred_driver_email),''), NULL) IS NOT NULL
    OR COALESCE(NULLIF(trim(referred_driver_phone),''), NULL) IS NOT NULL
  ),
  CONSTRAINT driver_referrals_no_self_ref_chk CHECK (
    referred_driver_user_id IS NULL OR referred_driver_user_id <> referring_driver_id
  )
);

CREATE INDEX idx_driver_referrals_opportunity ON public.driver_referrals(opportunity_id);
CREATE INDEX idx_driver_referrals_recruiter ON public.driver_referrals(recruiter_id);
CREATE INDEX idx_driver_referrals_referring ON public.driver_referrals(referring_driver_id);
CREATE INDEX idx_driver_referrals_referred_user ON public.driver_referrals(referred_driver_user_id);
CREATE INDEX idx_driver_referrals_status ON public.driver_referrals(status);

CREATE UNIQUE INDEX idx_driver_referrals_unique_email
  ON public.driver_referrals(opportunity_id, referring_driver_id, lower(referred_driver_email))
  WHERE referred_driver_email IS NOT NULL;
CREATE UNIQUE INDEX idx_driver_referrals_unique_phone
  ON public.driver_referrals(opportunity_id, referring_driver_id, referred_driver_phone)
  WHERE referred_driver_phone IS NOT NULL;
CREATE UNIQUE INDEX idx_driver_referrals_unique_user
  ON public.driver_referrals(opportunity_id, referring_driver_id, referred_driver_user_id)
  WHERE referred_driver_user_id IS NOT NULL;

-- ---------- referral_status_events ----------
CREATE TABLE public.referral_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.driver_referrals(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  old_status text,
  new_status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_status_events_new_status_chk CHECK (new_status IN (
    'referral_sent','driver_viewed','driver_requested_info',
    'recruiter_contacted','application_started','interview_scheduled',
    'offer_sent','contract_sent','hired',
    'waiting_period_started','waiting_period_completed',
    'eligible_for_bonus','marked_paid_externally','closed_not_hired'
  )),
  CONSTRAINT referral_status_events_actor_role_chk CHECK (
    actor_role IS NULL OR actor_role IN ('driver','recruiter','admin','system')
  )
);

CREATE INDEX idx_referral_status_events_referral ON public.referral_status_events(referral_id);
CREATE INDEX idx_referral_status_events_created ON public.referral_status_events(created_at DESC);

-- ---------- recruiter_referral_settings ----------
CREATE TABLE public.recruiter_referral_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL UNIQUE REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  referral_bonus_enabled boolean NOT NULL DEFAULT false,
  bonus_amount numeric,
  bonus_terms text,
  payment_trigger text,
  waiting_period_days integer,
  external_payment_disclaimer text NOT NULL DEFAULT 'Referral bonuses, if offered, are paid externally by the recruiter. Haul Tracker Pro tracks referral progress only and does not process or guarantee payments.',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rrs_bonus_amount_chk CHECK (bonus_amount IS NULL OR bonus_amount >= 0),
  CONSTRAINT rrs_waiting_period_chk CHECK (waiting_period_days IS NULL OR waiting_period_days >= 0),
  CONSTRAINT rrs_payment_trigger_chk CHECK (
    payment_trigger IS NULL OR payment_trigger IN ('on_hire','after_waiting_period','recruiter_defined','other')
  )
);

CREATE INDEX idx_recruiter_referral_settings_recruiter ON public.recruiter_referral_settings(recruiter_id);

-- ---------- updated_at triggers ----------
CREATE TRIGGER trg_driver_referrals_updated_at
  BEFORE UPDATE ON public.driver_referrals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_recruiter_referral_settings_updated_at
  BEFORE UPDATE ON public.recruiter_referral_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- driver_referrals integrity + status event triggers ----------

-- Ensure recruiter_id matches the opportunity's recruiter_id; also gate insert to approved/active opps.
CREATE OR REPLACE FUNCTION public.driver_referrals_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _opp public.opportunities;
BEGIN
  SELECT * INTO _opp FROM public.opportunities WHERE id = NEW.opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opportunity not found' USING ERRCODE = '23503';
  END IF;

  -- Correct/enforce recruiter_id matches the opportunity
  NEW.recruiter_id := _opp.recruiter_id;

  -- Non-admins may only refer to approved + active opportunities
  IF NOT public.is_admin(auth.uid()) THEN
    IF _opp.status <> 'active' OR _opp.admin_review_status <> 'approved' THEN
      RAISE EXCEPTION 'Cannot create referral for an opportunity that is not approved and active'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.status := COALESCE(NEW.status, 'referral_sent');
  NEW.last_status_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_driver_referrals_before_insert
  BEFORE INSERT ON public.driver_referrals
  FOR EACH ROW EXECUTE FUNCTION public.driver_referrals_before_insert();

-- Lock recruiter_id/opportunity_id/referring_driver_id and bump last_status_at on status change
CREATE OR REPLACE FUNCTION public.driver_referrals_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    NEW.opportunity_id := OLD.opportunity_id;
    NEW.recruiter_id := OLD.recruiter_id;
    NEW.referring_driver_id := OLD.referring_driver_id;
    NEW.referred_driver_user_id := OLD.referred_driver_user_id;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_status_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_driver_referrals_before_update
  BEFORE UPDATE ON public.driver_referrals
  FOR EACH ROW EXECUTE FUNCTION public.driver_referrals_before_update();

-- Emit status events on insert and on status change
CREATE OR REPLACE FUNCTION public.driver_referrals_emit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

CREATE TRIGGER trg_driver_referrals_emit_event_ins
  AFTER INSERT ON public.driver_referrals
  FOR EACH ROW EXECUTE FUNCTION public.driver_referrals_emit_event();

CREATE TRIGGER trg_driver_referrals_emit_event_upd
  AFTER UPDATE ON public.driver_referrals
  FOR EACH ROW EXECUTE FUNCTION public.driver_referrals_emit_event();

-- ---------- RLS ----------
ALTER TABLE public.driver_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruiter_referral_settings ENABLE ROW LEVEL SECURITY;

-- driver_referrals SELECT
CREATE POLICY "Admins view all referrals"
  ON public.driver_referrals FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Referring driver views own referrals"
  ON public.driver_referrals FOR SELECT TO authenticated
  USING (referring_driver_id = auth.uid());

CREATE POLICY "Referred driver views linked referrals"
  ON public.driver_referrals FOR SELECT TO authenticated
  USING (referred_driver_user_id IS NOT NULL AND referred_driver_user_id = auth.uid());

CREATE POLICY "Recruiter views own referrals"
  ON public.driver_referrals FOR SELECT TO authenticated
  USING (public.is_recruiter_owner(auth.uid(), recruiter_id));

-- driver_referrals INSERT: only referring driver inserts; trigger validates opportunity status
CREATE POLICY "Driver inserts own referral"
  ON public.driver_referrals FOR INSERT TO authenticated
  WITH CHECK (referring_driver_id = auth.uid());

CREATE POLICY "Admin inserts referral"
  ON public.driver_referrals FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

-- driver_referrals UPDATE
-- Referring driver: only while status = referral_sent and only contact/note fields (enforced by before_update trigger on others; status stays same here).
CREATE POLICY "Referring driver updates own referral early"
  ON public.driver_referrals FOR UPDATE TO authenticated
  USING (referring_driver_id = auth.uid() AND status = 'referral_sent')
  WITH CHECK (
    referring_driver_id = auth.uid()
    AND status = 'referral_sent'
  );

-- Recruiter: full status updates allowed for their own referrals
CREATE POLICY "Recruiter updates own referral"
  ON public.driver_referrals FOR UPDATE TO authenticated
  USING (public.is_recruiter_owner(auth.uid(), recruiter_id))
  WITH CHECK (public.is_recruiter_owner(auth.uid(), recruiter_id));

CREATE POLICY "Admin updates any referral"
  ON public.driver_referrals FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admin deletes referral"
  ON public.driver_referrals FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- referral_status_events
CREATE POLICY "Admins view all referral events"
  ON public.referral_status_events FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Referral parties view referral events"
  ON public.referral_status_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.driver_referrals r
      WHERE r.id = referral_status_events.referral_id
        AND (
          r.referring_driver_id = auth.uid()
          OR r.referred_driver_user_id = auth.uid()
          OR public.is_recruiter_owner(auth.uid(), r.recruiter_id)
        )
    )
  );

-- Inserts handled by SECURITY DEFINER trigger; only admins may insert directly.
CREATE POLICY "Admin inserts referral event"
  ON public.referral_status_events FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

-- recruiter_referral_settings
CREATE POLICY "Admins manage all referral settings"
  ON public.recruiter_referral_settings FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Recruiter manages own referral settings"
  ON public.recruiter_referral_settings FOR ALL TO authenticated
  USING (public.is_recruiter_owner(auth.uid(), recruiter_id))
  WITH CHECK (public.is_recruiter_owner(auth.uid(), recruiter_id));

CREATE POLICY "Drivers view referral settings for approved opps"
  ON public.recruiter_referral_settings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.opportunities o
      WHERE o.recruiter_id = recruiter_referral_settings.recruiter_id
        AND o.status = 'active'
        AND o.admin_review_status = 'approved'
    )
  );
