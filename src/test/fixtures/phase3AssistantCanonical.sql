-- Local-only infrastructure plus minimal faithful projections of referenced tables.
-- Real canonical helper bodies are extracted byte-for-byte from accepted migrations
-- by phase3AssistantHistoryPostgres.test.ts; no authorization stubs.
-- auth.uid is the sole infrastructure adapter: JWT subject GUC, as PostgREST supplies.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
-- Live catalog verified by architect: profiles_user_id_key + auth cascade.
CREATE TABLE public.profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.profiles TO authenticated;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
-- Deliberately NO DELETE policy, matching live catalog. Test fixture provisioning
-- and lifecycle deletion run as local bootstrap owner, not as authorization proof.
-- 20260228060534_e148b76a-288a-4273-a42b-f9d95f9bfb0e.sql
CREATE TABLE public.admin_users(user_id uuid NOT NULL UNIQUE,role text NOT NULL CHECK(role IN('admin','super_admin')));
-- 20260720110000_phase1j_additive_user_capabilities.sql
CREATE TYPE public.user_capability_type AS ENUM('driver','recruiter');
CREATE TYPE public.user_capability_status AS ENUM('setup','active','suspended','revoked');
CREATE TABLE public.user_capabilities(user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,capability public.user_capability_type NOT NULL,status public.user_capability_status NOT NULL,PRIMARY KEY(user_id,capability));
-- subscriptions plan/status are text in current accepted schema.
CREATE TABLE public.subscriptions(user_id uuid NOT NULL UNIQUE,plan_key text NOT NULL,status text NOT NULL);
-- 20260513003741_07f20f7a-242b-44d6-bd4b-4d91849cc847.sql +
-- 20260726013000_phase1p_recruiter_company_type_readiness.sql
CREATE TABLE public.recruiter_profiles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
 recruiter_name text NOT NULL,company_name text NOT NULL,recruiter_email text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','inactive','suspended')),
 verification_status text NOT NULL DEFAULT 'pending' CHECK(verification_status IN('pending','approved','rejected','suspended')),
 company_type text CHECK(company_type IN('carrier','third_party_recruiter','staffing_agency','independent_recruiter')),
 dot_number text,mc_number text,posting_terms_accepted_at timestamptz,legacy_terms_grandfathered_at timestamptz);
-- 20260513052701_cf07b84d-9518-4159-8771-b2b353578e54.sql
CREATE TABLE public.recruiter_billing_profiles(
 recruiter_id uuid NOT NULL UNIQUE REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,user_id uuid NOT NULL,
 plan text NOT NULL CHECK(plan IN('none','starter','growth','fleet')),
 status text NOT NULL CHECK(status IN('inactive','active','past_due','canceled','trialing')));
-- 20260815020500_phase_rc1a_recruiter_workspace_membership_foundation.sql
-- + RC1B permission-object constraint; RC1JB seat accounting.
CREATE TYPE public.recruiter_member_role AS ENUM('recruiter_owner','recruiter_admin','recruiter_staff');
CREATE TYPE public.recruiter_member_status AS ENUM('pending','active','revoked');
CREATE TYPE public.recruiter_workspace_permission AS ENUM('opportunities_view','applications_view','conversations_view');
CREATE TABLE public.recruiter_members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
 member_user_id uuid,role public.recruiter_member_role NOT NULL DEFAULT 'recruiter_staff',
 status public.recruiter_member_status NOT NULL DEFAULT 'pending',invite_token_hash text,invite_expires_at timestamptz,
 permissions jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(permissions)='object'),
 CHECK(status<>'active' OR member_user_id IS NOT NULL),
 CHECK(status<>'pending' OR(member_user_id IS NULL AND invite_token_hash IS NOT NULL AND invite_expires_at IS NOT NULL AND role<>'recruiter_owner')));
CREATE UNIQUE INDEX recruiter_members_active_user_unique ON public.recruiter_members(recruiter_id,member_user_id) WHERE status='active' AND member_user_id IS NOT NULL;
CREATE UNIQUE INDEX recruiter_members_active_owner_unique ON public.recruiter_members(recruiter_id) WHERE status='active' AND role='recruiter_owner';
-- 20260628105109_9110e462-2adb-45e5-a391-02b29d32363f.sql,
-- 20260816220000_phase_am1a_agency_member_identity_seat_delegation_lifecycle_hardening.sql,
-- 20260817033000_phase_am1b_agency_workspace_permission_contract.sql.
CREATE TYPE public.agency_status AS ENUM('active','disabled');
CREATE TYPE public.agency_member_role AS ENUM('agency_owner','agency_admin','agency_member');
CREATE TYPE public.agency_member_status AS ENUM('pending','active','revoked');
CREATE TYPE public.agency_workspace_permission AS ENUM('packages_view','client_requests_view','work_items_view_all');
CREATE TABLE public.agency_profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_user_id uuid NOT NULL UNIQUE,status public.agency_status NOT NULL DEFAULT 'active');
CREATE TABLE public.agency_members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
 member_user_id uuid,role public.agency_member_role NOT NULL DEFAULT 'agency_member',status public.agency_member_status NOT NULL DEFAULT 'pending',
 invite_token_hash text,invite_expires_at timestamptz,workspace_permissions jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(workspace_permissions)='object'),
 CHECK(status<>'active' OR member_user_id IS NOT NULL),
 CHECK(status<>'pending' OR(member_user_id IS NULL AND invite_token_hash IS NOT NULL AND invite_expires_at IS NOT NULL AND role<>'agency_owner')));
CREATE UNIQUE INDEX agency_members_active_user_uq ON public.agency_members(agency_id,member_user_id) WHERE status='active' AND member_user_id IS NOT NULL;
CREATE UNIQUE INDEX agency_members_active_owner_uq ON public.agency_members(agency_id) WHERE status='active' AND role='agency_owner';
-- 20260630001239_aacd1acb-dd6f-4fc5-9645-7f430b807820.sql +
-- 20260630002954_a8c350ea-94e2-4f9b-8107-58a921dbe35b.sql plan tightening.
CREATE TABLE public.agency_entitlements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),agency_id uuid NOT NULL UNIQUE REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
 plan_key text NOT NULL DEFAULT 'agency_starter' CONSTRAINT agency_entitlements_plan_key_check CHECK(plan_key IN('agency_starter','agency_team','agency_growth')),
 status text NOT NULL DEFAULT 'cancelled' CONSTRAINT agency_entitlements_status_check CHECK(status IN('trialing','active','past_due','cancelled','manual_beta')),
 source text NOT NULL DEFAULT 'manual' CONSTRAINT agency_entitlements_source_check CHECK(source IN('manual','stripe','admin_seed')),
 member_limit integer,active_client_limit integer,service_package_limit integer);
-- 20260628114250_fe0250b1-6527-477c-be9a-ac5e21467e0a.sql
CREATE TYPE public.agency_delegation_status AS ENUM('pending_driver_approval','approved','declined','revoked','expired');
CREATE TABLE public.agency_delegation_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
 driver_user_id uuid NOT NULL,member_user_id uuid NOT NULL,status public.agency_delegation_status NOT NULL DEFAULT 'pending_driver_approval',
 requested_permissions jsonb NOT NULL DEFAULT '{}');
-- 20260628033947_fd83ec69-321a-48ec-90f3-712584062414.sql + agency_delegation_id extension.
CREATE TYPE public.assistant_status AS ENUM('pending','active','revoked','expired');
CREATE TABLE public.driver_assistants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),driver_user_id uuid NOT NULL,assistant_user_id uuid,
 status public.assistant_status NOT NULL DEFAULT 'pending',permissions jsonb NOT NULL DEFAULT '{}',
 agency_delegation_id uuid REFERENCES public.agency_delegation_requests(id) ON DELETE SET NULL);
-- Owner QA chain: exact helper bodies loaded; no synthetic authorization flags.
-- 20260821003749_bfa5a325-8fcb-4a8b-b4e5-e6109e459fcb.sql
CREATE TABLE public.owner_qa_sessions(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 domain text NOT NULL CHECK(domain IN('driver','recruiter','agency')),persona text NOT NULL,enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 CHECK((domain='driver' AND persona IN('free','pro_monthly','pro_yearly')) OR(domain='recruiter' AND persona IN('free_verified','starter','growth','fleet')) OR(domain='agency' AND persona IN('assistant_free','agency_starter','agency_team','agency_growth'))),CHECK(expires_at>created_at));
-- 20260821062449_7c014ba4-370b-4eb8-afe0-f71de5785e43.sql
CREATE TABLE public.qa_fixture_roots(root_kind text NOT NULL CHECK(root_kind IN('user','recruiter_profile','agency_profile')),root_id uuid NOT NULL,
 qa_owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,registered_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 active boolean NOT NULL DEFAULT true,revoked_at timestamptz,PRIMARY KEY(root_kind,root_id),
 CHECK((active AND revoked_at IS NULL) OR(NOT active AND revoked_at IS NOT NULL)),CHECK(root_kind<>'user' OR root_id<>qa_owner_user_id));
