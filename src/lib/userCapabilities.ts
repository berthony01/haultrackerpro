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
 * non-array payloads are all rejected.
 *
 * DUPLICATE-CAPABILITY POLICY (fail-closed, order-independent):
 * If a capability (`driver` or `recruiter`) appears in more than one
 * structurally-valid row after per-row validation, that capability is
 * DISCARDED ENTIRELY. We never pick a "winner" — a duplicated row is
 * evidence of a malicious or corrupted response and must not grant any
 * access. A duplicated capability does not remove the other unique
 * capability.
 *
 * `activated_at` policy: MUST be an own property on the row (missing key
 * rejects the row). MUST be either `null` or a string matching a strict
 * RFC3339 timestamp with an explicit timezone designator — either `Z` or
 * a numeric `±HH:MM` offset. Date-only strings, timestamps without a
 * timezone, locale text, numbers, arrays, and objects are all rejected.
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

/**
 * Strict RFC3339 timestamp: date-time with explicit timezone designator.
 * Accepts `Z` or a numeric ±HH:MM offset. Fractional seconds optional.
 * Rejects: date-only, timestamp without TZ, locale strings, "not-a-date".
 */
const RFC3339_TZ_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isUserCapabilityType(v: unknown): v is UserCapabilityType {
  return typeof v === 'string' && CAP_SET.has(v);
}

export function isUserCapabilityStatus(v: unknown): v is UserCapabilityStatus {
  return typeof v === 'string' && STATUS_SET.has(v);
}

/**
 * Validate an `activated_at` field value. `null` is allowed (capability
 * exists but has never been activated). Any string must match the strict
 * RFC3339-with-timezone regex AND parse to a finite Date. Everything
 * else is rejected.
 */
export function isValidActivatedAt(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== 'string') return false;
  if (!RFC3339_TZ_REGEX.test(v)) return false;
  return Number.isFinite(Date.parse(v));
}

/** Throws on invalid input. Used to validate `begin_recruiter_setup` result. */
export function parseUserCapabilityStatus(v: unknown): UserCapabilityStatus {
  if (!isUserCapabilityStatus(v)) {
    throw new Error(`Invalid user_capability_status: ${JSON.stringify(v)}`);
  }
  return v;
}

/**
 * Returns a validated row or null when the shape is unusable. Missing
 * `activated_at` (not an own property) is rejected — the field must be
 * present and set to null or a strict RFC3339 timestamp.
 */
export function parseUserCapabilityRow(raw: unknown): UserCapabilityRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isUserCapabilityType(r.capability)) return null;
  if (!isUserCapabilityStatus(r.status)) return null;
  if (!Object.prototype.hasOwnProperty.call(r, 'activated_at')) return null;
  if (!isValidActivatedAt(r.activated_at)) return null;
  return {
    capability: r.capability,
    status: r.status,
    activated_at: r.activated_at as string | null,
  };
}

/**
 * Validates an RPC payload into a deterministic capability list.
 * - Non-array input yields `[]` (safe default).
 * - Structurally invalid rows are dropped per row.
 * - Fail-closed dedup: if a capability appears more than once after
 *   per-row validation, that capability is DROPPED ENTIRELY. The other
 *   unique capability is retained.
 */
export function parseUserCapabilityRows(data: unknown): UserCapabilityRow[] {
  if (!Array.isArray(data)) return [];
  const buckets = new Map<UserCapabilityType, UserCapabilityRow[]>();
  for (const raw of data) {
    const row = parseUserCapabilityRow(raw);
    if (!row) continue;
    const list = buckets.get(row.capability);
    if (list) list.push(row);
    else buckets.set(row.capability, [row]);
  }
  const out: UserCapabilityRow[] = [];
  for (const cap of USER_CAPABILITY_TYPES) {
    const list = buckets.get(cap);
    if (list && list.length === 1) out.push(list[0]);
    // list.length > 1 → drop this capability entirely (fail closed).
    // list undefined → capability absent.
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

/**
 * Pure, testable core of the `beginRecruiterSetup` hook path. Rejects
 * BEFORE invoking `rpc` when the caller has no authenticated user id.
 * When invoked, validates the returned status through
 * `parseUserCapabilityStatus` so bogus values cannot escape.
 *
 * Exported so unit tests can prove — with a mocked rpc — that a missing
 * user id does NOT trigger the RPC call.
 */
export async function beginRecruiterSetupRpc(
  userId: string | null | undefined,
  rpc: () => Promise<{ data: unknown; error: unknown }>,
): Promise<UserCapabilityStatus> {
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await rpc();
  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  return parseUserCapabilityStatus(data);
}
