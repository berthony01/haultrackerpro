-- Phase 1A: canonical driver billing identity integrity constraints.
--
-- Read-only preflight (run immediately before this migration) confirmed:
--   - zero rows in public.subscriptions, public.profiles,
--     public.recruiter_billing_profiles, or public.agency_entitlements
--     currently have a non-null stripe_customer_id or
--     stripe_subscription_id;
--   - zero cross-context or duplicate customer/subscription id collisions
--     exist anywhere.
-- There is therefore no legacy data to reconcile or backfill, and these
-- partial unique indexes are safe to add with no risk of violating existing
-- rows.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_unique
  ON public.subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_unique
  ON public.subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;