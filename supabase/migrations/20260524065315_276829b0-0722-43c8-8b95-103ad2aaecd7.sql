
CREATE TABLE public.resource_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  seo_title text NOT NULL DEFAULT '',
  meta_description text NOT NULL DEFAULT '',
  excerpt text,
  content text NOT NULL DEFAULT '',
  topic_cluster text NOT NULL DEFAULT 'profit',
  status text NOT NULL DEFAULT 'draft',
  approval_status text NOT NULL DEFAULT 'pending_review',
  author_name text,
  generated_by_ai boolean NOT NULL DEFAULT false,
  ai_generation_prompt text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resource_articles_status_check
    CHECK (status IN ('draft','approved','published','archived')),
  CONSTRAINT resource_articles_approval_check
    CHECK (approval_status IN ('pending_review','approved','rejected','needs_revision')),
  CONSTRAINT resource_articles_slug_format
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 120)
);

CREATE INDEX resource_articles_status_idx ON public.resource_articles (status);
CREATE INDEX resource_articles_published_at_idx ON public.resource_articles (published_at DESC);

ALTER TABLE public.resource_articles ENABLE ROW LEVEL SECURITY;

-- Public can only read published articles
CREATE POLICY "Public can read published resource articles"
ON public.resource_articles
FOR SELECT
TO anon, authenticated
USING (status = 'published' AND published_at IS NOT NULL);

-- Admins can read everything (including drafts)
CREATE POLICY "Admins can read all resource articles"
ON public.resource_articles
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert resource articles"
ON public.resource_articles
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update resource articles"
ON public.resource_articles
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete resource articles"
ON public.resource_articles
FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE TRIGGER resource_articles_set_updated_at
BEFORE UPDATE ON public.resource_articles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
