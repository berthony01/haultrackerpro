# Stripe pricing audit (read-only) - no changes proposed

Source: read directly from the connected Stripe account using the read-only price list, with products expanded. The list was complete (has_more=false). All results are LIVE mode.

| Plan | Stripe product name | Amount | Currency | Interval | Mode | Price / product active | Source |
|---|---|---|---|---|---|---|---|
| Driver Pro monthly | HaulTrackerPro Pro Monthly | $19.99 | USD | month | live | yes / yes | Stripe direct |
| Driver Pro annual | HaulTrackerPro Pro Annual | $179.88 | USD | year | live | yes / yes | Stripe direct |
| Recruiter Starter | HaulTrackerPro Recruiter Starter | **$19.00** | USD | month | live | yes / yes | Stripe direct |
| Recruiter Growth | HaulTrackerPro Recruiter Growth | $49.00 | USD | month | live | yes / yes | Stripe direct |
| Recruiter Fleet | HaulTrackerPro Recruiter Fleet | $149.00 | USD | month | live | yes / yes | Stripe direct |
| Agency Starter | Agency Starter | $29.00 | USD | month | live | yes / yes | Stripe direct |
| Agency Team | Agency Team | $79.00 | USD | month | live | yes / yes | Stripe direct |
| Agency Growth | Agency Growth | $149.00 | USD | month | live | yes / yes | Stripe direct |

Recruiter Starter is **$19.00** (1900 cents), not $19.99.

## Notes
- Two older live HaulTrackerPro Pro prices are also still active: $15.00/month and $120.00/year, under product name "HaulTrackerPro Pro". This audit did not check which price IDs the app's checkout actually uses.
- The account is shared, and it holds active prices for several other products.
- Nothing was created, updated or deleted. No checkout was run and no files were changed.

No build steps follow. This plan is only a record of the audit.
