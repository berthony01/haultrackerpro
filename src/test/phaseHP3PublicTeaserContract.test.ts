import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase HP-3A — safe public opportunity teaser RPC.
 *
 * Source-contract test over the HP-3A candidate migration. The candidate is
 * NOT applied live; these assertions therefore verify the authored SQL
 * contract (shape, eligibility gates, privilege surface), not runtime
 * behaviour.
 */

const CANDIDATE_PATH = resolve(
  process.cwd(),
  "supabase/migration-candidates/20260916180000_phase_hp3a_public_opportunity_teasers.sql",
);

const sql = readFileSync(CANDIDATE_PATH, "utf8");

/** Executable SQL only: `--` commentary is documentation, not behaviour. */
const executableSql = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const FN = "public.list_public_opportunity_teasers";

/** The return descriptor block, between RETURNS TABLE ( and its closing `)`. */
const returnDescriptor = (() => {
  const start = executableSql.indexOf("RETURNS TABLE (");
  expect(start).toBeGreaterThan(-1);
  const end = executableSql.indexOf("\n)", start);
  expect(end).toBeGreaterThan(start);
  return executableSql.slice(start, end);
})();

const APPROVED_RETURN_FIELDS = [
  "id",
  "title",
  "company_name",
  "hiring_city",
  "hiring_state",
  "hiring_states",
  "driver_type",
  "route_type",
  "trailer_type",
  "employment_model",
  "team_configuration",
  "home_time",
  "pay_model",
  "cpm",
  "percentage_pay",
  "percentage_basis_label",
  "flat_weekly_pay",
  "salary_amount",
  "salary_frequency",
  "other_pay_method_label",
  "estimated_weekly_gross",
  "estimated_weekly_miles",
  "estimated_loaded_miles",
  "estimated_deadhead_miles",
  "deadhead_paid",
  "sign_on_bonus",
  "min_years_experience",
  "required_cdl_class",
  "required_endorsements",
  "typical_lanes",
  "published_at",
  "featured",
  "has_additional_requirements",
] as const;

/** Column names declared in the RETURNS TABLE descriptor, in source order. */
const declaredReturnFields = returnDescriptor
  .split("\n")
  .slice(1)
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .map((line) => line.replace(/,$/, "").split(/\s+/)[0]);

describe("HP-3A — public opportunity teaser function contract", () => {
  it("creates exactly the one audited function", () => {
    const creates = executableSql.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/gi) ?? [];
    expect(creates).toHaveLength(1);
    expect(executableSql).toContain(`FUNCTION ${FN}(`);
  });

  it("declares the exact approved public return descriptor", () => {
    expect(declaredReturnFields).toEqual([...APPROVED_RETURN_FIELDS]);
  });

  it("never exposes recruiter_id or recruiter profile data", () => {
    expect(declaredReturnFields).not.toContain("recruiter_id");
    expect(returnDescriptor).not.toMatch(/recruiter_id/);
    expect(executableSql).not.toMatch(/recruiter_profiles/);
    expect(executableSql).not.toMatch(/\bJOIN\b/i);
  });

  it("never returns the whole opportunity row", () => {
    expect(executableSql).not.toMatch(/SETOF\s+opportunities/i);
    expect(executableSql).not.toMatch(/\bo\.\*/);
    expect(executableSql).not.toMatch(/SELECT\s+\*/i);
  });

  it("omits moderation, audit, and free-text requirement fields", () => {
    for (const forbidden of [
      "o.status",
      "o.admin_review_status",
      "o.view_count",
      "o.transparency_confirmed",
      "o.created_at",
      "o.updated_at",
      "o.description",
      "o.benefits",
      "o.actual_benefits",
      "o.lease_payment",
      "o.insurance_deductions",
    ]) {
      expect(returnDescriptor).not.toContain(forbidden);
    }
    // requirements is reduced to a derived boolean, never returned as text.
    expect(declaredReturnFields).not.toContain("requirements");
    expect(executableSql).toContain(
      "(btrim(coalesce(o.requirements, '')) <> '') AS has_additional_requirements",
    );
  });

  it("enforces all four eligibility gates, reusing existing helpers", () => {
    expect(executableSql).toContain("o.status = 'active'");
    expect(executableSql).toContain("o.admin_review_status = 'approved'");
    expect(executableSql).toContain(
      "public.recruiter_profile_can_manage_opportunities(o.recruiter_id)",
    );
    expect(executableSql).toContain(
      "NOT public.is_qa_fixture_root('recruiter_profile', o.recruiter_id)",
    );
  });

  it("excludes QA fixture rows unconditionally (no owner escape for anon)", () => {
    expect(executableSql).not.toMatch(/is_qa_fixture_root\([^)]*auth\.uid\(\)/);
  });

  it("supports the audited optional filters", () => {
    expect(executableSql).toContain("_opportunity_id IS NULL OR o.id = _opportunity_id");
    expect(executableSql).toContain("o.hiring_state = _state");
    expect(executableSql).toContain("_state = ANY (o.hiring_states)");
    expect(executableSql).toContain("_driver_type IS NULL OR o.driver_type = _driver_type");
    expect(executableSql).toContain("_route_type IS NULL OR o.route_type = _route_type");
  });

  it("orders like the authenticated driver path and clamps the limit", () => {
    expect(executableSql).toContain(
      "ORDER BY o.featured DESC NULLS LAST, o.published_at DESC NULLS LAST",
    );
    expect(executableSql).toContain("_limit integer DEFAULT 24");
    expect(executableSql).toContain("LIMIT least(greatest(coalesce(_limit, 24), 1), 50)");
  });

  it("is a read-only, hardened SECURITY DEFINER function", () => {
    expect(executableSql).toContain("LANGUAGE sql");
    expect(executableSql).toContain("STABLE");
    expect(executableSql).toContain("SECURITY DEFINER");
    expect(executableSql).toContain("SET search_path = public");
    expect(executableSql).not.toMatch(/\bVOLATILE\b/i);
  });

  it("contains no mutation statements", () => {
    for (const mutation of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+\w/i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
      /\bDROP\b/i,
      /\bALTER\s+TABLE\b/i,
      /\bCREATE\s+TABLE\b/i,
      /\bCREATE\s+TRIGGER\b/i,
    ]) {
      expect(executableSql).not.toMatch(mutation);
    }
  });

  it("changes no policy and no base-table privilege", () => {
    expect(executableSql).not.toMatch(/CREATE\s+POLICY/i);
    expect(executableSql).not.toMatch(/ALTER\s+POLICY/i);
    expect(executableSql).not.toMatch(/DROP\s+POLICY/i);
    expect(executableSql).not.toMatch(/ROW\s+LEVEL\s+SECURITY/i);
    // Every GRANT/REVOKE in this migration targets the new function only.
    const privilegeStatements = executableSql.match(/^(GRANT|REVOKE)[^;]+;/gim) ?? [];
    expect(privilegeStatements.length).toBeGreaterThan(0);
    for (const statement of privilegeStatements) {
      expect(statement).toMatch(/ON FUNCTION public\.list_public_opportunity_teasers/);
    }
  });

  it("revokes PUBLIC and grants EXECUTE only to anon and authenticated", () => {
    const signature = "public.list_public_opportunity_teasers(text, text, text, uuid, integer)";
    expect(executableSql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
    expect(executableSql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO anon;`);
    expect(executableSql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`);
    const grantees = (executableSql.match(/GRANT EXECUTE ON FUNCTION[^;]+TO\s+(\w+);/gi) ?? []).map(
      (line) => line.replace(/.*TO\s+/i, "").replace(";", "").trim(),
    );
    expect(new Set(grantees)).toEqual(new Set(["anon", "authenticated"]));
  });

  it("does not modify any existing function", () => {
    for (const existing of [
      "driver_can_access_opportunity",
      "list_driver_visible_opportunities",
    ]) {
      expect(executableSql).not.toContain(existing);
    }
    // The helpers are called, never redefined.
    expect(executableSql).not.toMatch(
      /FUNCTION\s+public\.(recruiter_profile_can_manage_opportunities|is_qa_fixture_root)/,
    );
  });
});
