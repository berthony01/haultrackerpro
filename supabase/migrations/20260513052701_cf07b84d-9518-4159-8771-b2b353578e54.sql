-- PHASE 8: Recruiter billing + posting limits

-- 1) Table
CREATE TABLE IF NOT EXISTS public.recruiter_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text NOT NULL DEFAULT 'none',
  status text NOT NULL DEFAULT 'inactive',
  active_opportunity_limit integer NOT NULL DEFAULT 0,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruiter_billing_plan_chk CHECK (plan IN ('none','starter','growth','fleet')),
  CONSTRAINT recruiter_billing_status_chk CHECK (status IN ('inactive','active','past_due','canceled','trialing'))
);

CREATE UNIQUE INDEX IF NOT EXISTS recruiter_billing_profiles_recruiter_uq
  ON public.recruiter_billing_profiles(recruiter_id);
CREATE INDEX IF NOT EXISTS recruiter_billing_profiles_user_idx
  ON public.recruiter_billing_profiles(user_id);
CREATE INDEX IF NOT EXISTS recruiter_billing_profiles_stripe_sub_idx
  ON public.recruiter_billing_profiles(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS recruiter_billing_profiles_stripe_cust_idx
  ON public.recruiter_billing_profiles(stripe_customer_id);

ALTER TABLE public.recruiter_billing_profiles ENABLE ROW LEVEL SECURITY;

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_recruiter_billing_updated_at ON public.recruiter_billing_profiles;
CREATE TRIGGER trg_recruiter_billing_updated_at
BEFORE UPDATE ON public.recruiter_billing_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Field guard: non-admins/non-service may NOT mutate billing fields directly
CREATE OR REPLACE FUNCTION public.recruiter_billing_field_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Force safe defaults for client-initiated inserts
    NEW.stripe_customer_id := NULL;
    NEW.stripe_subscription_id := NULL;
    NEW.plan := 'none';
    NEW.status := 'inactive';
    NEW.active_opportunity_limit := 0;
    NEW.current_period_end := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: lock all billing-controlled fields
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.plan := OLD.plan;
  NEW.status := OLD.status;
  NEW.active_opportunity_limit := OLD.active_opportunity_limit;
  NEW.current_period_end := OLD.current_period_end;
  NEW.recruiter_id := OLD.recruiter_id;
  NEW.user_id := OLD.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recruiter_billing_field_guard ON public.recruiter_billing_profiles;
CREATE TRIGGER trg_recruiter_billing_field_guard
BEFORE INSERT OR UPDATE ON public.recruiter_billing_profiles
FOR EACH ROW EXECUTE FUNCTION public.recruiter_billing_field_guard();

-- 2) RLS
DROP POLICY IF EXISTS "Recruiter views own billing" ON public.recruiter_billing_profiles;
CREATE POLICY "Recruiter views own billing"
  ON public.recruiter_billing_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Recruiter inserts own billing" ON public.recruiter_billing_profiles;
CREATE POLICY "Recruiter inserts own billing"
  ON public.recruiter_billing_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_recruiter_owner(auth.uid(), recruiter_id)
  );

DROP POLICY IF EXISTS "Recruiter updates own billing row" ON public.recruiter_billing_profiles;
CREATE POLICY "Recruiter updates own billing row"
  ON public.recruiter_billing_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all billing" ON public.recruiter_billing_profiles;
CREATE POLICY "Admins view all billing"
  ON public.recruiter_billing_profiles FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins update all billing" ON public.recruiter_billing_profiles;
CREATE POLICY "Admins update all billing"
  ON public.recruiter_billing_profiles FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins insert billing" ON public.recruiter_billing_profiles;
CREATE POLICY "Admins insert billing"
  ON public.recruiter_billing_profiles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins delete billing" ON public.recruiter_billing_profiles;
CREATE POLICY "Admins delete billing"
  ON public.recruiter_billing_profiles FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- 3) Helper: plan limit
CREATE OR REPLACE FUNCTION public.recruiter_plan_limit(_plan text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'starter' THEN 1
    WHEN 'growth' THEN 5
    WHEN 'fleet' THEN 25
    ELSE 0
  END
$$;

-- 4) Enforce active-opportunity limits server-side
CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _billing public.recruiter_billing_profiles;
  _limit integer;
  _active_count integer;
  _is_becoming_active boolean := false;
BEGIN
  -- Admins bypass
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _is_becoming_active := (NEW.status = 'active');
  ELSIF TG_OP = 'UPDATE' THEN
    _is_becoming_active := (NEW.status = 'active' AND COALESCE(OLD.status, '') <> 'active');
  END IF;

  IF NOT _is_becoming_active THEN
    RETURN NEW;
  END IF;

  -- Recruiter must be approved + not suspended (defense in depth, RLS already checks)
  IF NOT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = NEW.recruiter_id
      AND rp.verification_status = 'approved'
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  ) THEN
    RAISE EXCEPTION 'Recruiter must be approved and active to post opportunities.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _billing
  FROM public.recruiter_billing_profiles
  WHERE recruiter_id = NEW.recruiter_id;

  IF NOT FOUND OR _billing.status NOT IN ('active','trialing') THEN
    RAISE EXCEPTION 'Recruiter billing required to submit opportunities for review.'
      USING ERRCODE = '42501';
  END IF;

  _limit := public.recruiter_plan_limit(_billing.plan);
  IF _limit <= 0 THEN
    RAISE EXCEPTION 'Your recruiter plan does not allow active opportunities.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::int INTO _active_count
  FROM public.opportunities o
  WHERE o.recruiter_id = NEW.recruiter_id
    AND o.status = 'active'
    AND o.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF _active_count >= _limit THEN
    RAISE EXCEPTION 'Active opportunity limit reached for your recruiter plan.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opportunities_billing_guard ON public.opportunities;
CREATE TRIGGER trg_opportunities_billing_guard
BEFORE INSERT OR UPDATE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.opportunities_billing_guard();