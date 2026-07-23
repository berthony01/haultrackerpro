/**
 * Phase 1N-A — Historical Load-Date Integrity.
 *
 * Behavior-focused tests for LoadForm's local-calendar-safe date defaults,
 * pickup-date shortcuts, reporting-date summary, and the untouched-today
 * confirmation guard for new completed loads.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { format, subDays } from 'date-fns';

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

vi.mock('@/components/SmartChips', () => ({
  SmartChips: () => null,
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

const TODAY = format(new Date(), 'yyyy-MM-dd');
const THREE_DAYS_AGO = format(subDays(new Date(), 3), 'yyyy-MM-dd');

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/pickup/i, { selector: 'input#pickup_location' }), {
    target: { value: 'Dallas, TX' },
  });
  fireEvent.change(screen.getByLabelText(/drop-off/i, { selector: 'input#dropoff_location' }), {
    target: { value: 'Atlanta, GA' },
  });
  fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '500' } });
  // rate per mile — find by role=spinbutton isn't reliable; use placeholder scan.
  const numInputs = document.querySelectorAll('input[inputmode="decimal"]') as NodeListOf<HTMLInputElement>;
  // Set rate_per_mile (2nd decimal input in the layout).
  // Deterministic: find by id.
  (document.getElementById('rate_per_mile') as HTMLInputElement | null)?.setAttribute('value', '2.5');
  const rate = document.getElementById('rate_per_mile') as HTMLInputElement | null;
  if (rate) fireEvent.change(rate, { target: { value: '2.5' } });
  // fallback: if not found by id, fill first empty decimal.
  if (!rate) {
    for (const el of Array.from(numInputs)) {
      if (!el.value) { fireEvent.change(el, { target: { value: '2.5' } }); break; }
    }
  }
}

function renderNew(onSubmit = vi.fn()) {
  const utils = render(<LoadForm onSubmit={onSubmit} />);
  return { onSubmit, ...utils };
}

describe('Phase 1N-A — historical load-date integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. initializes Pickup Date to local today (not a UTC-shifted date)', () => {
    renderNew();
    const trigger = document.getElementById('load_date') as HTMLElement;
    expect(trigger).toBeTruthy();
    // DateInput renders MM/DD/YYYY label for the ISO value.
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
    // Confirmation panel dismissed and Pickup trigger has focus.
    expect(screen.queryByTestId('today-confirm-panel')).toBeNull();
    expect(document.activeElement?.id).toBe('load_date');
  });

  it('6. Save as Today acknowledges → next submit calls onSubmit once with today', () => {
    const { onSubmit } = renderNew();
    fillRequired();
    fireEvent.click(screen.getByTestId('load-form-submit'));
    fireEvent.click(screen.getByRole('button', { name: /save as today/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    // Second submit passes cleanly.
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.load_date).toBe(TODAY);
    expect(payload.dropoff_date).toBe(TODAY);
    // 11. Payload does not carry created_at/updated_at manipulation.
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

  it('8. new pending load never receives the completed-today warning', () => {
    const { onSubmit } = renderNew();
    fillRequired();
    // Flip the "Save as Pending" switch → finalStatus becomes 'pending'.
    const pendingSwitch = screen.getByRole('switch', { name: /save as pending/i });
    fireEvent.click(pendingSwitch);
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(screen.queryByTestId('today-confirm-panel')).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].status).toBe('pending');
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
    // Enable multi-stop.
    const multiSwitch = screen.getByRole('switch', { name: /multi-stop load/i });
    fireEvent.click(multiSwitch);
    // Add one interior stop with no stop_date via mocked editor.
    fireEvent.click(screen.getByTestId('mock-add-stop'));
    // Acknowledge the today-untouched guard first (it fires before multi-stop
    // check because pickup date is still auto-filled today).
    fireEvent.click(screen.getByTestId('load-form-submit'));
    if (screen.queryByTestId('today-confirm-panel')) {
      fireEvent.click(screen.getByRole('button', { name: /save as today/i }));
    }
    // First submit after today-ack triggers multi-stop drop warning (returns).
    fireEvent.click(screen.getByTestId('load-form-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    // Second submit acknowledges drop warning and proceeds.
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
});
