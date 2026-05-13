-- Phase 6C: Cleanup duplicate BEFORE UPDATE triggers on opportunity_applications
-- Drop both possible duplicate trigger names if they exist
DROP TRIGGER IF EXISTS opportunity_applications_update_guard_trigger
  ON public.opportunity_applications;

DROP TRIGGER IF EXISTS opportunity_applications_update_guard_trg
  ON public.opportunity_applications;

-- Recreate exactly one canonical trigger
CREATE TRIGGER opportunity_applications_update_guard_trg
  BEFORE UPDATE ON public.opportunity_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.opportunity_applications_update_guard();

COMMENT ON TRIGGER opportunity_applications_update_guard_trg
  ON public.opportunity_applications IS 'Canonical guard trigger for opportunity_applications updates';