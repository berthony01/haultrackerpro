/**
 * Phase 1J-A — Additive user-capability vocabulary (pure).
 *
 * Mirrors the server enums `user_capability_type` and
 * `user_capability_status`. Capability rows describe WHICH workspaces an
 * account may enter or configure. They deliberately carry no billing,
 * plan, or premium-feature meaning — plan gating stays with
 * `recruiterCapabilities.ts` / `useRecruiterBilling` / `useSubscription`.
 */

export type UserCapabilityType = 'driver' | 'recruiter';
export type UserCapabilityStatus = 'setup' | 'active' | 'suspended' | 'revoked';

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

export function deriveUserCapabilitiesView(
  rows: readonly UserCapabilityRow[] | null | undefined,
): UserCapabilitiesView {
  const safe = Array.isArray(rows) ? rows.slice() : [];
  const byCap = new Map<UserCapabilityType, UserCapabilityRow>();
  for (const r of safe) {
    if (!r) continue;
    if (r.capability === 'driver' || r.capability === 'recruiter') {
      byCap.set(r.capability, r);
    }
  }

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
