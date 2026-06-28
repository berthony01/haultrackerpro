/**
 * Driver Assistants — client-side mirror of the permission keys allowed on the
 * server. UI uses these for gating; server RLS + RPCs are the real enforcement.
 */
export const ASSISTANT_PERMISSION_KEYS = [
  'manage_loads',
  'manage_expenses',
  'manage_fuel',
  'manage_receipts',
  'view_reports',
  'export_reports',
  'manage_documents',
  'view_dashboard',
  'manage_settings_limited',
] as const;

export type AssistantPermissionKey = (typeof ASSISTANT_PERMISSION_KEYS)[number];

export type AssistantPermissions = Partial<Record<AssistantPermissionKey, boolean>>;

export const PERMISSION_LABELS: Record<AssistantPermissionKey, string> = {
  manage_loads: 'Loads — view, add, edit',
  manage_expenses: 'Expenses — view, add, edit',
  manage_fuel: 'Fuel logs — view, add, edit',
  manage_receipts: 'Receipts — upload and attach',
  view_reports: 'Reports — view',
  export_reports: 'Reports — export PDF / CSV',
  manage_documents: 'Documents — upload, view',
  view_dashboard: 'Dashboard — view KPIs and charts',
  manage_settings_limited: 'Limited settings (cost profile, default pay model)',
};

export const PERMISSION_DEFAULTS: AssistantPermissions = {
  manage_loads: true,
  manage_expenses: true,
  manage_fuel: true,
  manage_receipts: true,
  view_reports: true,
  view_dashboard: true,
};

/** Hard blocks — assistants must NEVER reach these regardless of UI state. */
export const ASSISTANT_FORBIDDEN_AREAS = [
  'billing',
  'subscription',
  'account_deletion',
  'owner_email',
  'recruiter_features',
  'invite_other_assistants',
  'platform_role_changes',
] as const;

export function hasPerm(
  perms: AssistantPermissions | null | undefined,
  key: AssistantPermissionKey,
): boolean {
  return !!perms && perms[key] === true;
}
