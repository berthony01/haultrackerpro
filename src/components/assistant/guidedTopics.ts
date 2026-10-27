/**
 * Deterministic Free guided-help menus for the floating HaulTracker Assistant.
 * Static content only: no model calls, no data reads. Every `to` is an existing app route.
 */
import type { GuideAudience } from '@/components/assistant/HaulTrackerAssistantLauncher';

export type GuideLink = { label: string; to: string; hint: string };
export type GuideTopic = {
  id: string;
  label: string;
  body?: string;
  links?: GuideLink[];
  children?: GuideTopic[];
  /** Self-driver only: mounts the canonical DriverWorkConversation (review before save). */
  findWork?: true;
};

const DOCS: GuideLink = { label: 'Help docs', to: '/docs', hint: 'Guides and answers.' };
const ASSISTANT_ACCESS: GuideTopic = {
  id: 'ai-access', label: 'About AI answers',
  body: 'Guided help is free and is not AI-generated. AI answers are a paid feature and only appear when your plan and the server allow them.',
  links: [{ label: 'Pricing', to: '/pricing', hint: 'Plans that include AI answers.' }, { label: 'Privacy Policy', to: '/privacy', hint: 'How assistant data is handled.' }],
};

export const GUIDE_TOPICS: Record<GuideAudience, GuideTopic[]> = {
  self_driver: [
    { id: 'find-work', label: 'Find work', body: 'Describe the work you want, then review your answers before saving. Nothing is saved automatically.', findWork: true },
    {
      id: 'loads', label: 'Loads and expenses', body: 'What do you want to record?',
      children: [
        { id: 'add-load', label: 'Add a load', body: 'Enter pay, loaded miles and stops. Estimated pay uses loaded miles × rate plus fees.', links: [{ label: 'Add a load', to: '/dashboard?page=add', hint: 'Open the load form.' }] },
        { id: 'add-expense', label: 'Log an expense or fuel', body: 'Use the quick actions on your dashboard to add an expense or a fuel stop.', links: [{ label: 'Dashboard', to: '/dashboard', hint: 'Quick actions for expenses and fuel.' }] },
      ],
    },
    { id: 'reports', label: 'Reports and profit', body: 'See weekly and monthly profit, and export reports.', links: [{ label: 'Reports', to: '/dashboard?page=reports', hint: 'Weekly and monthly profit.' }] },
    {
      id: 'helpers', label: 'Assistants and work items', body: 'Choose what you want to manage.',
      children: [
        { id: 'assistant-control', label: 'Who can help me', body: 'Review or change what your assistant can see and do.', links: [{ label: 'Assistant access', to: '/driver/assistant-control', hint: 'Permissions you granted.' }, { label: 'Agency approvals', to: '/driver/agency-approvals', hint: 'Agency access requests.' }] },
        { id: 'work-items', label: 'Shared work items', body: 'Tasks shared between you and your helpers.', links: [{ label: 'Work items', to: '/driver/work-items', hint: 'Open your task list.' }] },
      ],
    },
    { ...ASSISTANT_ACCESS, links: [...(ASSISTANT_ACCESS.links ?? []), { label: 'How-to guide', to: '/how-to-use-haultrackerpro', hint: 'Step-by-step help.' }] },
  ],
  recruiter: [
    { id: 'opportunities', label: 'Opportunities', body: 'Create and manage the jobs you post to drivers.', links: [{ label: 'Manage opportunities', to: '/recruiter/manage', hint: 'Post and edit opportunities.' }, { label: 'Recruiter guide', to: '/recruiter/guide', hint: 'How posting works.' }] },
    { id: 'applications', label: 'Applications', body: 'Review drivers who applied to your opportunities.', links: [{ label: 'Applications', to: '/recruiter/applications', hint: 'Review driver applications.' }] },
    { id: 'conversations', label: 'Conversations', body: 'Messages with real drivers live in Conversations, separate from this assistant.', links: [{ label: 'Conversations', to: '/conversations', hint: 'Your driver messages.' }] },
    {
      id: 'setup', label: 'Setup and reports', body: 'What do you want to set up?',
      children: [
        { id: 'onboarding', label: 'Finish my recruiter setup', body: 'Complete your company and contact details.', links: [{ label: 'Recruiter setup', to: '/recruiter/onboarding', hint: 'Profile and company.' }] },
        { id: 'recruiter-reports', label: 'Recruiting reports', body: 'See how your opportunities perform.', links: [{ label: 'Reports', to: '/recruiter/reports', hint: 'Recruiting results.' }] },
      ],
    },
    { ...ASSISTANT_ACCESS, links: [...(ASSISTANT_ACCESS.links ?? []), { label: 'Recruiter FAQ', to: '/recruiter/faq', hint: 'Common questions.' }] },
  ],
  agency: [
    { id: 'clients', label: 'Clients', body: 'See the drivers your agency works with.', links: [{ label: 'Agency dashboard', to: '/agency', hint: 'Clients, packages and requests.' }] },
    { id: 'delegation', label: 'Delegation and access', body: 'Drivers approve agency access and can revoke it at any time. Your team only sees what each driver approved.', links: [{ label: 'Assistants & agencies', to: '/assistants-agencies', hint: 'How agency access works.' }, DOCS] },
    { id: 'packages', label: 'Packages and work items', body: 'Packages and work items are managed from the agency dashboard.', links: [{ label: 'Agency dashboard', to: '/agency', hint: 'Packages and work items.' }] },
    ASSISTANT_ACCESS,
  ],
  acting_assistant: [
    { id: 'tasks', label: 'Tasks I can do', body: 'You can only do what the driver you help has approved. Your assistant dashboard shows those tasks.', links: [{ label: 'Assistant dashboard', to: '/assistant', hint: 'Drivers you help and your access.' }] },
    { id: 'permissions', label: 'My permissions', body: 'The driver controls your access. Ask them to change it if you need more.', links: [{ label: 'Assistant settings', to: '/assistant/settings', hint: 'Your assistant account.' }, DOCS] },
    ASSISTANT_ACCESS,
  ],
  general: [
    { id: 'help', label: 'Help and guides', body: 'Browse guides and common questions.', links: [DOCS, { label: 'FAQ', to: '/faq', hint: 'Common questions.' }] },
    ASSISTANT_ACCESS,
  ],
};

/** Resolves a stored id path to topics; stops at the first unknown id (fail closed to the menu). */
export function findTopicPath(roots: GuideTopic[], ids: string[]): GuideTopic[] {
  const out: GuideTopic[] = [];
  let level = roots;
  for (const id of ids) {
    const t = level.find((x) => x.id === id);
    if (!t) break;
    out.push(t);
    level = t.children ?? [];
  }
  return out;
}
