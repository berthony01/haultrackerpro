
-- Phase 26: Replace SECURITY DEFINER views with narrowly scoped RPC functions

DROP VIEW IF EXISTS public.driver_referrals_driver_safe;
DROP VIEW IF EXISTS public.resource_articles_public;

-- ---------------------------------------------------------------------------
-- Driver-safe referrals RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_driver_referrals()
RETURNS TABLE (
  id uuid,
  opportunity_id uuid,
  recruiter_id uuid,
  referring_driver_id uuid,
  referred_driver_user_id uuid,
  referred_driver_name text,
  status text,
  last_status_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  opportunity_title text,
  opportunity_company_name text,
  opportunity_hiring_city text,
  opportunity_hiring_state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    dr.updated_at,
    o.title,
    o.company_name,
    o.hiring_city,
    o.hiring_state
  FROM public.driver_referrals dr
  LEFT JOIN public.opportunities o ON o.id = dr.opportunity_id
  WHERE auth.uid() IS NOT NULL
    AND dr.referring_driver_id = auth.uid()
  ORDER BY dr.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_my_driver_referrals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_driver_referrals() TO authenticated;

COMMENT ON FUNCTION public.list_my_driver_referrals() IS
  'Driver-facing projection of driver_referrals. Omits referred_driver_email, referred_driver_phone, and referred_driver_note. Always filters by auth.uid() = referring_driver_id.';

-- ---------------------------------------------------------------------------
-- Public resource article RPCs (replace resource_articles_public view)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_public_resource_articles(_limit int DEFAULT 24)
RETURNS TABLE (
  id uuid,
  slug text,
  title text,
  excerpt text,
  topic_cluster text,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ra.id, ra.slug, ra.title, ra.excerpt, ra.topic_cluster, ra.published_at
  FROM public.resource_articles ra
  WHERE ra.status = 'published'
    AND ra.published_at IS NOT NULL
  ORDER BY ra.published_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 24), 100));
$$;

REVOKE ALL ON FUNCTION public.list_public_resource_articles(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_resource_articles(int) TO anon, authenticated;

COMMENT ON FUNCTION public.list_public_resource_articles(int) IS
  'Public projection of published resource_articles. Excludes ai_generation_prompt, approval_status, reviewed_by, created_by, status, and other internal/admin fields.';

CREATE OR REPLACE FUNCTION public.get_public_resource_article(_slug text)
RETURNS TABLE (
  id uuid,
  slug text,
  title text,
  seo_title text,
  meta_description text,
  excerpt text,
  content text,
  topic_cluster text,
  author_name text,
  published_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ra.id, ra.slug, ra.title, ra.seo_title, ra.meta_description,
         ra.excerpt, ra.content, ra.topic_cluster, ra.author_name,
         ra.published_at, ra.updated_at
  FROM public.resource_articles ra
  WHERE ra.slug = _slug
    AND ra.status = 'published'
    AND ra.published_at IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_resource_article(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_resource_article(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_resource_article(text) IS
  'Public single-article fetch for published resource_articles by slug. Excludes ai_generation_prompt and all admin workflow fields.';
