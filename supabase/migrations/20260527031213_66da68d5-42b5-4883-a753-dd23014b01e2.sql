CREATE TABLE public.recruiter_outreach_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_profile_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  recruiter_user_id uuid NULL,
  status text NOT NULL DEFAULT 'outreach_needed',
  priority text NOT NULL DEFAULT 'medium',
  last_template_key text NULL,
  last_template_label text NULL,
  last_copied_at timestamptz NULL,
  last_contacted_at timestamptz NULL,
  follow_up_at timestamptz NULL,
  closed_at timestamptz NULL,
  admin_note text NULL,
  created_by uuid NULL DEFAULT auth.uid(),
  updated_by uuid NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruiter_outreach_status_unique_recruiter UNIQUE (recruiter_profile_id),
  CONSTRAINT recruiter_outreach_status_status_check CHECK (status IN (
    'outreach_needed','template_copied','contacted_manually','replied',
    'no_response','follow_up_scheduled','closed'
  )),
  CONSTRAINT recruiter_outreach_status_priority_check CHECK (priority IN ('low','medium','high')),
  CONSTRAINT recruiter_outreach_status_note_length CHECK (admin_note IS NULL OR char_length(admin_note) <= 500)
);

GRANT SELECT, INSERT, UPDATE ON public.recruiter_outreach_status TO authenticated;
GRANT ALL ON public.recruiter_outreach_status TO service_role;

ALTER TABLE public.recruiter_outreach_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view recruiter outreach status"
  ON public.recruiter_outreach_status
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins insert recruiter outreach status"
  ON public.recruiter_outreach_status
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins update recruiter outreach status"
  ON public.recruiter_outreach_status
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX idx_recruiter_outreach_recruiter ON public.recruiter_outreach_status(recruiter_profile_id);
CREATE INDEX idx_recruiter_outreach_status ON public.recruiter_outreach_status(status);
CREATE INDEX idx_recruiter_outreach_priority ON public.recruiter_outreach_status(priority);
CREATE INDEX idx_recruiter_outreach_follow_up ON public.recruiter_outreach_status(follow_up_at);
CREATE INDEX idx_recruiter_outreach_updated ON public.recruiter_outreach_status(updated_at DESC);

CREATE OR REPLACE FUNCTION public.update_recruiter_outreach_status_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recruiter_outreach_status_updated_at
BEFORE UPDATE ON public.recruiter_outreach_status
FOR EACH ROW
EXECUTE FUNCTION public.update_recruiter_outreach_status_updated_at();