-- Lead magnet signups table
CREATE TABLE public.lead_magnet_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  first_name text,
  bundle_name text NOT NULL DEFAULT 'Trucker Starter Kit',
  bundle_version text NOT NULL DEFAULT 'free',
  source_page text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  download_sent_at timestamptz,
  downloaded_at timestamptz,
  converted_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_magnet_signups_email ON public.lead_magnet_signups (lower(email));
CREATE INDEX idx_lead_magnet_signups_created_at ON public.lead_magnet_signups (created_at DESC);

CREATE TRIGGER trg_lead_magnet_signups_updated_at
BEFORE UPDATE ON public.lead_magnet_signups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.lead_magnet_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit lead"
  ON public.lead_magnet_signups FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can view leads"
  ON public.lead_magnet_signups FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update leads"
  ON public.lead_magnet_signups FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Public storage bucket for lead magnet downloads
INSERT INTO storage.buckets (id, name, public)
VALUES ('lead-magnets', 'lead-magnets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can read lead magnets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'lead-magnets');