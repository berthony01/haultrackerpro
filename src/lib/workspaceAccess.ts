/**
 * Phase 1J-B1 — Capability-based workspace access decisions (pure).
 *
 * Single source of truth for "which workspace can this account enter?"
 * Consumes ONLY validated capability rows through
 * `deriveUserCapabilitiesView`, an optional preferred-role hint
 * (`profiles.intended_role` intent), and an optional stored preference
 * (localStorage). Never imports billing, subscription, plan, admin, or
 * Supabase clients. All decisions are pure functions.
 *
 * Product model:
 *  - driver / recruiter are additive capabilities, not exclusive roles.
 *  - driver.active            → driver workspace allowed.
 *  - recruiter.setup          → recruiter hub / onboarding only.
 *  - recruiter.active         → recruiter operational tools allowed.
 *  - recruiter.suspended      → recruiter hub only (only the suspension
 *                               notice surface — ALL requested subviews
 *                               collapse to `hub`).
 *  - recruiter.revoked / missing → no recruiter workspace, no switch.
 *
 * Admin status alone NEVER grants recruiter workspace. Plans / billing
 * NEVER decide workspace entry. localStorage/sessionStorage may store
 * a preference only; it never grants access.
 *
 * Trust boundary: Only `view.rows` is trusted, and even that is
 * re-validated through `deriveUserCapabilitiesView` on every call. Any
 * caller-supplied boolean or status field on the view object (e.g.
 * `canEnterDriverWorkspace`, `hasRecruiterCapability`) is IGNORED so a
 * forged view cannot manufacture access.
 */

import {
  deriveUserCapabilitiesView,
  type UserCapabilitiesView,
  type UserCapabilityRow,
  type UserCapabilityStatus,
} from '@/lib/userCapabilities';

export type WorkspaceRole = 'driver' | 'recruiter';

export const RECRUITER_SUBVIEWS = [
  'hub',
  'onboarding',
  'manager',
  'applications',
  'reports',
] as const;
export type RecruiterSubview = (typeof RECRUITER_SUBVIEWS)[number];

const OPERATIONAL_SUBVIEWS: ReadonlySet<RecruiterSubview> = new Set([
  'manager',
  'applications',
  'reports',
]);

export interface WorkspaceAccessDecisions {
  /** driver.active → true. */
  driverWorkspaceAllowed: boolean;
  /** recruiter status setup | active | suspended → true. */
  recruiterHubAllowed: boolean;
  /** recruiter.active → true. */
  recruiterOperationsAllowed: boolean;
  /** Both driver.active AND recruiter hub-allowed → true. */
  switcherAvailable: boolean;
  /** The workspace this account can safely land on; null when neither
   *  workspace is enterable (fail closed — caller must handle). */
  allowedFallbackWorkspace: WorkspaceRole | null;
  /** Convenience mirrors of the underlying capability statuses. */
  driverCapabilityStatus: UserCapabilityStatus | null;
  recruiterCapabilityStatus: UserCapabilityStatus | null;
}

export interface InitialWorkspaceInput {
  /** Optional intent hint from `profiles.intended_role`. Not an
   *  authorization signal — only chooses between two allowed workspaces. */
  preferredRole?: WorkspaceRole | null;
  /** Optional stored preference from localStorage. Same rule as above. */
  storedPreference?: WorkspaceRole | null;
}

export interface InitialWorkspaceResult {
  workspace: WorkspaceRole | null;
  /** True when the stored preference was ignored because it is no longer
   *  a workspace the account may enter. Caller should clear it. */
  shouldClearStoredPreference: boolean;
}

/** Extract the trusted rows array from an untyped view object. Returns
 *  `null` when the input does not carry a real rows array — every other
 *  field on the view is ignored. */
function extractRows(view: unknown): readonly UserCapabilityRow[] | null {
  if (!view || typeof view !== 'object') return null;
  const rows = (view as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as readonly UserCapabilityRow[]) : null;
}

export function computeWorkspaceAccess(
  view: UserCapabilitiesView | null | undefined,
): WorkspaceAccessDecisions {
  const rows = extractRows(view);
  if (!rows) {
    return {
      driverWorkspaceAllowed: false,
      recruiterHubAllowed: false,
      recruiterOperationsAllowed: false,
      switcherAvailable: false,
      allowedFallbackWorkspace: null,
      driverCapabilityStatus: null,
      recruiterCapabilityStatus: null,
    };
  }
  // Re-derive from raw rows so forged sibling booleans on the input
  // object cannot leak in. `deriveUserCapabilitiesView` re-runs the
  // per-row validators and the fail-closed dedup policy.
  const safe = deriveUserCapabilitiesView(rows);

  const driverWorkspaceAllowed = safe.canEnterDriverWorkspace === true;
  const recruiterHubAllowed = safe.hasRecruiterCapability === true;
  const recruiterOperationsAllowed = safe.canOperateRecruiterWorkspace === true;
  const switcherAvailable = driverWorkspaceAllowed && recruiterHubAllowed;

  let allowedFallbackWorkspace: WorkspaceRole | null = null;
  if (driverWorkspaceAllowed) allowedFallbackWorkspace = 'driver';
  else if (recruiterHubAllowed) allowedFallbackWorkspace = 'recruiter';

  return {
    driverWorkspaceAllowed,
    recruiterHubAllowed,
    recruiterOperationsAllowed,
    switcherAvailable,
    allowedFallbackWorkspace,
    driverCapabilityStatus: safe.driverCapabilityStatus,
    recruiterCapabilityStatus: safe.recruiterCapabilityStatus,
  };
}

/** Is `role` a workspace the account may enter right now? */
export function isWorkspaceAllowed(
  view: UserCapabilitiesView | null | undefined,
  role: WorkspaceRole,
): boolean {
  const d = computeWorkspaceAccess(view);
  return role === 'driver' ? d.driverWorkspaceAllowed : d.recruiterHubAllowed;
}

/**
 * Resolve the initial workspace on mount.
 *
 * Priority when multiple workspaces are enterable:
 *   1. Validated stored preference (localStorage).
 *   2. preferredRole hint (server-side intent, e.g. `intended_role`).
 *   3. Driver, when allowed.
 *   4. Recruiter, when allowed.
 *
 * Any preferred/stored value that is not currently enterable is IGNORED
 * (never re-mapped to grant access). A stale stored recruiter preference
 * is flagged via `shouldClearStoredPreference`.
 */
export function resolveInitialWorkspace(
  view: UserCapabilitiesView | null | undefined,
  input: InitialWorkspaceInput = {},
): InitialWorkspaceResult {
  const decisions = computeWorkspaceAccess(view);
  const { driverWorkspaceAllowed, recruiterHubAllowed } = decisions;

  const preferred = normalizeRole(input.preferredRole);
  const stored = normalizeRole(input.storedPreference);

  const allow = (r: WorkspaceRole | null): boolean =>
    r === 'driver' ? driverWorkspaceAllowed
    : r === 'recruiter' ? recruiterHubAllowed
    : false;

  let workspace: WorkspaceRole | null = null;
  if (allow(stored)) workspace = stored;
  else if (allow(preferred)) workspace = preferred;
  else workspace = decisions.allowedFallbackWorkspace;

  const shouldClearStoredPreference = stored !== null && !allow(stored);

  return { workspace, shouldClearStoredPreference };
}

function normalizeRole(v: unknown): WorkspaceRole | null {
  return v === 'driver' || v === 'recruiter' ? v : null;
}

/**
 * Resolve a requested recruiter subview against the current recruiter
 * capability status:
 *   - No recruiter hub access → null.
 *   - setup     → operational requests collapse to `onboarding`;
 *                 `hub`/`onboarding` allowed as requested (default onboarding).
 *   - suspended → ALL requested subviews collapse to `hub`. Only the
 *                 suspension notice surface is reachable.
 *   - active    → requested subview preserved (default `hub`).
 */
export function resolveRecruiterSubview(
  view: UserCapabilitiesView | null | undefined,
  requested?: RecruiterSubview | string | null,
): RecruiterSubview | null {
  const decisions = computeWorkspaceAccess(view);
  if (!decisions.recruiterHubAllowed) return null;

  const req = normalizeSubview(requested);
  const status = decisions.recruiterCapabilityStatus;

  if (status === 'active') {
    return req ?? 'hub';
  }
  if (status === 'setup') {
    if (req && OPERATIONAL_SUBVIEWS.has(req)) return 'onboarding';
    return req ?? 'onboarding';
  }
  if (status === 'suspended') {
    // Suspension is a terminal, hub-only surface: every requested
    // subview — including onboarding — collapses to `hub`.
    return 'hub';
  }
  return null;
}

function normalizeSubview(v: unknown): RecruiterSubview | null {
  return typeof v === 'string' && (RECRUITER_SUBVIEWS as readonly string[]).includes(v)
    ? (v as RecruiterSubview)
    : null;
}
