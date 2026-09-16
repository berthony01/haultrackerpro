import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import Landing from '@/pages/Landing';
import {
  HOME_INTAKE_SNAPSHOT_KEY,
  HOME_INTAKE_SNAPSHOT_VERSION,
  HOME_INTAKE_NEXT_PATH,
  WORK_TYPE_CHOICES,
  applyWorkTypeChoice,
  applyStepAnswer,
  buildIntakeSnapshot,
  extractLocation,
  extractWorkTypeHints,
  isStepAnswered,
  nextStep,
  parseIntakeSnapshot,
  readIntakeSnapshot,
  summarizeIntake,
  toDriverProfileSeed,
  type IntakeAnswers,
} from '@/lib/home/conversationIntake';

vi.mock('@/components/SEOHead', () => ({ default: () => null }));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const INTAKE_SRC = read('src/lib/home/conversationIntake.ts');
const FLOW_SRC = read('src/components/home/HomeConversationFlow.tsx');
const PROFILE_SRC = read('src/components/opportunities/DriverOpportunityProfile.tsx');

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

function reply(text: string) {
  fireEvent.change(screen.getByTestId('home-conversation-input'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('home-conversation-send'));
}

/** Drives the full locked script to the value state. */
function completeConversation() {
  fireEvent.click(screen.getByTestId('home-conversation-chip-regional'));
  reply('Houston, TX');
  fireEvent.click(screen.getByTestId('home-conversation-chip-a'));
  reply('2');
  fireEvent.click(screen.getByTestId('home-conversation-chip-weekly'));
  fireEvent.click(screen.getByTestId('home-conversation-skip')); // trailer (optional)
  fireEvent.click(screen.getByTestId('home-conversation-skip')); // pay goal (optional)
}

describe('HP-2 — canonical vocabulary and mapping', () => {
  it('exposes exactly the six locked first choices in order', () => {
    expect([...WORK_TYPE_CHOICES]).toEqual([
      'Local',
      'Regional',
      'OTR',
      'Dedicated',
      'Owner Operator',
      'Team',
    ]);
  });

  it('maps route types to preferred_route_type and Owner Operator / Team to preferred_driver_type', () => {
    expect(applyWorkTypeChoice({}, 'Local')).toEqual({ preferred_route_type: 'Local' });
    expect(applyWorkTypeChoice({}, 'Dedicated')).toEqual({ preferred_route_type: 'Dedicated' });
    expect(applyWorkTypeChoice({}, 'Owner Operator')).toEqual({
      preferred_driver_type: 'Owner Operator',
    });
    expect(applyWorkTypeChoice({}, 'Team')).toEqual({ preferred_driver_type: 'Team' });
    // Never stored as a route type.
    expect(applyWorkTypeChoice({}, 'Owner Operator').preferred_route_type).toBeUndefined();
    expect(applyWorkTypeChoice({}, 'Team').preferred_route_type).toBeUndefined();
  });

  it('free-text extraction is conservative and invents nothing', () => {
    expect(extractWorkTypeHints('I want regional work, owner operator')).toEqual({
      preferred_route_type: 'Regional',
      preferred_driver_type: 'Owner Operator',
    });
    expect(extractWorkTypeHints('something about freight')).toEqual({});
    expect(extractLocation('Houston, TX')).toEqual({ city: 'Houston', state: 'TX' });
    expect(extractLocation('texas')).toEqual({ state: 'TX' });
    expect(extractLocation('TX')).toEqual({ state: 'TX' });
  });
});

describe('HP-2 — progressive script', () => {
  it('never re-asks an answered item and honours skips', () => {
    let answers: IntakeAnswers = {};
    expect(nextStep(answers)?.id).toBe('work-type');
    answers = applyWorkTypeChoice(answers, 'Regional');
    expect(nextStep(answers)?.id).toBe('location');
    answers = applyStepAnswer(answers, 'location', 'Houston, TX');
    expect(nextStep(answers)?.id).toBe('cdl-class');
    answers = applyStepAnswer(answers, 'cdl-class', 'Class A');
    answers = applyStepAnswer(answers, 'experience', '2 years');
    answers = applyStepAnswer(answers, 'home-time', 'home weekly');
    expect(nextStep(answers)?.id).toBe('trailer');
    expect(nextStep(answers, ['trailer'])?.id).toBe('pay-goal');
    expect(nextStep(answers, ['trailer', 'pay-goal'])).toBeNull();
    expect(isStepAnswered(answers, 'experience')).toBe(true);
    expect(answers.years_experience).toBe(2);
  });

  it('summarizes only supplied facts and claims nothing about opportunities', () => {
    const line = summarizeIntake({
      preferred_route_type: 'Regional',
      city: 'Houston',
      state: 'TX',
      cdl_class: 'A',
      years_experience: 2,
      preferred_home_time: 'Weekly',
    }).join(' • ');
    expect(line).toBe('Regional • Houston, TX • CDL-A • 2 years • Home weekly');
    expect(/matched|qualified|approved|verified|hired|\d+\s+(jobs|opportunities)/i.test(line)).toBe(false);
  });
});

describe('HP-2 — signed-out homepage conversation', () => {
  it('completes a real multi-turn transcript with no auth redirect along the way', () => {
    renderLanding();
    completeConversation();
    expect(navigateSpy).not.toHaveBeenCalled();

    const transcript = screen.getByTestId('home-conversation-transcript');
    const driverBubbles = within(transcript).getAllByTestId('home-conversation-bubble-driver');
    expect(driverBubbles.length).toBeGreaterThanOrEqual(5);
    expect(within(transcript).getAllByTestId('home-conversation-bubble-assistant').length)
      .toBeGreaterThanOrEqual(5);
  });

  it('shows the truthful value summary before any auth CTA exists', () => {
    renderLanding();
    expect(screen.queryByTestId('home-conversation-continue')).not.toBeInTheDocument();
    completeConversation();

    const summary = screen.getByTestId('home-conversation-summary');
    expect(within(summary).getByTestId('home-conversation-summary-line')).toHaveTextContent(
      'Regional • Houston, TX • CDL-A • 2 years • Home weekly',
    );
    expect(summary).toHaveTextContent(/prefill your Driver Work Profile/i);
    expect(screen.getByTestId('home-conversation-continue')).toBeInTheDocument();
  });

  it('makes no opportunity, match, qualification or count claim pre-auth', () => {
    const { container } = renderLanding();
    completeConversation();
    const text = container.textContent ?? '';
    expect(/\d+\s+(jobs|opportunities|matches)\s+found/i.test(text)).toBe(false);
    expect(/you (are|'re) qualified|you qualify|pre-?approved|you are matched/i.test(text)).toBe(false);
    expect(/verified driver|guaranteed/i.test(text)).toBe(false);
  });

  it('continues through the existing auth route to the Driver Opportunity Preferences surface', () => {
    renderLanding();
    completeConversation();
    fireEvent.click(screen.getByTestId('home-conversation-continue'));
    expect(navigateSpy).toHaveBeenLastCalledWith(
      `/auth?intent=driver&next=${encodeURIComponent(HOME_INTAKE_NEXT_PATH)}`,
    );
    expect(HOME_INTAKE_NEXT_PATH).toBe('/dashboard?page=opportunities&view=driver-profile');
  });

  it('stores one bounded snapshot with only driver-supplied work-profile fields', () => {
    renderLanding();
    completeConversation();
    fireEvent.click(screen.getByTestId('home-conversation-continue'));

    const raw = sessionStorage.getItem(HOME_INTAKE_SNAPSHOT_KEY) as string;
    expect(raw).toBeTruthy();
    const snap = JSON.parse(raw);
    expect(snap.version).toBe(HOME_INTAKE_SNAPSHOT_VERSION);
    expect(snap.preferred_route_type).toBe('Regional');
    expect(snap.city).toBe('Houston');
    expect(snap.state).toBe('TX');
    expect(snap.cdl_class).toBe('A');
    expect(snap.years_experience).toBe(2);
    expect(snap.preferred_home_time).toBe('Weekly');

    for (const forbidden of [
      'visibility',
      'allow_verified_recruiter_contact',
      'contact_preference',
      'profile_completed',
      'phone',
      'email',
      'full_name',
    ]) {
      expect(snap[forbidden]).toBeUndefined();
    }
  });

  it('preserves the driver’s own words as initialMessage when they type freely', () => {
    renderLanding();
    reply('I run flatbed and want regional work out of Georgia');
    reply('Atlanta, GA');
    fireEvent.click(screen.getByTestId('home-conversation-chip-a'));
    reply('3');
    fireEvent.click(screen.getByTestId('home-conversation-chip-weekly'));
    fireEvent.click(screen.getByTestId('home-conversation-skip'));
    fireEvent.click(screen.getByTestId('home-conversation-skip'));
    fireEvent.click(screen.getByTestId('home-conversation-continue'));

    const snap = JSON.parse(sessionStorage.getItem(HOME_INTAKE_SNAPSHOT_KEY) as string);
    expect(snap.initialMessage).toBe('I run flatbed and want regional work out of Georgia');
    expect(snap.preferred_route_type).toBe('Regional');
  });

  it('lets the driver correct answers with Back and Start over', () => {
    renderLanding();
    fireEvent.click(screen.getByTestId('home-conversation-chip-otr'));
    fireEvent.click(screen.getByTestId('home-conversation-back'));
    expect(screen.getByTestId('home-conversation-transcript')).not.toHaveTextContent('OTR');

    fireEvent.click(screen.getByTestId('home-conversation-chip-local'));
    fireEvent.click(screen.getByTestId('home-conversation-restart'));
    const transcript = screen.getByTestId('home-conversation-transcript');
    expect(within(transcript).queryAllByTestId('home-conversation-bubble-driver').length).toBe(0);
    expect(transcript).toHaveTextContent('What kind of trucking work are you looking for?');
  });

  it('re-asks rather than inventing an answer it could not understand', () => {
    renderLanding();
    reply('zzzzz');
    const transcript = screen.getByTestId('home-conversation-transcript');
    expect(transcript).toHaveTextContent('I did not catch that one.');
    expect(screen.queryByTestId('home-conversation-summary')).not.toBeInTheDocument();
  });
});

describe('HP-2 — snapshot contract fails closed', () => {
  it('rejects wrong version, oversized, corrupt, and expired snapshots', () => {
    const good = buildIntakeSnapshot({ preferred_route_type: 'Local' });
    expect(parseIntakeSnapshot(JSON.stringify(good))).not.toBeNull();
    expect(parseIntakeSnapshot(JSON.stringify({ ...good, version: 99 }))).toBeNull();
    expect(parseIntakeSnapshot('not json')).toBeNull();
    expect(parseIntakeSnapshot(null)).toBeNull();
    expect(parseIntakeSnapshot(JSON.stringify(good) + ' '.repeat(5000))).toBeNull();

    const stale = buildIntakeSnapshot(
      { preferred_route_type: 'Local' },
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    );
    expect(parseIntakeSnapshot(JSON.stringify(stale))).toBeNull();
  });

  it('drops unknown and forbidden fields on read', () => {
    const parsed = parseIntakeSnapshot(
      JSON.stringify({
        version: HOME_INTAKE_SNAPSHOT_VERSION,
        createdAt: new Date().toISOString(),
        preferred_route_type: 'Regional',
        visibility: 'verified_recruiters',
        allow_verified_recruiter_contact: true,
        phone: '555-555-5555',
      }),
    ) as unknown as Record<string, unknown>;
    expect(parsed.preferred_route_type).toBe('Regional');
    expect(parsed.visibility).toBeUndefined();
    expect(parsed.allow_verified_recruiter_contact).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
  });

  it('clears an invalid snapshot on read so it can never be reused', () => {
    sessionStorage.setItem(HOME_INTAKE_SNAPSHOT_KEY, '{"version":42}');
    expect(readIntakeSnapshot()).toBeNull();
    expect(sessionStorage.getItem(HOME_INTAKE_SNAPSHOT_KEY)).toBeNull();
  });

  it('the profile seed carries no identity, consent, or completion field', () => {
    const seed = toDriverProfileSeed(
      buildIntakeSnapshot({
        initialMessage: 'regional flatbed',
        preferred_route_type: 'Regional',
        preferred_driver_type: 'Owner Operator',
        city: 'Houston',
        state: 'TX',
        cdl_class: 'A',
        years_experience: 2,
        preferred_home_time: 'Weekly',
        trailer_experience: ['Flatbed'],
        min_weekly_gross: 1800,
      }),
    ) as unknown as Record<string, unknown>;
    expect(Object.keys(seed).sort()).toEqual([
      'cdl_class',
      'city',
      'min_weekly_gross',
      'preferred_driver_type',
      'preferred_home_time',
      'preferred_route_type',
      'state',
      'trailer_experience',
      'years_experience',
    ]);
    expect(seed.visibility).toBeUndefined();
    expect(seed.allow_verified_recruiter_contact).toBeUndefined();
    expect(seed.profile_completed).toBeUndefined();
    expect(seed.initialMessage).toBeUndefined();
  });
});

describe('HP-2 — scope and safety guards', () => {
  it('the intake module is pure: no network, storage beyond the single bounded key, or backend import', () => {
    expect(INTAKE_SRC).not.toMatch(/from '@\/integrations\/supabase/);
    expect(INTAKE_SRC).not.toMatch(/fetch\(|XMLHttpRequest|\.rpc\(/);
    expect(FLOW_SRC).not.toMatch(/sessionStorage|localStorage/);
    const keys = INTAKE_SRC.match(/sessionStorage\.(get|set|remove)Item\(\s*([A-Z_]+)/g) ?? [];
    for (const k of keys) expect(k).toContain('HOME_INTAKE_SNAPSHOT_KEY');
  });

  it('the profile form applies the seed review-only: saved data wins and the driver must press Save', () => {
    expect(PROFILE_SRC).toMatch(/if \(profile\) return; \/\/ existing saved data wins/);
    // Seed never touches consent/visibility/completion.
    const seedBlock = PROFILE_SRC.slice(
      PROFILE_SRC.indexOf('const seed = toDriverProfileSeed'),
      PROFILE_SRC.indexOf('setSeedApplied(true)'),
    );
    expect(seedBlock).not.toMatch(/visibility|allow_verified_recruiter_contact|contact_preference|profile_completed/);
    // Cleared only after a successful save.
    expect(PROFILE_SRC).toMatch(/onSuccess: \(\) => \{[\s\S]{0,200}clearIntakeSnapshot\(\)/);
    expect(PROFILE_SRC).toMatch(/We prefilled this from your homepage conversation\. Review before saving\./);
  });
});
