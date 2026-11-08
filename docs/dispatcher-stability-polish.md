# Dispatch refresh stability and readability

Status: **STAGED FOR REVIEW. Production has not been republished.**

Starting source: `71fea0291a48f0ff662b83d3a7cd3dc31008f993`.
Candidate branch: `codex/dispatch-stability-polish`.

## Confirmed cause

The Dispatch hook starts a read every 15 seconds and on focus/visibility events.
It sets `loading=true` while retaining the existing same-account page. The old
screen then omitted summaries and load cards whenever `loading` was true. This
removed visible content on each routine check, producing a repeatable flicker.
Overlapping focus and visibility events also started duplicate permission reads
and invalidated earlier responses. Two new regression tests failed on the original
source: the visible load disappeared, and a burst made four permission reads where
one initial read plus one recheck was expected.

This is a confirmed source-level cause, not a claim that every possible blank
screen has the same cause. The current live browser had no matching app error logs
in the inspected sample; intermittent device/network failures are not ruled out.

## Change

- Keep the existing load cards and summaries mounted during a same-account,
  same-filter background read. A fixed-height update message explains the check.
- Coalesce matching in-flight reads. Pause polling while the document is hidden
  and recheck on return. Confirmed writes force a newer read rather than reusing a
  read that began before the write.
- Clear old results on filter/account changes. Server denial still clears private
  content and authority. Transient errors still hide private content, retain the
  inactive draft and show a visible Retry message. Write actions remain disabled
  until current permissions have been verified.
- Group the form into Driver & reference, Pickup & delivery, Miles and Agreed pay.
  Preserve extraction warnings, editable fields, source notes and exact retry intents.
- Use larger fields/buttons, distinct primary/secondary/delivery/cancellation
  colors, clear focus outlines and explicit button text. Optional fees have a
  labelled disclosure. A separate review panel summarizes the load before saving.
- Present posted loads with a status badge, separate pickup/delivery blocks,
  actual-delivery label, larger agreed pay/mileage and visible status actions.
- Make daily/weekly totals easier to scan and move secondary totals into a
  labelled disclosure. Condense the workspace banner and omit the unrelated New
  job button only while viewing Dispatch. Label the header Dispatch inside Telegram.

No SQL, database policy, authorization map, account link, bot command, AI setting,
billing setting, financial calculation or dependency was changed. No production
load was created or updated by this task.

## Verification

| Check | Result |
| --- | --- |
| Regression reproduction on original code | PASS: both new cases failed as expected |
| Dispatch, Mini App access/navigation/posting/privacy suites | PASS: 142 tests in 9 files |
| Overlapping read coalescing | PASS |
| Forced refresh after a confirmed mutation | PASS: late older response cannot restore stale data |
| Filter/account changes and explicit denial | PASS: old data is hidden/cleared |
| Hidden polling and resume | PASS |
| Draft retention during background refresh and temporary failure | PASS |
| Exact create/status retry, date validation and view-only restrictions | PASS |
| App and build-config TypeScript | PASS |
| Targeted source lint | PASS |
| Production build | PASS; existing large-chunk warning retained |
| Manual visual rendering at 320/375 px | NOT VERIFIED: browser security blocked the standalone preview protocol and the saved-review host |
| Production deployment / live acceptance of this candidate | NOT RUN: held for owner review and release approval |

An interactive review HTML file was prepared from the actual Dispatch components
and built production CSS, with a synthetic hook and synthetic load records. Its
Content Security Policy disables network access. It contains no live account,
credentials or production writes. It demonstrates layout and local interactions,
not signed Telegram authentication or real database persistence.

The browser did not grant access to a data preview URL or the ChatGPT review-file
host. No browser-policy workaround or alternate browser was used. Visual acceptance
remains an explicit release limitation; the saved file lets the owner inspect the
design directly. No Lovable development turn was requested.

Reproduction: run the nine named suites from `dispatch-polish-final-tests.log`
with the existing synthetic public test configuration; app/node `tsc --noEmit`,
targeted ESLint and `vite build`. The log is an intermediate local record; source
and this ledger are preserved in the review branch.

Single next action: review the design and approve publishing this tested frontend
candidate, followed by a read-only live check in the existing QA workspace.
