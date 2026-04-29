-- Idempotent backfill of the platform-owner admin row.
-- The original migration (20260228060534_…) seeded this row but only worked
-- if the auth.users record for berthonyxyz@gmail.com already existed at the
-- time the migration ran. This migration re-runs the same insert so that if
-- the owner account has since been created, the row is now present.
-- Safe to re-run any time.
INSERT INTO public.admin_users (user_id, email, role)
SELECT id, email, 'super_admin'
FROM auth.users
WHERE lower(email) = 'berthonyxyz@gmail.com'
ON CONFLICT (user_id) DO NOTHING;