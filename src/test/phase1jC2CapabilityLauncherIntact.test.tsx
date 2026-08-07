/**
 * Phase 1J-C2B — CapabilityLauncher still exposes Driver, Recruiter,
 * Assistant Access, and Agency Workspace tiles. C2B navigation additions
 * MUST NOT alter the launcher.
 *
 * Phase 1S-A8 — the launcher additionally records a transient workspace
 * intent (`htp_workspace_intent`) before navigating. Preference hint only.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import fs from 'node:fs';
import path from 'node:path';
import CapabilityLauncher from '@/pages/CapabilityLauncher';

const INTENT_KEY = 'htp_workspace_intent';

function renderLauncher() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <CapabilityLauncher />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

function clickTile(container: HTMLElement, id: string) {
  const el = container.querySelector(`[data-capability="${id}"]`) as HTMLElement | null;
  expect(el).not.toBeNull();
  fireEvent.click(el as HTMLElement);
}

describe('Phase 1J-C2B — CapabilityLauncher tiles intact', () => {
  it('renders all four capability tiles', () => {
    renderLauncher();
    expect(screen.getByText(/Track my trucking business/i)).toBeInTheDocument();
    expect(screen.getByText(/Post driver opportunities/i)).toBeInTheDocument();
    expect(screen.getByText(/Help drivers as an assistant/i)).toBeInTheDocument();
    expect(screen.getByText(/Build a back-office agency/i)).toBeInTheDocument();
  });

  it('exposes all four capability data attributes', () => {
    const { container } = renderLauncher();
    for (const id of ['driver', 'recruiter', 'assistant', 'agency']) {
      expect(container.querySelector(`[data-capability="${id}"]`)).not.toBeNull();
    }
  });
});

describe('Phase 1S-A8 — /start workspace intent persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('clicking Driver writes htp_workspace_intent=driver', () => {
    const { container } = renderLauncher();
    clickTile(container, 'driver');
    expect(sessionStorage.getItem(INTENT_KEY)).toBe('driver');
  });

  it('clicking Recruiter writes htp_workspace_intent=recruiter', () => {
    const { container } = renderLauncher();
    clickTile(container, 'recruiter');
    expect(sessionStorage.getItem(INTENT_KEY)).toBe('recruiter');
  });

  it('clicking Assistant clears a stale workspace intent', () => {
    sessionStorage.setItem(INTENT_KEY, 'recruiter');
    const { container } = renderLauncher();
    clickTile(container, 'assistant');
    expect(sessionStorage.getItem(INTENT_KEY)).toBeNull();
  });

  it('clicking Agency clears a stale workspace intent', () => {
    sessionStorage.setItem(INTENT_KEY, 'driver');
    const { container } = renderLauncher();
    clickTile(container, 'agency');
    expect(sessionStorage.getItem(INTENT_KEY)).toBeNull();
  });

  it('launcher does not import billing, Supabase, or role authorization', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/CapabilityLauncher.tsx'),
      'utf8',
    );
    const specs = Array.from(src.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
    for (const spec of specs) {
      expect(spec).not.toMatch(/supabase/i);
      expect(spec).not.toMatch(/billing/i);
      expect(spec).not.toMatch(/subscription/i);
      expect(spec).not.toMatch(/stripe/i);
      expect(spec).not.toMatch(/useUserRole|useAdmin|workspaceAccess/);
    }
  });
});

describe('Phase 1S-A8 — Auth.tsx uses the same workspace intent contract', () => {
  const authSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/Auth.tsx'),
    'utf8',
  );

  it('writes the exact htp_workspace_intent key', () => {
    expect(authSrc).toMatch(/sessionStorage\.setItem\(\s*'htp_workspace_intent'/);
    expect(authSrc).toMatch(/sessionStorage\.removeItem\(\s*'htp_workspace_intent'\s*\)/);
  });

  it('driver/recruiter set it and other capabilities clear it', () => {
    expect(authSrc).toMatch(
      /capability === 'driver' \|\| capability === 'recruiter'/,
    );
  });

  it('preserves the existing htp_auth_intent recruiter reconciliation', () => {
    expect(authSrc).toMatch(/sessionStorage\.setItem\('htp_auth_intent', 'recruiter'\)/);
    expect(authSrc).toMatch(/sessionStorage\.removeItem\('htp_auth_intent'\)/);
  });
});
