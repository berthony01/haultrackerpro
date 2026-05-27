# Phase 27 — Replace Starter Kit + Improve Lead Magnet Placement

## Audit findings

- Download URL (fallback): `https://pngptztxwbtozwxrtbwo.supabase.co/storage/v1/object/public/lead-magnets/HaulTrackerPro_Trucker_Starter_Kit_Free.zip` — defined in `src/lib/leadMagnet.ts`.
- Thank-you copy hardcodes "~70 KB" in `src/pages/StarterKitThanks.tsx:90`.
- Landing page has only one Starter Kit CTA at line ~831 (Section 6.5), far below the hero (hero ends at line ~260).
- New uploaded ZIP is 58.5 KB with 6 PDFs but file numbering is `00, 01, 03, 04, 05, 08` (non-sequential).
- No "passing the CDL" string currently in code — nothing to rename there.

## Changes

### 1. Repackage and replace starter kit asset

- Re-zip the uploaded PDFs with clean sequential numbering:
  - `00_Start_Here.pdf`
  - `01_CDL_Study_Companion.pdf`
  - `02_CDL_Test_Day_Checklist.pdf`
  - `03_New_Driver_Mistakes_to_Avoid.pdf`
  - `04_Owner_Operator_Document_Checklist.pdf`
  - `05_First_30_Days_Success_Checklist.pdf`
- Upload the new zip via `supabase--storage_upload` to bucket `lead-magnets` at the existing path `HaulTrackerPro_Trucker_Starter_Kit_Free.zip` so the public URL stays identical. No `leadMagnet.ts` URL change needed.

### 2. Copy updates

- `src/pages/StarterKitThanks.tsx`: change "~70 KB" → "~60 KB".
- `src/pages/StarterKit.tsx`: ensure any preparing-for-CDL language uses "foundation for preparing for the CDL" (currently fine; verify and tweak hero subhead to add explicit "preparing for the CDL" reassurance if appropriate without scope creep). Keep existing disclaimer block in trust section unchanged.

### 3. Landing page — add secondary CTA near the top

Insert a new compact CTA band immediately after Section 1 (HERO), before Section 1.5 (Opportunities), at line ~261 of `src/pages/Landing.tsx`. Reuse the existing visual pattern from Section 6.5 (outline orange button on dark band) so the lower CTA remains intact and the new one feels native.

- Headline: "New to trucking? Download the Free Trucker Starter Kit"
- Subcopy: "CDL study help, checklists, owner-op paperwork guidance, and first-30-days habits."
- Button: "Get the Free Kit" → `navigate('/starter-kit')` + `trackStarterKitCTAClicked('landing_top')`.
- Keep existing Section 6.5 CTA untouched (still tracked as `'landing'`).

### 4. Verification

- `npm run build`
- `npm run test`
- Manual: load `/`, confirm top CTA visible under hero; click → `/starter-kit`; submit form → `/starter-kit/thanks`; click Download → fetches new 60 KB ZIP with sequential filenames.

## Files touched

- `supabase storage: lead-magnets/HaulTrackerPro_Trucker_Starter_Kit_Free.zip` (replaced)
- `src/pages/StarterKitThanks.tsx` (size copy)
- `src/pages/StarterKit.tsx` (CDL wording verify/adjust)
- `src/pages/Landing.tsx` (new top CTA band)

No DB migrations, no analytics schema changes, no auth changes, no calculation logic touched.
