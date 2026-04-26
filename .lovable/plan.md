## Audit Findings

I scanned every `<img>` and image reference in `src/` and `public/`. Here's the complete picture:

### ❌ The only true placeholder
**`src/components/SEOConversionSections.tsx` line 63** — `ProductProofSection` renders:
```tsx
<img src="/placeholder.svg" alt="HaulTrackerPro dashboard..." />
```
This is the generic gray Lovable placeholder SVG (`public/placeholder.svg`).

### Why this matters more than it looks
`ProductProofSection` is imported and rendered on **21 public SEO/guide pages**, so the same empty placeholder shows up across the entire resource library:

- TruckerBookkeepingGuide (the page you're on)
- TruckerFuelCostCalculator, TruckerCostPerMileBreakdown
- TruckingExpensesList, TruckingExpenseCategories, TruckingProfitCalculator
- TruckingCostPerMile, TruckingCostPerMileCalculator, TruckingMaintenanceCostPerMile
- TruckingMileageExpenseGuide, FuelCostPerMileTrucking
- OwnerOperatorTaxWriteOffs, OwnerOperatorSalary, OwnerOperatorOperatingCosts, OwnerOperatorExpensesList
- TruckDriverExpenses, TruckDriverFuelExpenses, TruckDriverOperatingExpenses, TruckDriverPerDiem, TruckDriverTaxDeductions

Fixing it in one place fixes it everywhere.

### ✅ All other images are real (no action needed)
- `src/pages/Landing.tsx` — uses `src/assets/dashboard-mockup.png` ✅
- `src/pages/Install.tsx` — uses `/pwa-icon-192.png` ✅
- `src/components/ScanLoadModal.tsx` & `ReceiptScanModal.tsx` — render user-uploaded previews ✅
- `src/pages/StarterKit.tsx`, `Pricing.tsx`, `Features.tsx`, etc. — icon-based, no placeholders
- `public/placeholder.svg` itself — only referenced by the one line above

---

## Proposed Fix (single, surgical change)

**File:** `src/components/SEOConversionSections.tsx`

1. Import the existing real dashboard asset:
   ```tsx
   import dashboardMockup from '@/assets/dashboard-mockup.png';
   ```
2. Replace the placeholder in `ProductProofSection`:
   ```tsx
   <img
     src={dashboardMockup}
     alt="HaulTrackerPro dashboard showing loads, expenses, and profit overview"
     className="w-full h-auto object-contain bg-card"
     loading="lazy"
   />
   ```
3. Adjust the wrapper so the real screenshot displays cleanly (remove the fixed `h-48 sm:h-64 object-cover` crop that would clip the dashboard) — keep rounded border + shadow so it stays consistent with the platform's card styling.

**No other files change.** No new assets needed — we reuse the dashboard image already shipping on the landing page, which keeps branding consistent across landing + all SEO pages.

---

## Verification

- Visit `/trucker-bookkeeping-guide` and 2–3 other guide pages → confirm the real dashboard appears in the "See Your Trucking Finances In One Dashboard" section
- Confirm landing page (`/`) is unchanged
- `tsc --noEmit` clean
- Mobile (375px) and desktop layouts intact
