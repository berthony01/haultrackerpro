/**
 * HP-4A — deterministic multi-field first-message intake parsing.
 *
 * Asserts that the driver's FIRST free-text reply may populate several
 * unambiguous PREFERENCE fields at once, that ambiguity always fails closed,
 * that protected facts (CDL class, years of experience, endorsements) are never
 * inferred from that sentence, and that the conversation discloses exactly what
 * it captured without any match/qualification claim.
 *
 * The file is intentionally `.ts`: component turns are driven with
 * React.createElement so no JSX is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

const rpcMock = vi.fn(async () => ({ data: [], error: null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: () => rpcMock() },
}));

import HomeConversationFlow from '@/components/home/HomeConversationFlow';
import {
  FIRST_MESSAGE_PREFERENCE_FIELDS,
  extractFirstMessagePreferences,
  describeCapturedPreferences,
  hasExtraCapturedPreferences,
  isStepAnswered,
  nextStep,
  INTAKE_STEPS,
} from '@/lib/home/conversationIntake';

const INTAKE_SRC = readFileSync(
  join(process.cwd(), 'src/lib/home/conversationIntake.ts'),
  'utf8',
);

const FLOW_PROPS = {
  onContinue: () => {},
  amber: 'hsl(25, 95%, 53%)',
  surface: 'hsl(220, 20%, 10%)',
  border: 'hsl(220, 16%, 20%)',
  textMuted: 'hsl(220, 10%, 70%)',
  textDim: 'hsl(220, 10%, 55%)',
};

function renderFlow() {
  return render(createElement(HomeConversationFlow, FLOW_PROPS));
}

async function sendFirstMessage(text: string) {
  renderFlow();
  fireEvent.change(screen.getByTestId('home-conversation-input'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByTestId('home-conversation-send'));
  await waitFor(() => {
    expect(screen.getAllByTestId('home-conversation-bubble-driver').length).toBe(1);
  });
}

function transcript(): string[] {
  return screen
    .getAllByTestId('home-conversation-bubble-assistant')
    .map((el) => el.textContent ?? '');
}

describe('HP-4A — first-message preference extraction', () => {
  beforeEach(() => {
    rpcMock.mockClear();
  });

  it('captures route and home time from one sentence', () => {
    const captured = extractFirstMessagePreferences('find me regional, home weekly');
    expect(captured.preferred_route_type).toBe('Regional');
    expect(captured.preferred_home_time).toBe('Weekly');
    expect(hasExtraCapturedPreferences(captured)).toBe(true);
    expect(describeCapturedPreferences(captured)).toEqual(['Regional', 'Home weekly']);
  });

  it('skips the later home-time question once the first message answered it', () => {
    const captured = extractFirstMessagePreferences('find me regional, home weekly');
    expect(isStepAnswered(captured, 'home-time')).toBe(true);
    expect(nextStep(captured)?.id).toBe('location');
  });

  it('discloses the extra capture and moves past work type in the live flow', async () => {
    await sendFirstMessage('find me regional, home weekly');
    const lines = transcript();
    expect(lines.some((l) => l.includes('I also picked up:'))).toBe(true);
    expect(lines.some((l) => l.includes('Regional') && l.includes('Home weekly'))).toBe(true);
    // Work type resolved, home time already captured => the next question is location.
    expect(lines[lines.length - 1]).toContain('Where are you based?');
    // No match / qualification claim anywhere in the disclosure.
    for (const banned of ['qualified', 'eligible', 'match', 'guaranteed', 'approved']) {
      expect(lines.join(' ').toLowerCase()).not.toContain(banned);
    }
  });

  it('leaves route unset when the work type is ambiguous but keeps safe captures', async () => {
    const captured = extractFirstMessagePreferences('local or regional, home weekly');
    expect(captured.preferred_route_type).toBeUndefined();
    expect(captured.preferred_home_time).toBe('Weekly');

    await sendFirstMessage('local or regional, home weekly');
    const lines = transcript();
    expect(lines.some((l) => l.includes('I also picked up:') && l.includes('Home weekly'))).toBe(
      true,
    );
    // Work type is re-asked, verbatim from the locked script.
    expect(lines[lines.length - 1]).toContain(INTAKE_STEPS[0].prompt);
  });

  it('captures route, trailer, location and pay goal together without fact inference', () => {
    const captured = extractFirstMessagePreferences('OTR dry van in Dallas, TX, $1800 a week');
    expect(captured.preferred_route_type).toBe('OTR');
    expect(captured.trailer_experience).toEqual(['Dry Van']);
    expect(captured.city).toBe('Dallas');
    expect(captured.state).toBe('TX');
    expect(captured.min_weekly_gross).toBe(1800);
    expect(captured.cdl_class).toBeUndefined();
    expect(captured.years_experience).toBeUndefined();
    expect('endorsements' in captured).toBe(false);
  });

  it('leaves home time unset when terms conflict', () => {
    const captured = extractFirstMessagePreferences('home daily or home weekly, either works');
    expect(captured.preferred_home_time).toBeUndefined();
  });

  it('leaves location unset when several locations appear', () => {
    const captured = extractFirstMessagePreferences('running Dallas, TX or Phoenix, AZ');
    expect(captured.city).toBeUndefined();
    expect(captured.state).toBeUndefined();
  });

  it('leaves pay goal unset when several pay goals appear', () => {
    const captured = extractFirstMessagePreferences('looking for $1800 a week, maybe $2200 a week');
    expect(captured.min_weekly_gross).toBeUndefined();
  });

  it('leaves driver type unset when owner operator and team are both mentioned', () => {
    const captured = extractFirstMessagePreferences('owner operator or team driving, not sure yet');
    expect(captured.preferred_driver_type).toBeUndefined();
  });

  it('never derives CDL class or years of experience from the first message', () => {
    const captured = extractFirstMessagePreferences('I have 10 years and CDL A');
    expect(captured.cdl_class).toBeUndefined();
    expect(captured.years_experience).toBeUndefined();
  });

  it('exposes only the approved preference fields', () => {
    expect([...FIRST_MESSAGE_PREFERENCE_FIELDS]).toEqual([
      'preferred_route_type',
      'preferred_driver_type',
      'preferred_home_time',
      'trailer_experience',
      'city',
      'state',
      'min_weekly_gross',
    ]);
    for (const forbidden of ['cdl_class', 'years_experience', 'endorsements']) {
      expect(FIRST_MESSAGE_PREFERENCE_FIELDS as readonly string[]).not.toContain(forbidden);
    }
  });

  it('keeps the intake module free of network, AI and cross-module imports', () => {
    expect(INTAKE_SRC).not.toMatch(/^\s*import\s/m);
    for (const banned of [
      'fetch(',
      'XMLHttpRequest',
      'supabase',
      'localStorage',
      'openai',
      'ai.',
      'generateText',
    ]) {
      expect(INTAKE_SRC).not.toContain(banned);
    }
    // The only persistence is the pre-existing HP-2 bounded sessionStorage
    // snapshot; the HP-4A extraction section touches no storage at all.
    const hp4aSection = INTAKE_SRC.split('HP-4A — bounded deterministic')[1] ?? '';
    expect(hp4aSection.length).toBeGreaterThan(0);
    expect(hp4aSection).not.toContain('sessionStorage');
  });

  it('makes no backend call during the first-message turn', async () => {
    await sendFirstMessage('find me regional, home weekly');
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
