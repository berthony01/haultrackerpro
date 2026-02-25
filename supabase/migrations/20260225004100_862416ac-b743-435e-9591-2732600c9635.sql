
-- Rename columns to match new spec
ALTER TABLE public.loads RENAME COLUMN date TO load_date;
ALTER TABLE public.loads RENAME COLUMN pickup TO pickup_location;
ALTER TABLE public.loads RENAME COLUMN dropoff TO dropoff_location;
ALTER TABLE public.loads RENAME COLUMN actual_pay TO actual_pay_received;

-- Add new columns
ALTER TABLE public.loads ADD COLUMN other_fees numeric NOT NULL DEFAULT 0;
ALTER TABLE public.loads ADD COLUMN notes text;
