-- Recurring expense templates
CREATE TABLE public.recurring_expense_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  template_name TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  start_date DATE NOT NULL,
  end_date DATE,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_generated_date DATE,
  expense_type TEXT NOT NULL DEFAULT 'fixed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.recurring_expense_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own templates"
  ON public.recurring_expense_templates FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own templates"
  ON public.recurring_expense_templates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own templates"
  ON public.recurring_expense_templates FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own templates"
  ON public.recurring_expense_templates FOR DELETE
  USING (auth.uid() = user_id);

-- Timestamp trigger
CREATE TRIGGER update_recurring_expense_templates_updated_at
  BEFORE UPDATE ON public.recurring_expense_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();