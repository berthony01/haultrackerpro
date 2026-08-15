/**
 * Phase RC-1C — Pure parsing + resolution for recruiter STAFF workspace
 * entry context.
 *
 * Pure module: no React, no Supabase, no storage access. It only turns
 * an untrusted RPC payload into a validated workspace list and resolves
 * which workspace (if any) the shell may enter.
 *
 * Security contract:
 *  - Only ACTIVE non-owner roles are representable.
 *  - Malformed payloads / malformed rows fail CLOSED (invalid), never
 *    partially accepted and auto-selected.
 *  - Duplicate membership ids or duplicate recruiter ids fail CLOSED.
 *  - A stored recruiter id is a PREFERENCE only. It must match exactly
 *    one row of the CURRENT server payload or it grants nothing.
 *  - Resolution NEVER implies operational recruiter authority.
 */

export const RECRUITER_STAFF_ROLES = ['recruiter_admin', 'recruiter_staff'] as const;
export type RecruiterStaffRole = (typeof RECRUITER_STAFF_ROLES)[number];

export interface RecruiterStaffWorkspace {
  membershipId: string;
  recruiterId: string;
  companyName: string;
  recruiterName: string;
  memberRole: RecruiterStaffRole;
  memberSince: string | null;
}

export type RecruiterStaffWorkspaceResolution =
  | { kind: 'invalid'; workspaces: []; selected: null; reason: string }
  | { kind: 'none'; workspaces: []; selected: null }
  | {
      kind: 'selected';
      workspaces: RecruiterStaffWorkspace[];
      selected: RecruiterStaffWorkspace;
      /** True when a stored preference had to be discarded. */
      shouldClearStoredSelection: boolean;
    }
  | {
      kind: 'selection_required';
      workspaces: RecruiterStaffWorkspace[];
      selected: null;
      shouldClearStoredSelection: boolean;
    };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isRole(v: unknown): v is RecruiterStaffRole {
  return v === 'recruiter_admin' || v === 'recruiter_staff';
}

export function parseRecruiterStaffWorkspaceRow(
  row: unknown,
): RecruiterStaffWorkspace | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  if (!isNonEmptyString(r.membership_id)) return null;
  if (!isNonEmptyString(r.recruiter_id)) return null;
  if (!isNonEmptyString(r.company_name)) return null;
  if (!isNonEmptyString(r.recruiter_name)) return null;
  if (!isRole(r.member_role)) return null;
  const since = r.member_since;
  if (since !== null && since !== undefined && typeof since !== 'string') return null;
  return {
    membershipId: r.membership_id,
    recruiterId: r.recruiter_id,
    companyName: r.company_name,
    recruiterName: r.recruiter_name,
    memberRole: r.member_role,
    memberSince: typeof since === 'string' ? since : null,
  };
}

export type ParseResult =
  | { ok: true; workspaces: RecruiterStaffWorkspace[] }
  | { ok: false; reason: string };

/** Strict, fail-closed payload parser. */
export function parseRecruiterStaffWorkspaces(payload: unknown): ParseResult {
  if (payload === null || payload === undefined) {
    return { ok: true, workspaces: [] };
  }
  if (!Array.isArray(payload)) {
    return { ok: false, reason: 'malformed_payload' };
  }
  const out: RecruiterStaffWorkspace[] = [];
  for (const raw of payload) {
    const parsed = parseRecruiterStaffWorkspaceRow(raw);
    if (!parsed) return { ok: false, reason: 'malformed_row' };
    out.push(parsed);
  }
  const membershipIds = new Set<string>();
  const recruiterIds = new Set<string>();
  for (const w of out) {
    if (membershipIds.has(w.membershipId)) {
      return { ok: false, reason: 'duplicate_membership' };
    }
    if (recruiterIds.has(w.recruiterId)) {
      return { ok: false, reason: 'duplicate_recruiter' };
    }
    membershipIds.add(w.membershipId);
    recruiterIds.add(w.recruiterId);
  }
  return { ok: true, workspaces: out };
}

/**
 * Resolve which staff workspace the shell may enter.
 *
 *  - 0 rows                                  → none
 *  - exactly 1 row                           → selected
 *  - 2+ rows + stored id matching exactly 1  → selected
 *  - 2+ rows otherwise                       → selection_required
 */
export function resolveRecruiterStaffWorkspace(
  payload: unknown,
  storedRecruiterId?: string | null,
): RecruiterStaffWorkspaceResolution {
  const parsed = parseRecruiterStaffWorkspaces(payload);
  if (!parsed.ok) {
    return { kind: 'invalid', workspaces: [], selected: null, reason: parsed.reason };
  }
  const workspaces = parsed.workspaces;
  const stored = isNonEmptyString(storedRecruiterId) ? storedRecruiterId : null;

  if (workspaces.length === 0) {
    return { kind: 'none', workspaces: [], selected: null };
  }

  const matches = stored
    ? workspaces.filter(w => w.recruiterId === stored)
    : [];
  const storedIsValid = matches.length === 1;

  if (workspaces.length === 1) {
    return {
      kind: 'selected',
      workspaces,
      selected: workspaces[0],
      shouldClearStoredSelection: stored !== null && !storedIsValid,
    };
  }

  if (storedIsValid) {
    return {
      kind: 'selected',
      workspaces,
      selected: matches[0],
      shouldClearStoredSelection: false,
    };
  }

  return {
    kind: 'selection_required',
    workspaces,
    selected: null,
    shouldClearStoredSelection: stored !== null,
  };
}

/** User-scoped preference storage key. Preference only — never access. */
export function recruiterStaffWorkspaceStorageKey(userId: string): string {
  return `htp_recruiter_staff_workspace:${userId}`;
}
