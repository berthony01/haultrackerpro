

## Recommendation: Activation > Email Reminders

You have an **activation problem**, not a reminder problem. 12 signups, 1 active user means people are dropping off **inside the app**, not forgetting to come back. Sending "log your first load!" emails to users who already saw 5 onboarding modals and didn't act will mostly land in spam or get ignored. We need to fix the in-app dropoff first, then layer email on top.

Here's the recommended order, biggest impact first.

### Phase 1 — Diagnose the dropoff (no code, ~10 min)

Before building anything, I'll query `auth.users` joined with `loads`, `expenses`, `fuel_logs`, and `user_settings` (via a migration to grant access or via a Supabase admin query) to answer:

- How many users completed the **5-step onboarding modal** vs skipped?
- How many set a **default rate per mile** in Settings?
- How many opened the **Add Load** form but didn't submit?

This tells us *where* in the funnel they're dropping. Without this, any reminder email is a guess.

### Phase 2 — Reduce in-app friction (high impact)

Three concrete changes likely to move activation from 8% to 25%+:

1. **Shorten onboarding from 5 slides to 2.** Slides 2 (set rate), 4 (Profit Intel), and 5 (Pro trial) are great content but they delay the user from the one thing that matters: logging a load. Move them to a "Tips" panel inside the dashboard.
2. **Add a sample/demo load** auto-created on signup so the dashboard isn't empty. Empty state = "I don't know what this app does" = bounce.
3. **Pre-fill the first Add Load form** with a realistic example (Atlanta → Miami, 650 mi, $2.50/mi) and a "Log your real first load" CTA. Friction goes from "blank form" to "edit and save."

### Phase 3 — Lifecycle emails (the actual reminder system)

Once the in-app flow is tighter, layer in 3 transactional emails using the infrastructure already deployed:

| When                          | Email                               | Purpose                          |
|-------------------------------|-------------------------------------|----------------------------------|
| Day 0 (immediately on signup) | Welcome + "Log your first load" CTA | Already built (`welcome` template) — just wire to `auth.users` insert trigger |
| Day 2 (if 0 loads)            | "Need help getting started?" + 30-sec demo video link | Re-engage before they forget the app exists |
| Day 7 (if 0 loads, trial mid-point) | "Your Pro trial ends in 7 days" + what they'll lose | Trial urgency drives action |

These are **legitimate transactional emails** (triggered by their signup + inactivity, expected, one-to-one). Each has a clear unsubscribe via the existing handler.

### Phase 4 — Admin visibility

Add an **Activation funnel** card to the Admin dashboard:
- Signed up → Completed onboarding → Set default rate → Logged 1st load → Logged 5th load
- Per-user "last active" + "days since signup with 0 loads" column
- One-click "Send re-engagement email" button per user

This lets you see the funnel at a glance instead of scrolling the user table.

### What I'd build first

If you give the go-ahead, I'll do **Phase 1 + Phase 2** in one pass (diagnostic query + onboarding shortened + sample load + pre-filled form). That's the highest-leverage work. Then we add Phase 3 emails once we see the funnel data. Phase 4 is a nice-to-have after.

### What I would NOT do

- **Build a daily/weekly "you haven't logged anything" email blast.** That's borderline marketing, hurts deliverability, and won't convert users who already silently churned. Targeted day-2/day-7 transactional emails to specific users are fine; bulk inactivity blasts are not.
- **Send reminders to your 3 test accounts.** I'll exclude `berthonyxyz@gmail.com`, `peejayslifestyle@gmail.com`, `wysdomaniac@gmail.com` from any lifecycle email logic.

### Reply with one of:

- **"Do Phase 1+2"** — diagnose the funnel and ship the activation fixes
- **"Just emails (Phase 3)"** — skip the in-app work, wire the 3 lifecycle emails now
- **"Do all of it"** — Phase 1 → 4 in sequence
- Or push back / change the plan

