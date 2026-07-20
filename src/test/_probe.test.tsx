import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

beforeAll(() => {
  const proto = window.HTMLElement.prototype as any;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

const STABLE_USER = { id: 'x', email: 'x@x.com', user_metadata: {} };

vi.mock('@/hooks/opportunities/useDriverOpportunityProfile', () => ({
  useDriverOpportunityProfile: () => ({ profile: null, isLoading: false, isError: false, error: null, refetch: () => {}, upsertProfile: { mutate: () => {}, isPending: false }, deleteProfile: { mutate: () => {}, isPending: false } }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: STABLE_USER }) }));
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, message: () => {} }) }));

import { DriverOpportunityProfile } from '@/components/opportunities/DriverOpportunityProfile';

describe('probe', () => {
  it('renders', () => {
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><DriverOpportunityProfile onBack={() => {}} /></QueryClientProvider>);
    expect(screen.getByRole('button', { name: /Save Preferences/i })).toBeInTheDocument();
  });
});
