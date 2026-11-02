-- UNAPPLIED: separate approval is required before changing the production schedule.
-- Rollback candidate: restore the original once-per-minute Telegram schedule.
-- Project: Haul Tracker Pro / pngptztxwbtozwxrtbwo.
-- Reviewed runtime baseline: 8031ee1a4e109c159227ec2f461eafcf2f942dfe.
-- Only the schedule of existing cron job 68 changes. Its command, credentials,
-- owner, database, active state, name, and all other jobs are preserved.
-- No new job, poller, webhook, function, flag, permission, or load change.
-- Existing 90-second processing lease and receipt idempotency remain intact.
-- A 10-second schedule means at most 8,640 scheduled starts per 24 hours,
-- versus 1,440 at one minute: 86,400/10 versus 86,400/60, a 6x increase.
-- This is scheduling frequency, not an end-to-end response-time guarantee.
-- More frequent starts can increase runtime usage and job-history volume.
-- Live response time must be measured after separately approved application.
-- Restore with the companion candidate; both scripts reject unexpected state.

-- Serializable isolation rejects a concurrent change to the target job.
-- Use the supported cron API; this managed role cannot lock cron.job directly.
BEGIN ISOLATION LEVEL SERIALIZABLE;
DO $cadence$
DECLARE
  _apply constant boolean := true;
  _from constant text := '10 seconds';
  _to constant text := '* * * * *';
  _before cron.job%ROWTYPE;
  _checked cron.job%ROWTYPE;
  _after cron.job%ROWTYPE;
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres'
     OR (SELECT extversion FROM pg_catalog.pg_extension WHERE extname='pg_cron')
        IS DISTINCT FROM '1.6.4'
  THEN RAISE EXCEPTION 'telegram_poll_cadence_environment_mismatch'; END IF;

  IF (SELECT count(*) FROM cron.job
      WHERE command LIKE '%telegram-poll%' OR jobname ILIKE '%telegram%') <> 1
  THEN RAISE EXCEPTION 'telegram_poll_cadence_ambiguous_job'; END IF;

  SELECT * INTO STRICT _before FROM cron.job WHERE jobid=68;
  IF _before.jobname IS DISTINCT FROM 'telegram-poll-every-minute'
     OR _before.database IS DISTINCT FROM 'postgres'
     OR _before.username IS DISTINCT FROM 'postgres'
     OR _before.active IS DISTINCT FROM true
     OR md5(_before.command) IS DISTINCT FROM 'f05f47dae35dcc6ac88036a1a8e74246'
     OR _before.schedule IS DISTINCT FROM _from
  THEN RAISE EXCEPTION 'telegram_poll_cadence_baseline_mismatch'; END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_proc p
      WHERE p.pronamespace='public'::regnamespace AND p.prosecdef AND
      ((p.oid='public.telegram_claim_poll_lease()'::regprocedure
        AND md5(p.prosrc)='652054e8a45f56cc9c9a538242b1cf06')
       OR (p.oid='public.telegram_release_poll_lease(uuid)'::regprocedure
        AND md5(p.prosrc)='6fbf73533b710b75f98a20911dc45229'))) <> 2
  THEN RAISE EXCEPTION 'telegram_poll_cadence_lease_drift'; END IF;

  IF NOT _apply THEN
    RAISE NOTICE 'Read-only preflight passed; no schedule change performed';
    RETURN;
  END IF;

  SELECT * INTO STRICT _checked FROM cron.job WHERE jobid=68;
  IF to_jsonb(_checked) IS DISTINCT FROM to_jsonb(_before)
  THEN RAISE EXCEPTION 'telegram_poll_cadence_concurrent_change'; END IF;

  PERFORM cron.alter_job(job_id => 68, schedule => _to);

  SELECT * INTO STRICT _after FROM cron.job WHERE jobid=68;
  IF _after.schedule IS DISTINCT FROM _to
     OR (to_jsonb(_after) - 'schedule') IS DISTINCT FROM
        (to_jsonb(_before) - 'schedule')
     OR (SELECT count(*) FROM cron.job
         WHERE command LIKE '%telegram-poll%' OR jobname ILIKE '%telegram%') <> 1
  THEN RAISE EXCEPTION 'telegram_poll_cadence_postcheck_failed'; END IF;
END;
$cadence$;
COMMIT;
