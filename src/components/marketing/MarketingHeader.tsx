import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Menu, Truck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shared sticky header for public marketing pages
 * (Pricing, Features, Recruiters, Assistants & Agencies, etc.).
 *
 * Landing.tsx keeps its own bespoke nav because it carries two
 * audience-specific CTAs above the fold; everything else should
 * use this so links, CTA, and mobile menu stay consistent.
 */
const NAVY_BG = 'hsl(220, 20%, 8%)';
const NAVY_BORDER = 'hsl(220, 16%, 16%)';
const AMBER = 'hsl(25, 95%, 53%)';
const TEXT_MUTED = 'hsl(220, 10%, 70%)';

const NAV_LINKS: { label: string; href: string }[] = [
  { label: 'Features', href: '/features' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'For Recruiters', href: '/recruiters' },
  { label: 'Assistants & Agencies', href: '/assistants-agencies' },
];

export interface MarketingHeaderProps {
  /** Optional override for the primary CTA on the right. */
  primaryCta?: { label: string; mobileLabel?: string; onClick: () => void };
}

export function MarketingHeader({ primaryCta }: MarketingHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const cta = primaryCta ?? {
    label: 'Start Tracking Free',
    mobileLabel: 'Start Free',
    onClick: () => navigate('/auth'),
  };

  return (
    <nav
      data-testid="marketing-header"
      className="sticky top-0 z-50 border-b"
      style={{ background: NAVY_BG, borderColor: NAVY_BORDER }}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2"
          aria-label="HaulTrackerPro home"
        >
          <Truck className="h-6 w-6" style={{ color: AMBER }} />
          <span className="text-lg font-black tracking-tight text-white">HaulTrackerPro</span>
        </button>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((item) => {
            const active = location.pathname === item.href;
            return (
              <Button
                key={item.href}
                variant="ghost"
                onClick={() => navigate(item.href)}
                className="text-sm px-3"
                style={{ color: active ? 'white' : TEXT_MUTED }}
              >
                {item.label}
              </Button>
            );
          })}
          <Button
            variant="ghost"
            onClick={() => navigate('/auth')}
            className="text-sm px-3"
            style={{ color: TEXT_MUTED }}
          >
            Sign In
          </Button>
          <Button
            onClick={cta.onClick}
            className="text-sm font-bold rounded-xl px-5 ml-1 whitespace-nowrap"
            style={{ background: AMBER, color: 'white' }}
          >
            {cta.label}
          </Button>
        </div>

        {/* Mobile right side */}
        <div className="flex md:hidden items-center gap-2">
          <Button
            onClick={cta.onClick}
            className="text-xs font-bold rounded-xl px-3 whitespace-nowrap"
            style={{ background: AMBER, color: 'white' }}
          >
            {cta.mobileLabel ?? cta.label}
          </Button>
          <button
            onClick={() => setOpen((v) => !v)}
            className="p-2 rounded-lg"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            style={{ color: TEXT_MUTED }}
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {open && (
        <div
          className="md:hidden border-t"
          style={{ background: 'hsl(220, 20%, 10%)', borderColor: NAVY_BORDER }}
        >
          <div className="flex flex-col px-4 py-3 space-y-1">
            {[...NAV_LINKS, { label: 'FAQ', href: '/faq' }, { label: 'Sign In', href: '/auth' }].map((item) => (
              <button
                key={item.href}
                onClick={() => {
                  setOpen(false);
                  navigate(item.href);
                }}
                className="w-full text-left px-3 py-3 rounded-lg text-sm font-medium hover:bg-white/5"
                style={{ color: TEXT_MUTED }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

export default MarketingHeader;
