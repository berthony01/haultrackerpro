/**
 * Phase 1J-C2B — CapabilityLauncher still exposes Driver, Recruiter,
 * Assistant Access, and Agency Workspace tiles. C2B navigation additions
 * MUST NOT alter the launcher.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CapabilityLauncher from '@/pages/CapabilityLauncher';

describe('Phase 1J-C2B — CapabilityLauncher tiles intact', () => {
  it('renders all four capability tiles', () => {
    render(
      <MemoryRouter>
        <CapabilityLauncher />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Track my trucking business/i)).toBeInTheDocument();
    expect(screen.getByText(/Post driver opportunities/i)).toBeInTheDocument();
    expect(screen.getByText(/Help drivers as an assistant/i)).toBeInTheDocument();
    expect(screen.getByText(/Build a back-office agency/i)).toBeInTheDocument();
  });

  it('exposes all four capability data attributes', () => {
    const { container } = render(
      <MemoryRouter>
        <CapabilityLauncher />
      </MemoryRouter>,
    );
    for (const id of ['driver', 'recruiter', 'assistant', 'agency']) {
      expect(container.querySelector(`[data-capability="${id}"]`)).not.toBeNull();
    }
  });
});
