# Plan: Fix Resource Articles Admin Workflow

## What's actually broken (strict analysis)

After tracing `src/pages/admin/ResourceArticlesAdmin.tsx` and `src/pages/resources/ResourceArticleDynamic.tsx`, the issues you noticed are real:

1. **No way to preview the rendered article.** The Content field is a raw Markdown `<Textarea>`. There is no preview tab and no "View" link anywhere — not from the list, not from the editor. You can only stare at raw `##` headings.
2. **Public route hides anything not published.** `ResourceArticleDynamic` queries `.eq('status','published').not('published_at','is',null)`. So drafts and approved articles return "Resource not found" if you try to visit `/resources/<slug>` — that's why drafts feel invisible.
3. **Approve gives no visible feedback.** `setApproval('approved')` runs `save()`, which only shows a generic "Saved" toast. The only visible change is two tiny badges at the bottom of the dialog (`Status: approved`, `Approval: approved`) and the Publish button quietly becoming enabled. Nothing draws your eye to it.
4. **Mark Needs Revision is a dead end.** Same generic "Saved" toast, no field to capture *why* it needs revision, no visible state change beyond the small badge.
5. **Publish has no "view it live" affordance.** After publishing, the dialog stays open, toast says "Saved", and there's no link to open the public URL.
6. **Save Draft → "where is it?"** It saves to the list, but the list row has no Preview action, only Edit. So drafts really do feel like they vanish.

These are all UI-layer fixes. No schema, RLS, or backend changes.

## Changes (UI only, `src/pages/admin/ResourceArticlesAdmin.tsx`)

### 1. Add a Preview tab inside the editor dialog
- Wrap the Title/Slug/SEO/Content block in `Tabs` with two tabs: **Edit** and **Preview**.
- Preview renders `<SafeMarkdown content={editing.content ?? ''} />` (already used by the public page), plus title, excerpt, and the meta-description preview, so admin sees exactly what readers see.
- Default tab: Edit. Tab state local to the dialog.

### 2. Add a "Preview" action on each list row
- Next to the existing **Edit** button, add **Preview** which opens the editor dialog directly on the Preview tab. Same dialog, no new route, no DB changes.
- For rows already `published`, also add a small **Open Live** link that goes to `/resources/<slug>` in a new tab. Hidden for non-published rows (since the public route 404s them by design).

### 3. Make Approve / Needs Revision / Publish actually feel like they did something
- After `setApproval('approved')`: toast `"Approved — ready to publish"` and visually highlight the Publish button (e.g. pulse/ring) while the dialog stays open.
- After `setApproval('needs_revision')`: open a tiny inline panel (not a separate dialog) with a `Textarea` for an optional revision note that gets appended to the **Excerpt? No — to the existing editor as a yellow banner only**. Since there's no `revision_notes` column and you said no schema changes, store the note in component state and surface it as a banner at the top of the dialog while editing this article in the current session. Toast: `"Marked as needs revision"`. (If you want it persisted, that's a separate phase — see Deferred.)
- After `publish()` succeeds: toast `"Published"` plus a second toast action button `"Open live page"` linking to `/resources/<slug>` in a new tab. Also show a green inline banner in the dialog with the same link.

### 4. Clarify state at a glance
- Move the small `Status` / `Approval` badges from the bottom of the dialog to **right under the dialog title**, made larger and color-coded (draft = secondary, pending_review = warning, approved = success, published = primary, archived = muted, needs_revision = destructive).
- Footer buttons get hover tooltips explaining what each does and why it's disabled when it is (e.g. Publish disabled tooltip: `"Approve the article and tick the safety checklist first."`).

### 5. List filter cleanup (small)
- Add a `Needs revision` option to the Filter `Select` so it's findable without scrolling the All view. Filter logic: `q.eq('approval_status','needs_revision')`.

## Files touched

- `src/pages/admin/ResourceArticlesAdmin.tsx` — all of the above.

No changes to: `ResourceArticleDynamic.tsx`, `SafeMarkdown.tsx`, schema, RLS, edge functions, public routes.

## Deferred (not in this phase)

- Persisting revision notes (would need a `revision_notes` text column + migration).
- Public preview-by-token route for non-published articles (would need a token column + RLS policy).
- Diff view between draft and last-published version.
- Inline AI re-draft on a single section.

Confirm and I'll implement exactly the above — nothing more.