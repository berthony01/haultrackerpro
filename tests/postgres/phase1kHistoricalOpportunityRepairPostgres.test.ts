/**
 * Phase 1K-D — real PostgreSQL proof for the single historical opportunity repair.
 *
 * This suite loads the production migration directly from disk, creates a
 * schema-faithful PostgreSQL fixture, and proves success, fail-closed drift
 * handling, transaction atomicity, notification behavior, and driver visibility.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { beforeEach, afterAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.PHASE1K_D_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'PHASE1K_D_DATABASE_URL is required for the Phase 1K-D real-PostgreSQL gate. ' +
      'This suite must never be skipped.',
  );
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPAIR_PATH =
  REPO_ROOT +
  'supabase/migrations/20260721010000_phase1k_repair_historical_admin_recruiter_opportunity.sql';
const GUARD_PATH =
  REPO_ROOT +
  'supabase/migrations/20260721000000_phase1k_admin_recruiter_opportunity_publication.sql';

const REPAIR_SQL = readFileSync(REPAIR_PATH, 'utf8');
const FIXED_GUARD_SQL = readFileSync(GUARD_PATH, 'utf8');

const TARGET_ID = '28d75a1e-0d49-445a-82c8-01ba56432a93';
const RECRUITER_ID = 'f6b00b66-cd1c-4037-a382-8b1b9c629f3b';
const OWNER_ID = 'df860876-4c44-4f93-b31c-72ca9dbd9f3d';
const DRIVER_ID = '33333333-3333-4333-8333-333333333333';
const TITLE = 'Looking for OTR company drivers';

const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

const BASE_SCHEMA_SQL = `
DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS supabase_migrations CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA auth;
CREATE SCHEMA supabase_migrations;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text,
  created_by text,
  idempotency_key text UNIQUE,
  rollback text[]
);

CREATE TABLE public.admin_users (
  id uuid PRIMARY KEY,
  user_id uuid UNIQUE NOT NULL,
  email text NOT NULL,
  role text NOT NULL
);

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users au WHERE au.user_id = _user_id
  )
$$;

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  recruiter_name text NOT NULL,
  recruiter_email text,
  company_name text NOT NULL,
  dot_number text,
  mc_number text,
  verification_status text NOT NULL,
  status text NOT NULL,
  posting_terms_accepted_at timestamptz,
  posting_terms_version text,
  legacy_terms_grandfathered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(
  _recruiter_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.recruiter_profiles rp
     WHERE rp.id = _recruiter_id
       AND rp.status <> 'suspended'
       AND rp.verification_status <> 'suspended'
       AND COALESCE(btrim(rp.recruiter_name), '') <> ''
       AND COALESCE(btrim(rp.company_name), '') <> ''
       AND COALESCE(btrim(rp.recruiter_email), '') <> ''
       AND btrim(rp.recruiter_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
       AND (
             COALESCE(btrim(rp.dot_number), '') <> ''
          OR COALESCE(btrim(rp.mc_number), '') <> ''
       )
       AND (
             rp.posting_terms_accepted_at IS NOT NULL
          OR rp.legacy_terms_grandfathered_at IS NOT NULL
       )
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(
  _recruiter_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.recruiter_profiles rp
     WHERE rp.id = _recruiter_id
       AND rp.user_id = auth.uid()
       AND public.recruiter_profile_can_manage_opportunities(rp.id)
  )
$$;

CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY,
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id),
  title text NOT NULL,
  company_name text NOT NULL,
  hiring_state text,
  driver_type text,
  route_type text,
  trailer_type text,
  status text NOT NULL,
  admin_review_status text NOT NULL,
  featured boolean NOT NULL,
  view_count integer NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE public.opportunity_applications (
  id uuid PRIMARY KEY,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id)
);

CREATE TABLE public.opportunity_offers (
  id uuid PRIMARY KEY,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id)
);

CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY,
  in_app_enabled boolean NOT NULL DEFAULT true,
  recruiter_status_events boolean NOT NULL DEFAULT true
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.notification_category(_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _type = 'opportunity_reviewed' THEN 'recruiter_status_events'
    ELSE 'other'
  END
$$;

CREATE OR REPLACE FUNCTION public.create_notification(
  _user_id uuid,
  _type text,
  _title text,
  _body text,
  _payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prefs public.notification_preferences;
  _id uuid := (
    substr(md5(random()::text || clock_timestamp()::text), 1, 8) || '-' ||
    substr(md5(random()::text || clock_timestamp()::text), 1, 4) || '-4' ||
    substr(md5(random()::text || clock_timestamp()::text), 1, 3) || '-8' ||
    substr(md5(random()::text || clock_timestamp()::text), 1, 3) || '-' ||
    substr(md5(random()::text || clock_timestamp()::text), 1, 12)
  )::uuid;
BEGIN
  IF _user_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _prefs
    FROM public.notification_preferences
   WHERE user_id = _user_id;

  IF FOUND AND (
       _prefs.in_app_enabled IS NOT TRUE
       OR (_type = 'opportunity_reviewed' AND _prefs.recruiter_status_events IS NOT TRUE)
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (id, user_id, type, title, body, payload)
  VALUES (_id, _user_id, _type, _title, _body, COALESCE(_payload, '{}'::jsonb));

  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_opportunity_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recruiter_user_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.admin_review_status IS DISTINCT FROM OLD.admin_review_status
     AND NEW.admin_review_status IN ('approved', 'rejected')
  THEN
    SELECT rp.user_id INTO _recruiter_user_id
      FROM public.recruiter_profiles rp
     WHERE rp.id = NEW.recruiter_id;

    IF _recruiter_user_id IS NOT NULL THEN
      PERFORM public.create_notification(
        _recruiter_user_id,
        'opportunity_reviewed',
        CASE NEW.admin_review_status
          WHEN 'approved' THEN 'Opportunity approved'
          ELSE 'Opportunity rejected'
        END,
        'Your opportunity "' || COALESCE(NEW.title, '') || '" was ' ||
          NEW.admin_review_status || '.',
        jsonb_build_object(
          'opportunity_id', NEW.id,
          'admin_review_status', NEW.admin_review_status
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NOT public.current_user_can_manage_recruiter_opportunities(NEW.recruiter_id) THEN
    RAISE EXCEPTION 'Complete your recruiter profile to publish opportunities.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_driver_visible_opportunities(
  _state text DEFAULT NULL,
  _driver_type text DEFAULT NULL,
  _route_type text DEFAULT NULL
) RETURNS SETOF public.opportunities
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.*
    FROM public.opportunities o
   WHERE auth.uid() IS NOT NULL
     AND o.status = 'active'
     AND o.admin_review_status = 'approved'
     AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
     AND (_state IS NULL OR o.hiring_state = _state)
     AND (_driver_type IS NULL OR o.driver_type = _driver_type)
     AND (_route_type IS NULL OR o.route_type = _route_type)
   ORDER BY o.featured DESC NULLS LAST, o.published_at DESC NULLS LAST
$$;
`;

const TRIGGERS_SQL = `
DROP TRIGGER IF EXISTS trg_opportunities_billing_guard ON public.opportunities;
CREATE TRIGGER trg_opportunities_billing_guard
  BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.opportunities_billing_guard();

DROP TRIGGER IF EXISTS trg_opportunities_guard ON public.opportunities;
CREATE TRIGGER trg_opportunities_guard
  BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.opportunities_guard();

DROP TRIGGER IF EXISTS trg_opportunities_updated_at ON public.opportunities;
CREATE TRIGGER trg_opportunities_updated_at
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_notify_opportunity_reviewed ON public.opportunities;
CREATE TRIGGER trg_notify_opportunity_reviewed
  AFTER UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.notify_opportunity_reviewed();
`;

async function resetFixture(): Promise<void> {
  await pool.query(BASE_SCHEMA_SQL);
  await pool.query(FIXED_GUARD_SQL);
  await pool.query(TRIGGERS_SQL);

  await q(
    `INSERT INTO auth.users (id, email) VALUES
       ($1, 'owner@example.com'),
       ($2, 'driver@example.com')`,
    [OWNER_ID, DRIVER_ID],
  );
  await q(
    `INSERT INTO public.admin_users (id, user_id, email, role)
     VALUES ('aaaaaaaa-0000-4000-8000-000000000001', $1, 'owner@example.com', 'super_admin')`,
    [OWNER_ID],
  );
  await q(
    `INSERT INTO public.recruiter_profiles
       (id, user_id, recruiter_name, recruiter_email, company_name,
        dot_number, mc_number, verification_status, status,
        posting_terms_accepted_at, posting_terms_version,
        legacy_terms_grandfathered_at, created_at, updated_at)
     VALUES
       ($1, $2, 'Berthony (Owner Test)', 'berthonyxyz@gmail.com',
        'HaulTrackerPro Test Carrier LLC', '9999991', 'MC-9999991',
        'approved', 'active', NULL, NULL,
        '2026-07-17T17:55:03.72015Z',
        '2026-07-17T17:55:03.72015Z',
        '2026-07-17T17:55:03.72015Z')`,
    [RECRUITER_ID, OWNER_ID],
  );
  await q(
    `INSERT INTO public.opportunities
       (id, recruiter_id, title, company_name, hiring_state, driver_type,
        route_type, trailer_type, status, admin_review_status, featured,
        view_count, published_at, created_at, updated_at)
     VALUES
       ($1, $2, $3, 'HaulTrackerPro Test Carrier LLC', 'TX', 'company',
        'OTR', 'Dry Van', 'active', 'pending', true, 0, NULL,
        '2026-07-20T22:58:34.175344Z',
        '2026-07-20T22:58:34.175344Z')`,
    [TARGET_ID, RECRUITER_ID, TITLE],
  );
  await q(
    `INSERT INTO supabase_migrations.schema_migrations
       (version, statements, name, created_by, idempotency_key, rollback)
     VALUES
       ('20260721000000', ARRAY['guard'],
        '20260721000000_phase1k_admin_recruiter_opportunity_publication',
        'test', 'phase1k-c-test', NULL)`,
  );
}

async function rawOpportunityMutation(
  sql: string,
  params: unknown[] = [],
): Promise<void> {
  await q('ALTER TABLE public.opportunities DISABLE TRIGGER USER');
  try {
    await q(sql, params);
  } finally {
    await q('ALTER TABLE public.opportunities ENABLE TRIGGER USER');
  }
}

async function targetRow(): Promise<Record<string, unknown>> {
  const [row] = await q(
    `SELECT * FROM public.opportunities WHERE id = $1`,
    [TARGET_ID],
  );
  return row;
}

async function relatedState(): Promise<Record<string, unknown>> {
  const [state] = await q(
    `SELECT
       (SELECT count(*)::int FROM public.opportunity_applications
         WHERE opportunity_id = $1) AS applications,
       (SELECT count(*)::int FROM public.opportunity_offers
         WHERE opportunity_id = $1) AS offers,
       (SELECT count(*)::int FROM public.notifications
         WHERE user_id = $2
           AND type = 'opportunity_reviewed'
           AND payload ->> 'opportunity_id' = $1::text) AS notifications`,
    [TARGET_ID, OWNER_ID],
  );
  return state;
}

async function failureSnapshot(): Promise<Record<string, unknown>> {
  return {
    row: await targetRow(),
    related: await relatedState(),
  };
}

async function expectAtomicFailure(pattern: RegExp): Promise<void> {
  const before = await failureSnapshot();
  await expect(pool.query(REPAIR_SQL)).rejects.toThrow(pattern);
  expect(await failureSnapshot()).toEqual(before);
}

async function visibleAsDriver(): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true)`,
      [DRIVER_ID],
    );
    const result = await client.query(
      `SELECT id FROM public.list_driver_visible_opportunities(NULL, NULL, NULL)`,
    );
    await client.query('ROLLBACK');
    return result.rows.map((r) => String(r.id));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  await resetFixture();
});

afterAll(async () => {
  await pool.end();
});

describe('Phase 1K-D — successful historical repair', () => {
  it('repairs exactly one target and preserves every unauthorized column', async () => {
    const before = await targetRow();
    await pool.query(REPAIR_SQL);
    const after = await targetRow();

    expect(after.status).toBe('active');
    expect(after.admin_review_status).toBe('approved');
    expect(after.published_at).not.toBeNull();
    expect(new Date(String(after.updated_at)).getTime()).toBeGreaterThan(
      new Date(String(before.updated_at)).getTime(),
    );

    const permitted = new Set([
      'admin_review_status',
      'published_at',
      'updated_at',
    ]);
    for (const key of Object.keys(before)) {
      if (!permitted.has(key)) {
        expect(after[key]).toEqual(before[key]);
      }
    }
    expect(after.featured).toBe(true);
    expect(after.view_count).toBe(0);
  });

  it('creates one exact approval notification and no applications or offers', async () => {
    await pool.query(REPAIR_SQL);
    expect(await relatedState()).toEqual({
      applications: 0,
      offers: 0,
      notifications: 1,
    });

    const rows = await q(
      `SELECT user_id, type, title, body, payload
         FROM public.notifications
        WHERE payload ->> 'opportunity_id' = $1`,
      [TARGET_ID],
    );
    expect(rows).toEqual([
      {
        user_id: OWNER_ID,
        type: 'opportunity_reviewed',
        title: 'Opportunity approved',
        body: `Your opportunity "${TITLE}" was approved.`,
        payload: {
          opportunity_id: TARGET_ID,
          admin_review_status: 'approved',
        },
      },
    ]);
  });

  it('makes the repaired opportunity visible through the driver RPC', async () => {
    expect(await visibleAsDriver()).not.toContain(TARGET_ID);
    await pool.query(REPAIR_SQL);
    expect(await visibleAsDriver()).toContain(TARGET_ID);
  });

  it('fails closed on rerun and never creates a second notification', async () => {
    await pool.query(REPAIR_SQL);
    const before = await failureSnapshot();
    await expect(pool.query(REPAIR_SQL)).rejects.toThrow(
      /target opportunity state drifted/,
    );
    expect(await failureSnapshot()).toEqual(before);
    expect((await relatedState()).notifications).toBe(1);
  });
});

describe('Phase 1K-D — prerequisite failures roll back atomically', () => {
  it('fails when the Phase 1K-C ledger record is absent', async () => {
    await q(
      `DELETE FROM supabase_migrations.schema_migrations
        WHERE version = '20260721000000'`,
    );
    await expectAtomicFailure(/requires exactly one Phase 1K-C migration record/);
  });

  it('fails when the guard is not owner-aware and contains the old bypass', async () => {
    await q(`
      CREATE OR REPLACE FUNCTION public.opportunities_guard()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $vulnerable$
      BEGIN
        IF public.is_admin(auth.uid()) THEN
          RETURN NEW;
        END IF;
        RETURN NEW;
      END;
      $vulnerable$;
    `);
    await expectAtomicFailure(/requires the verified Phase 1K-C opportunities_guard/);
  });

  it('fails when the expected recruiter is no longer canonically eligible', async () => {
    await q(
      `UPDATE public.recruiter_profiles
          SET status = 'suspended'
        WHERE id = $1`,
      [RECRUITER_ID],
    );
    await expectAtomicFailure(/expected admin-owned eligible recruiter is not valid/);
  });

  it('fails when the expected owner is no longer an admin', async () => {
    await q(`DELETE FROM public.admin_users WHERE user_id = $1`, [OWNER_ID]);
    await expectAtomicFailure(/expected admin-owned eligible recruiter is not valid/);
  });

  it('fails when more than one qualifying affected row exists', async () => {
    await rawOpportunityMutation(
      `INSERT INTO public.opportunities
         (id, recruiter_id, title, company_name, hiring_state, driver_type,
          route_type, trailer_type, status, admin_review_status, featured,
          view_count, published_at, created_at, updated_at)
       VALUES
         ('99999999-9999-4999-8999-999999999999', $1, 'Second affected row',
          'HaulTrackerPro Test Carrier LLC', 'TX', 'company', 'OTR', 'Dry Van',
          'active', 'pending', false, 0, NULL, now(), now())`,
      [RECRUITER_ID],
    );
    await expectAtomicFailure(/requires exactly one affected opportunity/);
  });
});

describe('Phase 1K-D — target drift failures roll back atomically', () => {
  const cases: Array<[string, string, unknown[], RegExp]> = [
    ['status', `UPDATE public.opportunities SET status='paused' WHERE id=$1`, [TARGET_ID], /state drifted/],
    ['review status', `UPDATE public.opportunities SET admin_review_status='approved' WHERE id=$1`, [TARGET_ID], /state drifted/],
    ['published timestamp', `UPDATE public.opportunities SET published_at=now() WHERE id=$1`, [TARGET_ID], /state drifted/],
    ['title', `UPDATE public.opportunities SET title='Drifted title' WHERE id=$1`, [TARGET_ID], /state drifted/],
    ['featured', `UPDATE public.opportunities SET featured=false WHERE id=$1`, [TARGET_ID], /state drifted/],
    ['view count', `UPDATE public.opportunities SET view_count=1 WHERE id=$1`, [TARGET_ID], /state drifted/],
  ];

  it.each(cases)('fails when target %s drifted', async (_name, sql, params, pattern) => {
    await rawOpportunityMutation(sql, params);
    await expectAtomicFailure(pattern);
  });

  it('fails when the target recruiter ID drifted', async () => {
    const otherRecruiter = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const otherOwner = '44444444-4444-4444-8444-444444444444';
    await q(`INSERT INTO auth.users (id, email) VALUES ($1, 'other@example.com')`, [otherOwner]);
    await q(
      `INSERT INTO public.recruiter_profiles
         (id, user_id, recruiter_name, recruiter_email, company_name,
          dot_number, verification_status, status, legacy_terms_grandfathered_at)
       VALUES ($1, $2, 'Other Recruiter', 'other@example.com', 'Other LLC',
               '1000000', 'approved', 'active', now())`,
      [otherRecruiter, otherOwner],
    );
    await rawOpportunityMutation(
      `UPDATE public.opportunities SET recruiter_id=$2 WHERE id=$1`,
      [TARGET_ID, otherRecruiter],
    );
    await expectAtomicFailure(/state drifted/);
  });
});

describe('Phase 1K-D — related inventory drift failures roll back atomically', () => {
  it('fails when an application exists', async () => {
    await q(
      `INSERT INTO public.opportunity_applications (id, opportunity_id)
       VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', $1)`,
      [TARGET_ID],
    );
    await expectAtomicFailure(/related-row inventory drifted/);
  });

  it('fails when an offer exists', async () => {
    await q(
      `INSERT INTO public.opportunity_offers (id, opportunity_id)
       VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', $1)`,
      [TARGET_ID],
    );
    await expectAtomicFailure(/related-row inventory drifted/);
  });

  it('fails when an earlier review notification exists', async () => {
    await q(
      `INSERT INTO public.notifications
         (id, user_id, type, title, body, payload)
       VALUES
         ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', $1, 'opportunity_reviewed',
          'Earlier', 'Earlier', jsonb_build_object('opportunity_id', $2::text))`,
      [OWNER_ID, TARGET_ID],
    );
    await expectAtomicFailure(/related-row inventory drifted/);
  });

  it('fails when notification preferences exist', async () => {
    await q(
      `INSERT INTO public.notification_preferences
         (user_id, in_app_enabled, recruiter_status_events)
       VALUES ($1, true, true)`,
      [OWNER_ID],
    );
    await expectAtomicFailure(/notification preference precondition drifted/);
  });
});

describe('Phase 1K-D — migration source contract', () => {
  it('is hard-coded to the exact row and contains one narrow update only', () => {
    const normalized = REPAIR_SQL.replace(/\s+/g, ' ').toLowerCase();

    expect(REPAIR_SQL).toContain(TARGET_ID);
    expect(REPAIR_SQL).toContain(RECRUITER_ID);
    expect(REPAIR_SQL).toContain(OWNER_ID);
    expect(REPAIR_SQL).toContain(TITLE);

    expect(
      (normalized.match(/update public\.opportunities/g) ?? []).length,
    ).toBe(1);
    expect(normalized).toContain("set admin_review_status = 'approved'");
    expect(normalized).toContain('published_at = _repair_ts');
    expect(normalized).toContain('transaction_timestamp()');
    expect(normalized).toContain('get diagnostics _row_count = row_count');
    expect(normalized).toContain("set_config('request.jwt.claim.sub'");
  });

  it('does not bypass triggers, change role, or mutate other business tables', () => {
    const normalized = REPAIR_SQL.replace(/\s+/g, ' ').toLowerCase();

    expect(normalized).not.toContain('disable trigger');
    expect(normalized).not.toContain('session_replication_role');
    expect(normalized).not.toContain('set role');
    expect(normalized).not.toMatch(/delete\s+from\s+public\./);
    expect(normalized).not.toMatch(/insert\s+into\s+public\.(opportunities|opportunity_applications|opportunity_offers|notifications)/);
    expect(normalized).not.toContain('published_at = created_at');
  });

  it('contains full-row preservation and fail-closed inventory checks', () => {
    const normalized = REPAIR_SQL.replace(/\s+/g, ' ').toLowerCase();

    expect(normalized).toContain('to_jsonb(_after)');
    expect(normalized).toContain('to_jsonb(_before)');
    expect(normalized).toContain("'admin_review_status', 'published_at', 'updated_at'");
    expect(normalized).toContain('requires exactly one affected opportunity');
    expect(normalized).toContain('affected opportunity inventory did not reach zero');
    expect(normalized).toContain('does not fabricate the original publication time');
  });
});
