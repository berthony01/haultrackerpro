import { useNavigate } from 'react-router-dom';
import { Truck, Briefcase, Users, Building2, ArrowRight, ArrowLeft } from 'lucide-react';
import SEOHead from '@/components/SEOHead';

const AMBER = 'hsl(25, 95%, 53%)';
const NAVY_BG = 'hsl(220, 20%, 8%)';
const NAVY_CARD = 'hsl(220, 22%, 12%)';
const NAVY_BORDER = 'hsl(220, 16%, 18%)';
const TEXT_MUTED = 'hsl(220, 10%, 65%)';
const TEXT_DIM = 'hsl(220, 10%, 50%)';

type Tile = {
  id: 'driver' | 'recruiter' | 'assistant' | 'agency';
  label: string;
  blurb: string;
  Icon: typeof Truck;
  to: string;
};

const TILES: Tile[] = [
  {
    id: 'driver',
    label: 'Track my trucking business',
    blurb: 'Loads, expenses, fuel logs, reports, and real profit.',
    Icon: Truck,
    to: '/dashboard',
  },
  {
    id: 'recruiter',
    label: 'Post driver opportunities',
    blurb: 'Recruit drivers with structured, transparent listings.',
    Icon: Briefcase,
    to: '/recruiter',
  },
  {
    id: 'assistant',
    label: 'Help drivers as an assistant',
    blurb: 'Manage trucking records for drivers who invite you.',
    Icon: Users,
    to: '/assistant',
  },
  {
    id: 'agency',
    label: 'Build a back-office agency',
    blurb: 'Create a workspace and manage approved driver clients.',
    Icon: Building2,
    to: '/agency',
  },
];

/**
 * Phase 1S-A8 — record the transient workspace choice before navigating.
 * Preference hint ONLY: `useViewMode` validates it against server-derived
 * capability rows and is the sole authorization boundary.
 */
function recordWorkspaceIntent(id: Tile['id']) {
  try {
    if (id === 'driver' || id === 'recruiter') {
      sessionStorage.setItem('htp_workspace_intent', id);
    } else {
      sessionStorage.removeItem('htp_workspace_intent');
    }
  } catch {}
}

export default function CapabilityLauncher() {
  const navigate = useNavigate();

    <div className="min-h-screen px-4 py-10" style={{ background: NAVY_BG }}>
      <SEOHead
        title="Choose your workspace | HaulTrackerPro"
        description="Pick how you want to use HaulTrackerPro."
        path="/start"
        noindex
      />
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs font-medium mb-6"
          style={{ color: TEXT_DIM }}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>

        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
          What do you want to do?
        </h1>
        <p className="mt-2 text-sm" style={{ color: TEXT_MUTED }}>
          A single HaulTrackerPro account can be a driver, recruiter, driver assistant, or back-office agency.
          Pick the capability you want right now — you can switch any time.
        </p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TILES.map((t) => (
            <button
              key={t.id}
              data-capability={t.id}
              onClick={() => navigate(t.to)}
              className="group text-left rounded-2xl border p-5 transition-all hover:border-white/20"
              style={{ background: NAVY_CARD, borderColor: NAVY_BORDER }}
            >
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center justify-center rounded-xl p-2.5" style={{ background: 'rgba(249,115,22,0.12)' }}>
                  <t.Icon className="h-5 w-5" style={{ color: AMBER }} />
                </div>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" style={{ color: TEXT_DIM }} />
              </div>
              <div className="mt-4 font-bold text-base text-white">{t.label}</div>
              <p className="mt-1 text-xs leading-snug" style={{ color: TEXT_MUTED }}>{t.blurb}</p>
            </button>
          ))}
        </div>

        <p className="mt-8 text-xs" style={{ color: TEXT_DIM }}>
          Assistant access begins through a driver invite. Agency workspaces never gain access to a driver's
          account without explicit driver-approved delegation. HaulTrackerPro does not process payments
          between drivers and assistants or agencies.
        </p>
      </div>
    </div>
  );
}
