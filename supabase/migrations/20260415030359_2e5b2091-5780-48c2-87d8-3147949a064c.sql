-- Add payment tracking columns to loads table
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS invoice_submitted_date date,
  ADD COLUMN IF NOT EXISTS pod_submitted_date date,
  ADD COLUMN IF NOT EXISTS payment_due_date date,
  ADD COLUMN IF NOT EXISTS paid_date date,
  ADD COLUMN IF NOT EXISTS short_paid_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_notes text;