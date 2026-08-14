/**
 * Driver Assistants — client-side mirror of the permission keys allowed on the
 * server. UI uses these for gating; server RLS + RPCs are the real enforcement.
 *
 * NOTE: `manage_receipts` and `manage_documents` are intentionally NOT exposed
 * here in Phase 1 — those flows aren't yet wired end-to-end. They will be
 * re-introduced in a later phase once receipt/document upload paths support
 * assistant context.
 */
export const ASSISTANT_PERMISSION_KEYS = [
  'manage_loads',
  'manage_expenses',
  'manage_fuel',
  'view_reports',
  'export_reports',
  'view_dashboard',
  'manage_settings_limited',
  'settlements_view',
  'settlements_manage',
  'settlements_finalize',
] as const;

export type AssistantPermissionKey = (typeof ASSISTANT_PERMISSION_KEYS)[number];

export type AssistantPermissions = Partial<Record<AssistantPermissionKey, boolean>>;

export const PERMISSION_LABELS: Record<AssistantPermissionKey, string> = {
  manage_loads: 'Loads — view, add, edit',
  manage_expenses: 'Expenses — view, add, edit',
  manage_fuel: 'Fuel logs — view, add, edit',
  view_reports: 'Reports — view',
  export_reports: 'Reports — export PDF / CSV',
  view_dashboard: 'Dashboard — view KPIs and charts',
  manage_settings_limited: 'Limited settings (cost profile, default pay model)',
  settlements_view: 'Settlements: view statements',
  settlements_manage: 'Settlements: reconcile and manage',
  settlements_finalize: 'Settlements: finalize managed statements',
};

export const PERMISSION_DEFAULTS: AssistantPermissions = {
  manage_loads: true,
  manage_expenses: true,
  manage_fuel: true,
  view_reports: true,
  view_dashboard: true,
  settlements_view: false,
  settlements_manage: false,
  settlements_finalize: false,
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

/**
 * Map a navigation page id (used by BottomNav / AppSidebar / Index router) to
 * the permission key required when an assistant is acting on behalf of a driver.
 *
 * Phase DA-1: this is an ALLOWLIST. Only page ids explicitly enumerated below
 * are reachable while acting as an assistant. Anything else — including any
 * future page id — fails closed as 'BLOCKED'.
 */
export type PageGate = AssistantPermissionKey | 'BLOCKED' | null;

/** Pages that carry no protected workspace data. */
const ASSISTANT_NEUTRAL_PAGES = new Set<string>(['more']);

/** Exhaustive allowlist: page id -> required assistant permission. */
const ASSISTANT_PAGE_ALLOWLIST: Record<string, AssistantPermissionKey> = {
  dashboard: 'view_dashboard',
  loads: 'manage_loads',
  add: 'manage_loads',
  expenses: 'manage_expenses',
  add_expense: 'manage_expenses',
  fuel: 'manage_fuel',
  add_fuel: 'manage_fuel',
  reports: 'view_reports',
  monthly: 'view_reports',
  settlements: 'settlements_view',
};

export function assistantPageGate(page: string): PageGate {
  if (ASSISTANT_NEUTRAL_PAGES.has(page)) return null;
  const gate = ASSISTANT_PAGE_ALLOWLIST[page];
  if (gate) return gate;
  // Unknown / owner-only / recruiter / settings / contracts / alerts /
  // scorecard / closeout / recurring expenses / upgrade → fail closed.
  return 'BLOCKED';
}


/** First nav page an acting assistant can actually visit, given perms. */
export function firstAllowedAssistantPage(
  perms: AssistantPermissions | null | undefined,
): string {
  if (hasPerm(perms, 'view_dashboard')) return 'dashboard';
  if (hasPerm(perms, 'manage_loads')) return 'loads';
  if (hasPerm(perms, 'settlements_view')) return 'settlements';
  if (hasPerm(perms, 'view_reports')) return 'reports';
  if (hasPerm(perms, 'manage_expenses')) return 'expenses';
  if (hasPerm(perms, 'manage_fuel')) return 'fuel';
  return 'more';
}

export function isAssistantPageAllowed(
  page: string,
  perms: AssistantPermissions | null | undefined,
): boolean {
  const gate = assistantPageGate(page);
  if (gate === 'BLOCKED') return false;
  if (gate === null) return true;
  return hasPerm(perms, gate);
}
