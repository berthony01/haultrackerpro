// @vitest-environment node
// Phase 1F-A.1 + 1F-A.2 — Schema-faithful, real-RLS runtime harness.
//
// Applies the production Phase 1F-A.1 migration AND the two Phase 1F-A.2
// migration files (in exact file order) into an in-process PGlite instance
// and drives it under real Postgres roles (anon / authenticated /
// service_role) with per-user JWT claims fed via `request.jwt.claim.sub`.
//
// Phase 1F-A.2 additions this harness proves:
//   * Final privilege matrix, obsolete `recruiter_can_post` dropped.
//   * Two-line PUBLIC/anon correction on `list_driver_visible_opportunities`
//     is genuinely exercised (baseline seeds the pre-1F-A.2 PUBLIC grant).
//   * `driver_can_access_opportunity` gates both direct SELECT and driver
//     application INSERT; marketplace RPC agrees with direct SELECT;
//     saved-opportunity nested visibility flips off with suspension.
//   * Recruiter application listing and update authorization use the
//     canonical current-user helper; cross-recruiter blocked.
//   * `accept_recruiter_posting_terms` — server-stamped, exact version,
//     idempotent repeat, anon/incomplete/suspended denials, no cross-profile
//     effect, legacy grandfathered preserved.
//   * Direct consent forgery (INSERT/UPDATE of `posting_terms_*`,
//     `legacy_terms_grandfathered_at`) blocked outside the sanctioned RPC.
//   * Profile UPDATE denied for status='suspended' AND verification='suspended'.

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { PGlite } from "@electric-sql/pglite";

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

// Both applied Phase 1F-A.2 files by name — asserted immutable by the
// Stage 2A decision. They MUST be applied in this exact order.
const PHASE_1F_A2_FILES = [
  "20260717185620_7efcb752-08f0-46b5-aaad-593e410aa818.sql",
  "20260717185659_ecf497ad-ec79-4178-bfba-b0e9e7e18d4f.sql",
];

function findPhase1FA1Migration(): string {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const base = files.find((f) => {
    const body = fs.readFileSync(path.join(dir, f), "utf8");
    return (
      body.includes("current_user_can_manage_recruiter_opportunities") &&
      body.includes("recruiter_profile_can_manage_opportunities") &&
      // Skip 1F-A.2 files which also reference those names but only replace them.
      !PHASE_1F_A2_FILES.includes(f)
    );
  });
  if (!base) throw new Error("Phase 1F-A.1 migration not found on disk");
  // Concatenate the Phase 1F-A.1 migration with every later migration that
  // amends any of the RPCs / triggers the harness exercises, EXCLUDING the
  // two Phase 1F-A.2 files (appended separately below in exact file order
  // so the two-line correction lands second).
  const idx = files.indexOf(base);
  const relevant =
    /request_driver_contact|recruiter_can_post|list_driver_visible_opportunities|create_driver_referral_safe|recruiter_profile_can_manage_opportunities|current_user_can_manage_recruiter_opportunities|opportunities_guard|opportunities_billing_guard|recruiter_profile_guard/;
  const between = files
    .slice(idx + 1)
    .filter(
      (f) =>
        !PHASE_1F_A2_FILES.includes(f) &&
        relevant.test(fs.readFileSync(path.join(dir, f), "utf8")),
    );
  const parts = [base, ...between].map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
  return parts.join("\n\n");
}

function loadPhase1FA2Migrations(): string {
  const dir = path.join(process.cwd(), "supabase/migrations");
  return PHASE_1F_A2_FILES.map((f) => {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) {
      throw new Error(`Phase 1F-A.2 migration file missing: ${f}`);
    }
    return fs.readFileSync(p, "utf8");
  }).join("\n\n");
}

// Phase 1F-A.2.1A local candidate corrective SQL. Not a migration.
const PHASE_1F_A21_FIXTURE = path.join(
  process.cwd(),
  "src/test/fixtures/phase1fa21ServerTermsRepair.sql",
);
function loadPhase1FA21Fixture(): string {
  if (!fs.existsSync(PHASE_1F_A21_FIXTURE)) {
    throw new Error(`Phase 1F-A.2.1A fixture missing: ${PHASE_1F_A21_FIXTURE}`);
  }
  return fs.readFileSync(PHASE_1F_A21_FIXTURE, "utf8");
}


const RECR_A_USER = "11111111-1111-1111-1111-111111111111";
const RECR_B_USER = "22222222-2222-2222-2222-222222222222";
const INCOMPLETE_USER = "33333333-3333-3333-3333-333333333333";
const SUSPENDED_USER = "44444444-4444-4444-4444-444444444444";
const NO_CONSENT_USER = "55555555-5555-5555-5555-555555555555";
const DRIVER_USER = "66666666-6666-6666-6666-666666666666";
const ADMIN_USER = "77777777-7777-7777-7777-777777777777";

let db: AnyPGlite;
let recrAId: string;
let recrBId: string;
let incompleteRpId: string;
let suspendedRpId: string;
let noConsentRpId: string;

/** Run a block as an authenticated user with a JWT sub claim. */
async function asUser(uid: string, fn: () => Promise<void>) {
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE authenticated;`);
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', true);`);
    await fn();
    await db.exec("COMMIT");
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}

/** Run a block as anon (no JWT). */
async function asAnon(fn: () => Promise<void>) {
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE anon;`);
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', true);`);
    await fn();
    await db.exec("COMMIT");
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;

  // Baseline schema faithful to production, minus columns we don't test.
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    GRANT anon, authenticated, service_role TO CURRENT_USER;

    CREATE SCHEMA IF NOT EXISTS auth;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

    CREATE TABLE public.admin_users (user_id uuid PRIMARY KEY);

    CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = _user_id)
    $$;

    CREATE TABLE public.recruiter_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      recruiter_name text NOT NULL DEFAULT '',
      recruiter_email text,
      recruiter_phone text,
      company_name text NOT NULL DEFAULT '',
      company_website text,
      company_phone text,
      company_address text,
      company_city text,
      company_state text,
      dot_number text,
      mc_number text,
      hiring_states text[] NOT NULL DEFAULT '{}',
      equipment_types text[] NOT NULL DEFAULT '{}',
      driver_types_hired text[] NOT NULL DEFAULT '{}',
      verification_status text NOT NULL DEFAULT 'pending',
      status text NOT NULL DEFAULT 'active',
      admin_notes text,
      verified_at timestamptz,
      verified_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    GRANT SELECT, INSERT, UPDATE ON public.recruiter_profiles TO authenticated;
    -- Baseline mirrors production: service_role has full DML on the table.
    -- The Phase 1F-A.2.1A candidate fixture must NOT broaden this.
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruiter_profiles TO service_role;
    ALTER TABLE public.recruiter_profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rp_admin_all ON public.recruiter_profiles TO authenticated
      USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
    CREATE POLICY rp_owner_select ON public.recruiter_profiles FOR SELECT TO authenticated
      USING (user_id = auth.uid());
    CREATE POLICY rp_owner_insert ON public.recruiter_profiles FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
    CREATE POLICY "Recruiter updates own profile if not suspended" ON public.recruiter_profiles FOR UPDATE TO authenticated
      USING (user_id = auth.uid() AND status <> 'suspended')
      WITH CHECK (user_id = auth.uid());

    -- Pre-1F-A recruiter_can_post so migration can REVOKE from it.
    CREATE OR REPLACE FUNCTION public.recruiter_can_post(_user_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS(SELECT 1 FROM public.recruiter_profiles WHERE user_id = _user_id)
    $$;
    GRANT EXECUTE ON FUNCTION public.recruiter_can_post(uuid) TO anon, authenticated, service_role;

    CREATE TABLE public.opportunities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id),
      title text NOT NULL,
      company_name text,
      hiring_city text,
      hiring_state text,
      driver_type text,
      route_type text,
      trailer_type text,
      deadhead_paid boolean,
      lease_payment numeric,
      insurance_deductions numeric,
      maintenance_deductions numeric,
      other_deductions numeric,
      escrow_amount numeric,
      escrow_required boolean,
      estimated_weekly_gross numeric,
      flat_weekly_pay numeric,
      cpm numeric,
      percentage_pay numeric,
      estimated_weekly_miles numeric,
      estimated_loaded_miles numeric,
      estimated_deadhead_miles numeric,
      status text NOT NULL DEFAULT 'draft',
      admin_review_status text NOT NULL DEFAULT 'pending',
      featured boolean NOT NULL DEFAULT false,
      view_count integer NOT NULL DEFAULT 0,
      published_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;
    ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
    CREATE POLICY opp_admin_all ON public.opportunities TO authenticated
      USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
    -- Named to match production policy that Phase 1F-A.2 DROPs and re-creates
    -- with the canonical driver_can_access_opportunity gate.
    CREATE POLICY "Authenticated view approved active opportunities" ON public.opportunities FOR SELECT TO authenticated
      USING (status = 'active' AND admin_review_status = 'approved');
    CREATE POLICY opp_owner_read ON public.opportunities FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.recruiter_profiles rp
                     WHERE rp.id = recruiter_id AND rp.user_id = auth.uid()));

    -- Pre-1F-A stub trigger fn (migration will replace).
    CREATE OR REPLACE FUNCTION public.opportunities_guard() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN RETURN NEW; END; $$;
    CREATE OR REPLACE FUNCTION public.opportunities_billing_guard() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN RETURN NEW; END; $$;
    CREATE OR REPLACE FUNCTION public.recruiter_profile_guard() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN RETURN NEW; END; $$;

    CREATE TRIGGER trg_opp_guard BEFORE INSERT OR UPDATE ON public.opportunities
      FOR EACH ROW EXECUTE FUNCTION public.opportunities_guard();
    CREATE TRIGGER trg_opp_billing BEFORE INSERT OR UPDATE ON public.opportunities
      FOR EACH ROW EXECUTE FUNCTION public.opportunities_billing_guard();
    CREATE TRIGGER trg_rp_guard BEFORE INSERT OR UPDATE ON public.recruiter_profiles
      FOR EACH ROW EXECUTE FUNCTION public.recruiter_profile_guard();

    -- Legacy driver-visible RPC that migration will replace.
    -- IMPORTANT: baseline grants EXECUTE to PUBLIC so anon inherits access.
    -- Phase 1F-A.2 file 1 only revokes from anon, which is insufficient;
    -- file 2's REVOKE FROM PUBLIC is what actually strips anon. Granting
    -- PUBLIC here genuinely exercises the two-file correction sequence.
    CREATE OR REPLACE FUNCTION public.list_driver_visible_opportunities(
      _state text DEFAULT NULL, _driver_type text DEFAULT NULL, _route_type text DEFAULT NULL
    ) RETURNS SETOF public.opportunities
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT * FROM public.opportunities WHERE false
    $$;
    GRANT EXECUTE ON FUNCTION public.list_driver_visible_opportunities(text,text,text) TO PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_driver_visible_opportunities(text,text,text) TO authenticated;

    CREATE TABLE public.driver_opportunity_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      full_name text,
      city text,
      state text,
      cdl_class text,
      years_experience integer,
      preferred_driver_type text,
      preferred_route_type text,
      endorsements text[],
      trailer_experience text[],
      min_weekly_gross numeric,
      min_weekly_net numeric,
      min_effective_rpm numeric,
      allow_verified_recruiter_contact boolean NOT NULL DEFAULT false,
      contact_preference text
    );
    GRANT SELECT, INSERT, UPDATE ON public.driver_opportunity_profiles TO authenticated;

    CREATE TABLE public.opportunity_applications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      opportunity_id uuid NOT NULL REFERENCES public.opportunities(id),
      recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id),
      driver_user_id uuid NOT NULL,
      driver_profile_id uuid,
      application_type text NOT NULL DEFAULT 'apply',
      status text NOT NULL DEFAULT 'pending',
      message text,
      driver_phone_snapshot text,
      driver_email_snapshot text,
      preferred_contact_method text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    GRANT SELECT, INSERT, UPDATE ON public.opportunity_applications TO authenticated;
    ALTER TABLE public.opportunity_applications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Driver inserts own application" ON public.opportunity_applications FOR INSERT TO authenticated
      WITH CHECK (driver_user_id = auth.uid()
                  AND EXISTS (SELECT 1 FROM public.opportunities o
                              WHERE o.id = opportunity_id AND o.recruiter_id = opportunity_applications.recruiter_id
                                AND o.status = 'active' AND o.admin_review_status = 'approved'));
    CREATE POLICY oa_driver_read ON public.opportunity_applications FOR SELECT TO authenticated
      USING (driver_user_id = auth.uid());
    CREATE POLICY oa_recr_read ON public.opportunity_applications FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.recruiter_profiles rp
                     WHERE rp.id = recruiter_id AND rp.user_id = auth.uid()));

    CREATE TABLE public.driver_referrals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      opportunity_id uuid NOT NULL,
      recruiter_id uuid NOT NULL,
      referring_driver_id uuid NOT NULL,
      referred_driver_name text,
      referred_driver_email text,
      referred_driver_phone text,
      referred_driver_note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (opportunity_id, referred_driver_email)
    );

    CREATE TABLE public.recruiter_contact_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id uuid NOT NULL REFERENCES public.opportunity_applications(id),
      recruiter_user_id uuid NOT NULL,
      driver_user_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      recruiter_note text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    GRANT SELECT, INSERT, UPDATE ON public.recruiter_contact_requests TO authenticated;
    ALTER TABLE public.recruiter_contact_requests ENABLE ROW LEVEL SECURITY;

    -- saved_opportunities — used by 1F-A.2 nested-visibility case to prove
    -- that a driver's previously-saved opp becomes invisible when the
    -- recruiter loses eligibility.
    CREATE TABLE public.saved_opportunities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_user_id uuid NOT NULL,
      opportunity_id uuid NOT NULL REFERENCES public.opportunities(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (driver_user_id, opportunity_id)
    );
    GRANT SELECT, INSERT, DELETE ON public.saved_opportunities TO authenticated;
    ALTER TABLE public.saved_opportunities ENABLE ROW LEVEL SECURITY;
    CREATE POLICY so_owner_all ON public.saved_opportunities TO authenticated
      USING (driver_user_id = auth.uid()) WITH CHECK (driver_user_id = auth.uid());

    -- Legacy stubs migration will replace.
    CREATE OR REPLACE FUNCTION public.create_driver_referral_safe(
      _opportunity_id uuid, _recruiter_id uuid,
      _referred_driver_name text DEFAULT NULL, _referred_driver_email text DEFAULT NULL,
      _referred_driver_phone text DEFAULT NULL, _referred_driver_note text DEFAULT NULL
    ) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
      SELECT gen_random_uuid()
    $$;
    GRANT EXECUTE ON FUNCTION public.create_driver_referral_safe(uuid,uuid,text,text,text,text) TO authenticated;

    CREATE OR REPLACE FUNCTION public.request_driver_contact(
      application_id uuid, recruiter_note text DEFAULT NULL
    ) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
      SELECT gen_random_uuid()
    $$;
    GRANT EXECUTE ON FUNCTION public.request_driver_contact(uuid,text) TO authenticated;

    -- list_recruiter_applications_safe legacy stub (replaced by 1F-A.2).
    CREATE OR REPLACE FUNCTION public.list_recruiter_applications_safe(_recruiter_id uuid)
      RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT NULL::jsonb WHERE false
    $$;
    GRANT EXECUTE ON FUNCTION public.list_recruiter_applications_safe(uuid) TO authenticated;
  `);

  // Apply Phase 1F-A.1 first, then the two Phase 1F-A.2 files in file order.
  await db.exec(findPhase1FA1Migration());
  await db.exec(loadPhase1FA2Migrations());
  // Then the Phase 1F-A.2.1A local candidate corrective fixture (NOT a
  // production migration). Applied after the two immutable 1F-A.2 files
  // so we exercise the exact post-live sequence Stage 1F-A.2.1B will run.
  await db.exec(loadPhase1FA21Fixture());

  // Seed the admin user + recruiter profiles as the outer superuser
  // (bypasses RLS / triggers) so we can control the initial state.
  await db.query(`INSERT INTO public.admin_users(user_id) VALUES ($1)`, [ADMIN_USER]);
  // Pin the outer session JWT sub to the admin user so every raw db.query()
  // done outside asUser() takes the admin branch of triggers (bypass), while
  // asUser()/asAnon() override the claim inside their transactions via SET
  // LOCAL. This gives us superuser-equivalent seed control without disabling
  // triggers and without ever weakening the RLS/trigger enforcement we test.
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${ADMIN_USER}', false);`);


  const a = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles
     (user_id, recruiter_name, company_name, recruiter_email, dot_number,
      status, verification_status, posting_terms_accepted_at, posting_terms_version)
     VALUES ($1,'Alice','Acme','alice@acme.example','1234567','active','pending', now(), '2026-07-17.v1')
     RETURNING id`,
    [RECR_A_USER],
  );
  recrAId = a.rows[0].id;

  const b = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles
     (user_id, recruiter_name, company_name, recruiter_email, mc_number,
      status, verification_status, posting_terms_accepted_at, posting_terms_version)
     VALUES ($1,'Bob','Bco','bob@b.example','MC-98','active','approved', now(), '2026-07-17.v1')
     RETURNING id`,
    [RECR_B_USER],
  );
  recrBId = b.rows[0].id;

  const inc = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles
     (user_id, recruiter_name, company_name, recruiter_email, status, verification_status,
      posting_terms_accepted_at)
     VALUES ($1,'Cara','','carol@c.example','active','pending', now())
     RETURNING id`,
    [INCOMPLETE_USER],
  );
  incompleteRpId = inc.rows[0].id;

  const susp = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles
     (user_id, recruiter_name, company_name, recruiter_email, dot_number,
      status, verification_status, posting_terms_accepted_at)
     VALUES ($1,'Dan','Dco','dan@d.example','7654321','suspended','approved', now())
     RETURNING id`,
    [SUSPENDED_USER],
  );
  suspendedRpId = susp.rows[0].id;

  const nc = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles
     (user_id, recruiter_name, company_name, recruiter_email, dot_number,
      status, verification_status)
     VALUES ($1,'Eve','Eco','eve@e.example','2222222','active','pending')
     RETURNING id`,
    [NO_CONSENT_USER],
  );
  noConsentRpId = nc.rows[0].id;
});

describe("Phase 1F-A.1 — canonical eligibility (SQL helper)", () => {
  const eligible = async (rpId: string) => {
    const r = await db.query<{ b: boolean }>(
      `SELECT public.recruiter_profile_can_manage_opportunities($1) b`, [rpId]);
    return r.rows[0].b;
  };

  it("1. complete pending DOT-only recruiter is eligible", async () => {
    expect(await eligible(recrAId)).toBe(true);
  });
  it("2. MC-only substitutes for DOT", async () => {
    expect(await eligible(recrBId)).toBe(true);
  });
  it("3. incomplete profile (empty company) → ineligible", async () => {
    expect(await eligible(incompleteRpId)).toBe(false);
  });
  it("4. status-suspended → ineligible", async () => {
    expect(await eligible(suspendedRpId)).toBe(false);
  });
  it("5. verification-suspended → ineligible", async () => {
    await db.query(`UPDATE public.recruiter_profiles SET verification_status='suspended' WHERE id=$1`, [recrAId]);
    expect(await eligible(recrAId)).toBe(false);
    await db.query(`UPDATE public.recruiter_profiles SET verification_status='pending' WHERE id=$1`, [recrAId]);
  });
  it("6. no consent, no legacy grandfather → ineligible", async () => {
    expect(await eligible(noConsentRpId)).toBe(false);
  });
  it("7. legacy grandfather substitutes for consent", async () => {
    await db.query(`UPDATE public.recruiter_profiles SET legacy_terms_grandfathered_at=now() WHERE id=$1`, [noConsentRpId]);
    expect(await eligible(noConsentRpId)).toBe(true);
    await db.query(`UPDATE public.recruiter_profiles SET legacy_terms_grandfathered_at=NULL WHERE id=$1`, [noConsentRpId]);
  });
  it("8. missing BOTH DOT and MC → ineligible", async () => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles
        (user_id, recruiter_name, company_name, recruiter_email, status, verification_status, posting_terms_accepted_at)
       VALUES (gen_random_uuid(),'X','Xco','x@x.example','active','pending', now()) RETURNING id`);
    expect(await eligible(r.rows[0].id)).toBe(false);
  });
  it("9. invalid email format → ineligible", async () => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles
        (user_id, recruiter_name, company_name, recruiter_email, dot_number, status, verification_status, posting_terms_accepted_at)
       VALUES (gen_random_uuid(),'Y','Yco','not-an-email','111','active','pending', now()) RETURNING id`);
    expect(await eligible(r.rows[0].id)).toBe(false);
  });
});

describe("Phase 1F-A.1 — RLS on opportunities (authenticated role)", () => {
  it("10. completed pending recruiter can INSERT draft", async () => {
    await asUser(RECR_A_USER, async () => {
      const r = await db.query<{ admin_review_status: string; published_at: string | null }>(
        `INSERT INTO public.opportunities (recruiter_id, title, status)
         VALUES ($1,'Draft A','draft')
         RETURNING admin_review_status, published_at`, [recrAId]);
      expect(r.rows[0].admin_review_status).toBe("approved");
      expect(r.rows[0].published_at).toBeNull();
    });
  });

  it("11. completed pending recruiter can INSERT active → visible", async () => {
    await asUser(RECR_A_USER, async () => {
      const r = await db.query<{ admin_review_status: string; published_at: string | null }>(
        `INSERT INTO public.opportunities (recruiter_id, title, status)
         VALUES ($1,'Active A','active')
         RETURNING admin_review_status, published_at`, [recrAId]);
      expect(r.rows[0].admin_review_status).toBe("approved");
      expect(r.rows[0].published_at).not.toBeNull();
    });
  });

  it("12. completed rejected recruiter (unsuspended) can INSERT active", async () => {
    await db.query(`UPDATE public.recruiter_profiles SET verification_status='rejected' WHERE id=$1`, [recrAId]);
    await asUser(RECR_A_USER, async () => {
      const r = await db.query<{ admin_review_status: string }>(
        `INSERT INTO public.opportunities (recruiter_id, title, status)
         VALUES ($1,'Active rejected A','active') RETURNING admin_review_status`, [recrAId]);
      expect(r.rows[0].admin_review_status).toBe("approved");
    });
    await db.query(`UPDATE public.recruiter_profiles SET verification_status='pending' WHERE id=$1`, [recrAId]);
  });

  it("13. completed approved recruiter can INSERT active", async () => {
    await asUser(RECR_B_USER, async () => {
      const r = await db.query<{ admin_review_status: string }>(
        `INSERT INTO public.opportunities (recruiter_id, title, status)
         VALUES ($1,'Active B','active') RETURNING admin_review_status`, [recrBId]);
      expect(r.rows[0].admin_review_status).toBe("approved");
    });
  });

  it("14. missing profile (no rp) cannot INSERT (RLS + FK)", async () => {
    await expect(asUser(DRIVER_USER, async () => {
      await db.query(`INSERT INTO public.opportunities (recruiter_id, title, status)
                      VALUES ($1,'Ghost','draft')`, ["00000000-0000-0000-0000-0000000000fe"]);
    })).rejects.toThrow();
  });

  it("15. incomplete profile cannot INSERT even a draft", async () => {
    await expect(asUser(INCOMPLETE_USER, async () => {
      await db.query(`INSERT INTO public.opportunities (recruiter_id, title, status)
                      VALUES ($1,'Should fail','draft')`, [incompleteRpId]);
    })).rejects.toThrow();
  });

  it("16. status-suspended cannot INSERT", async () => {
    await expect(asUser(SUSPENDED_USER, async () => {
      await db.query(`INSERT INTO public.opportunities (recruiter_id, title, status)
                      VALUES ($1,'X','active')`, [suspendedRpId]);
    })).rejects.toThrow();
  });

  it("17. verification-suspended cannot INSERT", async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='suspended' WHERE id=$1`, [suspendedRpId]);
    await expect(asUser(SUSPENDED_USER, async () => {
      await db.query(`INSERT INTO public.opportunities (recruiter_id, title, status)
                      VALUES ($1,'X','draft')`, [suspendedRpId]);
    })).rejects.toThrow();
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended', verification_status='approved' WHERE id=$1`, [suspendedRpId]);
  });

  it("18. Recruiter A cannot INSERT under Recruiter B", async () => {
    await expect(asUser(RECR_A_USER, async () => {
      await db.query(`INSERT INTO public.opportunities (recruiter_id, title, status)
                      VALUES ($1,'Cross','active')`, [recrBId]);
    })).rejects.toThrow();
  });

  it("19. recruiter cannot reassign recruiter_id via UPDATE", async () => {
    // seed an opp for A
    const seed = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status)
       VALUES ($1,'Reassign','draft','approved') RETURNING id`, [recrAId]);
    const oppId = seed.rows[0].id;
    await expect(asUser(RECR_A_USER, async () => {
      await db.query(`UPDATE public.opportunities SET recruiter_id=$1 WHERE id=$2`, [recrBId, oppId]);
    })).rejects.toThrow();
  });

  it("20. client-set featured=true on INSERT is overwritten to false", async () => {
    await asUser(RECR_A_USER, async () => {
      const r = await db.query<{ featured: boolean }>(
        `INSERT INTO public.opportunities (recruiter_id, title, status, featured)
         VALUES ($1,'Sneaky','draft',true) RETURNING featured`, [recrAId]);
      expect(r.rows[0].featured).toBe(false);
    });
  });

  it("21. client cannot self-set admin_review_status via UPDATE", async () => {
    const seed = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status)
       VALUES ($1,'Selfmod','draft','pending') RETURNING id`, [recrAId]);
    const oppId = seed.rows[0].id;
    await asUser(RECR_A_USER, async () => {
      await db.query(`UPDATE public.opportunities SET admin_review_status='approved', title='edited' WHERE id=$1`, [oppId]);
    });
    const after = await db.query<{ admin_review_status: string }>(
      `SELECT admin_review_status FROM public.opportunities WHERE id=$1`, [oppId]);
    expect(after.rows[0].admin_review_status).toBe("pending");
  });

  it("22. eligible owner can pause and reactivate own opportunity", async () => {
    const seed = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'Toggle','active','approved', now()) RETURNING id`, [recrAId]);
    const oppId = seed.rows[0].id;
    await asUser(RECR_A_USER, async () => {
      await db.query(`UPDATE public.opportunities SET status='paused' WHERE id=$1`, [oppId]);
      await db.query(`UPDATE public.opportunities SET status='active' WHERE id=$1`, [oppId]);
    });
  });

  it("23. admin can flag/reject a recruiter's opportunity", async () => {
    const seed = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status)
       VALUES ($1,'Modme','active','approved') RETURNING id`, [recrAId]);
    const oppId = seed.rows[0].id;
    await asUser(ADMIN_USER, async () => {
      await db.query(`UPDATE public.opportunities SET admin_review_status='rejected' WHERE id=$1`, [oppId]);
    });
    const after = await db.query<{ admin_review_status: string }>(
      `SELECT admin_review_status FROM public.opportunities WHERE id=$1`, [oppId]);
    expect(after.rows[0].admin_review_status).toBe("rejected");
  });
});

describe("Phase 1F-A.1 — driver visibility RPC", () => {
  let visibleTitles: string[];

  it("24-27. active opps from pending/rejected/approved eligible recruiters visible; suspended/incomplete hidden", async () => {
    // Reset opportunity table then seed a matrix.
    await db.exec(`DELETE FROM public.opportunities;`);
    // Prep: unsuspend suspended recruiter briefly to seed an opp then re-suspend.
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [suspendedRpId]);
    await db.query(`INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
                    VALUES ($1,'Susp-was-eligible','active','approved', now())`, [suspendedRpId]);
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1`, [suspendedRpId]);

    await db.query(`INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
                    VALUES ($1,'Pending-eligible','active','approved', now())`, [recrAId]);
    await db.query(`UPDATE public.recruiter_profiles SET verification_status='rejected' WHERE id=$1`, [recrAId]);
    await db.query(`INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
                    VALUES ($1,'Rejected-eligible','active','approved', now())`, [recrAId]);
    await db.query(`UPDATE public.recruiter_profiles SET verification_status='pending' WHERE id=$1`, [recrAId]);
    await db.query(`INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
                    VALUES ($1,'Approved-eligible','active','approved', now())`, [recrBId]);
    // Incomplete recruiter opp seeded directly (bypasses trigger via superuser).
    await db.query(`INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
                    VALUES ($1,'Incomplete-hidden','active','approved', now())`, [incompleteRpId]);
    // Admin-rejected opp
    await db.query(`INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status)
                    VALUES ($1,'Admin-rejected','active','rejected')`, [recrAId]);

    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ title: string }>(`SELECT title FROM public.list_driver_visible_opportunities(NULL,NULL,NULL)`);
      visibleTitles = r.rows.map((x) => x.title);
    });
    expect(visibleTitles).toContain("Pending-eligible");
    expect(visibleTitles).toContain("Rejected-eligible");
    expect(visibleTitles).toContain("Approved-eligible");
    expect(visibleTitles).not.toContain("Susp-was-eligible");
    expect(visibleTitles).not.toContain("Incomplete-hidden");
    expect(visibleTitles).not.toContain("Admin-rejected");
  });

  it("28. filter by hiring_state narrows results", async () => {
    await db.query(`UPDATE public.opportunities SET hiring_state='TX' WHERE title='Pending-eligible'`);
    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ title: string }>(`SELECT title FROM public.list_driver_visible_opportunities('TX',NULL,NULL)`);
      expect(r.rows.map((x) => x.title)).toEqual(["Pending-eligible"]);
    });
  });
});

describe("Phase 1F-A.1/A.2 — function privileges", () => {
  it("29. recruiter_can_post has been dropped by 1F-A.2", async () => {
    const r = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM pg_proc
       WHERE pronamespace='public'::regnamespace AND proname='recruiter_can_post'`);
    expect(r.rows[0].n).toBe(0);
  });
  it("30. calling recruiter_can_post from any role errors (function absent)", async () => {
    await expect(
      db.query(`SELECT public.recruiter_can_post('00000000-0000-0000-0000-000000000000'::uuid)`),
    ).rejects.toThrow();
  });
  it("31. anon cannot execute recruiter_profile_can_manage_opportunities", async () => {
    const r = await db.query<{ b: boolean }>(
      `SELECT has_function_privilege('anon','public.recruiter_profile_can_manage_opportunities(uuid)','EXECUTE') b`);
    expect(r.rows[0].b).toBe(false);
  });
  it("32. anon cannot execute current_user_can_manage_recruiter_opportunities", async () => {
    const r = await db.query<{ b: boolean }>(
      `SELECT has_function_privilege('anon','public.current_user_can_manage_recruiter_opportunities(uuid)','EXECUTE') b`);
    expect(r.rows[0].b).toBe(false);
  });
  it("33. authenticated CAN execute current-user helper; profile-scoped helper is service_role-only", async () => {
    const a = await db.query<{ b: boolean }>(
      `SELECT has_function_privilege('authenticated','public.recruiter_profile_can_manage_opportunities(uuid)','EXECUTE') b`);
    const c = await db.query<{ b: boolean }>(
      `SELECT has_function_privilege('authenticated','public.current_user_can_manage_recruiter_opportunities(uuid)','EXECUTE') b`);
    const s = await db.query<{ b: boolean }>(
      `SELECT has_function_privilege('service_role','public.recruiter_profile_can_manage_opportunities(uuid)','EXECUTE') b`);
    expect(a.rows[0].b).toBe(false);
    expect(c.rows[0].b).toBe(true);
    expect(s.rows[0].b).toBe(true);
  });
  it("34. all changed SECURITY DEFINER functions have pinned search_path", async () => {
    const r = await db.query<{ proname: string; cfg: string[] | null }>(
      `SELECT proname, proconfig cfg FROM pg_proc
       WHERE pronamespace='public'::regnamespace
         AND proname IN ('recruiter_profile_can_manage_opportunities',
                         'current_user_can_manage_recruiter_opportunities',
                         'driver_can_access_opportunity',
                         'accept_recruiter_posting_terms',
                         'opportunities_guard','opportunities_billing_guard',
                         'list_driver_visible_opportunities','create_driver_referral_safe',
                         'request_driver_contact','recruiter_profile_guard',
                         'list_recruiter_applications_safe')`);
    for (const row of r.rows) {
      expect(row.cfg?.some((c) => c.startsWith("search_path=")), `${row.proname} missing search_path`).toBe(true);
    }
  });
});

describe("Phase 1F-A.1 — recruiter_profile_guard consent monotonicity", () => {
  it("35. non-admin cannot clear posting_terms_accepted_at via UPDATE (column-privilege denial or unchanged)", async () => {
    let threw = false;
    try {
      await asUser(RECR_A_USER, async () => {
        await db.query(`UPDATE public.recruiter_profiles SET posting_terms_accepted_at=NULL WHERE id=$1`, [recrAId]);
      });
    } catch { threw = true; }
    const r = await db.query<{ ts: string | null }>(
      `SELECT posting_terms_accepted_at ts FROM public.recruiter_profiles WHERE id=$1`, [recrAId]);
    expect(r.rows[0].ts).not.toBeNull();
    // Diagnostic — should throw under column-privilege enforcement.
    void threw;
  });

  it("36. non-admin cannot self-grandfather legacy_terms_grandfathered_at (column-privilege denial or unchanged)", async () => {
    let threw = false;
    try {
      await asUser(NO_CONSENT_USER, async () => {
        await db.query(`UPDATE public.recruiter_profiles SET legacy_terms_grandfathered_at=now() WHERE id=$1`, [noConsentRpId]);
      });
    } catch { threw = true; }
    const r = await db.query<{ ts: string | null }>(
      `SELECT legacy_terms_grandfathered_at ts FROM public.recruiter_profiles WHERE id=$1`, [noConsentRpId]);
    expect(r.rows[0].ts).toBeNull();
    void threw;
  });
});

describe("Phase 1F-A.1 — standard application/referral/contact pipeline", () => {
  let oppId: string;
  let appId: string;

  it("37. driver can insert application against unverified eligible recruiter's active opp", async () => {
    // Seed active/approved opp for pending Recruiter A.
    const seed = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'App-target','active','approved', now()) RETURNING id`, [recrAId]);
    oppId = seed.rows[0].id;

    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ id: string }>(
        `INSERT INTO public.opportunity_applications (opportunity_id, recruiter_id, driver_user_id)
         VALUES ($1,$2,$3) RETURNING id`, [oppId, recrAId, DRIVER_USER]);
      appId = r.rows[0].id;
    });
    expect(appId).toBeTruthy();
  });

  it("38. unverified eligible recruiter can list own applications", async () => {
    await asUser(RECR_A_USER, async () => {
      const r = await db.query<{ id: string }>(
        `SELECT id FROM public.opportunity_applications WHERE recruiter_id=$1`, [recrAId]);
      expect(r.rows.some((x) => x.id === appId)).toBe(true);
    });
  });

  it("39. recruiter B cannot read Recruiter A's applications (cross-recruiter isolation)", async () => {
    await asUser(RECR_B_USER, async () => {
      const r = await db.query<{ id: string }>(
        `SELECT id FROM public.opportunity_applications WHERE recruiter_id=$1`, [recrAId]);
      expect(r.rows.length).toBe(0);
    });
  });

  it("40. request_driver_contact succeeds for unverified eligible recruiter (no auto-expose)", async () => {
    await asUser(RECR_A_USER, async () => {
      const r = await db.query<{ id: string }>(
        `SELECT public.request_driver_contact($1,'hi') id`, [appId]);
      expect(r.rows[0].id).toBeTruthy();
    });
    // Contact request lands in pending state — driver must still approve.
    const r = await db.query<{ status: string }>(
      `SELECT status FROM public.recruiter_contact_requests WHERE application_id=$1`, [appId]);
    expect(r.rows[0].status).toBe("pending");
  });
});

// ============================================================================
// Phase 1F-A.2 — Recruiter Authorization Closure
// ============================================================================

describe("Phase 1F-A.2 — final privilege matrix", () => {
  it("41. driver_can_access_opportunity: anon NO, authenticated YES, service_role YES", async () => {
    const rows = await db.query<{ role: string; b: boolean }>(
      `SELECT rolname role,
              has_function_privilege(rolname,'public.driver_can_access_opportunity(uuid,uuid)','EXECUTE') b
         FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
         ORDER BY rolname`);
    const map = Object.fromEntries(rows.rows.map((r) => [r.role, r.b]));
    expect(map).toEqual({ anon: false, authenticated: true, service_role: true });
  });
  it("42. accept_recruiter_posting_terms: anon NO, authenticated YES, service_role YES", async () => {
    const rows = await db.query<{ role: string; b: boolean }>(
      `SELECT rolname role,
              has_function_privilege(rolname,'public.accept_recruiter_posting_terms(text)','EXECUTE') b
         FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
         ORDER BY rolname`);
    const map = Object.fromEntries(rows.rows.map((r) => [r.role, r.b]));
    expect(map).toEqual({ anon: false, authenticated: true, service_role: true });
  });
  it("43. list_driver_visible_opportunities: anon NO (two-line PUBLIC correction lands)", async () => {
    const r = await db.query<{ b: boolean }>(
      `SELECT has_function_privilege('anon','public.list_driver_visible_opportunities(text,text,text)','EXECUTE') b`);
    expect(r.rows[0].b).toBe(false);
    const a = await db.query<{ b: boolean }>(
      `SELECT has_function_privilege('authenticated','public.list_driver_visible_opportunities(text,text,text)','EXECUTE') b`);
    expect(a.rows[0].b).toBe(true);
  });
});

describe("Phase 1F-A.2 — driver_can_access_opportunity gate", () => {
  let eligibleOppId: string;
  beforeAll(async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [recrAId]);
    const r = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'AccessGate','active','approved', now()) RETURNING id`, [recrAId]);
    eligibleOppId = r.rows[0].id;
  });

  it("44. returns true for eligible recruiter + active + approved (authenticated caller)", async () => {
    let ok = false;
    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ b: boolean }>(
        `SELECT public.driver_can_access_opportunity($1,$2) b`, [eligibleOppId, recrAId]);
      ok = r.rows[0].b;
    });
    expect(ok).toBe(true);
  });
  it("45. returns false when recruiter is suspended", async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1`, [recrAId]);
    let ok = true;
    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ b: boolean }>(
        `SELECT public.driver_can_access_opportunity($1,$2) b`, [eligibleOppId, recrAId]);
      ok = r.rows[0].b;
    });
    expect(ok).toBe(false);
    await db.query(`UPDATE public.recruiter_profiles SET status='active' WHERE id=$1`, [recrAId]);
  });
  it("46. returns false when opportunity paused", async () => {
    await db.query(`UPDATE public.opportunities SET status='paused' WHERE id=$1`, [eligibleOppId]);
    let ok = true;
    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ b: boolean }>(
        `SELECT public.driver_can_access_opportunity($1,$2) b`, [eligibleOppId, recrAId]);
      ok = r.rows[0].b;
    });
    expect(ok).toBe(false);
    await db.query(`UPDATE public.opportunities SET status='active' WHERE id=$1`, [eligibleOppId]);
  });
  it("47. returns false when auth.uid() is NULL (no session)", async () => {
    // Call raw as superuser but with cleared jwt sub.
    await db.exec("BEGIN");
    try {
      await db.exec(`SELECT set_config('request.jwt.claim.sub','',true);`);
      const r = await db.query<{ b: boolean }>(
        `SELECT public.driver_can_access_opportunity($1,$2) b`, [eligibleOppId, recrAId]);
      expect(r.rows[0].b).toBe(false);
    } finally {
      await db.exec("ROLLBACK");
    }
  });
});

describe("Phase 1F-A.2 — direct SELECT + marketplace RPC agreement", () => {
  let eligOpp: string;
  let ineligOpp: string;
  beforeAll(async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [recrAId]);
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='approved' WHERE id=$1`, [suspendedRpId]);
    const e = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'DS-Eligible','active','approved', now()) RETURNING id`, [recrAId]);
    eligOpp = e.rows[0].id;
    const i = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'DS-WillSuspend','active','approved', now()) RETURNING id`, [suspendedRpId]);
    ineligOpp = i.rows[0].id;
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1`, [suspendedRpId]);
  });

  it("48. direct SELECT: eligible opp visible to driver", async () => {
    let count = 0;
    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ id: string }>(`SELECT id FROM public.opportunities WHERE id=$1`, [eligOpp]);
      count = r.rows.length;
    });
    expect(count).toBe(1);
  });
  it("49. direct SELECT: ineligible (suspended recruiter) opp hidden", async () => {
    let count = 999;
    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ id: string }>(`SELECT id FROM public.opportunities WHERE id=$1`, [ineligOpp]);
      count = r.rows.length;
    });
    expect(count).toBe(0);
  });
  it("50. marketplace RPC agrees with direct SELECT (eligible visible, ineligible hidden)", async () => {
    let ids: string[] = [];
    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ id: string }>(
        `SELECT id FROM public.list_driver_visible_opportunities(NULL,NULL,NULL)`);
      ids = r.rows.map((x) => x.id);
    });
    expect(ids).toContain(eligOpp);
    expect(ids).not.toContain(ineligOpp);
  });
  it("51. saved_opportunities nested visibility: saved opp becomes hidden after suspension", async () => {
    // Driver saves the eligible opp.
    await asUser(DRIVER_USER, async () => {
      await db.query(
        `INSERT INTO public.saved_opportunities (driver_user_id, opportunity_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [DRIVER_USER, eligOpp],
      );
    });
    let joined: number = -1;
    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ n: number }>(
        `SELECT count(*)::int n FROM public.saved_opportunities so
           JOIN public.opportunities o ON o.id = so.opportunity_id
          WHERE so.driver_user_id = auth.uid() AND o.id = $1`, [eligOpp]);
      joined = r.rows[0].n;
    });
    expect(joined).toBe(1);
    // Suspend the recruiter and verify the nested JOIN drops to zero.
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1`, [recrAId]);
    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ n: number }>(
        `SELECT count(*)::int n FROM public.saved_opportunities so
           JOIN public.opportunities o ON o.id = so.opportunity_id
          WHERE so.driver_user_id = auth.uid() AND o.id = $1`, [eligOpp]);
      joined = r.rows[0].n;
    });
    expect(joined).toBe(0);
    await db.query(`UPDATE public.recruiter_profiles SET status='active' WHERE id=$1`, [recrAId]);
  });
});

describe("Phase 1F-A.2 — driver application INSERT / recruiter pipeline auth", () => {
  let eligOpp: string;
  let ineligOpp: string;
  let appOnEligible: string;
  beforeAll(async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [recrAId]);
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='approved' WHERE id=$1`, [suspendedRpId]);
    const e = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'App-Eligible','active','approved', now()) RETURNING id`, [recrAId]);
    eligOpp = e.rows[0].id;
    const i = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'App-Suspended','active','approved', now()) RETURNING id`, [suspendedRpId]);
    ineligOpp = i.rows[0].id;
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1`, [suspendedRpId]);
  });

  it("52. driver INSERT allowed against eligible recruiter opp (known id)", async () => {
    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ id: string }>(
        `INSERT INTO public.opportunity_applications (opportunity_id, recruiter_id, driver_user_id)
         VALUES ($1,$2,$3) RETURNING id`, [eligOpp, recrAId, DRIVER_USER]);
      appOnEligible = r.rows[0].id;
    });
    expect(appOnEligible).toBeTruthy();
  });
  it("53. driver INSERT denied against suspended recruiter opp (known id)", async () => {
    await expect(asUser(DRIVER_USER, async () => {
      await db.query(
        `INSERT INTO public.opportunity_applications (opportunity_id, recruiter_id, driver_user_id)
         VALUES ($1,$2,$3)`, [ineligOpp, suspendedRpId, DRIVER_USER]);
    })).rejects.toThrow();
  });
  it("54. driver INSERT denied when opp admin_review_status='rejected'", async () => {
    const rej = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status)
       VALUES ($1,'App-Rejected','active','rejected') RETURNING id`, [recrAId]);
    await expect(asUser(DRIVER_USER, async () => {
      await db.query(
        `INSERT INTO public.opportunity_applications (opportunity_id, recruiter_id, driver_user_id)
         VALUES ($1,$2,$3)`, [rej.rows[0].id, recrAId, DRIVER_USER]);
    })).rejects.toThrow();
  });
  it("55. list_recruiter_applications_safe rejects non-owner", async () => {
    await expect(asUser(RECR_B_USER, async () => {
      await db.query(`SELECT public.list_recruiter_applications_safe($1)`, [recrAId]);
    })).rejects.toThrow();
  });
  it("56. list_recruiter_applications_safe returns rows for eligible owner", async () => {
    let n = -1;
    await asUser(RECR_A_USER, async () => {
      const r = await db.query<{ x: unknown }>(
        `SELECT public.list_recruiter_applications_safe($1) x`, [recrAId]);
      n = r.rows.length;
    });
    expect(n).toBeGreaterThan(0);
  });
  it("57. UPDATE application status denied to non-owner recruiter", async () => {
    await asUser(RECR_B_USER, async () => {
      await db.query(
        `UPDATE public.opportunity_applications SET status='reviewed' WHERE id=$1`,
        [appOnEligible],
      );
    });
    const r = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [appOnEligible]);
    expect(r.rows[0].status).not.toBe("reviewed");
  });
  it("58. UPDATE application status allowed for eligible owner", async () => {
    await asUser(RECR_A_USER, async () => {
      await db.query(
        `UPDATE public.opportunity_applications SET status='reviewed' WHERE id=$1`,
        [appOnEligible],
      );
    });
    const r = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [appOnEligible]);
    expect(r.rows[0].status).toBe("reviewed");
  });
  it("59. contact-request SELECT scoped to owner (rcr_recruiter_select)", async () => {
    await db.query(
      `INSERT INTO public.recruiter_contact_requests (application_id, recruiter_user_id, driver_user_id, status)
       VALUES ($1,$2,$3,'pending')`, [appOnEligible, RECR_A_USER, DRIVER_USER]);
    let ownerN = -1;
    let strangerN = -1;
    await asUser(RECR_A_USER, async () => {
      const r = await db.query(`SELECT id FROM public.recruiter_contact_requests WHERE application_id=$1`, [appOnEligible]);
      ownerN = r.rows.length;
    });
    await asUser(RECR_B_USER, async () => {
      const r = await db.query(`SELECT id FROM public.recruiter_contact_requests WHERE application_id=$1`, [appOnEligible]);
      strangerN = r.rows.length;
    });
    expect(ownerN).toBeGreaterThan(0);
    expect(strangerN).toBe(0);
  });
});

describe("Phase 1F-A.2 — referrals gate on canonical eligibility", () => {
  let refOpp: string;
  beforeAll(async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [recrAId]);
    const r = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'Referral-target','active','approved', now()) RETURNING id`, [recrAId]);
    refOpp = r.rows[0].id;
  });

  it("60. create_driver_referral_safe succeeds while recruiter eligible", async () => {
    let id: string | null = null;
    await asUser(DRIVER_USER, async () => {
      const r = await db.query<{ id: string }>(
        `SELECT public.create_driver_referral_safe($1,$2,'Jane','jane@x.example','555-0100','note') id`,
        [refOpp, recrAId]);
      id = r.rows[0].id;
    });
    expect(id).toBeTruthy();
  });
  it("61. create_driver_referral_safe fails after recruiter suspension", async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1`, [recrAId]);
    await expect(asUser(DRIVER_USER, async () => {
      await db.query(
        `SELECT public.create_driver_referral_safe($1,$2,'Ken','ken@x.example','555-0101','n')`,
        [refOpp, recrAId]);
    })).rejects.toThrow();
    await db.query(`UPDATE public.recruiter_profiles SET status='active' WHERE id=$1`, [recrAId]);
  });
});

describe("Phase 1F-A.2 — recruiter profile UPDATE denial (both suspension states)", () => {
  it("62. UPDATE denied when status='suspended'", async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended', verification_status='approved' WHERE id=$1`, [suspendedRpId]);
    await asUser(SUSPENDED_USER, async () => {
      await db.query(`UPDATE public.recruiter_profiles SET recruiter_name='Should Not' WHERE id=$1`, [suspendedRpId]);
    });
    const r = await db.query<{ recruiter_name: string }>(
      `SELECT recruiter_name FROM public.recruiter_profiles WHERE id=$1`, [suspendedRpId]);
    expect(r.rows[0].recruiter_name).not.toBe("Should Not");
  });
  it("63. UPDATE denied when verification_status='suspended'", async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='suspended' WHERE id=$1`, [suspendedRpId]);
    await asUser(SUSPENDED_USER, async () => {
      await db.query(`UPDATE public.recruiter_profiles SET recruiter_name='Also Not' WHERE id=$1`, [suspendedRpId]);
    });
    const r = await db.query<{ recruiter_name: string }>(
      `SELECT recruiter_name FROM public.recruiter_profiles WHERE id=$1`, [suspendedRpId]);
    expect(r.rows[0].recruiter_name).not.toBe("Also Not");
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended', verification_status='approved' WHERE id=$1`, [suspendedRpId]);
  });
});

describe("Phase 1F-A.2 — direct consent forgery prevention", () => {
  it("64. non-admin INSERT with posting_terms_accepted_at is stripped by guard", async () => {
    const NEW_USER = "88888888-8888-8888-8888-888888888888";
    let stampedId: string | null = null;
    await asUser(NEW_USER, async () => {
      const r = await db.query<{ id: string; ts: string | null; leg: string | null }>(
        `INSERT INTO public.recruiter_profiles
           (user_id, recruiter_name, company_name, recruiter_email, dot_number,
            posting_terms_accepted_at, posting_terms_version, legacy_terms_grandfathered_at)
         VALUES ($1,'Ivy','Ico','ivy@i.example','999888', now(), '2026-07-17.v1', now())
         RETURNING id, posting_terms_accepted_at ts, legacy_terms_grandfathered_at leg`,
        [NEW_USER]);
      stampedId = r.rows[0].id;
      expect(r.rows[0].ts).toBeNull();
      expect(r.rows[0].leg).toBeNull();
    });
    expect(stampedId).toBeTruthy();
  });
  it("65. non-admin UPDATE cannot self-set posting_terms_accepted_at without the RPC (column-privilege denial or unchanged)", async () => {
    let threw = false;
    try {
      await asUser(NO_CONSENT_USER, async () => {
        await db.query(
          `UPDATE public.recruiter_profiles SET posting_terms_accepted_at=now(), posting_terms_version='2026-07-17.v1' WHERE id=$1`,
          [noConsentRpId]);
      });
    } catch { threw = true; }
    const r = await db.query<{ ts: string | null; v: string | null }>(
      `SELECT posting_terms_accepted_at ts, posting_terms_version v FROM public.recruiter_profiles WHERE id=$1`,
      [noConsentRpId]);
    expect(r.rows[0].ts).toBeNull();
    expect(r.rows[0].v).toBeNull();
    void threw;
  });
});

describe("Phase 1F-A.2 — accept_recruiter_posting_terms RPC", () => {
  const CLEAN_USER = "99999999-9999-9999-9999-999999999999";
  const OTHER_USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  let cleanRpId: string;
  let otherRpId: string;

  beforeAll(async () => {
    // Two eligible-but-not-yet-consented profiles.
    const c = await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles
         (user_id, recruiter_name, company_name, recruiter_email, dot_number,
          status, verification_status)
       VALUES ($1,'Cleo','Cco','cleo@c.example','321321','active','pending')
       RETURNING id`, [CLEAN_USER]);
    cleanRpId = c.rows[0].id;
    const o = await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles
         (user_id, recruiter_name, company_name, recruiter_email, dot_number,
          status, verification_status)
       VALUES ($1,'Otto','Oco','otto@o.example','747474','active','pending')
       RETURNING id`, [OTHER_USER]);
    otherRpId = o.rows[0].id;
  });

  it("66. rejects wrong version", async () => {
    await expect(asUser(CLEAN_USER, async () => {
      await db.query(`SELECT public.accept_recruiter_posting_terms('9999-01-01.v9')`);
    })).rejects.toThrow();
  });
  it("67. stamps timestamp visible in DB for correct version", async () => {
    let returned: string | null = null;
    await asUser(CLEAN_USER, async () => {
      const r = await db.query<{ ts: string }>(
        `SELECT public.accept_recruiter_posting_terms('2026-07-17.v1') ts`);
      returned = r.rows[0].ts;
    });
    expect(returned).toBeTruthy();
    const r = await db.query<{ ts: string | null; v: string | null }>(
      `SELECT posting_terms_accepted_at ts, posting_terms_version v
         FROM public.recruiter_profiles WHERE id=$1`, [cleanRpId]);
    expect(r.rows[0].ts).not.toBeNull();
    expect(r.rows[0].v).toBe("2026-07-17.v1");
  });
  it("68. idempotent — repeat returns identical timestamp, no drift", async () => {
    let first: string | null = null;
    let second: string | null = null;
    await asUser(CLEAN_USER, async () => {
      const r1 = await db.query<{ ts: string }>(
        `SELECT public.accept_recruiter_posting_terms('2026-07-17.v1') ts`);
      first = r1.rows[0].ts;
      const r2 = await db.query<{ ts: string }>(
        `SELECT public.accept_recruiter_posting_terms('2026-07-17.v1') ts`);
      second = r2.rows[0].ts;
    });
    // pg driver returns Date objects; compare by ISO value, not identity.
    expect(new Date(first!).toISOString()).toBe(new Date(second!).toISOString());
  });
  it("69. rejects anon caller", async () => {
    await expect(asAnon(async () => {
      await db.query(`SELECT public.accept_recruiter_posting_terms('2026-07-17.v1')`);
    })).rejects.toThrow();
  });
  it("70. rejects incomplete profile", async () => {
    await expect(asUser(INCOMPLETE_USER, async () => {
      await db.query(`SELECT public.accept_recruiter_posting_terms('2026-07-17.v1')`);
    })).rejects.toThrow();
  });
  it("71. rejects suspended profile (both status flavors)", async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended', verification_status='approved' WHERE id=$1`, [suspendedRpId]);
    await expect(asUser(SUSPENDED_USER, async () => {
      await db.query(`SELECT public.accept_recruiter_posting_terms('2026-07-17.v1')`);
    })).rejects.toThrow();
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='suspended' WHERE id=$1`, [suspendedRpId]);
    await expect(asUser(SUSPENDED_USER, async () => {
      await db.query(`SELECT public.accept_recruiter_posting_terms('2026-07-17.v1')`);
    })).rejects.toThrow();
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended', verification_status='approved' WHERE id=$1`, [suspendedRpId]);
  });
  it("72. does not affect other users' profiles (no cross-write)", async () => {
    const before = await db.query<{ ts: string | null }>(
      `SELECT posting_terms_accepted_at ts FROM public.recruiter_profiles WHERE id=$1`, [otherRpId]);
    await asUser(CLEAN_USER, async () => {
      await db.query(`SELECT public.accept_recruiter_posting_terms('2026-07-17.v1')`);
    });
    const after = await db.query<{ ts: string | null }>(
      `SELECT posting_terms_accepted_at ts FROM public.recruiter_profiles WHERE id=$1`, [otherRpId]);
    expect(after.rows[0].ts).toBe(before.rows[0].ts);
  });
  it("73. legacy-grandfathered profile is eligible without RPC call", async () => {
    // Give NO_CONSENT_USER a legacy grandfather (admin-side raw update).
    await db.query(
      `UPDATE public.recruiter_profiles SET legacy_terms_grandfathered_at=now() WHERE id=$1`,
      [noConsentRpId]);
    const r = await db.query<{ b: boolean }>(
      `SELECT public.recruiter_profile_can_manage_opportunities($1) b`, [noConsentRpId]);
    expect(r.rows[0].b).toBe(true);
    await db.query(
      `UPDATE public.recruiter_profiles SET legacy_terms_grandfathered_at=NULL WHERE id=$1`,
      [noConsentRpId]);
  });
  it("74. GUC bypass: authenticated set_config('app.accept_posting_terms',true) + direct UPDATE must NOT persist forged consent", async () => {
    // Baseline: NO_CONSENT_USER owns a complete profile with NULL consent.
    const before = await db.query<{ ts: string | null; v: string | null }>(
      `SELECT posting_terms_accepted_at ts, posting_terms_version v
         FROM public.recruiter_profiles WHERE id=$1`, [noConsentRpId]);
    expect(before.rows[0].ts).toBeNull();

    const FORGED_TS = "2099-01-01T00:00:00Z";
    const ACCEPTED_VERSION = "2026-07-17.v1";

    // Attempt the exploit inside a single authenticated transaction:
    //   1. set the trusted GUC directly (no RPC)
    //   2. UPDATE own row stamping a forged future timestamp + accepted version
    let updateThrew = false;
    try {
      await asUser(NO_CONSENT_USER, async () => {
        await db.query(`SELECT set_config('app.accept_posting_terms','true',true)`);
        await db.query(
          `UPDATE public.recruiter_profiles
             SET posting_terms_accepted_at=$1::timestamptz,
                 posting_terms_version=$2
           WHERE id=$3`,
          [FORGED_TS, ACCEPTED_VERSION, noConsentRpId]);
      });
    } catch {
      updateThrew = true;
    }

    // Secure contract: the forged values must NOT persist, regardless of
    // whether the UPDATE raised or silently no-op'd.
    const after = await db.query<{ ts: string | null; v: string | null }>(
      `SELECT posting_terms_accepted_at ts, posting_terms_version v
         FROM public.recruiter_profiles WHERE id=$1`, [noConsentRpId]);

    // Diagnostic breadcrumb for the report:
    // eslint-disable-next-line no-console
    console.log("[GUC-BYPASS-DIAG]", {
      updateThrew,
      stored_ts: after.rows[0].ts,
      stored_version: after.rows[0].v,
    });

    expect(after.rows[0].ts).toBeNull();
    expect(after.rows[0].v).toBeNull();

    // And the profile must still be ineligible (no legacy grandfather).
    const elig = await db.query<{ b: boolean }>(
      `SELECT public.recruiter_profile_can_manage_opportunities($1) b`,
      [noConsentRpId]);
    expect(elig.rows[0].b).toBe(false);
  });
});

// ============================================================================
// Phase 1F-A.2.1A — Server terms authorization repair (LOCAL FIXTURE)
// ============================================================================
// These cases prove the fixture's column-privilege boundary genuinely
// closes the DEF-GUC-Bypass exploit and does not regress any legitimate
// authenticated / admin / RPC path. They run against the exact sequence
// Stage 1F-A.2.1B will apply live: Phase 1F-A.1 → both 1F-A.2 files
// (immutable) → fixture.

describe("Phase 1F-A.2.1A — column privileges on recruiter_profiles", () => {
  it("75. authenticated has NO table-level UPDATE grant (only column subset)", async () => {
    // Probe a protected column: authenticated must NOT have UPDATE.
    const cP = await db.query<{ b: boolean }>(
      `SELECT has_column_privilege('authenticated','public.recruiter_profiles','posting_terms_accepted_at','UPDATE') b`);
    expect(cP.rows[0].b).toBe(false);
    // Probe an ordinary column: authenticated MUST have UPDATE.
    const cO = await db.query<{ b: boolean }>(
      `SELECT has_column_privilege('authenticated','public.recruiter_profiles','recruiter_name','UPDATE') b`);
    expect(cO.rows[0].b).toBe(true);
  });

  it("76. authenticated CAN update every ordinary/moderation column category", async () => {
    const cols = [
      "recruiter_name","recruiter_email","recruiter_phone",
      "company_name","company_website","dot_number","mc_number",
      "hiring_states","equipment_types","driver_types_hired",
      "verification_status","status","admin_notes","verified_at","verified_by","updated_at",
    ];
    for (const c of cols) {
      const r = await db.query<{ b: boolean }>(
        `SELECT has_column_privilege('authenticated','public.recruiter_profiles',$1,'UPDATE') b`, [c]);
      expect(r.rows[0].b, `authenticated must have UPDATE on ${c}`).toBe(true);
    }
  });

  it("77. authenticated CANNOT update id/user_id/created_at/posting_terms_*/legacy_terms_grandfathered_at", async () => {
    const cols = [
      "id","user_id","created_at",
      "posting_terms_accepted_at","posting_terms_version","legacy_terms_grandfathered_at",
    ];
    for (const c of cols) {
      const r = await db.query<{ b: boolean }>(
        `SELECT has_column_privilege('authenticated','public.recruiter_profiles',$1,'UPDATE') b`, [c]);
      expect(r.rows[0].b, `authenticated MUST NOT have UPDATE on ${c}`).toBe(false);
    }
  });

  it("78. anon has NO UPDATE privilege on any recruiter_profiles column", async () => {
    const cols = [
      "recruiter_name","posting_terms_accepted_at","status","legacy_terms_grandfathered_at",
    ];
    for (const c of cols) {
      const r = await db.query<{ b: boolean }>(
        `SELECT has_column_privilege('anon','public.recruiter_profiles',$1,'UPDATE') b`, [c]);
      expect(r.rows[0].b, `anon MUST NOT have UPDATE on ${c}`).toBe(false);
    }
  });

  it("79. service_role retains full UPDATE on recruiter_profiles", async () => {
    const r = await db.query<{ b: boolean }>(
      `SELECT has_table_privilege('service_role','public.recruiter_profiles','UPDATE') b`);
    expect(r.rows[0].b).toBe(true);
  });

  it("80. ordinary authenticated owner update still succeeds", async () => {
    await asUser(RECR_A_USER, async () => {
      await db.query(`UPDATE public.recruiter_profiles SET recruiter_phone='555-0199' WHERE id=$1`, [recrAId]);
    });
    const r = await db.query<{ p: string | null }>(
      `SELECT recruiter_phone p FROM public.recruiter_profiles WHERE id=$1`, [recrAId]);
    expect(r.rows[0].p).toBe("555-0199");
  });

  it("81. admin can still approve/reject/suspend and non-admin moderation tampering is neutralized", async () => {
    // admin suspends noConsentRpId then unsuspends
    await asUser(ADMIN_USER, async () => {
      await db.query(`UPDATE public.recruiter_profiles SET status='suspended', verification_status='suspended', admin_notes='hold' WHERE id=$1`, [noConsentRpId]);
    });
    let r = await db.query<{ s: string; v: string; n: string | null }>(
      `SELECT status s, verification_status v, admin_notes n FROM public.recruiter_profiles WHERE id=$1`, [noConsentRpId]);
    expect(r.rows[0].s).toBe("suspended");
    expect(r.rows[0].v).toBe("suspended");
    expect(r.rows[0].n).toBe("hold");
    await asUser(ADMIN_USER, async () => {
      await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending', admin_notes=NULL WHERE id=$1`, [noConsentRpId]);
    });
    // Non-admin cannot escalate own verification_status: guard resets it.
    await asUser(NO_CONSENT_USER, async () => {
      await db.query(`UPDATE public.recruiter_profiles SET verification_status='approved' WHERE id=$1`, [noConsentRpId]);
    });
    r = await db.query<{ s: string; v: string; n: string | null }>(
      `SELECT status s, verification_status v, admin_notes n FROM public.recruiter_profiles WHERE id=$1`, [noConsentRpId]);
    expect(r.rows[0].v).not.toBe("approved");
  });
});

describe("Phase 1F-A.2.1A — exploit closure and RPC integrity", () => {
  it("82. direct authenticated UPDATE of protected column throws (no GUC involved)", async () => {
    let threw = false;
    try {
      await asUser(NO_CONSENT_USER, async () => {
        await db.query(
          `UPDATE public.recruiter_profiles SET posting_terms_accepted_at=now() WHERE id=$1`,
          [noConsentRpId]);
      });
    } catch { threw = true; }
    const r = await db.query<{ ts: string | null }>(
      `SELECT posting_terms_accepted_at ts FROM public.recruiter_profiles WHERE id=$1`, [noConsentRpId]);
    expect(r.rows[0].ts).toBeNull();
    expect(threw).toBe(true);
  });

  it("83. GUC bypass under fixture: forged consent + forged version blocked", async () => {
    // NO_CONSENT_USER must still be unsuspended and consent-null at this
    // point; a prior admin-reset in case 81 covers it.
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [noConsentRpId]);
    const FORGED = "2099-01-01T00:00:00Z";
    let threw = false;
    try {
      await asUser(NO_CONSENT_USER, async () => {
        await db.query(`SELECT set_config('app.accept_posting_terms','true',true)`);
        await db.query(
          `UPDATE public.recruiter_profiles
             SET posting_terms_accepted_at=$1::timestamptz,
                 posting_terms_version='2026-07-17.v1'
           WHERE id=$2`, [FORGED, noConsentRpId]);
      });
    } catch { threw = true; }
    const r = await db.query<{ ts: string | null; v: string | null }>(
      `SELECT posting_terms_accepted_at ts, posting_terms_version v FROM public.recruiter_profiles WHERE id=$1`,
      [noConsentRpId]);
    expect(r.rows[0].ts).toBeNull();
    expect(r.rows[0].v).toBeNull();
    expect(threw).toBe(true);
  });

  it("84. final RPC + trigger definitions contain no GUC / set_config / trusted flag", async () => {
    const r = await db.query<{ src: string }>(
      `SELECT pg_get_functiondef(p.oid) src FROM pg_proc p
        WHERE pronamespace='public'::regnamespace
          AND proname IN ('accept_recruiter_posting_terms','recruiter_profile_guard')`);
    for (const row of r.rows) {
      expect(row.src).not.toMatch(/app\.accept_posting_terms/);
      expect(row.src).not.toMatch(/set_config/);
      expect(row.src).not.toMatch(/current_setting/);
    }
  });

  it("85. RPC succeeds for complete eligible owner (fresh user)", async () => {
    const FRESH = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const rp = await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles (user_id, recruiter_name, company_name, recruiter_email, dot_number, status, verification_status)
       VALUES ($1,'Fran','Fco','fran@f.example','444444','active','pending') RETURNING id`, [FRESH]);
    let ts: string | null = null;
    await asUser(FRESH, async () => {
      const r = await db.query<{ t: string }>(
        `SELECT public.accept_recruiter_posting_terms('2026-07-17.v1') t`);
      ts = r.rows[0].t;
    });
    expect(ts).toBeTruthy();
    const chk = await db.query<{ v: string | null }>(
      `SELECT posting_terms_version v FROM public.recruiter_profiles WHERE id=$1`, [rp.rows[0].id]);
    expect(chk.rows[0].v).toBe("2026-07-17.v1");
  });

  it("86. timestamp bounded by DB clock immediately before and after", async () => {
    const FRESH2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    await db.query(
      `INSERT INTO public.recruiter_profiles (user_id, recruiter_name, company_name, recruiter_email, dot_number, status, verification_status)
       VALUES ($1,'Gia','Gco','gia@g.example','555555','active','pending')`, [FRESH2]);
    const b = new Date((await db.query<{ t: string }>(`SELECT clock_timestamp() t`)).rows[0].t);
    let ts: Date | null = null;
    await asUser(FRESH2, async () => {
      const r = await db.query<{ t: string }>(
        `SELECT public.accept_recruiter_posting_terms('2026-07-17.v1') t`);
      ts = new Date(r.rows[0].t);
    });
    const a = new Date((await db.query<{ t: string }>(`SELECT clock_timestamp() t`)).rows[0].t);
    expect(ts).toBeTruthy();
    expect(ts!.getTime()).toBeGreaterThanOrEqual(b.getTime());
    expect(ts!.getTime()).toBeLessThanOrEqual(a.getTime());
  });

  it("87. RPC rejects when caller has no profile", async () => {
    const GHOST = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    await expect(asUser(GHOST, async () => {
      await db.query(`SELECT public.accept_recruiter_posting_terms('2026-07-17.v1')`);
    })).rejects.toThrow();
  });

  it("88. existing accepted rows are not rewritten by the candidate fixture", async () => {
    // Alice/Bob were stamped in beforeAll before the fixture applied.
    // The fixture's REPLACE of RPC/trigger must not have UPDATEd rows.
    const r = await db.query<{ v: string | null; ts: string | null }>(
      `SELECT posting_terms_version v, posting_terms_accepted_at ts
         FROM public.recruiter_profiles WHERE id=$1`, [recrBId]);
    expect(r.rows[0].v).toBe("2026-07-17.v1");
    expect(r.rows[0].ts).not.toBeNull();
  });
});

describe("Phase 1F-A.2.1A — driver visibility completeness", () => {
  let vsuOpp: string;
  let incompleteOpp: string;
  beforeAll(async () => {
    // Verification-suspended recruiter opp
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [suspendedRpId]);
    const s = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'VerifSusp-Hidden','active','approved', now()) RETURNING id`, [suspendedRpId]);
    vsuOpp = s.rows[0].id;
    await db.query(`UPDATE public.recruiter_profiles SET verification_status='suspended' WHERE id=$1`, [suspendedRpId]);
    // Incomplete/no-consent recruiter opp (seed via superuser)
    const i = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'NoConsent-Hidden','active','approved', now()) RETURNING id`, [noConsentRpId]);
    incompleteOpp = i.rows[0].id;
  });

  it("89. direct Driver SELECT hides verification-suspended Recruiter opp", async () => {
    let n = 999;
    await asUser(DRIVER_USER, async () => {
      const r = await db.query(`SELECT id FROM public.opportunities WHERE id=$1`, [vsuOpp]);
      n = r.rows.length;
    });
    expect(n).toBe(0);
  });

  it("90. direct Driver SELECT hides incomplete/no-consent Recruiter opp", async () => {
    let n = 999;
    await asUser(DRIVER_USER, async () => {
      const r = await db.query(`SELECT id FROM public.opportunities WHERE id=$1`, [incompleteOpp]);
      n = r.rows.length;
    });
    expect(n).toBe(0);
  });
});

describe("Phase 1F-A.2.1A — application INSERT denial matrix", () => {
  let pausedOpp: string;
  let draftOpp: string;
  let closedOpp: string;
  let vsuOpp2: string;
  let incompleteOpp2: string;
  beforeAll(async () => {
    // Ensure recrA eligible for eligible-target opps
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [recrAId]);
    const p = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'Paused','paused','approved', now()) RETURNING id`, [recrAId]);
    pausedOpp = p.rows[0].id;
    const d = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status)
       VALUES ($1,'Draft','draft','approved') RETURNING id`, [recrAId]);
    draftOpp = d.rows[0].id;
    const c = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status)
       VALUES ($1,'Closed','closed','approved') RETURNING id`, [recrAId]);
    closedOpp = c.rows[0].id;
    // Verification-suspended recruiter opp
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [suspendedRpId]);
    const v = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'VS-App','active','approved', now()) RETURNING id`, [suspendedRpId]);
    vsuOpp2 = v.rows[0].id;
    await db.query(`UPDATE public.recruiter_profiles SET verification_status='suspended' WHERE id=$1`, [suspendedRpId]);
    // Incomplete recruiter opp
    const inc = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'INC-App','active','approved', now()) RETURNING id`, [noConsentRpId]);
    incompleteOpp2 = inc.rows[0].id;
  });

  it("91. application INSERT denies incomplete/no-consent Recruiter", async () => {
    await expect(asUser(DRIVER_USER, async () => {
      await db.query(`INSERT INTO public.opportunity_applications (opportunity_id, recruiter_id, driver_user_id)
                      VALUES ($1,$2,$3)`, [incompleteOpp2, noConsentRpId, DRIVER_USER]);
    })).rejects.toThrow();
  });

  it("92. application INSERT denies verification-suspended Recruiter", async () => {
    await expect(asUser(DRIVER_USER, async () => {
      await db.query(`INSERT INTO public.opportunity_applications (opportunity_id, recruiter_id, driver_user_id)
                      VALUES ($1,$2,$3)`, [vsuOpp2, suspendedRpId, DRIVER_USER]);
    })).rejects.toThrow();
  });

  it("93. application INSERT denies paused / draft / closed opportunities", async () => {
    for (const oid of [pausedOpp, draftOpp, closedOpp]) {
      await expect(asUser(DRIVER_USER, async () => {
        await db.query(`INSERT INTO public.opportunity_applications (opportunity_id, recruiter_id, driver_user_id)
                        VALUES ($1,$2,$3)`, [oid, recrAId, DRIVER_USER]);
      })).rejects.toThrow();
    }
  });

  it("94. application INSERT denies mismatched recruiter_id", async () => {
    // Seed an eligible opp under recrA, then try to insert with recrB's id.
    const e = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'Mismatch','active','approved', now()) RETURNING id`, [recrAId]);
    await expect(asUser(DRIVER_USER, async () => {
      await db.query(`INSERT INTO public.opportunity_applications (opportunity_id, recruiter_id, driver_user_id)
                      VALUES ($1,$2,$3)`, [e.rows[0].id, recrBId, DRIVER_USER]);
    })).rejects.toThrow();
  });

  it("95. application INSERT denies another Driver's profile_id", async () => {
    // Create driver profile owned by RECR_B_USER
    const dop = await db.query<{ id: string }>(
      `INSERT INTO public.driver_opportunity_profiles (user_id, full_name) VALUES ($1,'Other') RETURNING id`,
      [RECR_B_USER]);
    const e = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'ForeignProfile','active','approved', now()) RETURNING id`, [recrAId]);
    await expect(asUser(DRIVER_USER, async () => {
      await db.query(`INSERT INTO public.opportunity_applications (opportunity_id, recruiter_id, driver_user_id, driver_profile_id)
                      VALUES ($1,$2,$3,$4)`, [e.rows[0].id, recrAId, DRIVER_USER, dop.rows[0].id]);
    })).rejects.toThrow();
  });
});

describe("Phase 1F-A.2.1A — recruiter pipeline denial matrix", () => {
  it("96. list_recruiter_applications_safe denies incomplete owner", async () => {
    await expect(asUser(NO_CONSENT_USER, async () => {
      await db.query(`SELECT public.list_recruiter_applications_safe($1)`, [noConsentRpId]);
    })).rejects.toThrow();
  });

  it("97. list_recruiter_applications_safe denies both suspension states", async () => {
    // status='suspended'
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended', verification_status='approved' WHERE id=$1`, [suspendedRpId]);
    await expect(asUser(SUSPENDED_USER, async () => {
      await db.query(`SELECT public.list_recruiter_applications_safe($1)`, [suspendedRpId]);
    })).rejects.toThrow();
    // verification_status='suspended'
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='suspended' WHERE id=$1`, [suspendedRpId]);
    await expect(asUser(SUSPENDED_USER, async () => {
      await db.query(`SELECT public.list_recruiter_applications_safe($1)`, [suspendedRpId]);
    })).rejects.toThrow();
    // restore
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended', verification_status='approved' WHERE id=$1`, [suspendedRpId]);
  });

  it("98. Recruiter application status UPDATE denied for incomplete owner", async () => {
    // seed app for NO_CONSENT_USER's profile (bypass RLS via superuser)
    // First seed an eligible-looking opp for noConsent recruiter to hang app on
    const o = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'NC-App','active','approved', now()) RETURNING id`, [noConsentRpId]);
    const app = await db.query<{ id: string }>(
      `INSERT INTO public.opportunity_applications (opportunity_id, recruiter_id, driver_user_id)
       VALUES ($1,$2,$3) RETURNING id`, [o.rows[0].id, noConsentRpId, DRIVER_USER]);
    await asUser(NO_CONSENT_USER, async () => {
      await db.query(`UPDATE public.opportunity_applications SET status='reviewed' WHERE id=$1`, [app.rows[0].id]);
    });
    const r = await db.query<{ s: string }>(
      `SELECT status s FROM public.opportunity_applications WHERE id=$1`, [app.rows[0].id]);
    expect(r.rows[0].s).not.toBe("reviewed");
  });

  it("99. contact-request SELECT disappears after Recruiter loses eligibility", async () => {
    // seed app+contact request under recrA
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [recrAId]);
    const o = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'CR-Loss','active','approved', now()) RETURNING id`, [recrAId]);
    const app = await db.query<{ id: string }>(
      `INSERT INTO public.opportunity_applications (opportunity_id, recruiter_id, driver_user_id)
       VALUES ($1,$2,$3) RETURNING id`, [o.rows[0].id, recrAId, DRIVER_USER]);
    await db.query(
      `INSERT INTO public.recruiter_contact_requests (application_id, recruiter_user_id, driver_user_id, status)
       VALUES ($1,$2,$3,'pending')`, [app.rows[0].id, RECR_A_USER, DRIVER_USER]);
    // Owner initially sees it
    let n = 0;
    await asUser(RECR_A_USER, async () => {
      const r = await db.query(`SELECT id FROM public.recruiter_contact_requests WHERE application_id=$1`, [app.rows[0].id]);
      n = r.rows.length;
    });
    expect(n).toBeGreaterThan(0);
    // Suspend recrA → eligibility drops → SELECT returns 0
    await db.query(`UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1`, [recrAId]);
    await asUser(RECR_A_USER, async () => {
      const r = await db.query(`SELECT id FROM public.recruiter_contact_requests WHERE application_id=$1`, [app.rows[0].id]);
      n = r.rows.length;
    });
    expect(n).toBe(0);
    await db.query(`UPDATE public.recruiter_profiles SET status='active' WHERE id=$1`, [recrAId]);
  });

  it("100. Driver phone/email masked until approval + preferences satisfied", async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [recrAId]);
    const dop = await db.query<{ id: string }>(
      `INSERT INTO public.driver_opportunity_profiles (user_id, full_name, allow_verified_recruiter_contact, contact_preference)
       VALUES ($1,'Drv',false,'phone') RETURNING id`, [DRIVER_USER]);
    const o = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'Mask','active','approved', now()) RETURNING id`, [recrAId]);
    const app = await db.query<{ id: string }>(
      `INSERT INTO public.opportunity_applications
         (opportunity_id, recruiter_id, driver_user_id, driver_profile_id, driver_phone_snapshot, driver_email_snapshot)
       VALUES ($1,$2,$3,$4,'555-0000','drv@x.example') RETURNING id`,
      [o.rows[0].id, recrAId, DRIVER_USER, dop.rows[0].id]);
    // No approval yet + prefs not opted-in → both masked
    let phones: (string | null)[] = [];
    let emails: (string | null)[] = [];
    await asUser(RECR_A_USER, async () => {
      const r = await db.query<{ x: { driver_phone_snapshot: string | null; driver_email_snapshot: string | null } }>(
        `SELECT public.list_recruiter_applications_safe($1) x`, [recrAId]);
      for (const row of r.rows) {
        phones.push(row.x?.driver_phone_snapshot ?? null);
        emails.push(row.x?.driver_email_snapshot ?? null);
      }
    });
    // Every row for this recruiter must have both masked (opts not set).
    expect(phones.every((p) => p === null)).toBe(true);
    expect(emails.every((e) => e === null)).toBe(true);
    void app;
  });
});

describe("Phase 1F-A.2.1A — referral eligibility denial matrix", () => {
  it("101. referral denies verification-suspended Recruiter", async () => {
    await db.query(`UPDATE public.recruiter_profiles SET status='active', verification_status='pending' WHERE id=$1`, [suspendedRpId]);
    const o = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'Ref-VS','active','approved', now()) RETURNING id`, [suspendedRpId]);
    await db.query(`UPDATE public.recruiter_profiles SET verification_status='suspended' WHERE id=$1`, [suspendedRpId]);
    await expect(asUser(DRIVER_USER, async () => {
      await db.query(`SELECT public.create_driver_referral_safe($1,$2,'X','ref-vs@x.example',NULL,NULL)`,
        [o.rows[0].id, suspendedRpId]);
    })).rejects.toThrow();
  });

  it("102. referral denies incomplete/no-consent Recruiter", async () => {
    const o = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities (recruiter_id, title, status, admin_review_status, published_at)
       VALUES ($1,'Ref-INC','active','approved', now()) RETURNING id`, [noConsentRpId]);
    await expect(asUser(DRIVER_USER, async () => {
      await db.query(`SELECT public.create_driver_referral_safe($1,$2,'Y','ref-inc@x.example',NULL,NULL)`,
        [o.rows[0].id, noConsentRpId]);
    })).rejects.toThrow();
  });
});

