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
