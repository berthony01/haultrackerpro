

## Plan: Fix 6 Minor Pre-Launch Issues

### 1. Forgot Password Flow
**Files to create/modify:**
- **Create `src/pages/ResetPassword.tsx`** — Page that detects `type=recovery` in URL hash, shows a "set new password" form, calls `supabase.auth.updateUser({ password })`
- **Modify `src/pages/Auth.tsx`** — Add a "Forgot password?" link (visible in login mode) that calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' })`
- **Modify `src/App.tsx`** — Add public route `<Route path="/reset-password" element={<ResetPassword />} />`

### 2. 14-Day Free Trial Badge on Pricing Page
**Modify `src/pages/Pricing.tsx`:**
- Add a small badge/pill below the Pro price showing "14-day free trial included" styled with the existing orange accent
- Add trial mention to the "Upgrade to Pro" button text or adjacent to it

### 3. Server-Side Parser Limit Tracking
**Database migration:**
- Create `parse_usage` table: `id uuid`, `user_id uuid`, `used_at timestamptz default now()` with RLS (users can insert/select own rows)

**Modify `src/components/PasteLoadParser.tsx`:**
- Replace `localStorage` logic with a query to `parse_usage` table counting rows where `used_at >= current week start`
- Insert a row on each parse for free users
- Keep client-side as a fallback/cache, but enforce via DB count

### 4. Double Subscription Prevention in create-checkout
**Modify `supabase/functions/create-checkout/index.ts`:**
- After finding an existing Stripe customer, check `stripe.subscriptions.list({ customer: customerId, status: 'active' })` and `status: 'trialing'`
- If an active/trialing subscription exists, return an error: `"You already have an active subscription"`

### 5. Leaked Password Protection
- Use the configure-auth tool to enable leaked password protection (HaveIBeenPwned check) in the authentication configuration

### 6. Fix delete-account CORS Headers
**Modify `supabase/functions/delete-account/index.ts`:**
- Update `corsHeaders` to match the full header set used by other functions:
```
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
```

### Edge Functions to Redeploy
- `create-checkout`
- `delete-account`

