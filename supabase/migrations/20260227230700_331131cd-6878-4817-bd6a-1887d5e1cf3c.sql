
-- Add tax estimator fields to user_settings
ALTER TABLE public.user_settings
  ADD COLUMN tax_estimator_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN federal_tax_percent numeric NULL,
  ADD COLUMN state_tax_percent numeric NULL,
  ADD COLUMN include_se_tax boolean NULL,
  ADD COLUMN se_tax_percent numeric NULL,
  ADD COLUMN buffer_percent numeric NULL,
  ADD COLUMN tax_base_type text NULL;
