-- Add pause/resume metadata to recurring expense templates.
-- IMPORTANT: We keep the existing `is_active` boolean as the source of truth for the
-- generation cron (supabase/functions/generate-recurring-expenses) so we don't break
-- existing behavior. The new `status` column mirrors is_active and is kept in sync via
-- a trigger so UI code can read either field safely.

ALTER TABLE public.recurring_expense_templates
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS pause_reason TEXT NULL;

-- Backfill status from existing is_active so legacy rows are correct
UPDATE public.recurring_expense_templates
SET status = CASE WHEN is_active THEN 'active' ELSE 'paused' END
WHERE status IS NULL OR status NOT IN ('active','paused');

-- Constrain allowed values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recurring_expense_templates_status_check'
  ) THEN
    ALTER TABLE public.recurring_expense_templates
      ADD CONSTRAINT recurring_expense_templates_status_check
      CHECK (status IN ('active','paused'));
  END IF;
END $$;

-- Keep is_active and status in sync both ways so the existing cron function (which
-- filters on is_active) and the new UI (which uses status) stay consistent.
CREATE OR REPLACE FUNCTION public.sync_recurring_template_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- If status changed, update is_active to match
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.is_active := (NEW.status = 'active');
  -- Else if is_active changed, update status to match
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    NEW.status := CASE WHEN NEW.is_active THEN 'active' ELSE 'paused' END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_recurring_template_status ON public.recurring_expense_templates;
CREATE TRIGGER trg_sync_recurring_template_status
BEFORE UPDATE ON public.recurring_expense_templates
FOR EACH ROW
EXECUTE FUNCTION public.sync_recurring_template_status();

-- Add Home Time Mode flags to user_settings
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS home_time_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_time_started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS home_time_ended_at TIMESTAMPTZ NULL;