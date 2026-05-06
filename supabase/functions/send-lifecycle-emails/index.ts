import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from 'jsr:@supabase/supabase-js@2/cors'

const TEST_ACCOUNTS = new Set([
  'berthonyxyz@gmail.com',
  'peejayslifestyle@gmail.com',
  'wysdomaniac@gmail.com',
])

// Recent email change cooldown — don't pile lifecycle on top of an email-change event
const RECENT_EMAIL_CHANGE_HOURS = 72

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Restrict to internal callers (cron job) only.
  const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET')
  const provided = req.headers.get('x-internal-secret') ?? ''
  if (!internalSecret || provided !== internalSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // Pull all auth users (paginated)
    type AuthUser = {
      id: string
      email?: string
      created_at: string
      email_confirmed_at?: string | null
      confirmed_at?: string | null
      email_change_sent_at?: string | null
      new_email?: string | null
      user_metadata: any
    }
    const allUsers: AuthUser[] = []
    let page = 1
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw error
      allUsers.push(...((data.users as unknown) as AuthUser[]))
      if (!data.users || data.users.length < 200) break
      page++
      if (page > 25) break
    }

    const now = Date.now()
    const day = 24 * 60 * 60 * 1000

    // Eligible age windows
    const day2Window = (ageMs: number) => ageMs >= 2 * day && ageMs < 3 * day
    const day7Window = (ageMs: number) => ageMs >= 7 * day && ageMs < 8 * day

    const day2Candidates: AuthUser[] = []
    const day7Candidates: AuthUser[] = []

    const recentEmailChangeCutoff = now - RECENT_EMAIL_CHANGE_HOURS * 60 * 60 * 1000

    for (const u of allUsers) {
      const email = (u.email || '').toLowerCase().trim()
      if (!email || TEST_ACCOUNTS.has(email)) continue

      // Skip pending verification: must have email_confirmed_at OR confirmed_at
      const verified = !!(u.email_confirmed_at || u.confirmed_at)
      if (!verified) continue

      // Skip if a recent email change is in flight or just happened
      if (u.new_email) continue
      if (u.email_change_sent_at) {
        const t = new Date(u.email_change_sent_at).getTime()
        if (!Number.isNaN(t) && t > recentEmailChangeCutoff) continue
      }

      const age = now - new Date(u.created_at).getTime()
      if (day2Window(age)) day2Candidates.push(u)
      else if (day7Window(age)) day7Candidates.push(u)
    }

    const candidateIds = [...new Set([...day2Candidates, ...day7Candidates].map(u => u.id))]
    if (candidateIds.length === 0) {
      return json({ checked: allUsers.length, sent_day2: 0, sent_day7: 0 })
    }

    // "Loads inserted" gate — count actual loads rows per user (strict, not just signup age)
    const { data: loadsData } = await admin
      .from('loads')
      .select('user_id')
      .in('user_id', candidateIds)
    const loadCount = new Map<string, number>()
    for (const r of (loadsData ?? []) as Array<{ user_id: string }>) {
      loadCount.set(r.user_id, (loadCount.get(r.user_id) ?? 0) + 1)
    }

    // Email opt-in preferences
    const { data: settingsRows } = await admin
      .from('user_settings')
      .select('user_id, lifecycle_emails_opt_in')
      .in('user_id', candidateIds)
    const optedIn = new Map<string, boolean>()
    for (const r of (settingsRows ?? []) as Array<{ user_id: string; lifecycle_emails_opt_in: boolean | null }>) {
      optedIn.set(r.user_id, r.lifecycle_emails_opt_in !== false)
    }

    let sentDay2 = 0
    let sentDay7 = 0
    let skippedActive = 0
    let skippedOptOut = 0

    const send = async (templateName: string, user: AuthUser) => {
      const email = (user.email || '').toLowerCase().trim()
      // Skip if already has at least one load
      if ((loadCount.get(user.id) ?? 0) > 0) {
        skippedActive++
        return false
      }
      // Skip if opted out (default true when no settings row)
      if (optedIn.get(user.id) === false) {
        skippedOptOut++
        return false
      }
      const name = user.user_metadata?.display_name as string | undefined
      const { error } = await admin.functions.invoke('send-transactional-email', {
        headers: {
          // Internal server-to-server auth — see send-transactional-email policy.
          'x-internal-secret': Deno.env.get('INTERNAL_FUNCTION_SECRET') ?? '',
        },
        body: {
          templateName,
          recipientEmail: email,
          idempotencyKey: `${templateName}-${user.id}`,
          templateData: { name },
        },
      })
      if (error) {
        console.error(`[lifecycle] ${templateName} failed for ${email}:`, error)
        return false
      }
      return true
    }

    for (const u of day2Candidates) {
      if (await send('lifecycle-day2', u)) sentDay2++
    }
    for (const u of day7Candidates) {
      if (await send('lifecycle-day7', u)) sentDay7++
    }

    return json({
      checked: allUsers.length,
      day2_candidates: day2Candidates.length,
      day7_candidates: day7Candidates.length,
      sent_day2: sentDay2,
      sent_day7: sentDay7,
      skipped_active: skippedActive,
      skipped_opt_out: skippedOptOut,
    })
  } catch (err) {
    console.error('[lifecycle] error:', err)
    return json({ error: (err as Error).message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
