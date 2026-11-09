# Company Dispatch and driver account connections

Released November 9, 2026. The production website and Telegram Mini App share the Dispatch board and driver assignment records.

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
| Production company and driver acceptance | See live results below |

The fixture delivery used 14.5 loaded miles at $2.01 per mile. The product rounded $29.145 to $29.15. After recording $27.50 actual pay and $2.50 of fixture expenses, the configured 10% test estimate used a $25.00 base and returned $2.50. A separate cancelled load remained in history and added no revenue or mileage to those completed totals.

Review base `6b30d39e8f4fc0524f15d686c91b671bab94a7a4`. The database candidate is [20261108225739_company_driver_dispatch_workflow.sql](../supabase/migration-candidates/20261108225739_company_driver_dispatch_workflow.sql). Its SHA-256 is `595b68c4ef8156e8d27861e633b0774b2a302abf92e598029dab8ae30e5d3f01`. The candidate is outside the managed migrations directory. The branch's GitHub checks exercise the database functions with separate PostgreSQL sessions for concurrency cases.

After release approval, confirm the base and candidate digest, then apply the SQL transaction and check the new function grants and API availability. Publish the matching website build after that check. Use synthetic company and driver accounts for the assignment and status journey, verify the signed-in driver report, and capture the 320 px and 375 px website views. If the website needs to be rolled back, restore the prior published build and preserve any accepted relationships and load history.

## Production verification

PR #55 merged as `f998d8011a3a7ab4d08fe9f8e7f50880c6ef8368`. Both published version endpoints returned this build. Lovable deployment receipt `6ca8a177-db72-420a-95da-1bc7c2eee8d0`. The approved SQL was applied before the website release. The invitation table has row level security and no direct anonymous or authenticated client table grants. The five client functions require authentication, and the internal eligibility helper has no client execute grant. The existing load policies and Dispatch function definitions matched the pre-release checks. [PR #55](https://github.com/berthony01/haultrackerpro/pull/55) · [Website version](https://haultrackerpro.com/version.json) · [Verification run](https://github.com/berthony01/haultrackerpro/actions/runs/42625341792)

| Live check | Result |
| --- | --- |
| Signed-in company opened website Dispatch and saved a request | PASS |
| Verified test driver reviewed and accepted the request | PASS |
| Two test assignments appeared in the open driver Loads view | PASS |
| The same two rows changed to Completed and Cancelled in the open view | PASS |
| Driver saved actual pay and checked October and November reports | PASS |
| Company page, driver request and monthly Reports preset at 320 px and 375 px | PASS |
| Reports custom date row at 320 px and 375 px | The initial release overflowed. PR #56 passed the live retest below. |

The company request and driver acceptance ran through the browser. The assignments and status changes exercised the shared Dispatch functions with the QA company role while the driver tab stayed open. A separate transaction first verified the invitation replay and full lifecycle, then rolled back. The only retained test assignments are `HTP-QA-COMP-A1109` and `HTP-QA-COMP-B1109`.

Both assignments agreed 14.5 miles at $2.01 per mile, so $29.145 rounded to $29.15. The completed assignment retained its October 31 scheduled date and used November 1 for reporting. After the test driver recorded $27.50 actual pay, October showed $0 and 0 miles. November counted $27.50, 14.5 raw operating miles and one completed load. The UI rounds the displayed weekly mileage to 15. The other load remains in cancelled history and adds $0 to earnings.

At both widths the company and consent pages fit the viewport. The primary company controls and the driver consent buttons measured 48 px tall. The November Reports preset also fit both widths. Opening Custom Range widened the 320 px document to 390 px, or 70 px beyond the viewport. The date control fix stacks the fields and Apply on phones. It passed 118 focused tests and the production build. The signed-in production retest is recorded below.

- Website Dispatch at [320 px](dispatcher-mini-app-evidence/company-dispatch-web-320.png) and [375 px](dispatcher-mini-app-evidence/company-dispatch-web-375.png).
- Driver consent at [320 px](dispatcher-mini-app-evidence/company-driver-consent-320.png) and [375 px](dispatcher-mini-app-evidence/company-driver-consent-375.png).
- [November report and cancelled history](dispatcher-mini-app-evidence/company-driver-report-375.png).
- [Custom Range overflow at 375 px](dispatcher-mini-app-evidence/report-custom-range-overflow-375.png).

## Reports custom date release

PR #56 shipped on November 9, 2026. The public website and provider version endpoints returned `ef778953e4eeb0d3ba024700608464959abfbc19`, built at `2026-11-09T15:21:55.319Z`. Lovable deployment receipt `8f3bff13-a95e-4b8b-8dc2-43620718a03f`. [PR #56](https://github.com/berthony01/haultrackerpro/pull/56) · [Website version](https://haultrackerpro.com/version.json)

The signed-in driver opened Custom Range, entered the dates, and selected Apply at both widths. Each field and the Apply button measured 48 px tall. The document width matched the viewport before and after applying each range, and no date validation errors appeared.

| Viewport and document width | Applied dates | Result |
| --- | --- | --- |
| 320 px | November 1, 2026 | PASS · [Screenshot](dispatcher-mini-app-evidence/reports-custom-range-live-320.png) |
| 375 px | November 1 through November 2, 2026 | PASS · [Screenshot](dispatcher-mini-app-evidence/reports-custom-range-live-375.png) |

Both date ranges showed the test driver's $27.50 recorded earnings and 14.5 operating miles. The cancelled test load remained in history and contributed $0 to earnings. The release used the approved frontend patch. The browser checks changed only the displayed report filter.
