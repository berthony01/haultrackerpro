
-- ============================================================
-- Opportunities Foundation (Phase 1)
-- ============================================================

-- ============================================================
-- A. driver_opportunity_profiles
-- ============================================================
CREATE TABLE public.driver_opportunity_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  email text,
  city text,
  state text,
  cdl_class text,
  years_experience numeric,
  endorsements text[] NOT NULL DEFAULT '{}',
  trailer_experience text[] NOT NULL DEFAULT '{}',
  preferred_driver_type text,
  preferred_route_type text,
  preferred_home_time text,
  preferred_states text[] NOT NULL DEFAULT '{}',
  min_weekly_gross numeric,
  min_weekly_net numeric,
  min_effective_rpm numeric,
  available_start_date date,
  willing_to_relocate boolean NOT NULL DEFAULT false,
  contact_preference text NOT NULL DEFAULT 'in_app',
  visibility text NOT NULL DEFAULT 'private',
  allow_verified_recruiter_contact boolean NOT NULL DEFAULT false,
  profile_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_opportunity_profiles_user_unique UNIQUE (user_id),
  CONSTRAINT driver_opportunity_profiles_visibility_chk
    CHECK (visibility IN ('private','apply_only','verified_recruiters')),
  CONSTRAINT driver_opportunity_profiles_contact_pref_chk
    CHECK (contact_preference IN ('in_app','phone','email'))
);

ALTER TABLE public.driver_opportunity_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Driver views own opportunity profile"
  ON public.driver_opportunity_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all driver opportunity profiles"
  ON public.driver_opportunity_profiles FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Driver inserts own opportunity profile"
  ON public.driver_opportunity_profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Driver updates own opportunity profile"
  ON public.driver_opportunity_profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Driver deletes own opportunity profile"
  ON public.driver_opportunity_profiles FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE TRIGGER trg_driver_opportunity_profiles_updated_at
  BEFORE UPDATE ON public.driver_opportunity_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- B. recruiter_profiles
-- ============================================================
CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_name text NOT NULL,
  recruiter_email text,
  recruiter_phone text,
  company_name text NOT NULL,
  company_website text,
  dot_number text,
  mc_number text,
  company_phone text,
  company_address text,
  company_city text,
  company_state text,
  hiring_states text[] NOT NULL DEFAULT '{}',
  equipment_types text[] NOT NULL DEFAULT '{}',
  driver_types_hired text[] NOT NULL DEFAULT '{}',
  verification_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'active',
  admin_notes text,
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruiter_profiles_user_unique UNIQUE (user_id),
  CONSTRAINT recruiter_profiles_verification_status_chk
    CHECK (verification_status IN ('pending','approved','rejected','suspended')),
  CONSTRAINT recruiter_profiles_status_chk
    CHECK (status IN ('active','inactive','suspended'))
);

ALTER TABLE public.recruiter_profiles ENABLE ROW LEVEL SECURITY;

-- Now safe: helper to check recruiter ownership without recursive RLS
CREATE OR REPLACE FUNCTION public.is_recruiter_owner(_user_id uuid, _recruiter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recruiter_profiles
    WHERE id = _recruiter_id
      AND user_id = _user_id
      AND status <> 'suspended'
  )
$$;

CREATE POLICY "Recruiter views own profile"
  ON public.recruiter_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all recruiter profiles"
  ON public.recruiter_profiles FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Recruiter inserts own profile"
  ON public.recruiter_profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Recruiter updates own profile if not suspended"
  ON public.recruiter_profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status <> 'suspended')
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins update recruiter profiles"
  ON public.recruiter_profiles FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Block recruiters from setting verification fields themselves.
CREATE OR REPLACE FUNCTION public.recruiter_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending';
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
    NEW.admin_notes := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.verification_status := OLD.verification_status;
    NEW.verified_at := OLD.verified_at;
    NEW.verified_by := OLD.verified_by;
    NEW.admin_notes := OLD.admin_notes;
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recruiter_profiles_guard
  BEFORE INSERT OR UPDATE ON public.recruiter_profiles
  FOR EACH ROW EXECUTE FUNCTION public.recruiter_profile_guard();

CREATE TRIGGER trg_recruiter_profiles_updated_at
  BEFORE UPDATE ON public.recruiter_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- C. opportunities
-- ============================================================
CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  company_name text NOT NULL,
  hiring_city text,
  hiring_state text,
  hiring_states text[] NOT NULL DEFAULT '{}',
  driver_type text,
  route_type text,
  trailer_type text,
  pay_model text,
  cpm numeric,
  percentage_pay numeric,
  flat_weekly_pay numeric,
  estimated_weekly_gross numeric,
  estimated_weekly_miles numeric,
  estimated_loaded_miles numeric,
  estimated_deadhead_miles numeric,
  deadhead_paid boolean,
  detention_pay text,
  layover_pay text,
  sign_on_bonus numeric,
  fuel_paid_by text,
  insurance_deductions numeric,
  escrow_required boolean NOT NULL DEFAULT false,
  escrow_amount numeric,
  lease_payment numeric,
  maintenance_deductions numeric,
  other_deductions numeric,
  home_time text,
  forced_dispatch boolean,
  pets_allowed boolean,
  riders_allowed boolean,
  equipment_year text,
  benefits text,
  description text,
  transparency_confirmed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  admin_review_status text NOT NULL DEFAULT 'pending',
  featured boolean NOT NULL DEFAULT false,
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT opportunities_status_chk
    CHECK (status IN ('draft','active','paused','closed','removed')),
  CONSTRAINT opportunities_admin_review_status_chk
    CHECK (admin_review_status IN ('pending','approved','rejected','flagged')),
  CONSTRAINT opportunities_pay_model_chk
    CHECK (pay_model IS NULL OR pay_model IN ('cpm','percentage','flat_weekly','salary','mixed','other'))
);

CREATE INDEX idx_opportunities_recruiter ON public.opportunities(recruiter_id);
CREATE INDEX idx_opportunities_published
  ON public.opportunities(status, admin_review_status)
  WHERE status = 'active' AND admin_review_status = 'approved';

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view approved active opportunities"
  ON public.opportunities FOR SELECT TO authenticated
  USING (status = 'active' AND admin_review_status = 'approved');

CREATE POLICY "Recruiter views own opportunities"
  ON public.opportunities FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = opportunities.recruiter_id AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins view all opportunities"
  ON public.opportunities FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Recruiter inserts own opportunities"
  ON public.opportunities FOR INSERT TO authenticated
  WITH CHECK (public.is_recruiter_owner(auth.uid(), recruiter_id));

CREATE POLICY "Recruiter updates own opportunities"
  ON public.opportunities FOR UPDATE TO authenticated
  USING (public.is_recruiter_owner(auth.uid(), recruiter_id))
  WITH CHECK (public.is_recruiter_owner(auth.uid(), recruiter_id));

CREATE POLICY "Admins update all opportunities"
  ON public.opportunities FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins delete opportunities"
  ON public.opportunities FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.opportunities_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.admin_review_status := 'pending';
    NEW.featured := false;
    NEW.view_count := 0;
    NEW.published_at := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.admin_review_status := OLD.admin_review_status;
    NEW.featured := OLD.featured;
    NEW.view_count := OLD.view_count;
    NEW.published_at := OLD.published_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_opportunities_guard
  BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.opportunities_guard();

CREATE TRIGGER trg_opportunities_updated_at
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- D. saved_opportunities
-- ============================================================
CREATE TABLE public.saved_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_opportunities_unique UNIQUE (user_id, opportunity_id)
);

ALTER TABLE public.saved_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User views own saved opportunities"
  ON public.saved_opportunities FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all saved opportunities"
  ON public.saved_opportunities FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "User inserts own saved opportunities"
  ON public.saved_opportunities FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "User deletes own saved opportunities"
  ON public.saved_opportunities FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- E. opportunity_applications
-- ============================================================
CREATE TABLE public.opportunity_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  driver_profile_id uuid REFERENCES public.driver_opportunity_profiles(id) ON DELETE SET NULL,
  application_type text NOT NULL DEFAULT 'request_info',
  status text NOT NULL DEFAULT 'new',
  message text,
  preferred_contact_method text,
  driver_phone_snapshot text,
  driver_email_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_applications_unique UNIQUE (opportunity_id, driver_user_id),
  CONSTRAINT opportunity_applications_type_chk
    CHECK (application_type IN ('apply','request_info','callback')),
  CONSTRAINT opportunity_applications_status_chk
    CHECK (status IN ('new','viewed','contacted','interviewing','hired','rejected','withdrawn'))
);

CREATE INDEX idx_opportunity_applications_driver ON public.opportunity_applications(driver_user_id);
CREATE INDEX idx_opportunity_applications_recruiter ON public.opportunity_applications(recruiter_id);

ALTER TABLE public.opportunity_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Driver views own applications"
  ON public.opportunity_applications FOR SELECT TO authenticated
  USING (auth.uid() = driver_user_id);

CREATE POLICY "Recruiter views applications for own opportunities"
  ON public.opportunity_applications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = opportunity_applications.recruiter_id AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins view all applications"
  ON public.opportunity_applications FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Driver inserts own application"
  ON public.opportunity_applications FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = driver_user_id
    AND EXISTS (
      SELECT 1 FROM public.opportunities o
      WHERE o.id = opportunity_id
        AND o.recruiter_id = opportunity_applications.recruiter_id
        AND o.status = 'active'
        AND o.admin_review_status = 'approved'
    )
  );

CREATE POLICY "Recruiter updates application status"
  ON public.opportunity_applications FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = opportunity_applications.recruiter_id
        AND rp.user_id = auth.uid()
        AND rp.status <> 'suspended'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = opportunity_applications.recruiter_id
        AND rp.user_id = auth.uid()
        AND rp.status <> 'suspended'
    )
  );

CREATE POLICY "Admins update applications"
  ON public.opportunity_applications FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_opportunity_applications_updated_at
  BEFORE UPDATE ON public.opportunity_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- F. opportunity_reports
-- ============================================================
CREATE TABLE public.opportunity_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE CASCADE,
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_id uuid REFERENCES public.recruiter_profiles(id) ON DELETE SET NULL,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_reports_status_chk
    CHECK (status IN ('open','reviewing','resolved','dismissed'))
);

ALTER TABLE public.opportunity_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reporter views own reports"
  ON public.opportunity_reports FOR SELECT TO authenticated
  USING (auth.uid() = reporter_user_id);

CREATE POLICY "Admins view all reports"
  ON public.opportunity_reports FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Reporter inserts own report"
  ON public.opportunity_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_user_id);

CREATE POLICY "Admins update reports"
  ON public.opportunity_reports FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_opportunity_reports_updated_at
  BEFORE UPDATE ON public.opportunity_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
