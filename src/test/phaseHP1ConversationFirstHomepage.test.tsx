import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import Landing from '@/pages/Landing';
import { HOME_CONVERSATION_DRAFT_KEY } from '@/components/home/HomeConversationHero';

vi.mock('@/components/SEOHead', () => ({ default: () => null }));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const HERO_SRC = read('src/components/home/HomeConversationHero.tsx');
const LANDING_SRC = read('src/pages/Landing.tsx');

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

describe('Homepage — conversation-first front door', () => {
  it('renders the conversation surface inside the hero, above secondary sections', () => {
    renderLanding();
    const hero = screen.getByTestId('landing-hero');
    const surface = within(hero).getByTestId('home-conversation-surface');
    expect(surface).toBeInTheDocument();
    expect(within(surface).getByTestId('home-conversation-input')).toBeInTheDocument();

    const secondary = screen.getByTestId('secondary-tools-section');
    expect(
      hero.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps the start action disabled until the driver types something', () => {
    renderLanding();
    const start = screen.getByTestId('home-conversation-start');
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByTestId('home-conversation-input'), {
      target: { value: 'Regional flatbed out of Georgia' },
    });
    expect(start).toBeEnabled();
  });

  it('suggested prompts fill the input rather than navigating away', () => {
    renderLanding();
    const prompts = screen.getByTestId('home-conversation-prompts');
    const first = within(prompts).getAllByRole('button')[0];
    fireEvent.click(first);
    expect((screen.getByTestId('home-conversation-input') as HTMLTextAreaElement).value.length)
      .toBeGreaterThan(0);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('carries the typed draft into the existing driver auth flow and opportunities workspace', () => {
    renderLanding();
    fireEvent.change(screen.getByTestId('home-conversation-input'), {
      target: { value: '  Dedicated lanes out of Texas, home weekends  ' },
    });
    fireEvent.click(screen.getByTestId('home-conversation-start'));

    const stored = JSON.parse(sessionStorage.getItem(HOME_CONVERSATION_DRAFT_KEY) ?? '{}');
    expect(stored.text).toBe('Dedicated lanes out of Texas, home weekends');
    expect(navigateSpy).toHaveBeenLastCalledWith(
      `/auth?intent=driver&next=${encodeURIComponent('/dashboard?page=opportunities')}`,
    );
  });

  it('does not navigate or store anything for an empty draft', () => {
    renderLanding();
    fireEvent.click(screen.getByTestId('home-conversation-start'));
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(HOME_CONVERSATION_DRAFT_KEY)).toBeNull();
  });

  it('orders primary paths Find Work, My Trucking, Hire Drivers', () => {
    renderLanding();
    const paths = screen.getByTestId('hero-audience-paths');
    const ids = Array.from(paths.querySelectorAll('[data-testid^="hero-path-"]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(ids).toEqual(['hero-path-find-work', 'hero-path-my-trucking', 'hero-path-hire-drivers']);
  });

  it('Find Work focuses the conversation instead of routing to signup', () => {
    renderLanding();
    fireEvent.click(screen.getByTestId('hero-path-find-work'));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('keeps supporting tools secondary and linked to existing routes', () => {
    renderLanding();
    const section = screen.getByTestId('secondary-tools-section');
    for (const [key, href] of [
      ['assistants', '/assistants-agencies'],
      ['calculators', '/trucking-profit-calculator'],
      ['resources', '/resources'],
    ] as const) {
      fireEvent.click(within(section).getByTestId(`secondary-tool-${key}`));
      expect(navigateSpy).toHaveBeenLastCalledWith(href);
    }
  });

  it('does not publish unsupported social-proof metrics or verified-driver claims', () => {
    const { container } = renderLanding();
    const text = container.textContent ?? '';
    expect(/\d[\d,]*\+?\s*(drivers|recruiters|carriers|loads)\s*(joined|hired|matched)/i.test(text))
      .toBe(false);
    expect(/testimonial|success stories|\d\.\d\s*\/\s*5|star rating/i.test(text)).toBe(false);
    expect(/verified drivers/i.test(text)).toBe(false);
  });

  it('scope guard — the hero surface owns no chat backend, auth system, billing, or Telegram code', () => {
    for (const pattern of [
      /from '@\/integrations\/supabase/,
      /\.rpc\(/,
      /conversation_threads/,
      /signIn|signUp|auth\./,
      /stripe/i,
      /telegram/i,
      /fetch\(/,
    ]) {
      expect(pattern.test(HERO_SRC)).toBe(false);
    }
    // The homepage reuses the existing auth route; it never invents a second identity system.
    expect(LANDING_SRC).toContain('/auth?intent=driver');
    expect(LANDING_SRC).toContain('/dashboard?page=opportunities');
  });
});
