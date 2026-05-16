ALTER TABLE public.contract_signatures
  ADD CONSTRAINT contract_signatures_driver_only
  CHECK (signer_role = 'driver');