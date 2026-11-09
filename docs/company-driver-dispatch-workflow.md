# Company Dispatch and driver account connections

Status as of November 9, 2026. Built and tested on the review branch. Production release and signed-in browser acceptance are pending.

The company owner opens **Dispatch** in the Recruiter Command Center. A team member with load viewing permission opens it from the company workspace. The website uses the same Dispatch board and permission checks as the Telegram Mini App.

The carrier owner creates an in-app connection request using the driver's account email and can share the Company connections link. A driver can sign in or create an account with that email. The verified recipient sees the company name and reviews the access before accepting. Requests expire in seven days. Declining, revoking, and accepting are tied to the exact request. A renewed request receives a new identity.

After acceptance, the existing carrier and driver relationship makes the driver available in both Dispatch boards. Assigning a load writes one record owned by that driver. The open Driver dashboard checks for updates every 15 seconds while visible. Pending loads and cancelled loads do not count as completed earnings. Completed loads use recorded actual pay when available and agreed driver pay otherwise. The driver's existing expense and tax settings govern their own estimates.

Reports use a confirmed Dispatch delivery date when available. Scheduled dates and raw pay and mileage values stay as recorded. Older loads and group updates without an actual delivery date keep their existing scheduled delivery or pickup date. A read-only production count found one completed load with an explicit date and zero differences from its existing report date.

| Check | Result |
| --- | --- |
| Website owner and staff entry, driver-only and delegated assistant denial | PASS in component tests |
| Email matching, verification, driver consent, expiry, revocation, retry and disconnect | PASS with disposable PostgreSQL fixtures |
| Shared assignment, delivery, Telegram cancellation, actual pay, report and CSV totals | PASS with disposable PostgreSQL fixtures |
| Driver refresh without clearing the current view, account switch isolation and recording pay while pending | PASS in component tests |
| Production browser and mobile acceptance | Pending release and signed-in QA |

The fixture delivery used 14.5 loaded miles at $2.01 per mile. The product rounded $29.145 to $29.15. After recording $27.50 actual pay and $2.50 of fixture expenses, the configured 10% test estimate used a $25.00 base and returned $2.50. A separate cancelled load remained in history and added no revenue or mileage to those completed totals.

Review base `6b30d39e8f4fc0524f15d686c91b671bab94a7a4`. The database candidate is [20261108225739_company_driver_dispatch_workflow.sql](../supabase/migration-candidates/20261108225739_company_driver_dispatch_workflow.sql). Its SHA-256 is `595b68c4ef8156e8d27861e633b0774b2a302abf92e598029dab8ae30e5d3f01`. The candidate is outside the managed migrations directory. The branch's GitHub checks exercise the database functions with separate PostgreSQL sessions for concurrency cases.

After release approval, confirm the base and candidate digest, then apply the SQL transaction and check the new function grants and API availability. Publish the matching website build after that check. Use synthetic company and driver accounts for the assignment and status journey, verify the signed-in driver report, and capture the 320 px and 375 px website views. If the website needs to be rolled back, restore the prior published build and preserve any accepted relationships and load history.
