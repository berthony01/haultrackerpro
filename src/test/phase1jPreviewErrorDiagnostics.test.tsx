/**
 * Phase 1J-DIAG — Preview-only ErrorBoundary diagnostic surface.
 *
 * Proves:
 *  - Preview hosts render `Preview render diagnostic` with message, path,
 *    build fallback, JS stack, component stack, and a stable diagnostic id.
 *  - Production hosts render the exact generic screen and expose nothing.
 *  - Host classifier matches the required matrix.
 *  - Sanitizer caps both stacks at 8_000 chars and includes no auth/PII.
 *  - sessionStorage failure and clipboard failure never break the fallback.
 *  - Deterministic id is stable / changes as required.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import {
  ErrorBoundary,
  DIAGNOSTIC_SESSION_KEY,
  STACK_CAP,
  isDiagnosticPreviewHost,
  truncateStack,
  computeDiagnosticId,
  buildSanitizedDiagnostic,
} from '@/components/ErrorBoundary';

// --------------------------------------------------------------------------
// Host manipulation helper. jsdom's window.location is writable via delete +
// reassign of individual props via defineProperty; we replace `hostname`.
// --------------------------------------------------------------------------

function setHostname(hostname: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      hostname,
      href: `http://${hostname}/dashboard`,
      pathname: '/dashboard',
      reload: () => {},
    },
  });
}

const Boom: React.FC<{ msg?: string }> = ({ msg = 'diagnostic-boom' }) => {
  throw new Error(msg);
};

// Silence expected React error logging during throw tests.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

// --------------------------------------------------------------------------
// 1–2. ErrorBoundary catches; preview host shows diagnostic surface.
// --------------------------------------------------------------------------

describe('ErrorBoundary — preview host', () => {
  beforeEach(() => setHostname('localhost'));

  it('catches a child render throw and shows the diagnostic panel', () => {
    render(
      <ErrorBoundary>
        <Boom msg="preview-panel-msg" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Preview render diagnostic')).toBeInTheDocument();
    expect(screen.getByText(/preview-panel-msg/)).toBeInTheDocument();
    expect(screen.getByText('JavaScript stack')).toBeInTheDocument();
    expect(screen.getByText('React component stack')).toBeInTheDocument();
    // path + build fallback
    expect(screen.getByText(/\/dashboard/)).toBeInTheDocument();
    expect(screen.getByText(/unknown|[0-9a-f]{6,}/i)).toBeInTheDocument();
    // deterministic id is rendered
    expect(screen.getByTestId('diagnostic-id').textContent?.length ?? 0).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// 3. Production host shows only generic copy.
// --------------------------------------------------------------------------

describe('ErrorBoundary — production host', () => {
  beforeEach(() => setHostname('haultrackerpro.lovable.app'));

  it('renders only the generic screen and exposes no message/stack/path', () => {
    render(
      <ErrorBoundary>
        <Boom msg="production-secret-msg" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText(/An unexpected error occurred\. Tap below to reload\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload App' })).toBeInTheDocument();
    // Diagnostic surface must not leak.
    expect(screen.queryByText('Preview render diagnostic')).toBeNull();
    expect(screen.queryByText(/production-secret-msg/)).toBeNull();
    expect(screen.queryByText('JavaScript stack')).toBeNull();
    expect(screen.queryByText('React component stack')).toBeNull();
    expect(screen.queryByTestId('diagnostic-id')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// 4–6. Host classifier matrix.
// --------------------------------------------------------------------------

describe('isDiagnosticPreviewHost', () => {
  it('accepts id-preview--*.lovable.app', () => {
    expect(isDiagnosticPreviewHost('id-preview--abc.lovable.app')).toBe(true);
    expect(
      isDiagnosticPreviewHost('id-preview--6d28fa14-57dc-418b.lovable.app'),
    ).toBe(true);
  });

  it('rejects haultrackerpro.lovable.app (published)', () => {
    expect(isDiagnosticPreviewHost('haultrackerpro.lovable.app')).toBe(false);
    expect(isDiagnosticPreviewHost('www.haultrackerpro.com')).toBe(false);
    expect(isDiagnosticPreviewHost('haultrackerpro.com')).toBe(false);
  });

  it('accepts localhost and 127.0.0.1', () => {
    expect(isDiagnosticPreviewHost('localhost')).toBe(true);
    expect(isDiagnosticPreviewHost('127.0.0.1')).toBe(true);
  });

  it('rejects unrelated .lovable.app hosts (no id-preview-- prefix)', () => {
    expect(isDiagnosticPreviewHost('random.lovable.app')).toBe(false);
    expect(isDiagnosticPreviewHost('some-other-app.lovable.app')).toBe(false);
  });

  it('accepts lovable.dev editor hosts, rejects empty/undefined', () => {
    expect(isDiagnosticPreviewHost('lovable.dev')).toBe(true);
    expect(isDiagnosticPreviewHost('preview.lovable.dev')).toBe(true);
    expect(isDiagnosticPreviewHost('')).toBe(false);
    expect(isDiagnosticPreviewHost(null)).toBe(false);
    expect(isDiagnosticPreviewHost(undefined)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 7. Sanitizer stack cap.
// --------------------------------------------------------------------------

describe('truncateStack / buildSanitizedDiagnostic', () => {
  it('caps stacks at STACK_CAP (8000) and appends a truncation marker', () => {
    const huge = 'x'.repeat(STACK_CAP + 500);
    const out = truncateStack(huge);
    expect(out.startsWith('x'.repeat(STACK_CAP))).toBe(true);
    expect(out.length).toBeGreaterThan(STACK_CAP);
    expect(out).toMatch(/\[truncated \d+ chars\]/);
  });

  it('leaves short stacks unchanged and handles non-strings safely', () => {
    expect(truncateStack('short')).toBe('short');
    expect(truncateStack(undefined)).toBe('');
    expect(truncateStack(null)).toBe('');
    expect(truncateStack(123 as any)).toBe('');
  });

  it('sanitized diagnostic caps both stacks and includes no PII/token/storage fields', () => {
    const err = new Error('big-err');
    err.stack = 'y'.repeat(STACK_CAP + 100);
    const componentStack = 'z'.repeat(STACK_CAP + 100);
    const d = buildSanitizedDiagnostic(
      err,
      componentStack,
      { href: 'http://localhost/dashboard', pathname: '/dashboard' },
      'jsdom/1.0',
    );
    expect(d.stack.length).toBeGreaterThan(STACK_CAP);
    expect(d.stack).toMatch(/\[truncated \d+ chars\]/);
    expect(d.componentStack.length).toBeGreaterThan(STACK_CAP);
    expect(d.componentStack).toMatch(/\[truncated \d+ chars\]/);
    // Explicitly forbidden fields must not exist on the payload.
    const keys = Object.keys(d);
    for (const forbidden of [
      'cookie',
      'cookies',
      'token',
      'accessToken',
      'refreshToken',
      'session',
      'authorization',
      'localStorage',
      'sessionStorage',
      'email',
      'phone',
      'userId',
      'user_id',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(d.buildId).toBe('unknown'); // no VITE_*_SHA set in tests
    expect(d.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// --------------------------------------------------------------------------
// 8–9. sessionStorage persistence + failure safety.
// --------------------------------------------------------------------------

describe('sessionStorage persistence', () => {
  beforeEach(() => setHostname('localhost'));

  it('writes a sanitized object to htp:last-render-error with no token/cookie payloads', () => {
    render(
      <ErrorBoundary>
        <Boom msg="persisted-msg" />
      </ErrorBoundary>,
    );
    const raw = sessionStorage.getItem(DIAGNOSTIC_SESSION_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.message).toBe('persisted-msg');
    expect(parsed.name).toBe('Error');
    expect(typeof parsed.diagnosticId).toBe('string');
    for (const forbidden of [
      'cookie',
      'token',
      'accessToken',
      'refreshToken',
      'session',
      'authorization',
      'localStorage',
      'email',
      'phone',
      'userId',
    ]) {
      expect(Object.keys(parsed)).not.toContain(forbidden);
    }
  });

  it('does not break the fallback when sessionStorage.setItem throws', () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('storage-blocked');
      });
    try {
      render(
        <ErrorBoundary>
          <Boom msg="storage-throws" />
        </ErrorBoundary>,
      );
      // Fallback still renders — proves the throw was swallowed.
      expect(screen.getByText('Preview render diagnostic')).toBeInTheDocument();
      expect(screen.getByText(/storage-throws/)).toBeInTheDocument();
    } finally {
      setItemSpy.mockRestore();
    }
  });
});

// --------------------------------------------------------------------------
// 10. Clipboard unavailability / rejection does not break the fallback.
// --------------------------------------------------------------------------

describe('Copy Diagnostic Details button', () => {
  beforeEach(() => setHostname('localhost'));

  it('remains safe when navigator.clipboard is missing', () => {
    const originalClipboard = (navigator as any).clipboard;
    // Remove clipboard entirely.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    try {
      render(
        <ErrorBoundary>
          <Boom msg="clip-missing" />
        </ErrorBoundary>,
      );
      const btn = screen.getByRole('button', { name: 'Copy Diagnostic Details' });
      expect(() => fireEvent.click(btn)).not.toThrow();
      // Fallback still present.
      expect(screen.getByText('Preview render diagnostic')).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it('remains safe when writeText rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('nope')) },
    });
    render(
      <ErrorBoundary>
        <Boom msg="clip-rejects" />
      </ErrorBoundary>,
    );
    const btn = screen.getByRole('button', { name: 'Copy Diagnostic Details' });
    expect(() => fireEvent.click(btn)).not.toThrow();
    // Give the microtask queue a tick — no unhandled rejection escapes.
    await Promise.resolve();
    expect(screen.getByText('Preview render diagnostic')).toBeInTheDocument();
  });
});

// --------------------------------------------------------------------------
// 11. Deterministic diagnostic id.
// --------------------------------------------------------------------------

describe('computeDiagnosticId', () => {
  it('is stable for the same inputs and changes when message or path differs', () => {
    const a = computeDiagnosticId('boom', 'Error: boom\n  at foo', '/dashboard');
    const a2 = computeDiagnosticId('boom', 'Error: boom\n  at foo', '/dashboard');
    const b = computeDiagnosticId('other', 'Error: boom\n  at foo', '/dashboard');
    const c = computeDiagnosticId('boom', 'Error: boom\n  at foo', '/other');
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    // Non-empty short id.
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThan(32);
  });

  it('tolerates null/undefined inputs without throwing', () => {
    expect(() => computeDiagnosticId(null, null, null)).not.toThrow();
    expect(() => computeDiagnosticId(undefined, undefined, undefined)).not.toThrow();
  });
});
