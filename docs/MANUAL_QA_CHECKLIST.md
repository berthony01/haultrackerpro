# HaulTrackerPro — Manual QA Checklist

Run through this list on a real mobile device and a desktop browser before each public-facing release. Mark each item ✅ Pass / ❌ Fail / ⚠️ Notes.

## 1. Auth
- [ ] Sign up with new email → confirmation email received
- [ ] Email confirmation link logs user in
- [ ] Login with existing account
- [ ] Forgot password → reset email → reset flow completes
- [ ] Logout returns to landing/auth

## 2. Add Load
- [ ] Open Add Load form (FAB and Loads page)
- [ ] Save load with required fields only
- [ ] Edit existing load → values persist
- [ ] Delete load → removed from list and dashboard totals
- [ ] Multi-stop load saves all stops

### 2a. Phase 29 — Final drop-off date (multi-stop)
- [ ] Single-stop load: pickup date alone still controls reporting when no drop-off date is entered
- [ ] Multi-stop load with pickup May 29 and final stop May 30 → load appears in the May 30 week, not May 29
- [ ] Editing the final stop date and re-saving moves the load into the new week on the dashboard, loads page, reports, and weekly summary
- [ ] Duplicating a multi-stop load clears all `stop_date` values on the copy (no leaked old dates)
- [ ] Pasting a multi-stop dispatch with NO stop dates surfaces the "Final stop date is missing" warning; saving again confirms
- [ ] Scanning a multi-stop rate confirmation that has clear per-stop dates fills them in and the final stop date is used as the reporting date
- [ ] Scan results map any AI "Dropoff" stop_type to "Drop" in the editor

## 3. Telegram / Paste Import
- [ ] Paste raw broker text into Paste Load Parser
- [ ] Auto-fill populates locations, miles, rate, deadhead
- [ ] Free tier: 5/week limit enforced
- [ ] Pro tier: unlimited parses
- [ ] Manual review prompt appears for ambiguous mileage

## 4. OCR Receipt Scan
- [ ] Upload receipt image (camera + file)
- [ ] Tesseract scan completes without crash
- [ ] Parsed amount/category/date shown
- [ ] "Fill Form" only fills empty fields
- [ ] Monthly automation limit enforced

## 5. Voice Expense
- [ ] Mic permission prompt appears first time
- [ ] Recording auto-stops after 3s silence (cap 30s)
- [ ] Natural-language date parsed correctly
- [ ] No audio file persisted
- [ ] Parsed expense saved correctly

## 6. Add Expense
- [ ] Manual expense saves with category + amount
- [ ] Edit and delete work
- [ ] Recurring expense template creates monthly entry
- [ ] Schedule C category mapping correct in tax view

## 7. Add Fuel
- [ ] Fuel log saves (gallons, price, location, date)
- [ ] MPG calculation updates
- [ ] Optional load link works (and "none" sentinel)
- [ ] Edit/delete fuel log
- [ ] Pro fuel analytics render

## 8. Reports
- [ ] Date range filter updates all charts/tables
- [ ] PDF export downloads and opens
- [ ] CSV export downloads and opens in Excel/Sheets
- [ ] Tax/Schedule C report categories accurate
- [ ] Empty state shows when no data in range

## 9. Stripe / Billing
- [ ] Upgrade to Pro → Stripe Checkout opens
- [ ] Successful checkout flips account to Pro
- [ ] Customer Portal opens from Settings
- [ ] Cancel subscription reflects in app within ~1 min
- [ ] Auto-trial system retired; verify billing pages do not reference trial language.

## 10. Mobile Layout (≤768px)
- [ ] Bottom nav (2 + FAB + 2) renders, no overlap
- [ ] Forms scroll, inputs not clipped by keyboard
- [ ] Sheets/dialogs open in dark theme
- [ ] Tap targets ≥44px
- [ ] No horizontal scroll on any authenticated page

## 11. Desktop Layout (≥1024px)
- [ ] Sidebar visible and collapsible
- [ ] Tables render in full (Loads/Expenses/Fuel)
- [ ] Charts not cropped
- [ ] Hover/focus states visible
- [ ] Keyboard tab order logical across nav + forms

## 12. Parking Report Flow
- [ ] Parking page loads with locations list
- [ ] Search/filter narrows results
- [ ] "Report availability" submits successfully
- [ ] Confidence/availability indicators render
- [ ] Points/leaderboard updates after report

---

## Known Preview-Only Warning

**`RESET_BLANK_CHECK` from `lovable.js`** — this warning appears only inside the Lovable preview harness. It is **not** part of the application code and does **not** appear on the published domain (haultrackerpro.com / haultrackerpro.lovable.app). Safe to ignore during QA.
