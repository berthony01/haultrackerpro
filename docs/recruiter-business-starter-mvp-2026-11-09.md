# Recruiter Business Starter: staged scope and acceptance
**Date:** 2026-11-09
**Branch:** feature/recruiter-business-starter-stage-20261109
**Baseline:** b7fc641e2f6b8759d466a23aaeee939d4bd7b1f9
**Status:** Source-only staging. No feature launch or production approval.

## Product objective
Help independent truck driver recruiters understand how to start on HaulTrackerPro. Separate verified existing recruiting features from carrier-client CRM, service contracts, placement fee invoicing, and commissions, which are not established as end-to-end features.

## Audit conclusions
- Valid recruiter company types: carrier, independent_recruiter, third_party_recruiter, staffing_agency. DOT/MC required for a carrier profile, not for standard posting by non-carrier recruiter types.
- Recruiter Standard: 1 active opportunity. Starter: 5. Growth: 15. Fleet: 25 for existing or included entitlement, not new standalone checkout. Drafts unlimited.
- The applicant pipeline uses driver-approved private contact access.
- Existing Agency Clients features manage driver delegations, **not** carrier hiring clients. Do not repurpose agency delegations as carrier CRM.
- Existing recruiter contract tools concern driver-facing contracts, not recruiter-carrier fee agreements.
- No in-platform fee invoicing or commission collection established. Not a recruiting license, job-placement guarantee, or tax/legal service.

## Implemented in isolated branch
1. Align both recruiter public surfaces (`/recruiters` route and RecruiterLanding component) on listing limits, independent recruiter onboarding, and Fleet availability.
2. Add visible link to existing recruiter guide.
3. Add business starter steps on existing guide, with honest limitations.

## Proposed next feature build (NOT implemented or live)
- Carrier-client CRM separated from driver agency workflow, with recruiter-tenant scoping.
- Carrier-authorized hiring requests, permission and expiration checks.
- Recruiter-client service contract records and agreed placement-fee terms.
- Driver submissions, interview/placement status, and opt-in contact access.
- Commission/invoice ledger, recordkeeping only; no money transfer by default.
- Before engineering: role/RLS design, backfill isolation, legal review, and costed Lovable/Supabase implementation bundle.

## Acceptance checklist before merge or publish
- Static: free active limit 1; paid limits 5/15/25, Fleet preview-only; no stale unlimited free posting text.
- Preview: `/recruiters` to `/recruiter/guide` at 320px and 375px; signed-in/out onboarding remains separately untested.
- Automated CI: pull-request-only build, typecheck, and public-route Playwright smoke tests with a dummy offline backend.
- Responsive manual tests: 320px and 375px, no overflow or clipped CTA.
- Regression: role selection, recruiter posting, driver contact consent, applicant status, contracts, plans, agency clients, Telegram/dispatcher unchanged.
- Owner approval required before merge, deployment, production SQL, billing changes, or enabling any new functionality.

## Authenticated read-only checkpoint, 2026-11-09
- Connected browser showed an authenticated recruiter hub with incomplete profile, zero active opportunities, and zero applications. No form submissions or account data changes were made.
- Found conflicting incomplete-state DOT/MC copy and obsolete unlimited-free-posting wording in the recruiter command center. Staged copy-only correction and source-integrity test.
- The existing recruiter eligibility and workspace-access tests plus mocked rendered recruiter-state tests are included in isolated CI. These **do not** replace an authenticated end-to-end staging test.
- Authenticated applicant consent, contract hiring and paid checkout E2E remain untested, blocked by lack of an authorized staging session with suitable synthetic records. Do not mark full recruiting release acceptance PASS.
