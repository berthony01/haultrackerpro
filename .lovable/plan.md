# Free Trucker Starter Kit — Lead Magnet Funnel

Phased, surgical implementation. No existing routes, auth, Stripe, dashboard, or Supabase logic will be modified.

---

## Phase 1 — Audit findings

**Routing** (`src/App.tsx`): React Router v6 with `BrowserRouter`. Three wrappers exist:

- `PublicRoute` — redirects logged-in users to `/dashboard` (used by `/`)
- `AuthRoute` — same redirect (used by `/auth`)
- `ProtectedRoute` — requires auth
- Plain routes (no wrapper) — public to everyone (e.g. `/pricing`, `/faq`, all SEO pages)

✅ `/starter-kit` and `/starter-kit/thanks` will be **plain public routes** (no wrapper) so both logged-out AND logged-in users can access them — matches Phase 7 requirement.

**Landing** (`src/pages/Landing.tsx`): Dark theme, `hsl(220, 20%, 8%)` bg, amber accents, hero + sections. Has a hero CTA area where a small secondary "Get the Free Trucker Starter Kit" link fits cleanly without clutter.

**Pricing** (`src/pages/Pricing.tsx`): Has clear free/pro columns. Good spot for one inline CTA above the comparison table.

**Auth** (`src/hooks/useAuth.ts` + `src/pages/Auth.tsx`): Untouched. Signup CTA on thank-you page will simply `navigate('/auth')`.

**Supabase**: Client at `src/integrations/supabase/client.ts` (do not edit). Anon role can INSERT into RLS-permitted tables without auth — perfect for anonymous lead capture.

**Storage**: No buckets exist. We'll create a public `lead-magnets` bucket via migration.

**Analytics** (`src/lib/analytics.ts`): Has `trackCtaClick(label, location)`. We'll add 4 lightweight helpers (`trackLeadMagnetView`, `trackLeadMagnetSubmit`, `trackLeadMagnetDownload`, `trackLeadMagnetSignupClick`).

**UI primitives**: `Button`, `Input`, `Label`, `Card`, sonner `toast` — all available, matching existing visual theme.

**Email system**: Transactional email infrastructure exists (`send-transactional-email` edge function + registry). Phase 9 will be left as a documented TODO to avoid creating a new template type without explicit scope.

**ZIP file**: 66 KB, 6 PDFs (Start Here, CDL Study Companion, Test Day Checklist, New Driver Mistakes, Owner-Op Doc Checklist, First 30 Days). Small enough to ship in the public Storage bucket with no perf concern.

**No conflicts**: `/starter-kit*` paths are unused. No existing `lead_*` tables. No existing `lead-magnets` bucket.

---

## Phase 2 — Database migration

New table `public.lead_magnet_signups`:

```sql
CREATE TABLE public.lead_magnet_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  first_name text,
  bundle_name text NOT NULL DEFAULT 'Trucker Starter Kit',
  bundle_version text NOT NULL DEFAULT 'free',
  source_page text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  download_sent_at timestamptz,
  downloaded_at timestamptz,
  converted_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_magnet_signups_email ON public.lead_magnet_signups (lower(email));
CREATE INDEX idx_lead_magnet_signups_created_at ON public.lead_magnet_signups (created_at DESC);

CREATE TRIGGER trg_lead_magnet_signups_updated_at
BEFORE UPDATE ON public.lead_magnet_signups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.lead_magnet_signups ENABLE ROW LEVEL SECURITY;
```

**RLS policies**:

- `Anyone can submit lead` — `INSERT` to `anon, authenticated`, `WITH CHECK (true)` (no SELECT exposure)
- `Admins can view leads` — `SELECT` to `authenticated`, `USING (is_admin(auth.uid()))`
- `Admins can update leads` — `UPDATE` to `authenticated` (for `converted_user_id` / `downloaded_at` backfills)

**Duplicate-safe insert**: client-side only — we won't create a unique constraint (a driver may legitimately re-request). Each submission gets a fresh row; we de-dupe in admin reporting later. The `lower(email)` index makes that trivial.

---

## Phase 3 — Storage

Migration creates a **public bucket** `lead-magnets`:

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('lead-magnets','lead-magnets', true);
CREATE POLICY "Public can read lead magnets" ON storage.objects
  FOR SELECT USING (bucket_id = 'lead-magnets');
```

Then I'll upload `HaulTrackerPro_Trucker_Starter_Kit_Free.zip` to `lead-magnets/HaulTrackerPro_Trucker_Starter_Kit_Free.zip` via the storage API in a script during the implementation step. Resulting public URL:
`https://pngptztxwbtozwxrtbwo.supabase.co/storage/v1/object/public/lead-magnets/HaulTrackerPro_Trucker_Starter_Kit_Free.zip`

---

## Phase 4 — `/starter-kit` landing page

New file: `src/pages/StarterKit.tsx`. Public route in `App.tsx` (lazy-loaded, no wrapper).

Sections (matching existing dark theme + Card/Button primitives):

1. **SEOHead** — title, description, canonical
2. **Hero** — H1 "Get the Free Trucker Starter Kit", subhead "CDL help + checklists + real-world trucking guidance"
3. **Lead form Card** — `first_name` (optional), `email` (required), submit button "Send Me the Free Kit", inline validation, loading state, sonner toast
4. **What's Included** — bulleted list of the 6 PDFs
5. **Who It's For** — new CDL drivers, owner-ops in first year, fleets onboarding
6. **Trust disclaimer** — "We never sell your info. One email, then you decide."
7. **HaulTrackerPro bridge** — short pitch + "Start Tracking Free" → `/auth`

Logged-in handling (Phase 7): `useAuth()` — if user, prefill email, swap CTA to "Download Free Kit" + "Back to Dashboard", skip form-required state, still log a row (with `converted_user_id = user.id`).

---

## Phase 5 — Form logic

`src/lib/leadMagnet.ts` — small helper:

- `getUtmFromUrl()` — reads `utm_source/medium/campaign/content/term` from `window.location.search`
- `submitLeadMagnet({ email, first_name })` — zod-validated, inserts via `supabase.from('lead_magnet_signups').insert(...)`, sets `download_sent_at = now()`, `source_page = window.location.pathname`

On success: `navigate('/starter-kit/thanks?email=...')` (email passed only to enable optional prefill on thanks page; not required).

Validation (zod): `email` trimmed, valid, ≤255 chars; `first_name` optional, ≤100 chars.

---

## Phase 6 — `/starter-kit/thanks`

New file: `src/pages/StarterKitThanks.tsx`. Public route, lazy-loaded.

Contents:

- Headline "Your Free Trucker Starter Kit Is Ready"
- Primary button "Download Free Kit" → opens public Storage URL in new tab + fires `trackLeadMagnetDownload()` + best-effort `UPDATE lead_magnet_signups SET downloaded_at = now() WHERE email = ...` (RLS won't allow this from anon — so we'll just log via analytics; the `download_sent_at` we set on submit is sufficient for funnel reporting). Cleaner: skip the post-submit UPDATE entirely and rely on GA event.
- Secondary CTA "Create Free Account" → `/auth`
- Short "What's next" copy + light tease of the paid Trucker Starter Pack Full (text only, no purchase flow per instruction)
- Auto-trigger download once on mount via hidden anchor click? **No** — explicit button click is friendlier and more trackable.

---

## Phase 7 — Logged-in handling

Already covered in Phase 4. No redirect; same pages serve both states.

---

## Phase 8 — Global CTAs (minimal)

Three placements, each one line, no layout disruption:

1. `**Landing.tsx**` — small text link in hero secondary row: "📦 Free Trucker Starter Kit" → `/starter-kit`
2. `**Pricing.tsx**` — single subtle banner above the comparison table: "Not ready to sign up? Grab the Free Trucker Starter Kit →"
3. **Landing footer** — add link in existing footer column

All fire `trackCtaClick('starter_kit', '<location>')`.

---

## Phase 9 — Email (deferred)

Existing transactional email system uses pre-built React Email templates and an enqueue/process queue. Adding a new template type is non-trivial and out of scope unless requested. Plan: leave a `// TODO(phase-9): enqueue starter-kit email via send-transactional-email` comment in the submit helper. The download is delivered immediately on the thank-you page so users get the file regardless.

---

## Phase 10 — Analytics

Add to `src/lib/analytics.ts`:

- `trackLeadMagnetView(source: string)`
- `trackLeadMagnetSubmit()`
- `trackLeadMagnetDownload()`
- `trackLeadMagnetSignupClick()`

Wire on page mount (StarterKit/Thanks), submit success, download click, signup CTA click.

---

## Phase 11 — QA checklist

- `/starter-kit` loads logged out
- `/starter-kit` loads logged in (no redirect, prefilled)
- Form validates empty/invalid email
- Submit inserts row in `lead_magnet_signups` with UTM fields
- Redirect to `/starter-kit/thanks` works
- Download button fetches public ZIP successfully
- "Create Free Account" routes to `/auth`
- Global CTAs on `/`, `/pricing`, footer all link correctly
- No console errors
- `tsc --noEmit` clean
- Mobile responsive (715px+ viewport tested)
- Existing routes (`/`, `/dashboard`, `/auth`, `/pricing`, `/parking`, all SEO pages) unchanged

---

## Files summary

**New**:

- `supabase/migrations/<ts>_lead_magnet_signups.sql` (table + RLS + storage bucket + storage RLS)
- `src/pages/StarterKit.tsx`
- `src/pages/StarterKitThanks.tsx`
- `src/lib/leadMagnet.ts`

**Modified** (additive only):

- `src/App.tsx` — add 2 lazy routes
- `src/lib/analytics.ts` — add 4 helpers
- `src/pages/Landing.tsx` — one hero link + one footer link
- `src/pages/Pricing.tsx` — one banner row above comparison

**Storage**:

- Bucket `lead-magnets` (public, read-only via RLS)
- Object: `HaulTrackerPro_Trucker_Starter_Kit_Free.zip`

**Untouched**: auth, dashboard, Stripe, all hooks, all existing components, all SEO content pages. "**Proceed with the plan, but update it to use an environment-based download URL, use duplicate-safe upsert instead of unlimited duplicate rows, verify the ZIP upload/download, and keep the email delivery deferred for now."**

&nbsp;