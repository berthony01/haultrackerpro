import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from 'jsr:@supabase/supabase-js@2/cors'

const TEST_ACCOUNTS = new Set([
  'berthonyxyz@gmail.com',
  'peejayslifestyle@gmail.com',
  'wysdomaniac@gmail.com',
])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // Pull all auth users (paginated)
    const allUsers: Array<{ id: string; email?: string; created_at: string; user_metadata: any }> = []
    let page = 1
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw error
      allUsers.push(...(data.users as any))
      if (!data.users || data.users.length < 200) break
      page++
      if (page > 25) break
    }

    const now = Date.now()
    const day = 24 * 60 * 60 * 1000

    // Eligible candidates: signed up between 2-3 days ago (day2) or 7-8 days ago (day7)
    const day2Candidates = allUsers.filter(u => {
      const age = now - new Date(u.created_at).getTime()
      return age >= 2 * day && age < 3 * day
    })
    const day7Candidates = allUsers.filter(u => {
      const age = now - new Date(u.created_at).getTime()
      return age >= 7 * day && age < 8 * day
    })

    const candidateIds = [...new Set([...day2Candidates, ...day7Candidates].map(u => u.id))]
    if (candidateIds.length === 0) {
      return json({ checked: allUsers.length, sent: 0, day2: 0, day7: 0 })
    }

    // Find which candidates have ANY load (so we skip them)
    const { data: loadsData } = await admin
      .from('loads')
      .select('user_id')
      .in('user_id', candidateIds)
    const activeUserIds = new Set((loadsData ?? []).map((r: any) => r.user_id))

    let sentDay2 = 0
    let sentDay7 = 0

    const send = async (templateName: string, user: any) => {
      const email = (user.email || '').toLowerCase().trim()
      if (!email || TEST_ACCOUNTS.has(email)) return false
      if (activeUserIds.has(user.id)) return false
      const name = user.user_metadata?.display_name as string | undefined
      const { error } = await admin.functions.invoke('send-transactional-email', {
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
