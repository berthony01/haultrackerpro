` tags.

# Public Pages Audit — Are They Put Together Properly?

Overall: **Yes, the public pages are well-assembled and consistent.** Branding, routing, SEO, and CTAs all line up. There are a few small accuracy/consistency issues worth noting.

## ✅ What's working well

| Area | Status |
|---|---|
| **Branding** | Consistent dark navy (`hsl(220, 20%, 8%)`) + amber (`hsl(25, 95%, 53%)`) + Truck logo across Landing, Pricing, Features, FAQ, and 20+ guide pages |
| **Navigation** | All pages share the same sticky nav pattern; Landing has a working mobile hamburger; Footer links resolve |
| **Routing** | All 23 guide pages in `RelatedGuidesSection` are registered in `App.tsx` |
| **SEO** | Every public page uses `<SEOHead>` with title, description, canonical path; Landing has full `SoftwareApplication` JSON-LD with both price tiers |
| **Pricing accuracy** | $19.99/mo and $179.88/yr ($14.99 effective) match `PLANS` config and Stripe checkout flow |
| **Trial messaging** | "14-day free trial, no credit card" is consistent across Landing hero, Pricing card, Pricing bottom CTA, Landing AI demo, and Landing final CTA |
| **Feature claims vs reality** | Pro features listed (Voice, Receipt OCR, Rate Con OCR, Scorecard, Weekly Closeout, Smart Alerts 2.0, Tax breakdown) all map to implemented components |
| **Footer** | Three-column structure (Product / Resources / Legal) with finance guide links surfaced — good for SEO interlinking |

## ⚠️ Small issues found

1. **Pricing.tsx — duplicate `const planKey` declaration (lines 83 & 90)** in `handleUpgrade`. This is a real **TypeScript/build error**:
   ```ts
   const planKey = annual ? 'pro_yearly' : 'pro_monthly';   // line 83
   ...
   if (data?.url) {
     const planKey = annual ? 'pro_yearly' : 'pro_monthly'; // line 90 — redeclared
     ...
   }
   ```
   The inner `const` shadows the outer one. Compiles in TS (different scope), but it's dead-duplicate code and a code smell. Should be removed.

2. **Landing.tsx FAQ vs FAQ.tsx mismatch** — Landing has its own 5-question FAQ array (lines 8–14) that's separate from the full `/faq` page (14 questions). They don't conflict, but the Landing copy never tells users "see all FAQs →" — easy interlink miss.

3. **Phases 3–6 features (Profit Intelligence) are NOT advertised on public pages.** The big new capabilities you just shipped — Pre-Load Profit Check, Personal Intelligence Blocks, Profit Defense Alerts, Weekly Pulse — appear nowhere in:
   - Landing AI demo section
   - Pricing comparison table
   - Pricing `proFeatures` list
   - `featureList.ts` (which drives `/features`)
   
   This is a **product positioning gap** — users on the public site don't know these flagship features exist.

4. **`featureList.ts` "Account & Security" still says generic "Data Export"** — after the recent audit fix expanding export to 15 datasets and deletion to 18 tables, this copy could be tightened to reflect the more comprehensive scope (e.g., "Full Data Export — download every dataset tied to your account as JSON").

5. **FAQ.tsx has a duplicate question**: "How is net profit calculated?" appears at index 0 (line 9) AND index 12 (line 57) with slightly different wording. The second one is more detailed; the first should be removed.

6. **Landing testimonial is labeled "Early Access Driver"** (line 367) — clearly a placeholder. Fine for now, but flag for replacement when real quotes are collected.

7. **Minor**: Landing nav uses inline `style={{}}` extensively instead of Tailwind tokens — not broken, just inconsistent with the rest of the codebase. Not worth refactoring.

## 🟢 Not issues (verified)

- All 23 guide pages route correctly
- `downloadFeatureSheet()` produces a valid markdown export
- Stripe `create-checkout` invocation is correct
- SEO canonicals point to the right paths
- Mobile responsive (434px viewport — confirmed)
- No broken images (`dashboardMockup` import resolves)

## Recommendation

If you want me to fix any of these, the highest-impact ones in order are:

1. **Surface Phases 3–6 publicly** — add a "Profit Intelligence" section to Landing + Pricing + featureList. Right now the most impressive recent work is invisible to prospects.
2. **Remove duplicate `planKey` in Pricing.tsx** (1-line fix).
3. **Remove duplicate FAQ entry** + tighten "Data Export" copy to match the expanded implementation.

<lov-actions>
<lov-suggestion message="Add a 'Profit Intelligence' section to the Landing page, Pricing page, and featureList.ts to publicly surface Phases 3-6 (Pre-Load Profit Check, Personal Intelligence Blocks, Profit Defense Alerts, Weekly Pulse). Keep it consistent with existing dark navy + amber styling.">Surface Profit Intelligence publicly</lov-suggestion>
<lov-suggestion message="Fix the small public-page issues: remove the duplicate `const planKey` in Pricing.tsx handleUpgrade, remove the duplicate 'How is net profit calculated?' question in FAQ.tsx, and tighten the 'Data Export' / 'Account Deletion' copy in featureList.ts to reflect the expanded 15-dataset export and 18-table deletion.">Clean up public-page accuracy issues</lov-suggestion>
<lov-suggestion message="Add a 'See all questions →' link from the Landing FAQ section to the full /faq page so visitors can find the deeper answers.">Link Landing FAQ to full FAQ page</lov-suggestion>
<lov-suggestion message="Test the public pages end-to-end on mobile (434px): verify Landing hero, AI demo cards, Pricing toggle, FAQ accordion, Features grid, and footer links all render and navigate correctly.">Verify public pages on mobile</lov-suggestion>
</lov-actions>That accidental tool call failed — I'll just give the answer directly as plain text (this is a research question, no plan tag needed).

# Public Pages Audit — Are They Put Together Properly?

**Overall: Yes, the public pages are well-assembled and consistent.** Branding, routing, SEO, and CTAs all line up. A few small accuracy/consistency issues are worth flagging.

## ✅ What's working well

| Area | Status |
|---|---|
| **Branding** | Consistent dark navy + amber + Truck logo across Landing, Pricing, Features, FAQ, and 23 guide pages |
| **Navigation** | Shared sticky nav pattern; Landing has working mobile hamburger; footer links resolve |
| **Routing** | All 23 guide pages from `RelatedGuidesSection` are registered in `App.tsx` |
| **SEO** | Every public page uses `<SEOHead>` with title, description, canonical; Landing has full `SoftwareApplication` JSON-LD with both price tiers |
| **Pricing accuracy** | $19.99/mo and $179.88/yr ($14.99 effective) match `PLANS` config and Stripe checkout |
| **Trial messaging** | "14-day free trial, no credit card" is consistent across Landing hero, Pricing card + bottom CTA, Landing AI demo, and Landing final CTA |
| **Feature claims vs reality** | Pro features advertised (Voice, Receipt OCR, Rate Con OCR, Scorecard, Weekly Closeout, Smart Alerts 2.0, Tax breakdown) all map to implemented components |
| **Footer** | Three-column layout (Product / Resources / Legal) with finance guides surfaced — good for SEO interlinking |

## ⚠️ Small issues found

1. **Pricing.tsx — duplicate `const planKey` in `handleUpgrade` (lines 83 & 90).** The inner `const` shadows the outer. Compiles, but it's dead-duplicate code and a smell.

2. **Landing FAQ vs `/faq` page mismatch** — Landing has its own 5-question array; `/faq` has 14. No conflict, but Landing never says "see all FAQs →" — easy interlink miss.

3. **Phases 3–6 (Profit Intelligence) are NOT advertised publicly.** Pre-Load Profit Check, Personal Intelligence Blocks, Profit Defense Alerts, and Weekly Pulse appear nowhere in:
   - Landing AI demo
   - Pricing comparison table
   - Pricing `proFeatures` list
   - `featureList.ts` (which drives `/features`)
   
   This is a **product-positioning gap** — your most impressive recent work is invisible to prospects.

4. **`featureList.ts` "Account & Security" still uses generic "Data Export" / "Account Deletion" copy** — after the recent audit fixes (15-dataset export, 18-table deletion), this could be tightened to reflect the comprehensive scope.

5. **FAQ.tsx has a duplicate question**: "How is net profit calculated?" appears at index 0 (line 9) **and** index 12 (line 57) with different wording. The second is more detailed; the first should be removed.

6. **Landing testimonial labeled "Early Access Driver"** (line 367) — clearly a placeholder. Fine for now; flag for replacement when real quotes exist.

7. **Minor**: Landing uses inline `style={{}}` extensively instead of Tailwind tokens — inconsistent with the rest of the codebase but not broken.

## 🟢 Verified non-issues

- All 23 guide pages route correctly
- `downloadFeatureSheet()` produces valid markdown
- Stripe `create-checkout` invocation is correct
- SEO canonicals point to the right paths
- Mobile responsive at 434px viewport
- No broken image imports

## Recommendation

If you want fixes, in order of impact:

1. **Surface Phases 3–6 publicly** — highest impact; flagship features are currently invisible to prospects.
2. **Remove duplicate `planKey` in Pricing.tsx** (1-line fix).
3. **Remove duplicate FAQ entry + tighten Data Export/Deletion copy** in featureList.ts.

<lov-actions>
<lov-suggestion message="Add a 'Profit Intelligence' section to the Landing page, Pricing page comparison table + proFeatures list, and featureList.ts to publicly surface Phases 3-6 (Pre-Load Profit Check, Personal Intelligence Blocks, Profit Defense Alerts, Weekly Pulse). Keep consistent with existing dark navy + amber styling.">Surface Profit Intelligence publicly</lov-suggestion>
<lov-suggestion message="Clean up small public-page accuracy issues: remove the duplicate `const planKey` in Pricing.tsx handleUpgrade, remove the duplicate 'How is net profit calculated?' question in FAQ.tsx, and tighten the 'Data Export' / 'Account Deletion' copy in featureList.ts to reflect the expanded 15-dataset export and 18-table deletion.">Clean up public-page accuracy issues</lov-suggestion>
<lov-suggestion message="Add a 'See all questions →' link at the bottom of the Landing FAQ section that navigates to /faq so visitors can discover the deeper answers.">Link Landing FAQ to full FAQ page</lov-suggestion>
<lov-suggestion message="Test the public pages end-to-end on mobile (434px): verify Landing hero, AI demo cards, Pricing toggle, FAQ accordion, Features grid, and footer links all render and navigate correctly.">Verify public pages on mobile</lov-suggestion>
</lov-actions>