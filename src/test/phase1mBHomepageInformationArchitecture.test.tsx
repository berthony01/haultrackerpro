import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import Landing from '@/pages/Landing';

vi.mock('@/components/SEOHead', () => ({
  default: () => null,
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

beforeEach(() => {
  navigateSpy.mockReset();
});

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Landing />
    </MemoryRouter>,
  );
}

describe('Phase 1M-B — Homepage information architecture', () => {
  it('renders the exact new hero headline', () => {
    renderLanding();
    const hero = screen.getByTestId('landing-hero');
    expect(
      within(hero).getByRole('heading', {
        level: 1,
        name: 'The business platform behind every truck.',
      }),
    ).toBeInTheDocument();
  });

  it('contains none of the forbidden phrases anywhere on the page', () => {
    const { container } = renderLanding();
    const text = container.textContent ?? '';
    expect(/two sides/i.test(text)).toBe(false);
    expect(/pick your side/i.test(text)).toBe(false);
    expect(/side hustle/i.test(text)).toBe(false);
  });

  it('renders three compact hero audience paths with correct destinations', () => {
    renderLanding();
    const paths = screen.getByTestId('hero-audience-paths');
    const driver = within(paths).getByTestId('hero-path-driver');
    const recruiter = within(paths).getByTestId('hero-path-recruiter');
    const backoffice = within(paths).getByTestId('hero-path-backoffice');
    expect(driver).toHaveTextContent(/Drivers/);
    expect(recruiter).toHaveTextContent(/Recruiters & Carriers/);
    expect(backoffice).toHaveTextContent(/Back-Office Businesses/);

    fireEvent.click(driver);
    expect(navigateSpy).toHaveBeenLastCalledWith('/auth?intent=driver');
    fireEvent.click(recruiter);
    expect(navigateSpy).toHaveBeenLastCalledWith('/recruiters');
    fireEvent.click(backoffice);
    expect(navigateSpy).toHaveBeenLastCalledWith('/assistants-agencies');
  });

  it('renders a workspace tablist with three tabs, Driver selected by default', () => {
    renderLanding();
    const tablist = screen.getByRole('tablist', { name: /workspace previews/i });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAccessibleName(/Driver Workspace/);
    expect(tabs[1]).toHaveAccessibleName(/Recruiter Workspace/);
    expect(tabs[2]).toHaveAccessibleName(/Back-Office Workspace/);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
    // Only driver panel mounted
    expect(document.getElementById('workspace-panel-driver')).not.toBeNull();
    expect(document.getElementById('workspace-panel-recruiter')).toBeNull();
    expect(document.getElementById('workspace-panel-backoffice')).toBeNull();
  });

  it('switches workspace tabs and mounts only the selected panel', () => {
    renderLanding();
    const tablist = screen.getByRole('tablist', { name: /workspace previews/i });
    const [driverTab, recruiterTab, backTab] = within(tablist).getAllByRole('tab');

    fireEvent.click(recruiterTab);
    expect(recruiterTab).toHaveAttribute('aria-selected', 'true');
    expect(driverTab).toHaveAttribute('aria-selected', 'false');
    expect(document.getElementById('workspace-panel-recruiter')).not.toBeNull();
    expect(document.getElementById('workspace-panel-driver')).toBeNull();
    expect(document.getElementById('workspace-panel-backoffice')).toBeNull();

    fireEvent.click(backTab);
    expect(backTab).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('workspace-panel-backoffice')).not.toBeNull();
    expect(document.getElementById('workspace-panel-recruiter')).toBeNull();
    expect(document.getElementById('workspace-panel-driver')).toBeNull();
  });

  it('contains exactly three equal solution cards inside #solutions', () => {
    renderLanding();
    const solutions = document.getElementById('solutions');
    expect(solutions).not.toBeNull();
    const section = solutions as HTMLElement;
    expect(within(section).getByTestId('solution-card-driver')).toBeInTheDocument();
    expect(within(section).getByTestId('solution-card-recruiter')).toBeInTheDocument();
    expect(within(section).getByTestId('solution-card-backoffice')).toBeInTheDocument();
    // No unexpected fourth card
    const cards = section.querySelectorAll('[data-testid^="solution-card-"]');
    expect(cards.length).toBe(3);
  });

  it('renders how-it-works with three audiences and exactly three numbered steps each', () => {
    renderLanding();
    const section = screen.getByTestId('how-it-works-section');
    expect(
      within(section).getByRole('heading', { name: 'How HaulTracker Pro works for you.' }),
    ).toBeInTheDocument();

    for (const key of ['driver', 'recruiter', 'backoffice']) {
      const col = within(section).getByTestId(`how-it-works-${key}`);
      const items = col.querySelectorAll('ol > li');
      expect(items.length).toBe(3);
    }
  });

  it('renders the credibility heading verbatim', () => {
    renderLanding();
    expect(
      screen.getByRole('heading', { name: 'Built from firsthand trucking experience.' }),
    ).toBeInTheDocument();
  });

  it('renders exactly three pricing-preview cards with exact truthful pricing statements', () => {
    renderLanding();
    const section = screen.getByTestId('pricing-preview-section');
    const cards = section.querySelectorAll('[data-testid^="pricing-preview-"]');
    expect(cards.length).toBe(3);

    const driver = within(section).getByTestId('pricing-preview-driver');
    expect(driver).toHaveTextContent('Free plan available');
    expect(driver).toHaveTextContent('Pro from $19.99/month');

    const recruiter = within(section).getByTestId('pricing-preview-recruiter');
    expect(recruiter).toHaveTextContent('Free verified workspace');
    expect(recruiter).toHaveTextContent('Paid plans from $19/month');

    const agency = within(section).getByTestId('pricing-preview-agency');
    expect(agency).toHaveTextContent('Driver Assistant access is free');
    expect(agency).toHaveTextContent('Agency plans from $29/month');
  });

  it('pricing preview CTAs use exact query-parameter routes', () => {
    renderLanding();
    const section = screen.getByTestId('pricing-preview-section');

    fireEvent.click(within(within(section).getByTestId('pricing-preview-driver')).getByRole('button'));
    expect(navigateSpy).toHaveBeenLastCalledWith('/pricing?audience=driver');

    fireEvent.click(within(within(section).getByTestId('pricing-preview-recruiter')).getByRole('button'));
    expect(navigateSpy).toHaveBeenLastCalledWith('/pricing?audience=recruiter');

    fireEvent.click(within(within(section).getByTestId('pricing-preview-agency')).getByRole('button'));
    expect(navigateSpy).toHaveBeenLastCalledWith('/pricing?audience=agency');
  });

  it('final CTA renders all three audience actions with exact destinations', () => {
    renderLanding();
    const cta = screen.getByTestId('final-cta-section');
    expect(
      within(cta).getByRole('heading', { name: 'Choose the workspace that fits your role.' }),
    ).toBeInTheDocument();

    const driverBtn = within(cta).getByRole('button', { name: /Start Free as a Driver/i });
    const recruiterBtn = within(cta).getByRole('button', { name: /Explore Recruiter Access/i });
    const backBtn = within(cta).getByRole('button', { name: /Explore Back-Office Plans/i });

    fireEvent.click(driverBtn);
    expect(navigateSpy).toHaveBeenLastCalledWith('/auth?intent=driver');
    fireEvent.click(recruiterBtn);
    expect(navigateSpy).toHaveBeenLastCalledWith('/recruiters');
    fireEvent.click(backBtn);
    expect(navigateSpy).toHaveBeenLastCalledWith('/assistants-agencies');
  });

  it('preserves truthful recruiter verification and back-office delegation/outside-payment disclosures', () => {
    const { container } = renderLanding();
    const text = container.textContent ?? '';
    expect(/verified recruiter/i.test(text)).toBe(true);
    expect(/driver approv/i.test(text)).toBe(true);
    expect(/audit/i.test(text)).toBe(true);
    expect(/does not process (service )?payments/i.test(text)).toBe(true);
  });

  it('respects the responsive contract: desktop nav gated at lg, three-card grids one-column by default, root overflow-x-hidden', () => {
    const { container } = renderLanding();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/overflow-x-hidden/);

    const desktopNav = screen.getByTestId('landing-header-desktop-nav');
    expect(desktopNav.className).toMatch(/hidden/);
    expect(desktopNav.className).toMatch(/lg:flex/);

    for (const testId of [
      'solutions-section',
      'how-it-works-section',
      'pricing-preview-section',
    ]) {
      const section = screen.getByTestId(testId);
      const grid = section.querySelector('.grid');
      expect(grid).not.toBeNull();
      expect((grid as HTMLElement).className).toMatch(/grid-cols-1/);
      expect((grid as HTMLElement).className).toMatch(/md:grid-cols-3/);
    }
  });

  it('does not render the legacy six-card driver+recruiter pricing grid on the homepage', () => {
    renderLanding();
    // Legacy grid featured all four recruiter tiers on the homepage.
    expect(screen.queryByText('Free Verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Fleet')).not.toBeInTheDocument();
    // And a dedicated "For Drivers" pricing heading style
    expect(screen.queryByText(/^See full pricing/)).not.toBeInTheDocument();
  });
});
