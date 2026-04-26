# Dashboard UX Audit & Restructuring Plan

## 1. Current Dashboard Inventory (in render order)

| # | Section | Component | Classification |
|---|---|---|---|
| 1 | Header ("Dashboard / Your hauling overview") | inline | Passive info |
| 2 | Driver Intelligence (score + tier + best) | `DriverIntelligenceCard` | **Primary action driver** (gamified) |
| 3 | Top Drivers leaderboard | `DriverLeaderboardCard` | **Primary action driver** (competition) |
| 4 | Quarterly Tax Reminder | `TaxReminderBanner` | Alert |
| 5 | Weekly Focus | `WeeklyFocusCard` | Secondary support |
| 6 | Smart Alerts | `SmartAlertsCard` | Alert |
| 7 | Date range presets | inline | Filter control |
| 8 | Quick Actions (Expense / Load / Fuel) | inline grid | **Primary action driver** |
| 9 | Home Time Mode | `HomeTimeDashboardCard` | Secondary |
| 10 | Stat grid (Earnings/Loads/Miles/Deadhead/Pending) | `StatCard` x N | Business metric |
| 11 | Profit Overview | `ProfitOverview` | Business metric |
| 12 | Contribution Margin | `ContributionMarginCard` | Business metric |
| 13 | Pro Time Saved | `ProTimeSavedCard` | Passive (Pro value) |
| 14 | Fuel Analytics | `FuelAnalyticsCard` | Business metric |
| 15 | Tax Estimate | `TaxEstimateCard` | Business metric |
| 16 | Finalize Weekly Summary CTA | inline button | Action |
| 17 | View Reports CTA | inline button | Action |
| 18 | View Driver Scorecard CTA | inline button | Action (duplicates #2 intent) |
| 19 | Pro Insight | `ProInsightCard` | Insight |
| 20 | Smart Load Advisor | `SmartLoadAdvisor` | Insight |
| 21 | Weekly Pulse | `WeeklyPulseCard` | Insight |
| 22 | Personal Intelligence Blocks | `PersonalIntelligenceBlocks` | Insight |
| 23 | Performance Trends | `PerformanceTrends` | Insight (chart) |
| 24 | Performance Charts | `PerformanceCharts` | Insight (chart) |
| 25 | Last updated + disclaimer + empty state | inline | Passive |

## 2. Problems Identified

**Duplicate / overlapping purpose**
- #2 Intelligence card and #18 "View Driver Scorecard" CTA push the same feature in two distant places.
- #4 Tax Reminder and #15 Tax Estimate are split apart by ~10 sections.
- #5 Weekly Focus, #16 Finalize Weekly Summary, and #21 Weekly Pulse all serve weekly-cadence intent but are scattered.

**Buried high-value features**
- Smart Load Advisor (#20), Personal Intelligence (#22), Weekly Pulse (#21) sit deep below charts — most users never scroll there.
- Quick Actions (#8) sit *below* alerts/banners, making the primary "log something" action delayed.

**Competing for attention at top**
- Intelligence card + Leaderboard + Tax Banner + Weekly Focus + Smart Alerts all fire before the user can act. Five attention-grabbers stack before Quick Actions.

**Friction**
- New driver: sees a leaderboard with no rank, no clear "do this first" cue.
- Active driver: must scroll past 3 banners to reach Quick Actions.
- Pro user: their advanced insights (Personal Intelligence, Pulse, Advisor) are at the bottom — least-prominent placement for highest-value features.

**Gamification not driving behavior**
- Intelligence + Leaderboard render before Quick Actions, but there's no visual bridge between "you're 23 pts from Silver" and "log a load to earn points."

## 3. Proposed Layout — 6 Zones

```
┌─ Header
│
├─ ZONE 1 · ACTION ZONE
│   • Quick Actions (Expense / Load / Fuel)            ← moved up
│   • Driver Intelligence (with next-tier hint)         ← already action-oriented
│
├─ ZONE 2 · COMPETITION ZONE
│   • Driver Leaderboard (with Customize link)
│
├─ ZONE 3 · ALERTS (urgent only)
│   • Tax Reminder Banner
│   • Smart Alerts Card
│   • Weekly Focus Card
│
├─ ZONE 4 · QUICK SHORTCUTS / SUPPORT
│   • Home Time Mode
│   • Date Range Filter
│
├─ ZONE 5 · BUSINESS METRICS
│   • Stat grid (Earnings, Loads, Miles, Deadhead, Pending)
│   • Profit Overview
│   • Contribution Margin
│   • Fuel Analytics
│   • Tax Estimate
│   • Finalize Weekly Summary CTA
│   • View Reports CTA
│
├─ ZONE 6 · INSIGHTS (AI + trends)
│   • Weekly Pulse                          ← promoted from bottom
│   • Personal Intelligence Blocks          ← promoted
│   • Smart Load Advisor                    ← promoted
│   • Pro Insight
│   • Pro Time Saved
│   • Performance Trends
│   • Performance Charts
│
└─ Footer (last updated, disclaimer, empty state)
```

**Removed redundancy:** "View Driver Scorecard" standalone CTA is removed — its function is already served by `DriverIntelligenceCard` (which links to `/scorecard` on tap). Net feature loss: zero.

## 4. Current vs Proposed (visual)

| Position | Current | Proposed |
|---|---|---|
| 1 | Intelligence | **Quick Actions** |
| 2 | Leaderboard | Intelligence |
| 3 | Tax Banner | Leaderboard |
| 4 | Weekly Focus | Tax Banner |
| 5 | Smart Alerts | Smart Alerts |
| 6 | Date Filter | Weekly Focus |
| 7 | **Quick Actions** | Home Time |
| 8 | Home Time | Date Filter |
| ... | Stats → Insights at bottom | Stats → **Insights promoted above charts** |

## 5. Component Movement Plan (DashboardView.tsx only)

All changes are JSX reordering inside the existing `return` block. No prop changes, no new components, no styling changes.

| Move | From line | To zone | Notes |
|---|---|---|---|
| Quick Actions block (lines ~199–226) | mid | Top of Zone 1 | Wrap above `DriverIntelligenceCard` |
| `TaxReminderBanner` (158) | top | Zone 3 | Group with Smart Alerts |
| `WeeklyFocusCard` (161) | top | Zone 3 | After Smart Alerts |
| `HomeTimeDashboardCard` (230) | mid | Zone 4 | Above date filter |
| Date Range Filter (175–196) | mid | Zone 4 | Below Home Time |
| `WeeklyPulseCard` (364) | bottom | Zone 6 top | Promote |
| `PersonalIntelligenceBlocks` (367) | bottom | Zone 6 | Promote |
| `SmartLoadAdvisor` (361) | bottom | Zone 6 | Promote |
| "View Driver Scorecard" button (340–349) | mid | **Remove** | Redundant with Intelligence card |

Add lightweight `{/* === ZONE N · NAME === */}` JSX comments to mark zones for future maintainers.

## 6. Minimal Code Changes

- **Single file edit:** `src/components/DashboardView.tsx`
- **Type of change:** JSX block reordering inside existing `return`
- **Lines touched:** ~50 lines moved, 10 lines deleted (scorecard CTA), 6 comment lines added
- **No new files, no new props, no new imports** (one icon import — `Trophy` — can be removed if scorecard CTA is deleted)
- **No CSS changes**
- **No hook changes**
- **No memory updates required** (navigation structure unchanged)

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Users miss Tax Banner now lower in Zone 3 | Low | Banner self-dismisses with date logic; still above the fold on most viewports after Quick Actions + Intelligence + Leaderboard |
| Removing "View Driver Scorecard" CTA breaks discoverability | Low | Intelligence card already navigates to `/scorecard` on tap; bottom-nav unchanged |
| Date filter moving down delays metric customization | Low | Default `this_week` covers >80% of intent; users who change ranges will scroll once |
| Visual regression from JSX reorder | Very low | No styling, no Tailwind class changes |
| Mobile scroll order tested wrong | Low | Mobile-first preserved — same single-column flow |

## 8. Phased Rollout

**Phase D1 — Action Zone & Alert grouping** (single PR)
- Move Quick Actions to top
- Group Tax Banner + Smart Alerts + Weekly Focus into Zone 3
- Move Home Time + Date Filter into Zone 4
- Verify: top of dashboard now shows Quick Actions → Intelligence → Leaderboard

**Phase D2 — Insight promotion**
- Move Weekly Pulse, Personal Intelligence, Smart Load Advisor above Performance Trends
- Keep charts at bottom (passive)

**Phase D3 — Cleanup**
- Remove redundant "View Driver Scorecard" button
- Add zone comment markers
- Remove unused `Trophy` import if applicable

Each phase is independently shippable and reversible.

## 9. Testing Checklist (post-implementation)

- [ ] Dashboard renders with no console errors
- [ ] Quick Actions visible without scrolling on 375×812 viewport
- [ ] Intelligence card still navigates to `/scorecard`
- [ ] Leaderboard "Customize handle" link still works
- [ ] Tax Banner still appears when due
- [ ] Smart Alerts dismiss still functions
- [ ] Date filter still scopes stat grid + Profit Overview + Contribution Margin
- [ ] Empty state still renders when `filteredLoads.length === 0`
- [ ] TypeScript clean
- [ ] Free / Pro / trial / new-user variants all render
- [ ] Bottom nav unchanged

---

**Awaiting approval to proceed with Phase D1.**
