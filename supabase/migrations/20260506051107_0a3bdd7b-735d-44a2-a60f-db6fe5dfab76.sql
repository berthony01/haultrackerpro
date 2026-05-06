
-- Prevent users from modifying billing-controlled fields on their profile.
-- Service role (backend / Stripe webhook) bypasses RLS and triggers entirely,
-- so this only affects the authenticated user role.
CREATE OR REPLACE FUNCTION public.prevent_profile_billing_field_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow service_role (used by stripe-webhook + admin paths) to change anything.
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.stripe_customer_id      := OLD.stripe_customer_id;
  NEW.stripe_subscription_id  := OLD.stripe_subscription_id;
  NEW.subscription_status     := OLD.subscription_status;
  NEW.subscription_plan       := OLD.subscription_plan;
  NEW.subscription_expires_at := OLD.subscription_expires_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_billing_field_updates ON public.profiles;
CREATE TRIGGER profiles_prevent_billing_field_updates
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_billing_field_updates();

-- Restrict admin_users visibility so a regular admin can't enumerate other admins.
DROP POLICY IF EXISTS "Admins can view admin_users" ON public.admin_users;

CREATE POLICY "Admins can view own admin row"
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Super admins can view all admin_users"
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));
