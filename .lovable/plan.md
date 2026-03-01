

## Add PWA (Installable Web App) Support

### What this does
Allows users to install HaulTrackerPro to their phone's home screen directly from the browser. It will launch like a native app with its own icon and splash screen.

### Steps

1. **Install `vite-plugin-pwa`** and configure it in `vite.config.ts` with:
   - App name: "HaulTrackerPro"
   - Theme color matching the existing brand
   - Manifest with icons (192x192 and 512x512)
   - `navigateFallbackDenylist: [/^\/~oauth/]` to protect auth redirects
   - Register type: autoUpdate

2. **Add PWA icons** to `public/` directory (generated from existing favicon)

3. **Add mobile meta tags** to `index.html`:
   - `apple-mobile-web-app-capable`
   - `apple-mobile-web-app-status-bar-style`
   - `theme-color`

4. **Create `/install` page** with instructions for installing the app, including a browser install prompt trigger button

5. **Add route** for `/install` in `App.tsx`

### Files touched
- `vite.config.ts` — add PWA plugin config
- `index.html` — add meta tags
- `public/` — add manifest icons
- `src/pages/Install.tsx` — new install instructions page
- `src/App.tsx` — add `/install` route

### Not touched
- No changes to theme, layout, business logic, dashboard, settings, or any existing features

