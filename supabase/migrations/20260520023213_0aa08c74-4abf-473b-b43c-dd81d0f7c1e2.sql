ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS deadhead_pay_status text NULL,
  ADD COLUMN IF NOT EXISTS deadhead_pay_amount numeric NULL;

ALTER TABLE public.loads
  DROP CONSTRAINT IF EXISTS loads_deadhead_pay_status_check;

ALTER TABLE public.loads
  ADD CONSTRAINT loads_deadhead_pay_status_check
  CHECK (deadhead_pay_status IS NULL OR deadhead_pay_status IN ('unpaid', 'per_mile', 'flat'));