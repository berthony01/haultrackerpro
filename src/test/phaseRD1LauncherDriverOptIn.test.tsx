import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

const state: any = { isLoading: false, error: null, driverCapabilityStatus: null, activateDriverWorkspacePending: false };
const activate = vi.fn();
vi.mock('@/hooks/useUserCapabilities', () => ({ useUserCapabilities: () => ({ ...state, activateDriverWorkspace: activate }) }));
vi.mock('@/hooks/useActingContext', () => ({ useActingContext: () => ({ exitActingAs: vi.fn() }) }));
import CapabilityLauncher from '@/pages/CapabilityLauncher';

const renderAt = () => render(
  <HelmetProvider><MemoryRouter initialEntries={['/start']}><Routes>
    <Route path="/start" element={<CapabilityLauncher />} />
    <Route path="/dashboard" element={<div>DASHBOARD</div>} />
  </Routes></MemoryRouter></HelmetProvider>);

describe('RD-1 /start driver opt-in', () => {
  beforeEach(() => { activate.mockReset(); state.driverCapabilityStatus = null; });
  it('recruiter-only account sees Enable Driver tools, not a link to the dashboard', () => {
    renderAt();
    expect(screen.getByRole('button', { name: 'Enable Driver tools' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Driver Dashboard'));
    expect(screen.queryByText('DASHBOARD')).toBeNull();
  });
  it('enabling opens the dashboard after the server says active', async () => {
    activate.mockResolvedValue('active');
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Enable Driver tools' }));
    await waitFor(() => expect(screen.getByText('DASHBOARD')).toBeInTheDocument());
  });
  it('shows pending activation when the backend is not ready', async () => {
    activate.mockResolvedValue('unavailable');
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Enable Driver tools' }));
    expect(await screen.findByText(/pending activation/)).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD')).toBeNull();
  });
  it('suspended driver gets no enable button', () => {
    state.driverCapabilityStatus = 'suspended';
    renderAt();
    expect(screen.queryByRole('button', { name: 'Enable Driver tools' })).toBeNull();
    expect(screen.getByText(/paused/)).toBeInTheDocument();
  });
});
