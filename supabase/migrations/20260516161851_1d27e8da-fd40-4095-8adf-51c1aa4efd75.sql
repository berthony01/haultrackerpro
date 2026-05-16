-- Backfill featured = recruiter_has_priority_plan, bypassing the
-- opportunities_guard trigger which otherwise locks `featured` for non-admin sessions.
SET session_replication_role = replica;

UPDATE public.opportunities o
   SET featured = public.recruiter_has_priority_plan(o.recruiter_id)
 WHERE o.featured IS DISTINCT FROM public.recruiter_has_priority_plan(o.recruiter_id);

SET session_replication_role = DEFAULT;