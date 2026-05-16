This hardening plan is approved. Please proceed, but include these two safeguards:

1. Before adding the CHECK constraint on contract_signatures.signer_role, run a verification query to confirm there are no existing non-driver signature rows:

select signer_role, count(*)

from contract_signatures

group by signer_role;

If any non-driver rows exist, stop and report before adding the migration.

2. For the truthful-copy cleanup, do a full project-wide search, not only the listed files. Search for:

- signed PDF

- signed copy

- send it back

- sent back

- sent to recruiter

- legally sign

- return contract

- DocuSign

Remove or rewrite any copy that implies signed PDF generation, automatic delivery, or DocuSign-equivalent signing.

Keep the scope exactly as written:

- no signed PDF generation

- no email delivery

- no recruiter countersignature

- no signature-required hiring

- no billing, landing redesign, reports, or role-switcher changes

After implementation, run the full 18-item QA checklist and confirm build passes.

## Contract Signature Workflow — Hardening Plan

Scope: contract review + signature only. No changes to billing, landing, reports, or role-switcher.

### A. Driver decision UI gating (ContractAttachment.tsx)

Currently `canDriverDecide` allows decisions when status is `uploaded` or `parsed`, but the `review-contract` edge function rejects those. Tighten to match backend.

- Change the gating set from `['uploaded','parsed','ai_reviewed','driver_reviewing','changes_requested']` to `['ai_reviewed','driver_reviewing']` (see B for `changes_requested`).
- When `hasContract && role === 'driver' && !decision && status ∈ {uploaded, parsing, parsed}`, render an inline info panel instead of the decision buttons:
  > "Waiting for AI review. The recruiter must run AI review before you can approve, reject, or request changes."
- Keep recruiter-side Analyze button behavior as-is.

### B. Request Changes — lock the version

DB already enforces one driver decision per version (`contract_reviews_driver_unique_per_version`). Make the UI match.

- Treat `decision === 'changes_requested'` as terminal for that version: do not render Approve / Reject / Request Changes again.
- Replace with a locked notice (driver side):
  > "You requested changes for this contract version. The recruiter must upload a revised version before you can approve or sign."
- Recruiter side (`RecruiterContractsView` + `ContractAttachment` recruiter panel): when latest driver decision is `changes_requested` on the current version, show a clear "Revised version required — upload a new version to continue" banner and surface the driver's note (already available via `driver_review.notes`).
- Effectively: `decisionTerminal` becomes `decision === 'approved' || decision === 'rejected' || decision === 'changes_requested'`.

### C. Truthful signature copy

Audit and update strings in `ContractAttachment.tsx` (signature panel + helper text), `DriverContractsView.tsx`, `RecruiterContractsView.tsx`, `ContractActionsCard.tsx`, and the contract SEO/feature pages we own (`ContractSeoPage.tsx`, `featureList.ts`, `recruiterFeatureList.ts`, landing/recruiter contract sections).

Use:

- "Record your in-app approval/signature"
- "Platform record of consent"
- "Not a DocuSign-equivalent or qualified electronic signature"

Remove/avoid anywhere it currently appears:

- "Send signed contract back", "Legally sign and return contract", "Signed PDF", "signed copy sent to recruiter".

(We are explicitly NOT adding PDF generation or recruiter delivery in this pass.)

### D. Hire rule — keep Option 1 (approval-required, signature optional)

No DB trigger change. The existing `opportunity_applications_require_contract_for_hire` already requires `contracts.status ∈ {approved, signed}` + current version uploaded, which matches Option 1.

Copy updates (recruiter contract panels + `RecruiterContractsView` "Blocked from Hire" tooltip):

> "Recruiters can't mark a driver hired until the driver approves the current contract. If the driver also signs, HaulTrackerPro stores an in-app signature record."

### E. Admin override separation

Goal: admin acting in the driver review flow must not unlock driver signing.

- `sign-contract` already requires the latest driver review to be authored by the assigned driver (`drv.reviewer_user_id !== userId` → 409). No edge function change.
- Edit `review-contract/index.ts`: remove the admin bypass in the driver-decision authorization. Replace
  ```
  if (!isAdmin && !isDriver) return 403
  ```
  with strict
  ```
  if (c.driver_user_id !== userId) return 403 "Only the assigned driver can submit a decision."
  ```
  Admins continue to use the separate `contract-admin` function for overrides; that path is unchanged and never inserts a `contract_reviews(reviewer_role='driver', reviewer_user_id=<driver>)` row, so it cannot fake driver consent for signing.
- No UI change needed; admin tools live elsewhere.

### F. Tighten signature insert policy

Current state (verified): `contract_signatures` has no client INSERT policy — only `Admins manage signatures` (ALL) and `Parties view signatures` (SELECT). All driver signing already flows through `sign-contract` using service role, and the `contract_signatures_validate` trigger already rejects `signer_role='recruiter'`.

Action: add a defensive migration that explicitly documents driver-only signatures, in case a future policy is added:

- Add `CHECK (signer_role = 'driver')` on `contract_signatures` (drop later if/when recruiter signing ships).
- No new RLS policy added (keeps all writes service-role only).

### G. QA checklist (manual, post-deploy)

Run the 18-item checklist from the request. Specifically verify:

1. Driver sees the "Waiting for AI review" panel while status is `uploaded`/`parsing`/`parsed`.
2. After `ai_reviewed`, all three decision buttons appear.
3. After `request_changes`, version is locked with the new copy; recruiter sees the "Revised version required" banner.
4. Admin calling `review-contract` as a non-driver gets 403.
5. Driver can sign only after their own approval; status moves to `signed`.
6. Hire is blocked until `approved` or `signed`; copy reflects approval-required, signature-optional.
7. No remaining "signed PDF" / "sent back" copy in driver, recruiter, or marketing surfaces we control.
8. `bun run build` passes; no console errors in preview.

### Files to change

- `src/components/contracts/ContractAttachment.tsx` — gating (A), Request Changes lock (B), copy (C), recruiter banner (B).
- `src/components/contracts/DriverContractsView.tsx` — copy (C), surface "changes requested → waiting on recruiter".
- `src/components/contracts/RecruiterContractsView.tsx` — "Revised version required" filter/banner (B), hire-rule copy (D), signature copy (C).
- `src/components/contracts/ContractActionsCard.tsx` — copy (C/D).
- `src/components/contracts/ContractSeoPage.tsx`, `src/lib/featureList.ts`, `src/lib/recruiterFeatureList.ts`, and any contract landing sections that mention "signed PDF / sent back" — copy (C).
- `supabase/functions/review-contract/index.ts` — drop admin bypass (E).
- New migration — add `signer_role='driver'` CHECK on `contract_signatures` (F).

### Out of scope

- Generating signed PDFs.
- Emailing/uploading a signed copy to the recruiter.
- Switching to signature-required hiring (Option 2).
- Recruiter countersignature flow.