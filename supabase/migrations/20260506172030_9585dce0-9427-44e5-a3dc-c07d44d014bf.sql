-- Constrain recurring_expense_templates.frequency to known values.
-- Existing rows default to 'monthly' so this is safe.
ALTER TABLE public.recurring_expense_templates
  DROP CONSTRAINT IF EXISTS recurring_expense_templates_frequency_check;

ALTER TABLE public.recurring_expense_templates
  ADD CONSTRAINT recurring_expense_templates_frequency_check
  CHECK (frequency IN ('daily', 'weekly', 'monthly'));