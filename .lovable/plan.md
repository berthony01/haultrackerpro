

## SEO Safety Tweaks

Four targeted changes before the full SEO implementation.

### 1. `/landing` duplicate URL — Already handled
Route line 61 in `App.tsx` already redirects `/landing → /` with `replace`. No code change needed. The SEOHead implementation will add `<link rel="canonical" href="https://haultrackerpro.com/">` on the landing page, which fully covers this.

### 2. OG/Twitter image — Use stable self-hosted asset
Current `index.html` points to a long Google Cloud Storage URL (`.webp`). This is fragile and not ideal for social crawlers.

**Action**: Copy or reference the existing social image as `/public/og-image.png` (or keep the current asset but reference it with the production domain). Since we don't have a local `og-image.png` yet:
- Keep using the current hosted image URL for now in `index.html` defaults
- In `SEOHead.tsx`, default the `image` prop to `https://haultrackerpro.com/og-image.png`
- Create a reminder: once you have a final OG image, place it at `public/og-image.png`

**Alternatively** — if the user wants to use the existing image immediately, the SEOHead default can point to the current GCS URL. But best practice is a self-hosted absolute URL.

### 3. `robots.txt` — Match real private routes
Current `robots.txt` allows everything with no disallows. Update to match actual app routes:

```
User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /auth
Disallow: /admin
Disallow: /reset-password
Disallow: /install

Sitemap: https://haultrackerpro.com/sitemap.xml
```

`/settings` is not a standalone route (it's a tab inside `/dashboard`), so no need to disallow it separately.

### 4. Canonical base URL consistency
Use `https://haultrackerpro.com` (no `www`, no trailing variations) as the single canonical base in `SEOHead.tsx`. All canonical URLs, OG URLs, and sitemap URLs will use this base.

### Files to Edit

| File | Change |
|------|--------|
| `public/robots.txt` | Replace with proper disallow rules + sitemap |
| `index.html` | Update og:image/twitter:image to `https://haultrackerpro.com/og-image.png`, remove TODO comments |
| `src/components/SEOHead.tsx` (to be created) | Use `https://haultrackerpro.com` as canonical base, default image to `https://haultrackerpro.com/og-image.png` |

No routing changes needed — `/landing` redirect already exists.

