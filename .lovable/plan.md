

## Analysis

The user wants a full **Pricing page** (`/pricing`) with Free vs Pro plan cards, a comparison table, a "Why Go Pro?" value section, and Stripe product creation for subscriptions. The database already has `stripe_customer_id`, `subscription_status`, and `subscription_plan` on the `profiles` table, but is missing `stripe_subscription_id`. The app currently has no `/pricing` route.

Stripe integration needs to be enabled via the Lovable Stripe tool, which will create the products/prices and provide webhook handling context.

## Plan

### Step 1 — Add `stripe_subscription_id` column to profiles
- Add nullable `stripe_subscription_id text` column to the `profiles` table via migration.

### Step 2 — Enable Stripe integration
- Use the Stripe enablement tool to connect Stripe and get access to product/price creation tools.
- Create two Stripe products:
  - **HaulTrackerPro Pro Monthly** — $15/month recurring
  - **HaulTrackerPro Pro Annual** — $120/year recurring

### Step 3 — Create `/pricing` page
New file: `src/pages/Pricing.tsx`

Sections (all using existing dark theme HSL colors, no new design elements):

1. **Hero header**: "Simple Pricing. Built for Independent Drivers." with subheadline.

2. **Two pricing cards side-by-side** (Pro visually highlighted with orange border/glow):
   - **Free Plan** — $0/month with 11 included features listed with checkmarks
   - **Pro Plan** — $15/month (or $120/year, save $60) with "Everything in Free, plus:" and 8 additional features. Toggle for monthly/annual billing.

3. **"Why Go Pro?" value framing section** — 4 bullet points about margins, insights, accountability.

4. **Comparison table** — Free vs Pro columns, Pro column highlighted. All features listed with checkmarks, dashes, or descriptive text (e.g., "5 per week" vs "Unlimited").

5. **Bottom CTA** — "Start Free Today" and "Upgrade to Pro" buttons.

6. **Standard footer** (same as Landing/Features pages).

### Step 4 — Add route and navigation links
- Add `/pricing` route in `App.tsx` (public, no auth required).
- Add "Pricing" link to Landing page nav and footer.
- Add "Pricing" link to Features page footer.

### Step 5 — Create Stripe checkout edge function & webhook
- Edge function `create-checkout` that creates a Stripe Checkout Session for the selected price (monthly or annual), attaching the user's ID as metadata.
- Edge function `stripe-webhook` that handles `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted` events to update `profiles.subscription_status`, `stripe_customer_id`, and `stripe_subscription_id`.
- Wire the "Upgrade to Pro" button on the Pricing page to call the checkout function (requires auth).

### Technical Notes
- The comparison table uses the existing `Table` UI components.
- Monthly/annual toggle uses a simple `useState` boolean.
- Pro card gets an orange border (`hsl(25, 95%, 53%)`) and subtle glow to visually distinguish it.
- All styling uses existing inline HSL values consistent with Landing and Features pages.
- No changes to Smart Alerts, Scorecard, Tax, or any other existing feature logic.

