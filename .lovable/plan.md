

## End-to-End Analysis — Profit Intelligence Surface

### What's solid (no action needed)

**Demo (`ProfitIntelDemo.tsx`)** — All 6 inputs, scoring math, verdict gating (75/55), warnings, and "Use My Numbers" → `sessionStorage` + `/?prefill=load` round-trip. Disclaimer present.

**Prefill hydration (`Index.tsx`)** — 5-min freshness window, maps `rate → gross_revenue + estimated_pay`, computes `rate_per_mile`, drops fuel/other into Notes, switches to `add` page.

**Anchor scroll (`Landing.tsx`)** — `behavior: 'auto'` + rAF polling (20 frames) eliminates flicker on direct `/#profit-intelligence` hits.

**Pricing link** — Header button → `/#profit-intelligence` (line 120).

**FAQ page** — Search w/ URL deep-linking (`?q=&open=`), shareable link copy, live CSV preview with type selector, header integrity badge, accessible PDF mock (Tab/Enter/Esc/hover), AnchorValidator that auto-reruns on focus/visibility/route change.

**Single source of truth** — `loadUtils.ts` exports `CSV_HEADERS_*`; FAQ imports them; integrity badge compares against snapshot. Headers currently match — badge will show "Verified".

### Gaps / things worth doing

**1. Landing FAQ is plain text but the FAQ page is rich.** The Landing page's `faqs` array (lines 9–20) duplicates content as flat strings while `/faq` has the live previews. A user reading the Landing FAQ for "CSV columns" gets a wall of text instead of the live picker.
   - Add a "See live preview →" link on each duplicated Landing FAQ that deep-links to `/faq?open=csv-columns`, `/faq?open=pdf-mock`, `/faq?open=profit-intelligence-link`, `/faq?open=use-my-numbers`.

**2. Prefill loses two demo inputs.** `deadheadMiles` is prefilled, but `brokerOnTimePct` and the warning context never reach the form. The "Use My Numbers" FAQ already documents this honestly, but we could surface a one-line toast on arrival ("Prefilled from demo — fuel/other added to Notes, broker stays manual") so the user understands what came across.

**3. AnchorValidator is fragile in dev.** It does `fetch('/')` and parses HTML for `id="profit-intelligence"`. In Vite dev, the SSR HTML never contains that id (it's React-rendered), so the fallback path fires and the message is misleading. The iframe path still works in prod. Consider:
   - Skip the HTML-substring check and rely solely on the iframe `getElementById` result.
   - Bumping `tries` from 30 to ~60 for slow first-paint.

**4. No analytics on the new surface.** The `trackBeginCheckout`-style hooks exist (`src/lib/analytics.ts`) but the demo's "Use My Numbers" CTA, the Pricing → Profit Intelligence link, and the FAQ deep-link copies all fire silently. Add 3 GA4 events: `demo_use_my_numbers`, `pricing_profit_intel_click`, `faq_share_link_copied`.

**5. Mobile viewport check.** The demo grid is `lg:grid-cols-2 gap-6` — fine on the user's 1121px preview, but on <640px the "Score / 100" big number + verdict label can wrap awkwardly when the verdict is "Proceed With Caution". Worth a quick visual-only tweak.

**6. SEO.** The Landing page `jsonLd` doesn't expose the FAQ entries. Adding a `FAQPage` schema with the 10 Landing FAQs would help Google surface "How does load scoring use my own history" as a rich result.

### Recommended next batch (pick any subset)

```text
A. Cross-link Landing FAQ → /faq deep-links (low effort, high UX)
B. Toast on prefill arrival explaining what's manual    (low effort)
C. Harden AnchorValidator (drop fetch path, raise polls) (low effort)
D. Add 3 GA4 events on the new surface                   (low effort)
E. Add FAQPage JSON-LD to Landing                        (medium, SEO win)
F. Mobile polish on demo verdict header                  (low effort)
```

### Nothing broken

No type errors, no missing imports, header snapshot matches code, prefill round-trip is wired end-to-end, FAQ search/deep-link/share all function. The Profit Intelligence surface is shippable as-is — the items above are enhancements, not fixes.

Tell me which of A–F to proceed with (or "all") and I'll implement.

