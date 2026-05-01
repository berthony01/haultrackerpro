# Plan: Cost Profile → True Pre-Acceptance Profitability Check

## The decision

Yes, the platform should be able to tell a driver "Is this load profitable?" **before** they accept it — based on **costs the driver pre-registers themselves**, not just on rolling history. This builds on what already exists.

## What's already built (don't rebuild it)

- `useProfitCheck.ts` — runs as the driver types into LoadForm
- `ProfitCheckCard.tsx` — shows Strong / Fair / Weak / Risky badge with reasons
- It already uses lane history, broker reliability, and rolling cost-per-mile

**Gap:** It depends on `operating_metrics.rolling_cost_per_mile`, which is computed from the last 60 days of expenses. New drivers, or anyone who hasn't logged enough expenses yet, get "Not enough history yet" and no real profitability answer.

## What we'll add

### 1. New "My Cost Profile" section in Settings

A dedicated area where the driver pre-registers their known operating costs **once**. Exact fields:

**Fixed monthly costs** (driver fills in dollar amounts):
- Truck payment / lease
- Trailer payment
- Insurance
- Permits & licensing
- ELD / software / phone
- Other fixed monthly

**Variable per-mile costs:**
- Fuel: average MPG + diesel price per gallon → app derives fuel $/mile
- Maintenance reserve ($/mile, e.g. $0.10)
- Tires reserve ($/mile, e.g. $0.03)
- Tolls average ($/mile, optional)

**Per-day costs:**
- Meals & lodging ($/day on the road)

**Driver expectation:**
- Minimum acceptable profit margin % (e.g. "I won't run a load under 20% margin")
- Minimum acceptable $/mile
- Estimated days per 1,000 miles (default 2.5) — used to spread per-day costs

The driver can save partial info. The more they fill in, the sharper the check.

### 2. New `cost_profile` table

```text
cost_profile (one row per user)
├─ Fixed monthly costs (truck, insurance, etc.)
├─ Per-mile variable rates (maintenance, tires, tolls)
├─ Fuel inputs (avg MPG, diesel $/gal)
├─ Per-day costs (meals)
├─ Targets (min margin %, min RPM, days per 1k mi)
└─ Estimated monthly miles (used to convert fixed → per-mile)
```

RLS: user owns their row, standard CRUD policies.

### 3. Upgraded profit-check math

`useProfitCheck` will use a layered cost model — falls back gracefully:

```text
Cost-per-mile for THIS load =
   Fuel CPM      = diesel_price / avg_mpg
 + Maintenance   = user-entered $/mi
 + Tires         = user-entered $/mi
 + Tolls         = user-entered $/mi
 + Fixed share   = (sum of fixed monthly) / estimated monthly miles
 + Per-day share = (meals × estimated days for this load) / total miles

Estimated load cost = CPM × total_miles (loaded + deadhead)
Estimated net       = estimated_pay − estimated load cost
Estimated margin %  = estimated_net / estimated_pay × 100

Decision = compare margin % and RPM against driver's
           pre-registered targets (min margin, min RPM)
```

**Priority order for CPM:**
1. Cost Profile (driver-defined) — primary
2. Rolling 60-day actuals — used as a sanity check / blends in if both exist
3. Neither — show "Set up your Cost Profile" CTA inside the card

### 4. UI changes

- **Settings page:** new "My Cost Profile" section with the inputs above (collapsible groups: Fixed / Variable / Targets)
- **LoadForm:** ProfitCheckCard now shows real numbers from Day 1 if profile exists
- **ProfitCheckCard:** new line "Based on your Cost Profile" or "Based on 60-day actuals" so the driver sees where the number comes from
- **LoadForm decision banner:** add an explicit "❌ Below your minimum margin" / "✅ Meets your minimum margin" line when targets are set
- **First-run nudge:** if a driver opens LoadForm without a cost profile, show a small banner: "Set up your costs in Settings to know if a load is profitable before you accept it." (one-tap to settings)

### 5. Onboarding tie-in

Add a 5th onboarding step (skippable): "Tell us your costs so we can warn you about bad loads." Pre-fills with realistic sample numbers the driver can edit.

## Out of scope (intentionally)

- Editing per-load profit after acceptance — already covered by linked expenses + reports
- Auto-pulling fuel prices from an API — driver enters their own, simpler & accurate
- AI-generated cost profile — deterministic only, per project rule

## Why this is the right design (honest take)

- **Predictive, not reactive** — works Day 1, before any history exists
- **Driver-owned numbers** — they trust their own inputs more than a black-box average
- **Self-correcting over time** — once 60-day actuals exist, app can compare profile vs reality and nudge: "Your real fuel CPM is $0.65, you have $0.55 in your profile — update?"
- **Aligns with existing architecture** — extends `useProfitCheck` and `ProfitCheckCard`, no duplicate UI
- **Surgical** — one new table, one settings section, one math upgrade. No refactor of LoadForm or reports

## Files touched

- New: `supabase/migrations/...` (cost_profile table + RLS)
- New: `src/hooks/useCostProfile.ts`
- New: `src/components/CostProfileSettings.tsx`
- Edit: `src/components/SettingsView.tsx` (mount new section)
- Edit: `src/hooks/useProfitCheck.ts` (layered CPM math)
- Edit: `src/components/ProfitCheckCard.tsx` (source-of-numbers label, target indicator)
- Edit: `src/components/LoadForm.tsx` (first-run banner if profile empty)
- Edit: `src/components/Onboarding.tsx` (optional 5th step)

Approve and I'll build it.
