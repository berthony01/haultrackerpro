-- Phase TG-2E3-O6 — QA fixture root registry (CANDIDATE ONLY).
--
-- Root-only internal QA classification/ownership metadata.
--
-- THIS REGISTRY IS NOT BILLING, SUBSCRIPTION, ENTITLEMENT, OR AUTHORIZATION
-- TRUTH. It carries no plan/tier, Stripe, Telegram, email, or child-record
-- state. Plan truth stays in public.owner_qa_sessions; authorization truth
-- stays in the existing RLS policies and permission resolvers. Nothing in this
-- file may be consulted to grant access, widen limits, or alter entitlements.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.qa_fixture_roots (
  root_kind text NOT NULL,
  root_id uuid NOT NULL,
  qa_owner_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  note text,
  registered_by_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT qa_fixture_roots_pkey PRIMARY KEY (root_kind, root_id),
  CONSTRAINT qa_fixture_roots_root_kind_allowlist
    CHECK (root_kind IN ('user', 'recruiter_profile', 'agency_profile')),
  CONSTRAINT qa_fixture_roots_active_revoked_consistent
    CHECK (
      (active AND revoked_at IS NULL)
      OR (NOT active AND revoked_at IS NOT NULL)
    ),
  CONSTRAINT qa_fixture_roots_note_length
    CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT qa_fixture_roots_user_root_not_qa_owner
    CHECK (root_kind <> 'user' OR root_id <> qa_owner_user_id)
);

COMMENT ON TABLE public.qa_fixture_roots IS
  'Internal QA fixture root registry: classification and ownership metadata for synthetic QA workspaces only. NOT billing, subscription, entitlement, or authorization truth.';
COMMENT ON COLUMN public.qa_fixture_roots.root_kind IS
  'Root classification: user | recruiter_profile | agency_profile. No polymorphic FK is declared on root_id.';
COMMENT ON COLUMN public.qa_fixture_roots.root_id IS
  'Identifier of the synthetic root record of root_kind. Intentionally unconstrained by FK.';
COMMENT ON COLUMN public.qa_fixture_roots.qa_owner_user_id IS
  'Real owner identity that this synthetic QA root belongs to. Confers no privilege.';
COMMENT ON COLUMN public.qa_fixture_roots.active IS
  'True only while the root is a live QA fixture; must be paired with a NULL revoked_at.';
COMMENT ON COLUMN public.qa_fixture_roots.registered_by_user_id IS
  'Audit-only: identity that registered the root. Confers no privilege.';

-- ---------------------------------------------------------------------------
-- Privileges + RLS
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.qa_fixture_roots FROM PUBLIC;
REVOKE ALL ON TABLE public.qa_fixture_roots FROM anon;
REVOKE ALL ON TABLE public.qa_fixture_roots FROM authenticated;

GRANT SELECT ON TABLE public.qa_fixture_roots TO authenticated;
GRANT ALL ON TABLE public.qa_fixture_roots TO service_role;

ALTER TABLE public.qa_fixture_roots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qa_fixture_roots_super_admin_select
  ON public.qa_fixture_roots;

CREATE POLICY qa_fixture_roots_super_admin_select
  ON public.qa_fixture_roots
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Lookup index (partial; does not duplicate the composite primary key)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS qa_fixture_roots_active_owner_lookup_idx
  ON public.qa_fixture_roots (qa_owner_user_id, root_kind, root_id)
  WHERE active;

-- ---------------------------------------------------------------------------
-- Helper (fail-closed classification read only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_qa_fixture_root(
  _root_kind text,
  _root_id uuid,
  _qa_owner_user_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.qa_fixture_roots r
    WHERE r.active
      AND r.root_kind = _root_kind
      AND r.root_id = _root_id
      AND (_qa_owner_user_id IS NULL OR r.qa_owner_user_id = _qa_owner_user_id)
  )
$$;

COMMENT ON FUNCTION public.is_qa_fixture_root(text, uuid, uuid) IS
  'Fail-closed read of the QA fixture root registry. Returns true only for an active, exactly matching root (and matching qa_owner_user_id when supplied). Classification only: NOT billing, subscription, entitlement, or authorization truth.';

REVOKE ALL ON FUNCTION public.is_qa_fixture_root(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_qa_fixture_root(text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_qa_fixture_root(text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_qa_fixture_root(text, uuid, uuid) TO service_role;
