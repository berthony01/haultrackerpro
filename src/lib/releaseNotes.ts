export interface ReleaseNoteLink {
  label: string;
  to: string;
}

export interface ReleaseNote {
  id: string;
  version: string;
  date: string; // ISO yyyy-mm-dd
  title: string;
  summary: string;
  highlights: string[];
  links?: ReleaseNoteLink[];
}

/**
 * Newest first. Add new entries to the TOP of the array.
 * The `id` of the first entry is used as the dismiss key for the
 * dashboard "What's New" card and the auto-popup modal.
 *
 * Keep copy clean of legacy plan-preview wording — see
 * src/test/noTrialLanguage.test.ts for the guard. // trial-allowlist: refers to test file name
 */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    id: 'v2025-04-simpler-plans',
    version: '2025.04',
    date: '2026-04-26',
    title: "We've simplified our plans (and shipped a lot more)",
    summary:
      "Every account now starts on the Free plan, and you can upgrade to Pro whenever you're ready. The previous Pro preview window has been retired — your data and account are unchanged. Here's everything else that's new.",
    highlights: [
      'Simpler pricing: start Free, upgrade to Pro anytime — no time-limited windows.',
      'New Free Trucker Starter Kit — downloadable templates and guides for new drivers.',
      'Parking Finder: real-time truck parking with driver verifications and reports.',
      'Driver Points & Streaks for logging loads and parking activity consistently.',
      'Smarter Pro insights: lane intelligence, broker reliability, margin leak alerts.',
      'Weekly Pulse recap — what to repeat, what to avoid, who paid late.',
      'Better paste-load parsing for deadhead miles and mixed dispatch formats.',
      'Parking expense exports (CSV/PDF) you can hand in with load paperwork.',
    ],
    links: [
      { label: 'See pricing', to: '/pricing' },
      { label: 'All features', to: '/features' },
      { label: 'Free Starter Kit', to: '/starter-kit' },
    ],
  },
];

export const LATEST_RELEASE_ID = RELEASE_NOTES[0].id;
export const LATEST_RELEASE = RELEASE_NOTES[0];
