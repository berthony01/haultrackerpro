

## Add Feedback Tab to Admin Dashboard

**Problem:** User feedback (suggestions, bugs, questions) is saved to `feedback_responses` table but there's no way to view it. The Admin Dashboard has no Feedback tab.

### Steps

1. **Add `list-feedback` action to the `admin-api` edge function**
   - Query `feedback_responses` joined with `profiles` (or auth metadata) to get user email
   - Return: id, user_id, response, category, loads_count, created_at
   - Sort by newest first, limit 100

2. **Add a "Feedback" tab to `src/pages/Admin.tsx`**
   - New tab with `MessageSquare` icon alongside existing tabs (5-column grid)
   - Fetch feedback via `api.get('list-feedback')` when tab is active
   - Display a table with columns: Date, User Email (if available), Category, Message
   - Add category filter dropdown (all / suggestion / bug / question / great / needs_improvement / found_bug)
   - Show empty state when no feedback exists

### Files touched
- `supabase/functions/admin-api/index.ts` — add `list-feedback` handler
- `src/pages/Admin.tsx` — add Feedback tab UI

### Not touched
- No changes to theme, settings, dashboard, or any other existing features

