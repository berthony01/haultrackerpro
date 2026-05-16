## Replace PWA / app icon with new premium HaulTrackerPro image

Asset-only swap. No code, routing, billing, or UI changes.

### Source
Uploaded image: `user-uploads://ChatGPT_Image_May_16_2026_02_19_18_PM.png` (square, dark navy + orange truck + "HaulTrackerPro" wordmark).

### Steps

1. Copy the upload to a working path, then use ImageMagick (via `nix run nixpkgs#imagemagick`) to produce sharp, properly sized square assets:
   - `public/pwa-icon-512.png` — resized to 512×512 with Lanczos filter, no crop/stretch (source is already square).
   - `public/pwa-icon-192.png` — resized to 192×192 from the 512.
   - `public/favicon.ico` — multi-resolution ICO (16, 32, 48) generated from the new image so the browser tab favicon updates too.

2. Verify references — no edits required, but confirm:
   - `public/manifest.webmanifest` already points to `/pwa-icon-192.png` and `/pwa-icon-512.png` ✅
   - `index.html` line 53 `apple-touch-icon` already points to `/pwa-icon-192.png` ✅
   - `src/pages/Install.tsx` uses `/pwa-icon-192.png` ✅
   - `public/sw.js` is the self-destroying kill-switch and references no icons ✅
   - No other stale icon references exist.

3. QA: open the regenerated 192 and 512 PNGs to confirm the truck + wordmark remain centered, sharp, and readable; confirm file sizes are reasonable; confirm build passes (auto-run by harness).

### Files changed
- `public/pwa-icon-192.png` (replaced)
- `public/pwa-icon-512.png` (replaced)
- `public/favicon.ico` (replaced)

No source code or manifest edits needed — existing references already match these filenames.