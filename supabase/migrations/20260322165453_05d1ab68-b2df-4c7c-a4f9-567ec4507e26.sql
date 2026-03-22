
-- Add expense_type column to expenses table
ALTER TABLE public.expenses 
ADD COLUMN IF NOT EXISTS expense_type text NOT NULL DEFAULT 'variable';

-- Backfill existing expenses based on category
UPDATE public.expenses SET expense_type = 'fixed' WHERE category IN ('Insurance', 'Permits', 'Licensing', 'Truck Payment', 'Lease Payment', 'Phone', 'ELD/Software');
UPDATE public.expenses SET expense_type = 'variable' WHERE category IN ('Fuel', 'Maintenance', 'Repairs', 'Tires', 'Tolls', 'Parking', 'Scale/Weigh', 'Lumper', 'Meals', 'Lodging', 'Supplies', 'Other');
