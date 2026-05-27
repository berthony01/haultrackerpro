## Audit findings — Starter Kit download button

The download button lives in two places and both use the same pattern:

- `src/pages/StarterKit.tsx` (line 76) — `directDownload()` for already-signed-in users
- `src/pages/StarterKitThanks.tsx` (line 36) — `handleDownload()` after form submit

Both call:

```ts
window.open(STARTER_KIT_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
```

`STARTER_KIT_DOWNLOAD_URL` points to a **.zip** in Supabase Storage on a **different origin** (`pngptztxwbtozwxrtbwo.supabase.co`).

### Why this is unreliable on mobile

1. **iOS Safari + `window.open` to a binary file.** iOS often blocks or silently fails when `window.open('_blank')` targets a non-renderable file (zip). It opens a blank tab that immediately closes, or shows "Safari cannot download this file." Users see nothing happen.
2. **No `download` attribute, no Content-Disposition.** `window.open` never triggers a save dialog. The browser decides what to do with the response. Because the file is cross-origin from Supabase Storage, even an `<a download>` attribute would be **ignored** unless the object is served with `Content-Disposition: attachment`. We don't control that header today.
3. **Popup blockers on Android Chrome / in-app browsers** (Gmail, Instagram, Facebook, TikTok webview) frequently kill `_blank` for binary URLs, even inside a direct click handler. In-app browsers also can't always download zips at all.
4. **Copy says "6 PDFs (~70 KB)" but the asset is a single .zip.** On iOS that means the user gets a "compressed archive" they may not know how to open — and Files app handling varies.
5. **No visible fallback.** If the new tab is blocked or silently fails, the user has no copyable link, no "tap here if nothing happened" affordance.

### Fix plan (UI / frontend only — no schema, no backend)

All work stays in `src/pages/StarterKit.tsx`, `src/pages/StarterKitThanks.tsx`, and a tiny helper in `src/lib/leadMagnet.ts`. No business logic, no auth, no analytics events change semantics.

1. **New helper `triggerStarterKitDownload()` in `src/lib/leadMagnet.ts`.**
   - Creates a hidden `<a>` element with `href = STARTER_KIT_DOWNLOAD_URL`, `download="HaulTrackerPro_Trucker_Starter_Kit.zip"`, `rel="noopener noreferrer"`.
   - On iOS / Safari (detected via `navigator.userAgent`), sets `target="_self"` and uses `window.location.assign(url)` instead — same-tab navigation is the only reliable way iOS will offer "Download Linked File" / open in Files.
   - On everything else, sets `target="_blank"` and clicks the anchor (so Chrome/Edge/Android honor the download attribute when the server allows it, and otherwise opens in a new tab).
   - Always returns the URL so callers can show a manual fallback.

2. **Update both pages to call the helper** instead of `window.open(...)` directly. Analytics tracking calls (`trackLeadMagnetDownload`, `trackStarterKitDownloadClicked`) stay identical and fire before the helper.

3. **Add a visible fallback link under each download button.**
   - Small "Trouble downloading? Tap here to open the file directly" anchor that points to `STARTER_KIT_DOWNLOAD_URL` with `target="_blank"` and `rel="noopener noreferrer"`. Plain `<a href>` is the most mobile-robust escape hatch — long-press to "Download Linked File" on iOS, normal save on Android.
   - Replaces / augments the existing "Trouble downloading? Try a different browser…" text on the Thanks page; adds a matching line under the "Already signed in — download now" link on the Starter Kit page.

4. **Fix the misleading copy** on Thanks page: "(6 PDFs, ~70 KB)" → "(ZIP file — 6 PDFs inside, ~70 KB)" so users on mobile aren't surprised by a compressed archive.

5. **No change** to:
   - `STARTER_KIT_DOWNLOAD_URL` value
   - The Supabase Storage object or its headers (out of scope for a UI fix; flagged as a follow-up below)
   - Auth flow, form submission, RPC, or redirect to `/starter-kit/thanks`
   - Footer, SEO, layout

### Files changed

- `src/lib/leadMagnet.ts` — add `triggerStarterKitDownload()` helper.
- `src/pages/StarterKit.tsx` — `directDownload()` uses helper; add fallback `<a>` under the "Already signed in — download now" button.
- `src/pages/StarterKitThanks.tsx` — `handleDownload()` uses helper; update copy; add fallback `<a>` under the primary Download button.

### Technical detail

Helper sketch (no other behavior changes):

```ts
export function triggerStarterKitDownload() {
  const url = STARTER_KIT_DOWNLOAD_URL;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;

  if (isIOS) {
    // Same-tab navigation is the only reliable iOS path for cross-origin binaries.
    window.location.assign(url);
    return url;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = 'HaulTrackerPro_Trucker_Starter_Kit.zip';
  a.rel = 'noopener noreferrer';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}
```

### Deferred (not part of this UI fix)

- Configure the Supabase Storage object to be served with `Content-Disposition: attachment; filename="HaulTrackerPro_Trucker_Starter_Kit.zip"` so cross-origin `download` actually forces save on desktop Chrome. This requires re-uploading the object with metadata or fronting it with an edge function — out of scope for a frontend audit/fix.
- Splitting the zip into 6 individual PDFs hosted directly (would remove the iOS zip-handling friction entirely) — product decision, not in this phase.

### Verification

- TypeScript build clean.
- Manual: open `/starter-kit/thanks?email=test@test.com` on the mobile preview, tap Download → iOS navigates same-tab to the file; Android Chrome triggers download or opens in new tab; fallback link always works via long-press.
