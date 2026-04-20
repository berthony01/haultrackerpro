
User wants in-app only Weekly Pulse (since email setup isn't working). This matches the second option from the previous turn. Skip all email infrastructure — build a Monday-morning dashboard card.

Plan: Weekly Pulse dashboard card (in-app only)

What to build:
1. New component `src/components/WeeklyPulseCard.tsx`
   - Shows on dashboard Mon/Tue (or anytime if not yet dismissed for the week)
   - Reuses `buildWeeklyRecommendations` from `src/lib/profitDefenseAlerts.ts`
   - Pulls last week's loads via existing `useLoads` + `usePersonalIntelligence` hooks
   - Surfaces: top Lane to Repeat, top Lane to Avoid, top Broker to Watch
   - Includes last-week summary line: total revenue, net, margin
   - Dismiss button stores `weekly_pulse_dismissed_<YYYY-WW>` in localStorage
2. Integrate into `src/components/DashboardView.tsx` near the top (above PersonalIntelligenceBlocks), only when data exists
3. Pro-gated with locked teaser for free users (consistent with other intelligence cards)
4. Mobile-first, dark navy + amber styling
5. Add memory `mem://features/weekly-pulse`

No DB changes, no edge functions, no email. Pure client-side card driven by existing data.
