/**
 * Phase 1N-A — Historical Load-Date Integrity.
 *
 * Behavior-focused tests for LoadForm's local-calendar-safe date defaults,
 * pickup-date shortcuts, reporting-date summary, and the untouched-today
 * confirmation guard for new completed loads.
 *
 * Phase 1N-A-R1 acceptance repair: proves cancelled bypass explicitly,
 * proves Copy Last Load resets touched/acknowledgement state, and looks up
 * switches by accessible name rather than DOM order.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format, subDays } from 'date-fns';

// Radix Switch relies on ResizeObserver which jsdom does not provide.
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? RO;

// Radix Select relies on pointer-capture/scrollIntoView APIs jsdom lacks.
(() => {
  const proto = (globalThis as any).Element?.prototype;
  if (!proto) return;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.scrollIntoView = () => {};
})();

// --- Isolate LoadForm from data hooks / heavy children ---------------------

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: null }),
}));

vi.mock('@/hooks/useCostProfile', () => ({
  useCostProfile: () => ({ profile: null }),
  computeCostProfileCPM: () => ({ cpm: 0, warnings: [] }),
}));

vi.mock('@/hooks/useProfitCheck', () => ({
  useProfitCheck: () => ({ result: null }),
}));

// Narrow SmartChips mock: renders a real Copy Last Load button that calls the
// production onCopyLastLoad prop when a recentLoads entry exists. All other
// SmartChips behavior stays out of scope.
vi.mock('@/components/SmartChips', () => ({
  SmartChips: ({ lastLoad, onCopyLastLoad }: any) =>
    lastLoad ? (
      <button
        type="button"
        data-testid="mock-copy-last-load"
        onClick={onCopyLastLoad}
      >
        Copy Last Load
      </button>
    ) : null,
}));

vi.mock('@/components/PasteLoadParser', () => ({
  PasteLoadParser: () => null,
}));

vi.mock('@/components/ScanLoadModal', () => ({
  ScanLoadModal: () => null,
}));

vi.mock('@/components/ProfitCheckCard', () => ({
  ProfitCheckCard: () => null,
}));

vi.mock('@/components/MultiStopEditor', () => ({
  MultiStopEditor: ({ stops, onChange }: any) => (
    <button
      type="button"
      data-testid="mock-add-stop"
      onClick={() =>
        onChange([
          ...stops,
          {
            stop_order: (stops?.length ?? 0) + 1,
            location: 'Memphis, TN',
            stop_type: 'Stop',
            detention_minutes: null,
            stop_date: null,
          },
        ])
      }
    >
      add stop
    </button>
  ),
}));

// Import AFTER mocks so LoadForm resolves to the mocked deps.
import { LoadForm } from '@/components/LoadForm';
import type { Load } from '@/hooks/useLoads';

const TODAY = format(new Date(), 'yyyy-MM-dd');
const THREE_DAYS_AGO = format(subDays(new Date(), 3), 'yyyy-MM-dd');

function setById(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`missing #${id}`);
  fireEvent.change(el, { target: { value } });
}

function fillRequired() {
  setById('pickup_location', 'Dallas, TX');
  setById('dropoff_location', 'Atlanta, GA');
  setById('loaded_miles', '500');
  setById('rate_per_mile', '2.5');
}

function renderNew(onSubmit = vi.fn(), recentLoads: Load[] = []) {
  const utils = render(<LoadForm onSubmit={onSubmit} recentLoads={recentLoads} />);
  return { onSubmit, ...utils };
}

/** Pick an option from a Radix Select combobox by accessible name. */
async function selectStatus(optionName: RegExp) {
  const user = userEvent.setup();
  const trigger = screen.getByRole('combobox', { name: /status/i });
  await user.click(trigger);
  const option = await screen.findByRole('option', { name: optionName });
  await user.click(option);
}

const RECENT_LOAD_FIXTURE: Load = {
  id: 'last-1',
  user_id: 'u1',
  load_date: THREE_DAYS_AGO,
  dropoff_date: THREE_DAYS_AGO,
  pickup_location: 'Houston, TX',
  dropoff_location: 'Nashville, TN',
  loaded_miles: 780,
  deadhead_miles: 40,
  rate_per_mile: 2.8,
  wait_fee: 0,
  detention_fee: 0,
  other_fees: 0,
  actual_pay_received: null,
  notes: null,
  status: 'completed',
  gross_revenue: null,
  invoice_submitted_date: null,
  pod_submitted_date: null,
  payment_due_date: null,
  paid_date: null,
  short_paid_amount: null,
  payment_status: 'unpaid',
  payment_notes: null,
  pay_model: 'loaded_miles_only',
  total_miles: null,
  flat_rate_amount: null,
  deadhead_rate_per_mile: null,
  broker_id: null,
  estimated_pay: 2184,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
} as unknown as Load;

describe('Phase 1N-A — historical load-date integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. initializes Pickup Date to local today (not a UTC-shifted date)', () => {
    renderNew();
    const trigger = document.getElementById('load_date') as HTMLElement;
    expect(trigger).toBeTruthy();
    const [y, m, d] = TODAY.split('-');
    expect(trigger.textContent).toContain(`${m}/${d}/${y}`);
  });

  it('2. "3 days ago" shortcut sets pickup and mirrors blank dropoff', () => {
    renderNew();
    fireEvent.click(screen.getByRole('button', { name: /set pickup date to 3 days ago/i }));
    const pickup = document.getElementById('load_date') as HTMLElement;
    const drop = document.getElementById('dropoff_date') as HTMLElement;
    const [y, m, d] = THREE_DAYS_AGO.split('-');
    expect(pickup.textContent).toContain(`${m}/${d}/${y}`);
    expect(drop.textContent).toContain(`${m}/${d}/${y}`);
  });

  it('3. reporting summary shows the effective date and required phrasing', () => {
    renderNew();
    fireEvent.click(screen.getByRole('button', { name: /set pickup date to 3 days ago/i }));
    const summary = screen.getByTestId('reporting-date-summary');
    expect(summary.textContent).toMatch(/This load will count toward/);
    expect(summary.textContent).toMatch(/in dashboard totals and reports\./);
    const pretty = format(subDays(new Date(), 3), 'MMMM d, yyyy');
    expect(summary.textContent).toContain(pretty);
  });

  it('4. new completed untouched-today load is blocked on first submit with exact copy', () => {
    const { onSubmit } = renderNew();
    fillRequired();
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    const panel = screen.getByTestId('today-confirm-panel');
    expect(panel.textContent).toContain(
      'This completed load is dated today. Did this load actually happen today?',
    );
    expect(screen.getByRole('button', { name: /change date/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /save as today/i })).toBeTruthy();
  });

  it('5. Change Date keeps submission blocked and focuses Pickup Date input', () => {
    const { onSubmit } = renderNew();
    fillRequired();
    fireEvent.click(screen.getByTestId('load-form-submit'));
    const changeBtn = screen.getByRole('button', { name: /change date/i });
    act(() => { fireEvent.click(changeBtn); });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('today-confirm-panel')).toBeNull();
    const focused = document.activeElement as HTMLElement | null;
    const pickup = document.getElementById('load_date') as HTMLElement;
    const popoverOpen = pickup.getAttribute('data-state') === 'open';
    expect(focused?.id === 'load_date' || popoverOpen || pickup.contains(focused)).toBe(true);
  });

  it('6. Save as Today acknowledges → next submit calls onSubmit once with today', () => {
    const { onSubmit } = renderNew();
    fillRequired();
    fireEvent.click(screen.getByTestId('load-form-submit'));
    fireEvent.click(screen.getByRole('button', { name: /save as today/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.load_date).toBe(TODAY);
    expect(payload.dropoff_date).toBe(TODAY);
    // Payload does not carry created_at/updated_at manipulation.
    expect(payload).not.toHaveProperty('created_at');
    expect(payload).not.toHaveProperty('updated_at');
  });

  it('7. manually selected historical date submits without the today confirmation', () => {
    const { onSubmit } = renderNew();
    fireEvent.click(screen.getByRole('button', { name: /set pickup date to 3 days ago/i }));
    fillRequired();
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(screen.queryByTestId('today-confirm-panel')).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.load_date).toBe(THREE_DAYS_AGO);
    expect(payload.dropoff_date).toBe(THREE_DAYS_AGO);
  });

  it('8. new PENDING load never receives the completed-today warning', () => {
    const { onSubmit } = renderNew();
    fillRequired();
    fireEvent.click(screen.getByRole('switch', { name: /save as pending/i }));
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(screen.queryByTestId('today-confirm-panel')).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].status).toBe('pending');
  });

  it('8b. new CANCELLED load never receives the completed-today warning', async () => {
    const { onSubmit } = renderNew();
    fillRequired();
    await selectStatus(/cancelled/i);
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(screen.queryByTestId('today-confirm-panel')).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].status).toBe('cancelled');
  });

  it('9. edit mode never receives the untouched-today warning', () => {
    const initialData: any = {
      id: 'x',
      load_date: TODAY,
      dropoff_date: TODAY,
      pickup_location: 'Dallas, TX',
      dropoff_location: 'Atlanta, GA',
      loaded_miles: 500,
      deadhead_miles: 0,
      rate_per_mile: 2.5,
      wait_fee: 0,
      detention_fee: 0,
      other_fees: 0,
      status: 'completed',
      pay_model: 'loaded_miles_only',
    };
    const onSubmit = vi.fn();
    render(<LoadForm onSubmit={onSubmit} initialData={initialData} />);
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(screen.queryByTestId('today-confirm-panel')).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('10. multi-stop missing-final-drop warning still fires independently', () => {
    const { onSubmit } = renderNew();
    fillRequired();
    fireEvent.click(screen.getByRole('switch', { name: /multi-stop load/i }));
    fireEvent.click(screen.getByTestId('mock-add-stop'));
    // Acknowledge the today-untouched guard first (it fires before multi-stop
    // check because pickup date is still auto-filled today).
    fireEvent.click(screen.getByTestId('load-form-submit'));
    if (screen.queryByTestId('today-confirm-panel')) {
      fireEvent.click(screen.getByRole('button', { name: /save as today/i }));
    }
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('12. shortcut controls are accessible type=button controls with aria labels', () => {
    renderNew();
    const shortcuts = screen.getByTestId('pickup-date-shortcuts');
    const buttons = shortcuts.querySelectorAll('button');
    expect(buttons.length).toBe(5); // Today, Yesterday, 2d, 3d, Choose
    for (const b of Array.from(buttons)) {
      expect(b.getAttribute('type')).toBe('button');
      expect(b.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('13. Copy Last Load resets touched/ack state → completed-today guard still fires', async () => {
    const { onSubmit } = renderNew(vi.fn(), [RECENT_LOAD_FIXTURE]);

    // 1) Intentionally touch pickup date to a historical value first.
    fireEvent.click(screen.getByRole('button', { name: /set pickup date to 3 days ago/i }));
    const pickup = document.getElementById('load_date') as HTMLElement;
    const [ty, tm, td] = THREE_DAYS_AGO.split('-');
    expect(pickup.textContent).toContain(`${tm}/${td}/${ty}`);

    // 2) Trigger Copy Last Load via the narrow SmartChips mock.
    fireEvent.click(screen.getByTestId('mock-copy-last-load'));

    // 3) Copied form: pickup back to local today, Save as Pending is on.
    const [y, m, d] = TODAY.split('-');
    await waitFor(() => {
      expect(pickup.textContent).toContain(`${m}/${d}/${y}`);
    });
    const pendingSwitch = screen.getByRole('switch', { name: /save as pending/i });
    expect(pendingSwitch.getAttribute('data-state')).toBe('checked');

    // 4) Flip Save as Pending off and set Status = Completed.
    fireEvent.click(pendingSwitch);
    await selectStatus(/completed/i);

    // 5) Submit → completed-today confirmation MUST appear (state was reset).
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('today-confirm-panel')).toBeTruthy();
  });
});
