

## Plan: Landing Page Overhaul

Replace `src/pages/Landing.tsx` entirely with the new version from the uploaded prompt.

### What changes

**Removed sections** (still live on their own pages):
- "Who It's For" → /features
- "Free Calculators" → individual tool URLs
- "Free Features" grid → /features
- "Pro Features" grid → /pricing
- "Built for Drivers" → redundant

**Added sections**:
- AI Demo — showcases Voice Logging and Receipt Scanning with step-by-step visuals
- Social Proof — trust signals grid + early-access testimonial placeholder

**Updated**:
- All CTAs unified to "Start Tracking Free"
- FAQ shortened to 5 items (adds Pro trial question)
- Section order: Hero → How It Works → Pain Points → AI Demo → Social Proof → FAQ → Final CTA → Footer

### Files changed
- `src/pages/Landing.tsx` — full replacement

### What stays the same
- All other files untouched
- Same imports (`dashboardMockup`, `SEOHead`)
- Same routes and navigation
- Same styling patterns (inline HSL)

