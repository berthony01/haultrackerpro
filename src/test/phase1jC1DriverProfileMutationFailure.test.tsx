// Phase 1J-C1 — Isolated proof that the REAL DriverOpportunityProfile
// component NEVER invokes the parent-supplied `onSaveSuccess` when
// `useDriverOpportunityProfile().upsertProfile.mutate` invokes `onError`.
//
// Narrow scope: renders ONLY DriverOpportunityProfile. Top-level mocks
// for the profile hook, useAuth, and sonner. Uses fireEvent (no per-char
// typing). No sleeps, no dynamic imports, no background processes.

import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Radix pointer-capture polyfill for jsdom.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as any;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

// Shared spies live on globalThis so hoisted vi.mock factories can call
// them without hitting the "cannot access before initialization" hoisting
// order issue.
declare global {
  // eslint-disable-next-line no-var
  var __c1_mutate: (payload: any, opts: any) => void;
  // eslint-disable-next-line no-var
  var __c1_toast_error: (m: string) => void;
  // eslint-disable-next-line no-var
  var __c1_toast_success: (m: string) => void;
}

vi.mock('@/hooks/opportunities/useDriverOpportunityProfile', () => ({
  useDriverOpportunityProfile: () => ({
    profile: null,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    upsertProfile: {
      mutate: (payload: any, opts: any) => globalThis.__c1_mutate(payload, opts),
      isPending: false,
    },
    deleteProfile: { mutate: () => {}, isPending: false },
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u-iso', email: 'iso@example.com', user_metadata: {} },
  }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, {
    success: (m: string) => globalThis.__c1_toast_success(m),
    error: (m: string) => globalThis.__c1_toast_error(m),
    message: () => {},
  }),
}));

// Import AFTER mocks so the real component binds to the mocked hooks.
import { DriverOpportunityProfile } from '@/components/opportunities/DriverOpportunityProfile';

const mutateMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
globalThis.__c1_mutate = (p, o) => mutateMock(p, o);
globalThis.__c1_toast_error = (m) => toastError(m);
globalThis.__c1_toast_success = (m) => toastSuccess(m);

function renderPrefs(handlers: {
  onBack?: () => void;
  onSaveSuccess?: (r: { completed: boolean }) => void;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DriverOpportunityProfile
        onBack={handlers.onBack ?? (() => {})}
        onSaveSuccess={handlers.onSaveSuccess}
      />
    </QueryClientProvider>,
  );
}

function fillPartial() {
  const nameInput = screen.getByPlaceholderText('John Doe') as HTMLInputElement;
  const emailInput = screen.getByPlaceholderText('you@example.com') as HTMLInputElement;
  fireEvent.change(nameInput, { target: { value: 'Jane Driver' } });
  fireEvent.change(emailInput, { target: { value: 'jane@example.com' } });
}

beforeEach(() => {
  mutateMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe('Phase 1J-C1 — DriverOpportunityProfile REAL mutation-failure contract', () => {
  it('mutation onError never calls onSaveSuccess and surfaces the error via toast', () => {
    mutateMock.mockImplementation((_payload: any, opts: any) => {
      opts?.onError?.(new Error('network down'));
    });

    const onSaveSuccess = vi.fn();
    const onBack = vi.fn();
    renderPrefs({ onSaveSuccess, onBack });
    fillPartial();

    fireEvent.click(screen.getByRole('button', { name: /Save Preferences/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const [payload, opts] = mutateMock.mock.calls[0];
    expect(payload).toBeTypeOf('object');
    expect(payload.full_name).toBe('Jane Driver');
    expect(payload.email).toBe('jane@example.com');
    expect(typeof opts.onError).toBe('function');
    expect(typeof opts.onSuccess).toBe('function');

    expect(toastError).toHaveBeenCalledWith('network down');
    expect(onSaveSuccess).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('control: mutation onSuccess calls onSaveSuccess exactly once with {completed:false} for a partial form', () => {
    mutateMock.mockImplementation((_payload: any, opts: any) => {
      opts?.onSuccess?.();
    });

    const onSaveSuccess = vi.fn();
    const onBack = vi.fn();
    renderPrefs({ onSaveSuccess, onBack });
    fillPartial();

    fireEvent.click(screen.getByRole('button', { name: /Save Preferences/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(onSaveSuccess).toHaveBeenCalledTimes(1);
    expect(onSaveSuccess).toHaveBeenCalledWith({ completed: false });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });
});
