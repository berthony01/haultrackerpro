import type { ReleaseNote } from './releaseNotes';

/**
 * Recruiter-specific release notes. Newest first.
 * Powers /recruiter/updates.
 */
export const RECRUITER_RELEASE_NOTES: ReleaseNote[] = [
  {
    id: 'rec-v2026-11-company-dispatch-telegram',
    version: '2026.11',
    date: '2026-11-12',
    title: 'Company Dispatch, connected drivers, and Telegram Mini App',
    summary:
      'Authorized company teams can connect consenting drivers and manage assigned loads through the website and signed Telegram Mini App, alongside existing recruiter opportunity tools.',
    highlights: [
      'Company Dispatch is a separate, permission-controlled workflow from posting recruiting opportunities. Company owners can invite drivers to accept a company connection before assigning loads.',
      'Authorized owners and staff use the website Dispatch board or linked Telegram Mini App to manage connected-driver loads. Changes appear in the driver’s own load history.',
      'Delivered and Cancelled actions require confirmation. The Dispatch board requires a delivery date; older group-delivered loads missing actual dates are labeled unconfirmed.',
      'Telegram group setup requires a separate account link, the bot and a one-time group connection command. A group member does not gain company Dispatch permissions by adding the bot.',
      'Recruiter and driver guidance now distinguishes assigned loads, recruiting applications, the Conversations inbox and account-specific access.',
    ],
    links: [
      { label: 'Company Dispatch guide', to: '/recruiter/guide#dispatch' },
      { label: 'Recruiter FAQ', to: '/recruiter/faq' },
      { label: 'Dispatch', to: '/dispatch' },
    ],
  },
  {
    id: 'rec-v2026-05-recruiter-experience',
    version: '2026.05',
    date: '2026-05-16',
    title: 'A dedicated home for recruiters',
    summary:
      'Recruiter accounts now have their own settings, help center, feature list, and update feed — separate from the driver experience.',
    highlights: [
      'New Recruiter Settings page: company profile, verification status, billing, and account controls in one place.',
      'New /recruiter/features, /recruiter/guide, and /recruiter/faq pages tailored to recruiter workflows.',
      'In-app billing portal access — change plan, update card, or cancel without leaving the app.',
      'Cleaner driver/recruiter separation across the sidebar, bottom nav, and onboarding flow.',
      'Refreshed Terms of Service and Privacy Policy with explicit recruiter-side coverage.',
    ],
    links: [
      { label: 'Recruiter Features', to: '/recruiter/features' },
      { label: 'Recruiter Guide', to: '/recruiter/guide' },
      { label: 'Recruiter FAQ', to: '/recruiter/faq' },
    ],
  },
  {
    id: 'rec-v2026-04-contract-protection',
    version: '2026.04',
    date: '2026-04-26',
    title: 'Contract Protection for recruiters',
    summary:
      'Upload the contract you want a driver to sign directly inside the application. Drivers get AI-assisted clarity; you get a clean audit trail.',
    highlights: [
      'Attach contracts (PDF or image) to any opportunity application.',
      'AI parsing + risk review surfaces key terms to the driver in plain English.',
      'Drivers can approve, request changes, reject, or sign — every step logged.',
      'Hired-status workflow protection: required steps must be complete before marking hired.',
    ],
    links: [
      { label: 'See Features', to: '/recruiter/features' },
    ],
  },
];

export const LATEST_RECRUITER_RELEASE = RECRUITER_RELEASE_NOTES[0];
