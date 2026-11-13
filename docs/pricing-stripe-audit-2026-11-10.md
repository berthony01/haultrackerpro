# HaulTracker Pro pricing and permissions audit
**Date:** November 10, 2026  
**Scope:** Read-only catalog comparison and staged copy clarification.  
**Status:** No deployment or Stripe changes approved.

## Direct Stripe catalog verification
Lovable's built-in Stripe integration was enabled for the workspace. The connected agent queried the Stripe account and the read-only `GetPrices` operation with expanded products and a result limit of 100. The agent reported `has_more=false`, all eight entries below in live mode, and both product and price active.

| Product | Listed recurring price |
|---|---|
| Driver Pro Monthly | USD $19.99 / month |
| Driver Pro Annual | USD $179.88 / year (equivalent $14.99 per month) |
| Recruiter Starter | USD $19.00 / month |
| Recruiter Growth | USD $49.00 / month |
| Recruiter Fleet | USD $149.00 / month |
| Agency Starter | USD $29.00 / month |
| Agency Team | USD $79.00 / month |
| Agency Growth | USD $149.00 / month |

Older active HaulTrackerPro Pro prices of USD $15/month and USD $120/year also appeared. **Active does not prove current purchase eligibility.** No subscriptions were modified or checkout attempted.

## Checkout implementation and limits
- Driver checkout resolves `pro_monthly` and `pro_yearly` to server environment price IDs (`STRIPE_PRO_MONTHLY_PRICE_ID`, `STRIPE_PRO_YEARLY_PRICE_ID`). The frontend's plan configuration also contains public price IDs, but live environment values were **not** read or matched against the catalog. The currently selected checkout price IDs therefore remain **unverified**.
- Recruiter checkout resolves server-side price IDs for Starter/Growth/Fleet. New standalone Fleet checkout is explicitly blocked even though its Stripe price is active.
- Agency checkout resolves server-side price IDs for Starter/Team/Growth; client-supplied price IDs are not accepted.
- Agency → recruiter inclusion is owner-only for qualified active agency members, not automatic for all employees.
- Direct Driver Assistant access requires the recipient driver's Pro entitlement, plus the driver's explicit delegation. Paid agency delegation has separate permission and billing rules.
- Company Dispatch requires scoped company permissions and accepted carrier-driver relationships. An Agency subscription alone does not convey Dispatch access to another company.
- Recruiter Standard allows **1 active opportunity** (drafts unlimited), then 5/15/25 for Starter/Growth/Fleet. The old recruiter marketing page incorrectly says "unlimited"; open PR #57 already stages the corresponding repair.

## Safe delivery sequence
1. Review staged pricing-role clarity changes independently of open PR #57; avoid overlapping edits.
2. Verify live checkout environment price-ID mappings through a read-only authorized integration (do not disclose secret credentials), or with a controlled synthetic Stripe checkout QA if separately approved.
3. Run focused unit/rendered tests and mobile preview at 320/375 px.
4. Review both PRs together for consistent public copy, then obtain explicit approval before any production deployment or billing migration.

## Guardrails
- No new subscription tiers or prices; no billing, webhook, entitlement, Dispatch RLS, Telegram, or customer-data changes.
- The Stripe read-only audit initially overwrote `.lovable/plan.md` on the base branch. This staging change restores that file's exact prior preflight text and saves the audit separately here.
- No live customer subscription, entitlement, settlement, or dispatch record was changed in this staging work.
