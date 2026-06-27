# Phase 6A.0b — Live Payment Status Confirmation (Read-Only)

No code changes. This plan documents the verification result so you can decide whether to move to live end-to-end testing.

## Verified live and working
- Stripe account connected: **Directory Agents** (`acct_1Qup39I2TXbeuHi4`) — this is who gets paid.
- Pro Monthly price `price_1TGMZ7I2TXbeuHi41ceyf1zP` is a **live-mode** price ($19.99/mo) on that account.
- All required secrets present: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, 5 price IDs (Pro monthly/yearly + recruiter starter/growth/fleet).
- Checkout, webhook (signature-verified + idempotent), entitlement flip via `subscriptions` table, and customer portal all wired correctly (verified in Phase 6A).

## Conclusion
If a driver or recruiter signs up right now and pays, the card is charged for real and funds go to Directory Agents.

## Only remaining unknown (outside the code)
Stripe account payout health — bank verified, no restrictions, no holds. Visible only in your Stripe dashboard at Balance → Payouts.

## Recommended next step (your call, no code changes yet)
Pick one:
1. **Manual live smoke test** — you (or a teammate) sign up a real account, upgrade to Pro with a real card, confirm the webhook flips the account to Pro, then refund yourself in Stripe.
2. **Defer** — accept the read-only verification above and continue building.

If you choose option 1, the next phase would be a guided live test checklist (no automated charges) — say the word and I'll write it.
