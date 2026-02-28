

## Analysis

The downloadable feature sheet already exists — it's the **"Download Feature Sheet"** button on the `/features` page. It generates a Markdown file client-side from `src/lib/featureList.ts`. You can access it at `/features` or via the "View All Features" button in Settings > Support.

### Missing Features from the Feature List

Two recently added features need to be reflected in `featureList.ts` (which automatically updates both the page and the download):

1. **Multi-Stop Auto-Detection** (Load & Expense Management) — The numbered-stop paste parser (`1#:`, `2#:`) that auto-toggles multi-stop mode. Not listed.

2. **Smart Alerts description update** — Smart Alerts 2.0 now has a tiered model (basic alerts free, advanced alerts Pro-only). The current description doesn't mention this.

### Plan

1. **Add "Multi-Stop Auto-Detection"** entry to the "Load & Expense Management" category in `src/lib/featureList.ts` with a `ClipboardPaste` or `Sparkles` icon.

2. **Update Smart Alerts 2.0 description** in the "Pro Features" category to reflect the tiered access model (basic alerts free, advanced insights Pro).

No other files need changing — the Features page and download function already read from `featureList`, so both update automatically.

