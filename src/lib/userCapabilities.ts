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
 * Captures numeric components so we can validate the calendar and clock
 * ourselves — JavaScript's `Date.parse` normalizes impossible dates
 * (e.g. `2026-02-30` becomes March 2), which would otherwise fail-open.
 */
const RFC3339_TZ_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

export function isUserCapabilityType(v: unknown): v is UserCapabilityType {
  return typeof v === 'string' && CAP_SET.has(v);
}

export function isUserCapabilityStatus(v: unknown): v is UserCapabilityStatus {
  return typeof v === 'string' && STATUS_SET.has(v);
}

/** Leap-year rule per RFC3339 / proleptic Gregorian calendar. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Last valid day for a given month (1–12) in a given year. */
function lastDayOfMonth(year: number, month: number): number {
  switch (month) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12: return 31;
    case 4: case 6: case 9: case 11: return 30;
    case 2: return isLeapYear(year) ? 29 : 28;
    default: return 0;
  }
}

/**
 * Validate an `activated_at` field value. `null` is allowed (capability
 * exists but has never been activated). Any string must match the strict
 * RFC3339-with-timezone regex AND every numeric component must be a real
 * calendar/clock value — month 01–12, day valid for that month+year
 * (including leap years), hour 00–23, minute 00–59, second 00–59, and
 * timezone offset hour 00–23, minute 00–59. We do NOT rely on
 * `Date.parse` normalization to decide calendar validity.
 */
export function isValidActivatedAt(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== 'string') return false;
  const m = RFC3339_TZ_REGEX.exec(v);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > lastDayOfMonth(year, month)) return false;
  if (hour > 23) return false;
  if (minute > 59) return false;
  if (second > 59) return false;
  if (m[7] !== 'Z') {
    const offHour = Number(m[9]);
    const offMin = Number(m[10]);
    if (offHour > 23) return false;
    if (offMin > 59) return false;
  }
  return true;
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
