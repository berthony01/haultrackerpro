import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MarketingHeader from '@/components/marketing/MarketingHeader';

function renderAt(path: string, node: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
}

describe('MarketingHeader (Phase 6B shared public header)', () => {
  it('renders all four audience marketing links on desktop', () => {
    renderAt('/pricing', <MarketingHeader />);
    const header = screen.getByTestId('marketing-header');
    expect(within(header).getByText('Features')).toBeInTheDocument();
    expect(within(header).getByText('Pricing')).toBeInTheDocument();
    expect(within(header).getByText('For Recruiters')).toBeInTheDocument();
    expect(within(header).getByText('Assistants & Agencies')).toBeInTheDocument();
    expect(within(header).getByText('Sign In')).toBeInTheDocument();
  });

  it('uses the default Start Tracking Free CTA by default', () => {
    renderAt('/features', <MarketingHeader />);
    const header = screen.getByTestId('marketing-header');
    expect(within(header).getAllByText(/Start Tracking Free|Start Free/i).length).toBeGreaterThan(0);
  });

  it('honors a custom primary CTA (e.g. Create Agency Workspace)', () => {
    renderAt(
      '/assistants-agencies',
      <MarketingHeader
        primaryCta={{ label: 'Create Agency Workspace', onClick: () => {} }}
      />,
    );
    const header = screen.getByTestId('marketing-header');
    expect(within(header).getAllByText('Create Agency Workspace').length).toBeGreaterThan(0);
  });

  it('exposes a mobile menu toggle button', () => {
    renderAt('/pricing', <MarketingHeader />);
    expect(screen.getByRole('button', { name: /open menu|close menu/i })).toBeInTheDocument();
  });
});
