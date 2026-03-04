

## Plan: Fix Landing Page Nav Overflow + Update Feature Highlights

### Issue 1: Nav Bar Crowding on Mobile (from screenshot)

The nav has 4 items (Features, Pricing, Sign In, Start Free) that overflow on small screens. The "Start Free" button gets cut off.

**Fix in `src/pages/Landing.tsx` (lines 39-60)**:
- Hide "Features" and "Sign In" text links on mobile (show only on `sm:` and up)
- Keep "Pricing" visible as it's key for conversion
- Keep "Start Free" button but make it more compact on mobile
- Use `hidden sm:inline-flex` on Features and Sign In buttons

### Issue 2: Landing Page Feature Lists Out of Sync

The hardcoded `freeFeatures` and `proFeatures` arrays (lines 7-21) are missing key features that have been added:

**Free features missing**: Multi-Stop Loads, Paste Parser (5/week), Estimated vs Actual Pay, Tax Set-Aside estimate
**Pro features missing**: AI Voice Logging, AI Receipt Scanning, RPM Trend Analysis, Full Tax Breakdown

**Fix**: Update both arrays to better represent the current feature set. Keep it to 5-6 highlights each (landing page shouldn't list everything — that's what /features is for), but swap in the most compelling ones:

Free (updated):
- Load Tracking (keep)
- Expense Tracking (keep)
- Net Profit Calculation (keep)
- Multi-Stop Loads (add — key differentiator)
- Paste Load Parser (5/week) (add — shows automation even on free)
- CSV Exports (keep)

Pro (updated):
- AI Voice Expense Logging (add — strongest Pro selling point)
- AI Receipt Scanning (add — automation story)
- Driver Scorecard (keep)
- Weekly Closeout (keep)
- Unlimited Paste Parser (keep)
- Advanced Performance Charts (add — replaces Smart Alerts as more visual)

### Issue 3: Features Page

The Features page (`/features`) renders directly from `featureList.ts`, so it is already up to date with all current features. No changes needed.

### Files to Edit

| File | Change |
|------|--------|
| `src/pages/Landing.tsx` | Fix nav overflow on mobile; update free/pro feature highlight arrays |

