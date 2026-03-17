
-- Add dropoff_date column to loads table
ALTER TABLE public.loads ADD COLUMN dropoff_date date;

-- Backfill existing rows with load_date so nothing breaks
UPDATE public.loads SET dropoff_date = load_date WHERE dropoff_date IS NULL;
