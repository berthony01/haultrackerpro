import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import Landing from '@/pages/Landing';
import { HOME_CONVERSATION_NEXT_PATH } from '@/components/home/HomeConversationHero';

vi.mock('@/components/SEOHead', () => ({ default: () => null }));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const HERO_SRC = read('src/components/home/HomeConversationHero.tsx');
const FLOW_SRC = read('src/components/home/HomeConversationFlow.tsx');
const INTAKE_SRC = read('src/lib/home/conversationIntake.ts');
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

describe('Homepage — conversation-first front door (HP-1 re-pinned for HP-2)', () => {
  it('renders the conversation surface inside the hero, above secondary sections', () => {
    renderLanding();
    const hero = screen.getByTestId('landing-hero');
    const surface = within(hero).getByTestId('home-conversation-surface');
    expect(surface).toBeInTheDocument();
    expect(within(surface).getByTestId('home-conversation-input')).toBeInTheDocument();
    expect(within(surface).getByTestId('home-conversation-transcript')).toBeInTheDocument();

    const secondary = screen.getByTestId('secondary-tools-section');
    expect(
      hero.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('the first thing the driver sees is the opening question, not a signup CTA', () => {
    renderLanding();
    const transcript = screen.getByTestId('home-conversation-transcript');
    expect(transcript).toHaveTextContent('What kind of trucking work are you looking for?');
    expect(screen.queryByTestId('home-conversation-continue')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start Free as a Driver/i })).not.toBeInTheDocument();
  });

  it('quick replies answer the question in place rather than navigating away', () => {
    renderLanding();
    fireEvent.click(screen.getByTestId('home-conversation-chip-regional'));
    expect(screen.getByTestId('home-conversation-transcript')).toHaveTextContent('Regional');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('send stays disabled until the driver types a reply', () => {
    renderLanding();
    const send = screen.getByTestId('home-conversation-send');
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByTestId('home-conversation-input'), {
      target: { value: 'Regional flatbed out of Georgia' },
    });
    expect(send).toBeEnabled();
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

  it('header primary action is conversation-first, not a generic signup', () => {
    renderLanding();
    fireEvent.click(screen.getByTestId('landing-header-start-talking'));
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(LANDING_SRC).not.toMatch(/>Start Free</);
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

  it('scope guard — the conversation surface owns no chat backend, auth system, billing, or Telegram code', () => {
    for (const src of [HERO_SRC, FLOW_SRC, INTAKE_SRC]) {
      for (const pattern of [
        /from '@\/integrations\/supabase/,
        /\.rpc\(/,
        /conversation_threads/,
        /signIn|signUp/,
        /stripe/i,
        /telegram/i,
        /fetch\(/,
      ]) {
        expect(pattern.test(src)).toBe(false);
      }
    }
    // The homepage reuses the existing auth route; it never invents a second identity system.
    expect(LANDING_SRC).toContain('/auth?intent=driver');
    expect(HOME_CONVERSATION_NEXT_PATH).toBe('/dashboard?page=opportunities&view=driver-profile');
  });

  it('the dead one-shot draft capture is gone', () => {
    expect(HERO_SRC).not.toMatch(/htp_home_conversation_draft|HOME_CONVERSATION_DRAFT_KEY/);
    expect(LANDING_SRC).not.toMatch(/htp_home_conversation_draft|HOME_CONVERSATION_DRAFT_KEY/);
  });
});
