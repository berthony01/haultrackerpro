# Fix plan: restore preview rendering after auth hook rename

## Root cause

The preview is blank because the dev preview is still requesting a deleted module:

```text
GET /src/hooks/useAuth.ts?t=... -> 404
Referer: /src/hooks/useAdmin.ts?t=...
```

That missing script aborts the Vite module graph before React mounts, so `#root` stays empty and the preview shows a white screen.

This does not look like a new business-logic failure in auth/dashboard/Stripe. It looks like a preview/dev-server module-resolution problem introduced when `src/hooks/useAuth.ts` was deleted and replaced with `src/hooks/useAuth.tsx`.

## Implementation plan

### 1. Restore compatibility for the old import path

Add back `src/hooks/useAuth.ts` as a tiny compatibility shim that re-exports from `./useAuth.tsx`:

- `export { AuthProvider, useAuth } from './useAuth.tsx'`
- re-export any needed types if applicable

This gives the preview a valid response for stale `/src/hooks/useAuth.ts?...` requests and is the safest surgical fix because it does not alter working auth logic.

### 2. Preserve the current auth provider implementation

Keep the current centralized provider in `src/hooks/useAuth.tsx` as the source of truth.

- No rollback of the provider refactor
- No changes to auth flows, redirects, billing, admin checks, or user state behavior unless a second issue appears during verification

### 3. Verify the preview boot path end-to-end

After restoring the shim, verify:

- `/` renders instead of a blank page
- no more 404 for `/src/hooks/useAuth.ts`
- auth-protected routes still gate correctly
- the previous realtime crash fix still holds
- the “What’s New” once-per-user behavior still remains intact

## Technical details

- The 401 on `manifest.webmanifest` is not the blank-screen cause; the app should still mount with that warning.
- The critical failure is the missing JS module request for the deleted auth file.
- This matches known Vite dev/HMR behavior around renamed/deleted modules leaving stale import URLs during preview refreshes.

## Expected result

- Preview loads normally again
- Existing auth/provider refactor stays in place
- No regression to dashboard, Pro gating, Stripe, admin, or release-notes persistence Please implement the preview white-screen fix carefully and in phases.
  Context:
  After pushing the Haul Tracker Pro code to GitHub, the Lovable preview stopped rendering and shows a blank white screen. The dev console shows this critical error:
  GET /src/hooks/useAuth.ts?t=... -> 404
  Referer: /src/hooks/useAdmin.ts?t=...
  This suggests the Vite dev preview is still requesting a deleted or renamed auth hook module. The app likely had src/hooks/useAuth.ts before, but the current implementation now lives in src/hooks/useAuth.tsx.
  Phase 1: Restore preview compatibility immediately
  1. Create or restore this file:
  src/hooks/useAuth.ts
  2. Make it a tiny compatibility shim only. It should not contain new auth logic.
  3. It should re-export the current auth provider and hook from src/hooks/useAuth.tsx.
  4. Use the safest correct exports based on the actual file contents. For example:
  export { AuthProvider, useAuth } from './useAuth.tsx';
  If there are exported types used elsewhere, re-export those too.
  Important:
  Do not rewrite the auth system.
  Do not change login, signup, redirects, Stripe, Pro gating, admin logic, trial logic, dashboard logic, or protected route behavior unless a separate verified error appears.
  Phase 2: Audit all useAuth imports
  Search the entire codebase for all imports referencing useAuth, including:
  from './useAuth'
  from '@/hooks/useAuth'
  from '../hooks/useAuth'
  from './useAuth.ts'
  from '@/hooks/useAuth.ts'
  from './useAuth.tsx'
  from '@/hooks/useAuth.tsx'
  Verify that every import resolves correctly in Vite.
  If any file explicitly imports useAuth.ts and that creates fragility, update it to the clean alias/path import style already used by the project, preferably without hardcoding the extension unless the project requires it.
  Phase 3: Verify the module graph and preview
  Run the appropriate checks available in the project:
  npm install if needed
  npm run build
  npm run lint if available
  npm run typecheck if available
  npm run dev or preview boot check if available
  Then verify:
  1. The Lovable preview renders the homepage instead of a blank screen.
  2. There is no longer a 404 request for /src/hooks/useAuth.ts.
  3. React successfully mounts into #root.
  4. Auth-protected routes still redirect/gate correctly.
  5. Admin routes still work for the configured owner/admin account.
  6. Dashboard still loads.
  7. Pro gating and Stripe-related UI are not broken.
  8. The previous realtime crash fix still holds.
  9. The “What’s New” once-per-user behavior still remains intact.
  Phase 4: Do not chase unrelated warnings unless necessary
  The 401 on manifest.webmanifest should be logged separately, but do not treat it as the cause of the blank preview unless the app still fails after fixing the missing module.
  Expected result:
  The Lovable preview should load normally again, the current useAuth.tsx implementation should remain the source of truth, and there should be no regressions to auth, dashboard, admin, Stripe, Pro gating, or release-notes persistence.
  After implementation, provide a clear report showing:
  - Files changed
  - Exact exports added to src/hooks/useAuth.ts
  - All useAuth imports found
  - Any imports corrected
  - Build/lint/typecheck results
  - Preview verification results
  - Any remaining warnings that are not blocking app rendering