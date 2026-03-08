
-- Create subscriptions table as canonical billing state
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  plan_key text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'free',
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_subscriptions_stripe_customer_id ON public.subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_stripe_subscription_id ON public.subscriptions(stripe_subscription_id);

-- Enable RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can only read their own subscription
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No direct user writes (webhook/server-only via service role)
-- Admins can view all subscriptions
CREATE POLICY "Admins can view all subscriptions"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Updated_at trigger
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed a subscription row for every existing user from profiles data
INSERT INTO public.subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan_key, status)
SELECT 
  p.user_id,
  p.stripe_customer_id,
  p.stripe_subscription_id,
  CASE WHEN p.subscription_status = 'pro' THEN 'pro_monthly' ELSE 'free' END,
  CASE 
    WHEN p.subscription_status = 'pro' THEN 'active'
    ELSE 'free'
  END
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;

-- Update handle_new_user to also create a subscription row
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);
  INSERT INTO public.subscriptions (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;
