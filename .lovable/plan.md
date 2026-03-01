

## Problem

The price IDs hardcoded in `src/pages/Pricing.tsx` do not exist in your Stripe account. They were likely placeholder values. Your Stripe account has products from other projects but no "HaulTrackerPro" products with $15/month or $120/year pricing.

## Plan

### Step 1: Create two Stripe prices for HaulTrackerPro

Using the Stripe tools, create:
- **HaulTrackerPro Pro Monthly** — $15.00/month recurring
- **HaulTrackerPro Pro Annual** — $120.00/year recurring

### Step 2: Update `src/pages/Pricing.tsx`

Replace the two invalid constants with the real price IDs returned from Step 1:

```typescript
const MONTHLY_PRICE_ID = '<new_monthly_price_id>';
const ANNUAL_PRICE_ID = '<new_annual_price_id>';
```

No other code changes needed. The edge function, CORS, auth flow, and error handling are all correct — the only issue is invalid price IDs.

