-- Stripe webhook idempotency ledger.
-- Only the service role (used by the stripe-webhook edge function) should
-- read/write this table. RLS is enabled with NO policies so authenticated
-- and anon roles cannot access it.
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type
  ON public.stripe_webhook_events (event_type, processed_at DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: service_role bypasses RLS; no other role may access.