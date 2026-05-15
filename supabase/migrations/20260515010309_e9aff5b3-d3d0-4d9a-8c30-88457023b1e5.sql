-- Phase 4 hardening: one AI review per (contract, version)
-- Deduplicate any pre-existing duplicates first (keep most recent)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY contract_id, version_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.contract_reviews
  WHERE reviewer_role = 'ai' AND version_id IS NOT NULL
)
DELETE FROM public.contract_reviews cr
USING ranked r
WHERE cr.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS contract_reviews_ai_unique_per_version
  ON public.contract_reviews (contract_id, version_id)
  WHERE reviewer_role = 'ai' AND version_id IS NOT NULL;
