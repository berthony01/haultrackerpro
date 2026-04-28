-- Phase 3: Convert estimated_pay from a generated column to a regular writable column
-- so the new pay-model engine (computeLoadPay) can persist correct values for
-- flat_rate, total_miles, loaded_plus_deadhead, and manual pay models.
-- Also add deadhead_rate_per_mile so loaded_plus_deadhead loads round-trip correctly.

-- 1. Drop the generated-column dependency. Existing data is preserved as plain numeric values.
ALTER TABLE public.loads
  ALTER COLUMN estimated_pay DROP EXPRESSION IF EXISTS;

-- 2. Add the missing per-mile deadhead rate (loaded_plus_deadhead pay model).
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS deadhead_rate_per_mile numeric;

-- 3. Backfill any rows where estimated_pay is NULL using the legacy formula so existing
--    loads continue to render exactly as before. New rows are written by the app.
UPDATE public.loads
SET estimated_pay = COALESCE(estimated_pay,
  (COALESCE(loaded_miles,0) * COALESCE(rate_per_mile,0))
  + COALESCE(wait_fee,0) + COALESCE(detention_fee,0)
)
WHERE estimated_pay IS NULL;