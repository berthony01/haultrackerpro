import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  sessionStorage.clear();
});

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Landing />
    </MemoryRouter>,
  );
}

/**
 * HP-2 re-pin. The homepage information architecture is now the locked six-part
 * conversation-first hierarchy. Sections removed from `/` (workspace walkthrough,
 * role sales cards, pricing preview, FAQ, founder story, duplicate CTAs) keep
 * their dedicated routes — they are simply no longer competing with the hero.
 */
describe('Phase 1M-B — Homepage information architecture', () => {
  it('renders the conversation-first hero headline and keeps the platform tagline', () => {
    renderLanding();
    const hero = screen.getByTestId('landing-hero');
    expect(
      within(hero).getByRole('heading', {
        level: 1,
        name: /Talk about the work you want\./i,
      }),
    ).toBeInTheDocument();
    expect(hero).toHaveTextContent('The business platform behind every truck.');
  });

  it('contains none of the forbidden phrases anywhere on the page', () => {
    const { container } = renderLanding();
    const text = container.textContent ?? '';
    expect(/two sides/i.test(text)).toBe(false);
    expect(/pick your side/i.test(text)).toBe(false);
    expect(/side hustle/i.test(text)).toBe(false);
  });

  it('renders the three primary hero paths in conversation-first order', () => {
    renderLanding();
    const paths = screen.getByTestId('hero-audience-paths');
    const findWork = within(paths).getByTestId('hero-path-find-work');
    const myTrucking = within(paths).getByTestId('hero-path-my-trucking');
    const hire = within(paths).getByTestId('hero-path-hire-drivers');
    expect(findWork).toHaveTextContent(/Find Work/);
    expect(myTrucking).toHaveTextContent(/My Trucking/);
    expect(hire).toHaveTextContent(/Hire Drivers/);

    fireEvent.click(myTrucking);
    expect(navigateSpy).toHaveBeenLastCalledWith('/auth?intent=driver');
    fireEvent.click(hire);
    expect(navigateSpy).toHaveBeenLastCalledWith('/recruiters');
  });

  it('renders exactly the locked six-part hierarchy in order', () => {
    renderLanding();
    const order = [
      'landing-header',
      'landing-hero',
      'how-it-works-section',
      'my-trucking-section',
      'secondary-tools-section',
      'trust-section',
    ].map((id) => screen.getByTestId(id));

    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('how-it-works is a single four-step finding-work explanation', () => {
    renderLanding();
    const section = screen.getByTestId('how-it-works-section');
    expect(
      within(section).getByRole('heading', { name: 'How finding work works.' }),
    ).toBeInTheDocument();
    const steps = section.querySelectorAll('[data-testid^="how-it-works-step-"]');
    expect(steps.length).toBe(4);
  });

  it('keeps one My Trucking proof section wired to the existing driver route', () => {
    renderLanding();
    const section = screen.getByTestId('my-trucking-section');
    expect(within(section).getByRole('img')).toBeInTheDocument();
    fireEvent.click(within(section).getByTestId('my-trucking-cta'));
    expect(navigateSpy).toHaveBeenLastCalledWith('/auth?intent=driver');
  });

  it('removes the workspace walkthrough, role sales cards, pricing preview, FAQ, founder story, and duplicate CTAs from the homepage', () => {
    renderLanding();
    expect(screen.queryByRole('tablist', { name: /workspace previews/i })).not.toBeInTheDocument();
    expect(document.getElementById('solutions')).toBeNull();
    expect(document.querySelectorAll('[data-testid^="solution-card-"]').length).toBe(0);
    expect(screen.queryByTestId('pricing-preview-section')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="pricing-preview-"]').length).toBe(0);
    expect(screen.queryByTestId('final-cta-section')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Quick answers' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Built from firsthand trucking experience.' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start Free as a Driver/i })).not.toBeInTheDocument();
  });

  it('preserves the dedicated routes those sections moved back to', () => {
    renderLanding();
    fireEvent.click(screen.getByTestId('landing-header-desktop-nav').querySelectorAll('button')[1]);
    expect(navigateSpy).toHaveBeenLastCalledWith('/pricing');
    fireEvent.click(within(screen.getByTestId('secondary-tools-section')).getByTestId('secondary-tool-assistants'));
    expect(navigateSpy).toHaveBeenLastCalledWith('/assistants-agencies');
  });

  it('preserves truthful recruiter verification and back-office delegation/outside-payment disclosures', () => {
    const { container } = renderLanding();
    const text = container.textContent ?? '';
    expect(/verified|verification/i.test(text)).toBe(true);
    expect(/driver approv/i.test(text)).toBe(true);
    expect(/audit/i.test(text)).toBe(true);
    expect(/revoke/i.test(text)).toBe(true);
    expect(/does not process (service )?payments/i.test(text)).toBe(true);
  });

  it('respects the responsive contract: desktop nav gated at lg, multi-card grids one-column by default, root overflow-x-hidden', () => {
    const { container } = renderLanding();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/overflow-x-hidden/);

    const desktopNav = screen.getByTestId('landing-header-desktop-nav');
    expect(desktopNav.className).toMatch(/hidden/);
    expect(desktopNav.className).toMatch(/lg:flex/);

    const paths = screen.getByTestId('hero-audience-paths');
    expect(paths.className).toMatch(/grid-cols-1/);
    expect(paths.className).toMatch(/md:grid-cols-3/);
  });

  it('does not render the legacy six-card driver+recruiter pricing grid on the homepage', () => {
    renderLanding();
    expect(screen.queryByText('Free Verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Fleet')).not.toBeInTheDocument();
    expect(screen.queryByText(/^See full pricing/)).not.toBeInTheDocument();
  });
});
