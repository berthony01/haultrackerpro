/**
 * Phase 1J-B1 — Capability-based workspace access decisions (pure).
 *
 * Single source of truth for "which workspace can this account enter?"
 * Consumes ONLY the validated `UserCapabilitiesView` from
 * `@/lib/userCapabilities`, an optional preferred-role hint
 * (`profiles.intended_role` intent), and an optional stored preference
 * (localStorage). Never imports billing, subscription, plan, admin, or
 * Supabase clients. All decisions are pure functions.
 *
 * Product model:
 *  - driver / recruiter are additive capabilities, not exclusive roles.
 *  - driver.active            → driver workspace allowed.
 *  - recruiter.setup          → recruiter hub / onboarding only.
 *  - recruiter.active         → recruiter operational tools allowed.
 *  - recruiter.suspended      → recruiter hub only (see suspension +
 *                               switch back to driver).
 *  - recruiter.revoked / missing → no recruiter workspace, no switch.
 *
 * Admin status alone NEVER grants recruiter workspace. Plans / billing
 * NEVER decide workspace entry. localStorage/sessionStorage may store
 * a preference only; it never grants access.
 */

import type {
  UserCapabilitiesView,
  UserCapabilityStatus,
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

/** True only when `view` is a real derived view with a defined `rows`
 *  array. Anything else fails closed. */
function isView(view: unknown): view is UserCapabilitiesView {
  if (!view || typeof view !== 'object') return false;
  const v = view as Partial<UserCapabilitiesView>;
  return Array.isArray(v.rows);
}

export function computeWorkspaceAccess(
  view: UserCapabilitiesView | null | undefined,
): WorkspaceAccessDecisions {
  if (!isView(view)) {
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

  const driverWorkspaceAllowed = view.canEnterDriverWorkspace === true;
  const recruiterHubAllowed = view.hasRecruiterCapability === true;
  const recruiterOperationsAllowed = view.canOperateRecruiterWorkspace === true;
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
    driverCapabilityStatus: view.driverCapabilityStatus ?? null,
    recruiterCapabilityStatus: view.recruiterCapabilityStatus ?? null,
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
 *   - suspended → operational requests collapse to `hub`;
 *                 `hub`/`onboarding` allowed as requested (default hub).
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
    if (req && OPERATIONAL_SUBVIEWS.has(req)) return 'hub';
    return req ?? 'hub';
  }
  return null;
}

function normalizeSubview(v: unknown): RecruiterSubview | null {
  return typeof v === 'string' && (RECRUITER_SUBVIEWS as readonly string[]).includes(v)
    ? (v as RecruiterSubview)
    : null;
}
