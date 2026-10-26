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
 * Homepage positioning re-pin: three audiences precede the guided driver chat.
 * The existing ordered section anchors remain protected. Sections removed from `/` (workspace walkthrough,
 * role sales cards, pricing preview, FAQ, founder story, duplicate CTAs) keep
 * their dedicated routes — they are simply no longer competing with the hero.
 */
describe('Phase 1M-B — Homepage information architecture', () => {
  it('renders the asymmetric hero headline and keeps the platform tagline', () => {
    renderLanding();
    const hero = screen.getByTestId('landing-hero');
    expect(
      within(hero).getByRole('heading', {
        level: 1,
        name: 'Find work. Run your business. Support the people who move it.',
      }),
    ).toBeInTheDocument();
    expect(hero).toHaveTextContent('The business platform behind every truck.');
    expect(hero).toHaveTextContent('One platform. Three connected workspaces.');
  });

  it('contains none of the forbidden phrases anywhere on the page', () => {
    const { container } = renderLanding();
    const text = container.textContent ?? '';
    expect(/two sides/i.test(text)).toBe(false);
    expect(/pick your side/i.test(text)).toBe(false);
    expect(/side hustle/i.test(text)).toBe(false);
  });

  it('keeps the driver, recruiter, and support primary actions wired to existing journeys', () => {
    renderLanding();
    const paths = screen.getByTestId('hero-audience-paths');
    const findWork = within(paths).getByTestId('hero-path-find-work');
    const myTrucking = within(paths).getByTestId('hero-path-my-trucking');
    const hire = within(paths).getByTestId('hero-path-hire-drivers');
    const support = within(paths).getByTestId('hero-path-assistants-agencies');
    expect(findWork).toHaveTextContent(/Find Work/);
    expect(myTrucking).toHaveTextContent(/My Trucking/);
    expect(hire).toHaveTextContent('Recruiting Tools');
    expect(support).toHaveTextContent('Assistant & Agency Tools');

    fireEvent.click(findWork);
    expect(screen.getByTestId('home-conversation-input')).toHaveFocus();
    expect(navigateSpy).not.toHaveBeenCalled();

    fireEvent.click(myTrucking);
    expect(navigateSpy).toHaveBeenLastCalledWith('/auth?intent=driver');
    fireEvent.click(hire);
    expect(navigateSpy).toHaveBeenLastCalledWith('/recruiters');
    fireEvent.click(support);
    expect(navigateSpy).toHaveBeenLastCalledWith('/assistants-agencies');
  });

  it('renders exactly the locked hierarchy in order', () => {
    renderLanding();
    const order = [
      'landing-header',
      'landing-hero',
      'hero-audience-paths',
      'how-it-works-section',
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

  it('keeps the My Trucking driver region wired to the existing driver route without a mockup image', () => {
    renderLanding();
    const section = screen.getByTestId('my-trucking-section');
    expect(within(section).queryByRole('img')).not.toBeInTheDocument();
    expect(section).toHaveTextContent('Find your next opportunity. Keep your numbers in view.');
    fireEvent.click(within(within(section).getByTestId('my-trucking-cta')).getByRole('button'));
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

  it('requires review, approved limited delegation, and outside-payment disclosures without unsupported claims', () => {
    const { container } = renderLanding();
    const text = container.textContent ?? '';
    const trust = screen.getByTestId('trust-section');
    expect(trust).toHaveTextContent(/review your Find Work answers before saving your preferences/i);
    expect(/driver approv/i.test(text)).toBe(true);
    expect(trust).toHaveTextContent(/access requires driver approval/i);
    expect(trust).toHaveTextContent(/limited to granted permissions/i);
    expect(/does not process (service )?payments/i.test(text)).toBe(true);
    expect(trust).toHaveTextContent(/service payments.*arranged outside HaulTracker Pro/i);
    expect(/Verified recruiters post/i.test(text)).toBe(false);
    expect(/every action is audit[-\s]logged/i.test(text)).toBe(false);
    expect(/revoked instantly/i.test(text)).toBe(false);
    expect(/\b(?:verified|qualified|automatically vetted)\s+drivers\b/i.test(text)).toBe(false);
    expect(/\b(?:live\s+candidate[-\s]+(?:discovery|cards)|candidate[-\s]+discovery\s+is\s+live)\b/i.test(text)).toBe(false);
  });

  it('respects the responsive contract: desktop nav gated at lg, multi-card grids one-column by default, root overflow-x-hidden', () => {
    const { container } = renderLanding();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/overflow-x-hidden/);

    const desktopNav = screen.getByTestId('landing-header-desktop-nav');
    expect(desktopNav.className).toMatch(/hidden/);
    expect(desktopNav.className).toMatch(/lg:flex/);

    const paths = screen.getByTestId('hero-audience-paths');
    const articles = within(paths).getAllByRole('article');
    expect(articles).toHaveLength(3);
    articles.forEach((article) => {
      expect(article.className).toMatch(/md:grid-cols-2/);
      expect(article.className).not.toMatch(/(?:^|\s)grid-cols-[2-9]/);
    });
  });

  it('does not render the legacy six-card driver+recruiter pricing grid on the homepage', () => {
    renderLanding();
    expect(screen.queryByText('Free Verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Fleet')).not.toBeInTheDocument();
    expect(screen.queryByText(/^See full pricing/)).not.toBeInTheDocument();
  });
});
