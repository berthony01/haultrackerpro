/**
 * Phase RC-1B — pure client mirror of the recruiter staff permission vocabulary.
 *
 * This module is intentionally pure: no React, no Supabase, no side effects.
 * It mirrors the database enum `public.recruiter_workspace_permission` exactly
 * (same keys, same order). It grants nothing on its own — the database
 * resolver is the only authority.
 */

export const RECRUITER_STAFF_PERMISSION_KEYS = [
  "opportunities_view",
  "opportunities_create",
  "opportunities_edit",
  "opportunities_change_status",
  "opportunities_delete",
  "applications_view",
  "applications_manage_status",
  "applications_request_contact",
  "applications_manage_notes",
  "contracts_view",
  "contracts_manage",
  "referrals_view",
  "referrals_manage_status",
  "referral_terms_manage",
  "reports_view",
  "reports_export",
  "settlements_view",
  "settlements_prepare",
  "settlements_finalize",
  "team_view",
  "team_manage",
] as const;

export type RecruiterStaffPermissionKey = (typeof RECRUITER_STAFF_PERMISSION_KEYS)[number];

export type RecruiterStaffPermissions = Partial<Record<RecruiterStaffPermissionKey, boolean>>;

export const RECRUITER_STAFF_PERMISSION_LABELS: Record<RecruiterStaffPermissionKey, string> = {
  opportunities_view: "View opportunities",
  opportunities_create: "Create opportunities",
  opportunities_edit: "Edit opportunities",
  opportunities_change_status: "Change opportunity status",
  opportunities_delete: "Delete opportunities",
  applications_view: "View applications",
  applications_manage_status: "Manage application status",
  applications_request_contact: "Request driver contact",
  applications_manage_notes: "Manage application notes",
  contracts_view: "View contracts",
  contracts_manage: "Manage contracts",
  referrals_view: "View referrals",
  referrals_manage_status: "Manage referral status",
  referral_terms_manage: "Manage referral terms",
  reports_view: "View reports",
  reports_export: "Export reports",
  settlements_view: "View settlements",
  settlements_prepare: "Prepare settlements",
  settlements_finalize: "Finalize settlements",
  team_view: "View team",
  team_manage: "Manage team",
};

/**
 * Areas that are permanently owner-only. These are NOT permission keys and can
 * never be delegated to a staff member through the permission map.
 */
export const RECRUITER_OWNER_ONLY_AREAS = [
  "billing",
  "subscription",
  "account_deletion",
  "company_identity",
  "posting_terms",
  "verification_moderation",
  "platform_role_changes",
] as const;

export type RecruiterOwnerOnlyArea = (typeof RECRUITER_OWNER_ONLY_AREAS)[number];

/**
 * Fail-closed permission check. Only an explicit boolean `true` grants access.
 */
export function hasRecruiterStaffPermission(
  perms: RecruiterStaffPermissions | null | undefined,
  key: RecruiterStaffPermissionKey,
): boolean {
  if (!perms) return false;
  return perms[key] === true;
}

/**
 * Phase RC-1D — strict parser for the RC-1B full permission map returned by
 * `get_my_recruiter_permissions(_recruiter_id)`.
 *
 * Fail-closed contract:
 *   * payload MUST be a plain object (not null, array, string, number…)
 *   * EVERY key in RECRUITER_STAFF_PERMISSION_KEYS must be present and boolean
 *   * unknown extra keys invalidate the payload
 * There are no role presets and no defaults.
 */
export type ParsedRecruiterStaffPermissions = Record<RecruiterStaffPermissionKey, boolean>;

export function parseRecruiterStaffPermissions(
  payload: unknown,
): ParsedRecruiterStaffPermissions | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  // Plain object only: Supabase JSON payloads carry Object.prototype (or a null
  // prototype); class instances / exotic objects are rejected fail-closed.
  const proto = Object.getPrototypeOf(payload);
  if (proto !== Object.prototype && proto !== null) {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length !== RECRUITER_STAFF_PERMISSION_KEYS.length) return null;
  const out = {} as ParsedRecruiterStaffPermissions;
  for (const key of RECRUITER_STAFF_PERMISSION_KEYS) {
    const value = raw[key];
    if (typeof value !== 'boolean') return null;
    out[key] = value;
  }
  // Reject unknown extra keys (length check above plus explicit membership).
  for (const key of keys) {
    if (!(RECRUITER_STAFF_PERMISSION_KEYS as readonly string[]).includes(key)) {
      return null;
    }
  }
  return out;
}

/** Every permission denied. Used whenever resolution fails. */
export function emptyRecruiterStaffPermissions(): ParsedRecruiterStaffPermissions {
  const out = {} as ParsedRecruiterStaffPermissions;
  for (const key of RECRUITER_STAFF_PERMISSION_KEYS) out[key] = false;
  return out;
}

