/**
 * Phase AM-1B — pure client mirror of the Agency workspace permission vocabulary.
 *
 * This module is intentionally pure: no React, no Supabase, no side effects.
 * It mirrors the database enum `public.agency_workspace_permission` exactly
 * (same keys, same order). It grants nothing on its own — the database
 * resolver is the only authority.
 *
 * Agency workspace permission does NOT grant driver-account access. Driver
 * data still requires an exact driver-approved delegation.
 */

export const AGENCY_WORKSPACE_PERMISSION_KEYS = [
  "packages_view",
  "packages_manage",
  "client_requests_view",
  "client_requests_manage",
  "clients_view",
  "delegations_view",
  "delegations_manage",
  "work_items_view_all",
  "work_items_manage",
  "audit_view",
  "team_view",
] as const;

export type AgencyWorkspacePermissionKey = (typeof AGENCY_WORKSPACE_PERMISSION_KEYS)[number];

export type AgencyWorkspacePermissions = Partial<Record<AgencyWorkspacePermissionKey, boolean>>;

export const AGENCY_WORKSPACE_PERMISSION_LABELS: Record<AgencyWorkspacePermissionKey, string> = {
  packages_view: "View service packages",
  packages_manage: "Manage service packages",
  client_requests_view: "View client requests",
  client_requests_manage: "Manage client requests",
  clients_view: "View clients",
  delegations_view: "View delegations",
  delegations_manage: "Manage delegations",
  work_items_view_all: "View all work items",
  work_items_manage: "Manage work items",
  audit_view: "View audit log",
  team_view: "View team",
};

/**
 * Areas that are never delegable to a non-owner Agency member. These are not
 * permission keys and must never appear in the permission vocabulary.
 */
export const AGENCY_OWNER_ONLY_AREAS = [
  "billing",
  "subscription",
  "plan_and_limits",
  "agency_identity",
  "agency_slug_private_request_link",
  "member_invitation",
  "member_revocation",
  "permission_assignment",
  "account_deletion",
  "ownership_transfer",
  "platform_role_changes",
] as const;

export type AgencyOwnerOnlyArea = (typeof AGENCY_OWNER_ONLY_AREAS)[number];

/** True only for an exact boolean `true` value. Everything else fails closed. */
export function hasAgencyWorkspacePermission(
  perms: AgencyWorkspacePermissions | null | undefined,
  key: AgencyWorkspacePermissionKey,
): boolean {
  if (!perms) return false;
  return perms[key] === true;
}

export type ParsedAgencyWorkspacePermissions = Record<AgencyWorkspacePermissionKey, boolean>;

/**
 * Strict parser: accepts only a plain object containing exactly all 11 known
 * keys, each with a boolean value, and no extra keys. Anything else => null.
 */
export function parseAgencyWorkspacePermissions(
  payload: unknown,
): ParsedAgencyWorkspacePermissions | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;

  const proto = Object.getPrototypeOf(payload);
  if (proto !== Object.prototype && proto !== null) return null;

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== AGENCY_WORKSPACE_PERMISSION_KEYS.length) return null;

  const known = new Set<string>(AGENCY_WORKSPACE_PERMISSION_KEYS);
  for (const key of keys) {
    if (!known.has(key)) return null;
  }

  const result = {} as ParsedAgencyWorkspacePermissions;
  for (const key of AGENCY_WORKSPACE_PERMISSION_KEYS) {
    const value = record[key];
    if (typeof value !== "boolean") return null;
    result[key] = value;
  }
  return result;
}

/** A complete, all-false permission map. */
export function emptyAgencyWorkspacePermissions(): ParsedAgencyWorkspacePermissions {
  const result = {} as ParsedAgencyWorkspacePermissions;
  for (const key of AGENCY_WORKSPACE_PERMISSION_KEYS) {
    result[key] = false;
  }
  return result;
}
