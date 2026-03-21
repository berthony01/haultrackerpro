

## Plan: Auto-Start Pro Trial + Conversion System

Implement the complete system from the uploaded prompt: auto-trial on signup, trial/expired banners, milestone nudges, and updated onboarding.

### Task 1: Database Migration

Run SQL to create:
- `auto_start_pro_trial()` trigger function — inserts a 14-day trial subscription row when a `user_settings` row is created (if no subscription exists)
- Trigger `on_user_created_start_trial` on `user_settings` table
- `expire_ended_trials()` function — sets trialing subscriptions past their `trial_end` to `free`

### Task 2: Create `src/components/TrialBanner.tsx`

New file with two exports:
- **`TrialBanner`** — shows during active trial with days-left countdown, urgency styling (green > 7d, yellow 4-7d, red 1-3d), and upgrade CTA when <= 7 days
- **`TrialExpiredBanner`** — shows after trial ends, prompts upgrade, dismissible

### Task 3: Create `src/components/MilestoneNudges.tsx`

New file with contextual conversion nudges based on usage milestones:
- 3 loads → scorecard teaser
- 2 loads + 0 expenses → prompt to add expenses
- 5 loads → RPM trend teaser
- 5 expenses → voice logging teaser
- 10 loads → weekly closeout teaser
- 20 loads → expense breakdown teaser

Nudges are dismissible (persisted in localStorage), hidden during active trial, and only shown to free users.

### Task 4: Replace `src/components/OnboardingModal.tsx`

Replace slide 4 from "Close Out Every Week" to "You're Starting on Pro" — with a 2x2 grid of Pro feature highlights (Voice Logging, Receipt Scan, Driver Score, All Charts). Final CTA changes from "Log Your First Load" to "Start Tracking".

### Task 5: Update `src/pages/Index.tsx`

- Add imports for `TrialBanner`, `TrialExpiredBanner`, `MilestoneNudges`
- Add variables after line 66: `isTrialing`, `trialEnd`, `trialExpired`, `handleUpgrade`
- Wrap the dashboard block (lines 298-308) with trial banners and milestone nudges above `DashboardView`

### Files Changed
- `src/components/TrialBanner.tsx` (new)
- `src/components/MilestoneNudges.tsx` (new)
- `src/components/OnboardingModal.tsx` (replaced)
- `src/pages/Index.tsx` (imports + variables + dashboard wrapper)
- 1 database migration (trigger + functions)

### What stays unchanged
- `useSubscription.ts`, all edge functions, billing logic, RLS policies, styling, navigation, all other components

