
-- ============================================================================
-- Phase 24: Production security hardening
-- 1) driver_referrals: stop exposing referred-driver PII to the referring driver
-- 2) resource_articles: stop exposing ai_generation_prompt + internal fields to public
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. driver_referrals: driver-safe view + drop wide driver SELECT
-- ----------------------------------------------------------------------------

-- Remove the broad SELECT policy that lets referring drivers read PII columns.
DROP POLICY IF EXISTS "Referring driver views own referrals" ON public.driver_referrals;

-- Safe driver-facing view: excludes referred_driver_email / referred_driver_phone /
-- referred_driver_note. Implemented as SECURITY DEFINER (default for views with
-- security_invoker=false) so it can return rows to the referring driver even
-- though the base-table policy no longer allows them to SELECT directly.
-- The view itself filters by auth.uid() so a driver only ever sees their own rows.
DROP VIEW IF EXISTS public.driver_referrals_driver_safe;
CREATE VIEW public.driver_referrals_driver_safe
WITH (security_invoker = false)
AS
SELECT
  dr.id,
  dr.opportunity_id,
  dr.recruiter_id,
  dr.referring_driver_id,
  dr.referred_driver_user_id,
  dr.referred_driver_name,
  dr.status,
  dr.last_status_at,
  dr.created_at,
  dr.updated_at
FROM public.driver_referrals dr
WHERE dr.referring_driver_id = auth.uid();

REVOKE ALL ON public.driver_referrals_driver_safe FROM PUBLIC, anon;
GRANT SELECT ON public.driver_referrals_driver_safe TO authenticated;

COMMENT ON VIEW public.driver_referrals_driver_safe IS
  'Driver-facing projection of driver_referrals that omits referred_driver_email, referred_driver_phone, and referred_driver_note. Filters by auth.uid() = referring_driver_id.';

-- Sanity: referring driver still needs to be able to INSERT their own referrals.
-- The existing "Driver inserts own referral" INSERT policy remains untouched.
-- Admin SELECT/UPDATE/DELETE and Recruiter SELECT/UPDATE policies remain untouched.
-- "Referred driver views linked referrals" remains so the referred user can see linked rows.
-- "Referring driver updates own referral early" remains so drivers can still correct contact
-- details while status = 'referral_sent' (write-only path, no PII read leakage).

-- ----------------------------------------------------------------------------
-- 2. resource_articles: drop public base-table SELECT, expose public-safe view
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Public can read published resource articles" ON public.resource_articles;

DROP VIEW IF EXISTS public.resource_articles_public;
CREATE VIEW public.resource_articles_public
WITH (security_invoker = false)
AS
SELECT
  ra.id,
  ra.slug,
  ra.title,
  ra.seo_title,
  ra.meta_description,
  ra.excerpt,
  ra.content,
  ra.topic_cluster,
  ra.author_name,
  ra.published_at,
  ra.updated_at
FROM public.resource_articles ra
WHERE ra.status = 'published'
  AND ra.published_at IS NOT NULL;

REVOKE ALL ON public.resource_articles_public FROM PUBLIC;
GRANT SELECT ON public.resource_articles_public TO anon, authenticated;

COMMENT ON VIEW public.resource_articles_public IS
  'Public projection of published resource_articles. Excludes ai_generation_prompt, approval_status, reviewed_by, created_by, status, and other internal/admin fields.';

-- Admin SELECT/INSERT/UPDATE policies on the base table are unchanged, so the
-- admin article manager keeps full access via the base table.
