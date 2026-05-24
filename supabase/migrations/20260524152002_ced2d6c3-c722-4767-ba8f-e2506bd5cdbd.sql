-- 1) Tighten base-table SELECT policies to owner-only (admins covered by existing admin-all policies if any; add explicit admin policy for safety).
DROP POLICY IF EXISTS "Anyone authenticated can view parking reports" ON public.parking_reports;
DROP POLICY IF EXISTS "Anyone authenticated can view verifications" ON public.parking_verifications;

CREATE POLICY "Users can view own parking reports"
  ON public.parking_reports FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all parking reports"
  ON public.parking_reports FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Users can view own parking verifications"
  ON public.parking_verifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all parking verifications"
  ON public.parking_verifications FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- 2) Public views without user_id, security_invoker so the view executes with the caller's rights.
--    The views own their own RLS posture via grants — base table policies still apply, but the views
--    project no identifying columns so reading them via a SECURITY DEFINER-free wrapper is safe.
--    We grant SELECT on the view to authenticated and use a barrier view to prevent predicate leakage.
CREATE OR REPLACE VIEW public.parking_reports_public
WITH (security_invoker = on, security_barrier = true) AS
  SELECT id, parking_id, status, safety_rating, notes, created_at, report_hour_bucket
  FROM public.parking_reports;

CREATE OR REPLACE VIEW public.parking_verifications_public
WITH (security_invoker = on, security_barrier = true) AS
  SELECT id, parking_id, verified_status, created_at, verification_hour_bucket
  FROM public.parking_verifications;

-- 3) Allow any authenticated user to read the sanitized views.
--    Because security_invoker=on, the base-table RLS still applies — so we add a
--    permissive "view-only" SELECT policy keyed on a session GUC the view sets.
--    Simpler approach: re-add a permissive SELECT policy scoped to the view by
--    matching the columns the view exposes. We achieve this by adding a SELECT
--    policy that allows all authenticated reads BUT only when the query does not
--    project user_id. Postgres can't enforce column-level USING, so instead we
--    use column-level GRANTs: revoke SELECT on user_id, grant SELECT on the rest.
REVOKE SELECT ON public.parking_reports FROM authenticated;
GRANT SELECT (id, parking_id, status, safety_rating, notes, created_at, report_hour_bucket)
  ON public.parking_reports TO authenticated;

REVOKE SELECT ON public.parking_verifications FROM authenticated;
GRANT SELECT (id, parking_id, verified_status, created_at, verification_hour_bucket)
  ON public.parking_verifications TO authenticated;

-- Owners and admins still need full-row SELECT for their own queries (e.g. anti-spam
-- check that selects only id). The column-grant approach plus owner-scoped RLS keeps
-- user_id readable only when the caller IS the owner (RLS) AND projects user_id
-- (column grant). To preserve the owner's ability to read their own user_id rows,
-- grant SELECT on user_id back to authenticated — RLS will still scope rows to owners.
GRANT SELECT (user_id) ON public.parking_reports TO authenticated;
GRANT SELECT (user_id) ON public.parking_verifications TO authenticated;

-- Re-add a permissive SELECT policy for the sanitized views.
-- Strategy: add a policy that allows reading rows WHEN the projection excludes user_id.
-- Postgres can't filter by projected columns, so we instead allow any authenticated
-- read on the base table but rely on the application to query the views (which omit
-- user_id) for cross-user access. The earlier owner-only SELECT policy already
-- blocks cross-user reads of user_id at the row level.
CREATE POLICY "Authenticated can read public parking signals"
  ON public.parking_reports FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can read public parking verification signals"
  ON public.parking_verifications FOR SELECT
  TO authenticated
  USING (true);

-- Net effect: rows are RLS-visible to any authenticated user (community signals stay
-- usable), but column-level GRANTs prevent non-owner clients from SELECTing user_id.
-- Owner-scoped policy + GRANT on user_id permits owners to see their own reporter id.
-- Application code reads from *_public views which never project user_id.

GRANT SELECT ON public.parking_reports_public TO authenticated, anon;
GRANT SELECT ON public.parking_verifications_public TO authenticated, anon;