/**
 * Phase DA-1 — driver-workspace surface guards.
 *
 *  6. The acting assistant's driver Pro gate is derived from the MANAGED
 *     driver's `driver_is_pro`, never from the assistant's own subscription.
 *  7. Reports use the managed driver's safe report settings while acting.
 *  8. view_reports without export_reports disables ALL report exports,
 *     including the weekly CSV export.
 *  9. Unknown assistant page ids fail closed.
 * 10. Explicitly allowed assistant subpages route under the correct permission.
 * 11-13. Driver Pro pricing truth for the single direct Driver Assistant.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  assistantPageGate,
  isAssistantPageAllowed,
} from '@/lib/assistantPermissions';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// -------------------------------------------------------------------------
// 6 + 7 — Index.tsx wires the MANAGED driver's entitlement and settings.
// -------------------------------------------------------------------------
describe('DA-1 · acting assistant uses the managed driver context', () => {
  const INDEX = read('src/pages/Index.tsx');

  it('derives driver-workspace Pro from actingDriver.driver_is_pro, not the assistant subscription', () => {
    expect(INDEX).toMatch(
      /const isPro = isActingAsAssistant[\s\S]{0,120}actingDriver\?\.driver_is_pro === true[\s\S]{0,80}subscription\.isPro/,
    );
    // The raw assistant subscription value must not be the driver gate.
    expect(INDEX).not.toMatch(/const isPro = subscription\.isPro;/);
  });

  it('passes the managed driver safe report settings and export capability to ReportsView', () => {
    expect(INDEX).toMatch(/useDriverReportSettings\(/);
    expect(INDEX).toMatch(/settingsOverride=\{isActingAsAssistant \? driverReportSettings \?\? null : null\}/);
    expect(INDEX).toMatch(/canExport=\{canExportReports\}/);
    expect(INDEX).toMatch(/hasPerm\(actingPermissions, 'export_reports'\)/);
  });

  it('reads report settings only through the narrow RPC', () => {
    const hook = read('src/hooks/useDriverReportSettings.ts');
    expect(hook).toMatch(/rpc\('get_driver_report_settings'/);
    expect(hook).not.toMatch(/from\('user_settings'\)/);
  });
});

// -------------------------------------------------------------------------
// 8 — export_reports actually controls exports (rendered behavior).
// -------------------------------------------------------------------------
vi.mock('@/hooks/useLoadStops', () => ({ useLoadStops: () => ({ stops: [] }) }));
vi.mock('@/hooks/useFuelLogs', () => ({ useFuelLogs: () => ({ fuelLogs: [] }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'assistant', email: 'assistant@x.test', user_metadata: {} } }),
}));
vi.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({
    settings: { company_name: 'ASSISTANT OWN CO', week_start_day: 'monday' },
    isLoading: false,
    updateSettings: { mutate: () => {} },
  }),
}));

import { ReportsView } from '@/components/ReportsView';

const LOAD: any = {
  id: 'l1',
  user_id: 'driver',
  status: 'completed',
  pickup_date: '2026-01-05',
  dropoff_date: '2026-01-06',
  loaded_miles: 500,
  rate_per_mile: 2.5,
  gross_pay: 1250,
  broker_name: 'ACME',
  origin_city: 'Dallas',
  origin_state: 'TX',
  destination_city: 'Austin',
  destination_state: 'TX',
};

describe('DA-1 · export_reports controls report exports', () => {
  it('disables PDF, CSV and weekly CSV when canExport is false', () => {
    render(<ReportsView loads={[LOAD]} expenses={[]} isPro canExport={false} />);
    expect((screen.getByRole('button', { name: /Download PDF/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Export CSV/i }) as HTMLButtonElement).disabled).toBe(true);
    for (const btn of screen.queryAllByTestId('export-week-csv')) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByTestId('reports-export-not-permitted')).toBeTruthy();
  });

  it('leaves weekly CSV enabled when export is permitted', () => {
    render(<ReportsView loads={[LOAD]} expenses={[]} isPro canExport />);
    expect(screen.queryByTestId('reports-export-not-permitted')).toBeNull();
    for (const btn of screen.queryAllByTestId('export-week-csv')) {
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('renders the managed driver company name, not the assistant own settings', () => {
    render(
      <ReportsView
        loads={[LOAD]}
        expenses={[]}
        isPro
        canExport
        settingsOverride={{ company_name: 'MANAGED DRIVER LLC', week_start_day: 'monday' }}
      />,
    );
    expect(document.body.textContent).not.toContain('ASSISTANT OWN CO');
  });
});

// -------------------------------------------------------------------------
// DA-1 acceptance — Monthly Summary drill-down honours the same gates.
// -------------------------------------------------------------------------
import { MonthlySummary } from '@/components/MonthlySummary';

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const MONTH_LOAD: any = {
  ...LOAD,
  id: 'm1',
  load_date: iso(today),
  pickup_date: iso(today),
  dropoff_date: iso(today),
};

const monthlyButtons = () => ({
  csv: screen.getAllByTestId('monthly-export-csv') as HTMLButtonElement[],
  pdf: screen.getAllByTestId('monthly-export-pdf') as HTMLButtonElement[],
});

describe('DA-1 · Monthly Summary export gating', () => {
  it('disables monthly CSV and PDF when canExport is false', () => {
    render(<MonthlySummary loads={[MONTH_LOAD]} expenses={[]} onBack={() => {}} isPro canExport={false} />);
    const { csv, pdf } = monthlyButtons();
    expect(csv.length).toBeGreaterThan(0);
    for (const b of csv) expect(b.disabled).toBe(true);
    for (const b of pdf) expect(b.disabled).toBe(true);
    expect(screen.getByTestId('monthly-export-not-permitted')).toBeTruthy();
  });

  it('disables monthly CSV and PDF when the managed driver is not Pro', () => {
    render(<MonthlySummary loads={[MONTH_LOAD]} expenses={[]} onBack={() => {}} isPro={false} canExport />);
    const { csv, pdf } = monthlyButtons();
    for (const b of csv) expect(b.disabled).toBe(true);
    for (const b of pdf) expect(b.disabled).toBe(true);
  });

  it('enables monthly exports only when export permission AND driver Pro are both true', () => {
    render(<MonthlySummary loads={[MONTH_LOAD]} expenses={[]} onBack={() => {}} isPro canExport />);
    const { csv, pdf } = monthlyButtons();
    expect(csv.some((b) => !b.disabled)).toBe(true);
    expect(pdf.some((b) => !b.disabled)).toBe(true);
  });

  it('never falls back to the assistant identity when a settings override is supplied', () => {
    const SRC = read('src/components/MonthlySummary.tsx');
    expect(SRC).toMatch(/const settings: any = settingsOverride \?\? ownSettings;/);
    expect(SRC).toMatch(
      /settings\?\.company_name \|\|\s*\n?\s*\(settingsOverride\s*\n?\s*\? 'HaulTrackerPro Driver'/,
    );
    render(
      <MonthlySummary
        loads={[MONTH_LOAD]}
        expenses={[]}
        onBack={() => {}}
        isPro
        canExport
        settingsOverride={{ company_name: 'MANAGED DRIVER LLC', week_start_day: 'monday' }}
      />,
    );
    expect(document.body.textContent).not.toContain('ASSISTANT OWN CO');
  });
});

// -------------------------------------------------------------------------
// DA-1 acceptance — Index wires managed-driver context into monthly + dashboard.
// -------------------------------------------------------------------------
describe('DA-1 · Index passes managed-driver context to monthly + dashboard', () => {
  const INDEX = read('src/pages/Index.tsx');

  it('passes isPro, canExport and the managed driver settings to MonthlySummary', () => {
    const block = INDEX.slice(INDEX.indexOf('<MonthlySummary'));
    const jsx = block.slice(0, block.indexOf('/>'));
    expect(jsx).toMatch(/isPro=\{isPro\}/);
    expect(jsx).toMatch(/canExport=\{canExportReports\}/);
    expect(jsx).toMatch(/settingsOverride=\{isActingAsAssistant \? driverReportSettings \?\? null : null\}/);
  });

  it('passes the managed driver settings override to DashboardView', () => {
    const block = INDEX.slice(INDEX.indexOf('<DashboardView'));
    const jsx = block.slice(0, block.indexOf('/>'));
    expect(jsx).toMatch(/settingsOverride=\{isActingAsAssistant \? driverReportSettings \?\? null : null\}/);
  });

  it('derives the effective week start from the managed driver while acting, own settings when self', () => {
    expect(INDEX).toMatch(
      /const effectiveWeekStartDay = isActingAsAssistant\s*\n?\s*\? driverReportSettings\?\.week_start_day \?\? undefined\s*\n?\s*: settings\?\.week_start_day;/,
    );
    expect(INDEX).toMatch(/useSmartAlerts\([^)]*effectiveWeekStartDay\)/);
    expect(INDEX).toMatch(/useDriverScorecard\([^)]*effectiveWeekStartDay\)/);
    // No second RPC hook instance.
    expect(INDEX.match(/useDriverReportSettings\(/g)?.length).toBe(1);
  });

  it('resolves DashboardView settings from the override before own settings', () => {
    const SRC = read('src/components/DashboardView.tsx');
    expect(SRC).toMatch(/const \{ settings: ownSettings \} = useUserSettings\(\);/);
    expect(SRC).toMatch(/const settings: any = settingsOverride \?\? ownSettings;/);
  });
});


// -------------------------------------------------------------------------
// 9 + 10 — assistant navigation allowlist fails closed.
// -------------------------------------------------------------------------
describe('DA-1 · assistant navigation fails closed', () => {
  const FULL = {
    view_dashboard: true,
    manage_loads: true,
    manage_expenses: true,
    manage_fuel: true,
    view_reports: true,
    export_reports: true,
    settlements_view: true,
    manage_settings_limited: true,
  };

  it('blocks unknown / future page ids', () => {
    for (const page of ['totally-new-page', 'billing', 'upgrade', 'alerts', 'scorecard', 'closeout', 'recurring', '']) {
      expect(assistantPageGate(page)).toBe('BLOCKED');
      expect(isAssistantPageAllowed(page, FULL)).toBe(false);
    }
  });

  it('keeps existing owner-only areas blocked', () => {
    for (const page of ['settings', 'recruiter-access', 'opportunities', 'opportunity-preferences', 'contracts']) {
      expect(assistantPageGate(page)).toBe('BLOCKED');
    }
  });

  it('routes allowed subpages under the correct permission', () => {
    expect(assistantPageGate('dashboard')).toBe('view_dashboard');
    expect(assistantPageGate('loads')).toBe('manage_loads');
    expect(assistantPageGate('add')).toBe('manage_loads');
    expect(assistantPageGate('expenses')).toBe('manage_expenses');
    expect(assistantPageGate('add_expense')).toBe('manage_expenses');
    expect(assistantPageGate('fuel')).toBe('manage_fuel');
    expect(assistantPageGate('add_fuel')).toBe('manage_fuel');
    expect(assistantPageGate('reports')).toBe('view_reports');
    expect(assistantPageGate('monthly')).toBe('view_reports');
    expect(assistantPageGate('settlements')).toBe('settlements_view');
    expect(assistantPageGate('more')).toBeNull();
  });

  it('denies allowed pages when the permission is absent', () => {
    expect(isAssistantPageAllowed('reports', { manage_loads: true })).toBe(false);
    expect(isAssistantPageAllowed('reports', { view_reports: true })).toBe(true);
  });
});

// -------------------------------------------------------------------------
// 11-13 — Driver Pro pricing truth.
// -------------------------------------------------------------------------
import Pricing from '@/pages/Pricing';

const renderPricing = () =>
  render(
    <HelmetProvider>
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>
    </HelmetProvider>,
  );

describe('DA-1 · Driver Pro pricing truth', () => {
  it('shows the 1-assistant benefit in the non-expanded Pro key benefits', () => {
    const SRC = read('src/pages/Pricing.tsx');
    const list = SRC.slice(SRC.indexOf('const proFeatures = ['));
    const first8 = list.slice(0, list.indexOf(']')).split('\n').slice(1, 9).join('\n');
    expect(first8).toMatch(/Invite 1 trusted Driver Assistant/);

    renderPricing();
    expect(
      screen.getAllByText(/Invite 1 trusted Driver Assistant/i).length,
    ).toBeGreaterThan(0);
  });

  it('shows Free unavailable and Pro one permission-controlled assistant in the comparison', () => {
    renderPricing();
    const cell = screen.getAllByText('Direct Driver Assistant access')[0];
    // Walk up until the ancestor holds the whole comparison row.
    let row: HTMLElement = cell.parentElement as HTMLElement;
    while (row && !/1 assistant · permission-controlled/.test(row.textContent ?? '')) {
      row = row.parentElement as HTMLElement;
    }
    expect(row).toBeTruthy();
    const cells = Array.from(row.children).map((c) => (c.textContent ?? '').trim());
    const featureIdx = cells.findIndex((t) => t === 'Direct Driver Assistant access');
    expect(featureIdx).toBeGreaterThanOrEqual(0);
    // Free is rendered as the "unavailable" minus icon, never a value.
    const freeCell = row.children[featureIdx + 1] as HTMLElement;
    expect(freeCell.textContent?.trim()).toBe('');
    expect(freeCell.querySelector('svg.lucide-minus')).toBeTruthy();
    expect(cells[featureIdx + 2]).toBe('1 assistant · permission-controlled');
  });

  it('never claims assistants reach billing, account deletion, or recruiter features', () => {
    const SRC = read('src/pages/Pricing.tsx');
    const assistantCopy = SRC.split('\n').filter((l) => /assistant/i.test(l)).join('\n');
    expect(assistantCopy).not.toMatch(/assistant[^\n]*\b(billing|subscription|payment method|delete (the |your )?account|recruiter)/i);
    expect(assistantCopy).not.toMatch(/invite (more|additional|other) assistants/i);
  });
});

describe('DA-1 · webhook cleanup uses the exact canonical Driver Pro rule', () => {
  const SRC = () => read('supabase/functions/stripe-webhook/index.ts');

  it('derives driverProActive from status === "active" on a pro plan only', () => {
    expect(SRC()).toMatch(
      /const driverProActive\s*=\s*status === "active" &&\s*\n?\s*\(price\.planKey === "pro_monthly" \|\| price\.planKey === "pro_yearly"\)/,
    );
  });

  it('gates the driver-branch cleanup call on !driverProActive, not the legacy isActive variable', () => {
    const src = SRC();
    const start = src.indexOf('const driverProActive');
    const branch = src.slice(start, src.indexOf('Driver entitlement applied', start));
    expect(branch).toMatch(/if \(!driverProActive\) \{[\s\S]*?endDirectAssistantAccess\(supabase, entityKey\)/);
    // The cleanup must never sit inside an `else` of the broader isActive check.
    expect(branch).not.toMatch(/\} else \{[\s\S]*?endDirectAssistantAccess/);
  });

  it('keeps the legacy isActive billing-state meaning unchanged', () => {
    expect(SRC()).toMatch(
      /const isActive = status === "active" \|\| status === "trialing" \|\| status === "past_due";/,
    );
  });

  it('still ends direct assistant access on terminal revoke', () => {
    const src = SRC();
    const revoke = src.slice(src.indexOf('async function applyRevoke'));
    expect(revoke).toMatch(/endDirectAssistantAccess\(supabase, entityKey\)/);
  });
});

// -------------------------------------------------------------------------
// DA-1 dashboard-context sanitation — assistant mode must not mount widgets
// bound to the SIGNED-IN user's own personal driver state.
// -------------------------------------------------------------------------
const tierUpSpy = vi.fn();

vi.mock('@/hooks/useTierUpDetector', () => ({ useTierUpDetector: () => tierUpSpy() }));
vi.mock('@/hooks/useCostProfile', () => ({
  useCostProfile: () => ({ profile: null }),
  computeCostProfileCPM: () => ({ cpm: 0, warnings: [] }),
  profileHasUsableData: () => false,
}));
vi.mock('@/components/DriverIntelligenceCard', () => ({
  DriverIntelligenceCard: () => <div data-testid="w-driver-intelligence" />,
}));
vi.mock('@/components/DriverLeaderboardCard', () => ({
  DriverLeaderboardCard: () => <div data-testid="w-leaderboard" />,
}));
vi.mock('@/components/HomeTimeDashboardCard', () => ({
  HomeTimeDashboardCard: () => <div data-testid="w-home-time" />,
}));
vi.mock('@/components/WeeklyPulseCard', () => ({
  WeeklyPulseCard: () => <div data-testid="w-weekly-pulse" />,
}));
vi.mock('@/components/PersonalIntelligenceBlocks', () => ({
  PersonalIntelligenceBlocks: () => <div data-testid="w-personal-intel" />,
}));
vi.mock('@/components/ProTimeSavedCard', () => ({
  ProTimeSavedCard: () => <div data-testid="w-time-saved" />,
}));
vi.mock('@/components/ProInsightCard', () => ({
  ProInsightCard: () => <div data-testid="w-pro-insight" />,
}));
vi.mock('@/components/SmartAlertsCard', () => ({
  SmartAlertsCard: () => <div data-testid="w-smart-alerts" />,
}));
vi.mock('@/components/TaxReminderBanner', () => ({
  TaxReminderBanner: () => <div data-testid="w-tax-reminder" />,
}));
vi.mock('@/components/WeeklyFocusCard', () => ({
  WeeklyFocusCard: () => <div data-testid="w-weekly-focus" />,
}));
vi.mock('@/components/SmartLoadAdvisor', () => ({
  SmartLoadAdvisor: () => <div data-testid="w-load-advisor" />,
}));
vi.mock('@/components/ContributionMarginCard', () => ({
  ContributionMarginCard: () => <div data-testid="w-contribution-margin" />,
}));
vi.mock('@/components/FuelAnalyticsCard', () => ({
  FuelAnalyticsCard: () => <div data-testid="w-fuel-analytics" />,
}));
vi.mock('@/components/TaxEstimateCard', () => ({
  TaxEstimateCard: () => <div data-testid="w-tax-estimate" />,
}));
vi.mock('@/components/premium/ProfitOverviewChart', () => ({
  ProfitOverviewChart: () => <div data-testid="w-profit-overview" />,
}));
vi.mock('@/components/premium/ExpenseDonut', () => ({
  ExpenseDonut: () => <div data-testid="w-expense-donut" />,
}));
vi.mock('@/components/premium/DriverScoreGauge', () => ({
  DriverScoreGauge: () => <div data-testid="w-score-gauge" />,
}));
vi.mock('@/components/premium/RecentLoadsPanel', () => ({
  RecentLoadsPanel: () => <div data-testid="w-recent-loads" />,
}));
vi.mock('@/components/premium/ProfitByLoadTable', () => ({
  ProfitByLoadTable: () => <div data-testid="w-profit-by-load" />,
}));
vi.mock('@/components/premium/DashboardFooterCTA', () => ({
  DashboardFooterCTA: () => <div data-testid="w-footer-cta" />,
}));

import { DashboardView } from '@/components/DashboardView';

const PERSONAL_WIDGETS = [
  'w-driver-intelligence',
  'w-leaderboard',
  'w-home-time',
  'w-weekly-pulse',
  'w-personal-intel',
  'w-time-saved',
  'w-pro-insight',
  'w-smart-alerts',
  'w-tax-reminder',
  'w-footer-cta',
];

const CORE_WIDGETS = [
  'dashboard-metrics',
  'w-profit-overview',
  'w-expense-donut',
  'w-score-gauge',
  'w-recent-loads',
  'w-profit-by-load',
  'w-contribution-margin',
  'w-fuel-analytics',
  'w-tax-estimate',
  'w-weekly-focus',
  'w-load-advisor',
];

const dashboardProps: any = {
  loads: [{ ...LOAD, updated_at: '2026-01-06T00:00:00.000Z' }],
  expenses: [],
  fuelLogs: [],
  isLoading: false,
  onNavigate: () => {},
  smartAlerts: { alerts: [], dismissAlert: { mutate: () => {} } },
  isPro: true,
};

describe('DA-1 · dashboard assistant-context sanitation', () => {
  it('Index passes isAssistantView={isActingAsAssistant} to DashboardView', () => {
    const INDEX = read('src/pages/Index.tsx');
    const block = INDEX.slice(INDEX.indexOf('<DashboardView'));
    const jsx = block.slice(0, block.indexOf('/>'));
    expect(jsx).toMatch(/isAssistantView=\{isActingAsAssistant\}/);
  });

  it('self mode renders every personal widget/control and the action zone', () => {
    tierUpSpy.mockClear();
    render(<DashboardView {...dashboardProps} />);
    for (const id of PERSONAL_WIDGETS) expect(screen.queryByTestId(id)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Finalize Weekly Summary/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Parking$/i })).toBeTruthy();
  });

  it('runs useTierUpDetector in self mode only', () => {
    tierUpSpy.mockClear();
    render(<DashboardView {...dashboardProps} />);
    expect(tierUpSpy).toHaveBeenCalled();

    tierUpSpy.mockClear();
    render(<DashboardView {...dashboardProps} isAssistantView />);
    expect(tierUpSpy).not.toHaveBeenCalled();
  });

  it('assistant mode mounts none of the signed-in-user personal widgets/controls', () => {
    render(<DashboardView {...dashboardProps} isAssistantView />);
    for (const id of PERSONAL_WIDGETS) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.queryByRole('button', { name: /Finalize Weekly Summary/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Parking$/i })).toBeNull();
  });

  it('assistant mode keeps the managed-driver KPI/chart surfaces', () => {
    render(<DashboardView {...dashboardProps} isAssistantView />);
    for (const id of CORE_WIDGETS) expect(screen.queryByTestId(id)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /This Week/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /View Reports/i })).toBeTruthy();
  });
});
