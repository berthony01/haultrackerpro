# Small UX Clarity Patch — Opportunity Preferences Note Placement

## 1. Add explanatory note inside ProfileEntryCard

Update `src/components/opportunities/OpportunitiesPage.tsx`:

- Inside the `ProfileEntryCard` component (lines 481–548), add a compact helper card/note directly beneath the main body text and above the CTA button.
- The note should render for `state === 'none'` and `state === 'incomplete'`.
- For `state === 'complete'`, render a smaller muted variant (optional, collapsed or subtler).

**Copy:**
- Title: "Why Opportunity Preferences?"
- Body: "Your main HaulTrackerPro account stays the same. These preferences only help improve match quality and show approved recruiters the information you choose to share when you request info."

**Style:**
- Subtle dark muted card (`bg-muted/30` or `bg-card/50`, `border-border/40`)
- Compact padding (`p-3` or `p-4`)
- Muted text (`text-muted-foreground`, `text-xs` or `text-sm`)
- Optional info icon (`Info` from lucide-react) in `text-muted-foreground`
- Keep it visually subordinate to the main card content

## 2. Optional microcopy softening

If readability improves, update `ProfileEntryCard` cfg titles:
- `state === 'none'`: change from "Complete Your Opportunity Preferences" → "Improve Your Opportunity Matches"
- `state === 'incomplete'`: change from "Complete Your Opportunity Preferences" → "Improve Your Opportunity Matches" (or keep as-is if the note provides enough context)
- CTA stays "Set Preferences" / "Edit Preferences"

Decision: evaluate after adding the note. If the note makes the intent clear, keep existing titles; if still too "setup" oriented, soften.

## 3. Out of scope

- No database changes
- No RLS changes
- No Stripe changes
- No recruiter billing changes
- No onboarding logic changes
- No match engine changes
- No application flow changes
- No admin dashboard changes
- No LoadForm / reports / parking changes

## 4. Verification

- `npx tsc --noEmit` clean
- `bunx vitest run` passes
- Opportunities page renders note immediately below entry card body
- No "Create Driver Profile" or "verified recruiter" wording remains
- Request Info flow unchanged
- Recruiter flows unchanged

## Files to edit

1. `src/components/opportunities/OpportunitiesPage.tsx`