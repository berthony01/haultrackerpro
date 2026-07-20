import React from 'react';

/**
 * Phase 1J-DIAG — Preview-only render diagnostic surface.
 *
 * On diagnostic preview hosts (localhost / 127.0.0.1 / id-preview--*.lovable.app /
 * lovable.dev editor), an uncaught render exception is shown with enough detail
 * (message, JS stack, React component stack, path, build id) to isolate the
 * exact cause without a round-trip through the user.
 *
 * On all other hosts (including the published haultrackerpro.lovable.app), the
 * fallback preserves the previous generic copy and Reload button. No message,
 * stack, path, or diagnostic id is ever rendered on production hosts.
 *
 * The sanitized diagnostic object is also persisted to sessionStorage under
 * `htp:last-render-error` so a subsequent inspection can retrieve the last
 * crash. Tokens, cookies, storage payloads, and PII are never included.
 */

// --------------------------------------------------------------------------
// Pure helpers (exported for tests).
// --------------------------------------------------------------------------

export const DIAGNOSTIC_SESSION_KEY = 'htp:last-render-error';
export const STACK_CAP = 8000;

/**
 * Return true only for hosts where exposing a render stack is safe:
 *   - localhost / 127.0.0.1
 *   - id-preview--*.lovable.app (Lovable ephemeral preview)
 *   - *.lovable.dev editor/preview hosts
 * Explicitly false for the published haultrackerpro.lovable.app apex/subdomain
 * and every unrelated host.
 */
export function isDiagnosticPreviewHost(hostname: string | null | undefined): boolean {
  if (typeof hostname !== 'string' || hostname.length === 0) return false;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1') return true;
  if (h.endsWith('.lovable.dev') || h === 'lovable.dev') return true;
  if (h.endsWith('.lovable.app')) {
    // Only ephemeral id-preview--* subdomains are diagnostic.
    return h.startsWith('id-preview--');
  }
  return false;
}

/** Truncate a string to `cap` chars, appending a marker if truncated. */
export function truncateStack(input: unknown, cap: number = STACK_CAP): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  if (input.length <= cap) return input;
  return input.slice(0, cap) + `\n…[truncated ${input.length - cap} chars]`;
}

/**
 * Deterministic, non-cryptographic short id derived from message + first stack
 * line + pathname. Same input → same id. Different message/path → different id.
 * djb2 variant, 32-bit, base36 encoded.
 */
export function computeDiagnosticId(
  message: string | null | undefined,
  stack: string | null | undefined,
  pathname: string | null | undefined,
): string {
  const firstStackLine = typeof stack === 'string' ? (stack.split('\n')[0] ?? '') : '';
  const source = `${message ?? ''}\u0001${firstStackLine}\u0001${pathname ?? ''}`;
  let hash = 5381;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
  }
  const unsigned = hash >>> 0;
  return unsigned.toString(36).padStart(7, '0');
}

export interface SanitizedDiagnostic {
  name: string;
  message: string;
  stack: string;
  componentStack: string;
  href: string;
  pathname: string;
  userAgent: string;
  timestamp: string;
  buildId: string;
  diagnosticId: string;
}

function readBuildId(): string {
  try {
    // Access via bracket lookups so a missing key is `undefined`, not a throw.
    const env = (import.meta as any)?.env ?? {};
    const v =
      env.VITE_GIT_SHA ||
      env.VITE_BUILD_SHA ||
      env.VITE_COMMIT_SHA;
    if (typeof v === 'string' && v.length > 0) return v;
  } catch {
    // ignore
  }
  return 'unknown';
}

export function buildSanitizedDiagnostic(
  error: unknown,
  componentStack: string | null | undefined,
  loc: { href: string; pathname: string } | null,
  userAgent: string,
  now: Date = new Date(),
): SanitizedDiagnostic {
  const errObj = (error && typeof error === 'object' ? (error as any) : {}) as {
    name?: unknown;
    message?: unknown;
    stack?: unknown;
  };
  const name =
    typeof errObj.name === 'string' && errObj.name.length > 0 ? errObj.name : 'Error';
  const message =
    typeof errObj.message === 'string'
      ? errObj.message
      : typeof error === 'string'
      ? error
      : '';
  const stack = truncateStack(errObj.stack);
  const cStack = truncateStack(componentStack);
  const href = loc?.href ?? '';
  const pathname = loc?.pathname ?? '';
  const buildId = readBuildId();
  return {
    name,
    message,
    stack,
    componentStack: cStack,
    href,
    pathname,
    userAgent,
    timestamp: now.toISOString(),
    buildId,
    diagnosticId: computeDiagnosticId(message, stack, pathname),
  };
}

function safeReadLocation(): { href: string; pathname: string } | null {
  try {
    if (typeof window === 'undefined' || !window.location) return null;
    return { href: window.location.href, pathname: window.location.pathname };
  } catch {
    return null;
  }
}

function safeReadUserAgent(): string {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
      return navigator.userAgent;
    }
  } catch {
    // ignore
  }
  return '';
}

function safeReadHostname(): string {
  try {
    if (typeof window !== 'undefined' && window.location) return window.location.hostname;
  } catch {
    // ignore
  }
  return '';
}

function safePersistDiagnostic(payload: SanitizedDiagnostic): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(DIAGNOSTIC_SESSION_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be disabled/full/blocked — never let it break the fallback.
  }
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  diagnostic: SanitizedDiagnostic | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, diagnostic: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Only the error object here; component stack arrives in componentDidCatch.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Preserve existing signal.
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info.componentStack);
    const diagnostic = buildSanitizedDiagnostic(
      error,
      info?.componentStack ?? '',
      safeReadLocation(),
      safeReadUserAgent(),
    );
    safePersistDiagnostic(diagnostic);
    this.setState({ diagnostic });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const diagnostic =
      this.state.diagnostic ??
      buildSanitizedDiagnostic(
        this.state.error,
        '',
        safeReadLocation(),
        safeReadUserAgent(),
      );
    const isPreview = isDiagnosticPreviewHost(safeReadHostname());
    return (
      <ErrorFallback diagnostic={diagnostic} isPreview={isPreview} />
    );
  }
}

// --------------------------------------------------------------------------
// Fallback UI (functional; safe under repeated renders)
// --------------------------------------------------------------------------

function ErrorFallback({
  diagnostic,
  isPreview,
}: {
  diagnostic: SanitizedDiagnostic;
  isPreview: boolean;
}) {
  const [copied, setCopied] = React.useState<'idle' | 'ok' | 'fail'>('idle');

  const onReload = () => {
    try {
      window.location.reload();
    } catch {
      // no-op
    }
  };

  const onCopy = () => {
    let payload = '';
    try {
      payload = JSON.stringify(diagnostic, null, 2);
    } catch {
      payload = `${diagnostic.name}: ${diagnostic.message}`;
    }
    try {
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      const cb = nav && nav.clipboard && typeof nav.clipboard.writeText === 'function'
        ? nav.clipboard.writeText(payload)
        : null;
      if (cb && typeof cb.then === 'function') {
        cb.then(
          () => setCopied('ok'),
          () => setCopied('fail'),
        );
      } else {
        setCopied('fail');
      }
    } catch {
      setCopied('fail');
    }
  };

  if (!isPreview) {
    // Production/user-facing: unchanged copy.
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-sm">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-lg font-bold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            An unexpected error occurred. Tap below to reload.
          </p>
          <button
            onClick={onReload}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
          >
            Reload App
          </button>
        </div>
      </div>
    );
  }

  // Diagnostic preview surface.
  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-6 overflow-auto">
      <div className="w-full max-w-3xl space-y-4 text-left">
        <div>
          <h1 className="text-lg font-bold text-foreground">Preview render diagnostic</h1>
          <p className="text-xs text-muted-foreground">
            Shown only on Lovable preview/localhost. Not visible on the published site.
          </p>
        </div>

        <div className="rounded-md border border-border bg-card p-3 text-sm space-y-1">
          <div>
            <span className="font-semibold">{diagnostic.name}</span>
            {diagnostic.message ? `: ${diagnostic.message}` : ''}
          </div>
          <div className="text-xs text-muted-foreground">
            path: <code>{diagnostic.pathname || '(unknown)'}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            build: <code>{diagnostic.buildId}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            id: <code data-testid="diagnostic-id">{diagnostic.diagnosticId}</code>
          </div>
        </div>

        <details className="rounded-md border border-border bg-card p-3 text-xs">
          <summary className="cursor-pointer font-semibold">JavaScript stack</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-snug">
{diagnostic.stack || '(no stack)'}
          </pre>
        </details>

        <details className="rounded-md border border-border bg-card p-3 text-xs">
          <summary className="cursor-pointer font-semibold">React component stack</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-snug">
{diagnostic.componentStack || '(no component stack)'}
          </pre>
        </details>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onCopy}
            className="px-3 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium"
          >
            Copy Diagnostic Details
          </button>
          <button
            onClick={onReload}
            className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
          >
            Reload App
          </button>
          {copied === 'ok' && (
            <span className="text-xs text-muted-foreground self-center">Copied.</span>
          )}
          {copied === 'fail' && (
            <span className="text-xs text-muted-foreground self-center">
              Copy unavailable — select the panel text manually.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
