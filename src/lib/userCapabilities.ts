/**
 * Phase 1J-A — Additive user-capability vocabulary (pure).
 *
 * Mirrors the server enums `user_capability_type` and
 * `user_capability_status`. Capability rows describe WHICH workspaces an
 * account may enter or configure. They deliberately carry no billing,
 * plan, or premium-feature meaning — plan gating stays with
 * `recruiterCapabilities.ts` / `useRecruiterBilling` / `useSubscription`.
 *
 * Runtime parsers here are the SOLE trust boundary between the RPC
 * responses and the rest of the client. Unknown capabilities, unknown
 * statuses, malformed `activated_at` values, non-object rows, and
 * non-array payloads are all rejected. Duplicate capability rows are
 * resolved deterministically by FIRST-WINS: the first structurally valid
 * row for a given capability is retained and later duplicates are
 * dropped. This is safe because every code path that produces
 * capabilities is server-authoritative and the on-disk PK guarantees at
 * most one row per (user_id, capability); a duplicate would only appear
 * from a malicious/misconfigured response and dropping later rows cannot
 * escalate privilege.
 */

export const USER_CAPABILITY_TYPES = ['driver', 'recruiter'] as const;
export const USER_CAPABILITY_STATUSES = ['setup', 'active', 'suspended', 'revoked'] as const;

export type UserCapabilityType = (typeof USER_CAPABILITY_TYPES)[number];
export type UserCapabilityStatus = (typeof USER_CAPABILITY_STATUSES)[number];

export interface UserCapabilityRow {
  capability: UserCapabilityType;
  status: UserCapabilityStatus;
  activated_at: string | null;
}

export interface UserCapabilitiesView {
  rows: UserCapabilityRow[];
  hasDriverCapability: boolean;
  hasRecruiterCapability: boolean;
  driverCapabilityStatus: UserCapabilityStatus | null;
  recruiterCapabilityStatus: UserCapabilityStatus | null;
  canEnterDriverWorkspace: boolean;
  canEnterRecruiterSetup: boolean;
  canOperateRecruiterWorkspace: boolean;
  isRecruiterSuspended: boolean;
}

const CAP_SET: ReadonlySet<string> = new Set(USER_CAPABILITY_TYPES);
const STATUS_SET: ReadonlySet<string> = new Set(USER_CAPABILITY_STATUSES);

export function isUserCapabilityType(v: unknown): v is UserCapabilityType {
  return typeof v === 'string' && CAP_SET.has(v);
}

export function isUserCapabilityStatus(v: unknown): v is UserCapabilityStatus {
  return typeof v === 'string' && STATUS_SET.has(v);
}

/** Throws on invalid input. Used to validate `begin_recruiter_setup` result. */
export function parseUserCapabilityStatus(v: unknown): UserCapabilityStatus {
  if (!isUserCapabilityStatus(v)) {
    throw new Error(`Invalid user_capability_status: ${JSON.stringify(v)}`);
  }
  return v;
}

/** Returns a validated row or null when the shape is unusable. */
export function parseUserCapabilityRow(raw: unknown): UserCapabilityRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isUserCapabilityType(r.capability)) return null;
  if (!isUserCapabilityStatus(r.status)) return null;

  let activated_at: string | null;
  const a = r.activated_at;
  if (a === null || a === undefined) {
    activated_at = null;
  } else if (typeof a === 'string' && Number.isFinite(Date.parse(a))) {
    activated_at = a;
  } else {
    return null;
  }
  return { capability: r.capability, status: r.status, activated_at };
}

/**
 * Validates an RPC payload into a deterministic capability list.
 * - Non-array input yields `[]` (safe default).
 * - Structurally invalid rows are dropped.
 * - Duplicates: FIRST-WINS per capability (see file header).
 */
export function parseUserCapabilityRows(data: unknown): UserCapabilityRow[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<UserCapabilityType>();
  const out: UserCapabilityRow[] = [];
  for (const raw of data) {
    const row = parseUserCapabilityRow(raw);
    if (!row) continue;
    if (seen.has(row.capability)) continue;
    seen.add(row.capability);
    out.push(row);
  }
  return out;
}

export function deriveUserCapabilitiesView(
  rows: readonly UserCapabilityRow[] | null | undefined,
): UserCapabilitiesView {
  // Re-validate defensively so callers cannot inject arbitrary strings.
  const safe = parseUserCapabilityRows(rows ?? []);
  const byCap = new Map<UserCapabilityType, UserCapabilityRow>();
  for (const r of safe) byCap.set(r.capability, r);

  const driver = byCap.get('driver') ?? null;
  const recruiter = byCap.get('recruiter') ?? null;

  const recruiterStatus = recruiter?.status ?? null;
  const hasRecruiterCapability =
    recruiterStatus === 'setup' ||
    recruiterStatus === 'active' ||
    recruiterStatus === 'suspended';

  return {
    rows: safe,
    hasDriverCapability: !!driver,
    hasRecruiterCapability,
    driverCapabilityStatus: driver?.status ?? null,
    recruiterCapabilityStatus: recruiterStatus,
    canEnterDriverWorkspace: driver?.status === 'active',
    canEnterRecruiterSetup: hasRecruiterCapability,
    canOperateRecruiterWorkspace: recruiterStatus === 'active',
    isRecruiterSuspended: recruiterStatus === 'suspended',
  };
}
