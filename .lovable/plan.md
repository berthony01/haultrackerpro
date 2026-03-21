

## Plan: Fix Admin Users Tab — Redeploy Edge Function

### Problem
The admin "Users" tab fails because the deployed `admin-api` edge function is an older version that doesn't include the `list-users` action handler. The network request `GET /admin-api?action=list-users&page=1&per_page=50` returns **400 "Unknown action"**.

The source code in `supabase/functions/admin-api/index.ts` already has the correct `list-users` handler (line 95). No code changes are needed.

### Fix
**Redeploy the `admin-api` edge function** so the deployed version matches the source code that already includes:
- `list-users` action with pagination (50 per page)
- Email search filtering
- User enrichment with loads/expenses counts

### Files Changed
None — the code is already correct. Only a deployment is needed.

### Verification
After redeployment:
1. Navigate to `/admin` and click the Users tab
2. The full user list should load automatically (7 users based on overview data)
3. Pagination controls (Previous/Next) should work
4. Search by email/name should filter results

