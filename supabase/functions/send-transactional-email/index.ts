import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'

// Configuration baked in at scaffold time — do NOT change these manually.
const SITE_NAME = "haultrackerpro"
const SENDER_DOMAIN = "notify.haultrackerpro.com"
const FROM_DOMAIN = "notify.haultrackerpro.com"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-internal-secret',
}

// =============================================================================
// AUTH / ABUSE POLICY
// =============================================================================
//
// This function runs with `verify_jwt = false` in config.toml so we control
// auth in code. There are three valid caller modes:
//
//   1. Internal server-to-server (other Edge Functions). Caller MUST send
//      header `x-internal-secret` matching the project secret
//      INTERNAL_FUNCTION_SECRET. These calls may target any allowlisted
//      template and any recipient.
//
//   2. Authenticated end user. Caller sends a valid Supabase user JWT in the
//      `Authorization: Bearer …` header. The recipient MUST equal the
//      authenticated user's email (case-insensitive), unless the template
//      defines a fixed `to` (admin notifications go to the fixed address).
//
//   3. Anonymous (no JWT). ONLY the signup-welcome template is allowed
//      because it must fire before the user has confirmed their email.
//      Recipient is rate-limited per email and per IP. We never reveal
//      whether the email exists.
//
// In all modes the client cannot control: template HTML, subject line,
// sender address, reply-to, or any other template internals — those come
// from the registry on the server.

// Templates that anonymous callers may trigger. Keep this list as small as
// possible — anything here is publicly reachable.
const ANON_ALLOWED_TEMPLATES = new Set<string>([
  'lifecycle-day0', // signup welcome — fires before email confirmation
])

// Rate-limit window for anonymous sends (seconds).
const ANON_RATE_WINDOW_SECONDS = 60

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 320) return false
  // Conservative RFC-5322-ish check; good enough as a sanity gate.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  // ---- Parse body ----
  let templateName: string
  let recipientEmail: string | undefined
  let idempotencyKey: string
  const messageId = crypto.randomUUID()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let templateData: Record<string, any> = {}
  try {
    const body = await req.json()
    templateName = body.templateName || body.template_name
    recipientEmail = body.recipientEmail || body.recipient_email
    idempotencyKey = body.idempotencyKey || body.idempotency_key || messageId
    if (body.templateData && typeof body.templateData === 'object') {
      templateData = body.templateData
    }
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }

  if (!templateName || typeof templateName !== 'string') {
    return jsonResponse({ error: 'templateName is required' }, 400)
  }

  // ---- Template allowlist (registry IS the allowlist) ----
  const template = TEMPLATES[templateName]
  if (!template) {
    // Neutral error — do not reveal which templates exist.
    return jsonResponse({ error: 'Invalid template' }, 400)
  }

  // ---- Caller classification ----
  // We deliberately do NOT log the Authorization header or the internal
  // secret anywhere. Only the resolved boolean modes are logged.
  const providedInternalSecret = req.headers.get('x-internal-secret')
  const isInternalCall =
    !!internalSecret &&
    !!providedInternalSecret &&
    providedInternalSecret === internalSecret

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  let authedUserEmail: string | null = null
  if (!isInternalCall) {
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length)
      try {
        const { data, error } = await supabase.auth.getClaims(token)
        if (!error && data?.claims?.email) {
          authedUserEmail = String(data.claims.email).toLowerCase()
        }
      } catch {
        // Treat as anonymous — handled below.
      }
    }
  }

  const isAnonymous = !isInternalCall && !authedUserEmail

  // ---- Resolve effective recipient ----
  // Template-level `to` takes precedence (fixed admin recipients).
  let effectiveRecipient: string | undefined = template.to || recipientEmail

  if (!effectiveRecipient || !isValidEmail(effectiveRecipient)) {
    return jsonResponse(
      { error: 'A valid recipientEmail is required' },
      400,
    )
  }
  effectiveRecipient = effectiveRecipient.trim().toLowerCase()

  // ---- Per-mode authorization ----
  if (isAnonymous) {
    // Only specific templates are reachable anonymously.
    if (!ANON_ALLOWED_TEMPLATES.has(templateName)) {
      // Generic 401 — never reveal template policy details.
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    // For anon templates, recipient must come from the request (no fixed `to`).
    if (template.to) {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
  } else if (!isInternalCall && authedUserEmail) {
    // Authenticated user: recipient must match their own email, unless the
    // template has a fixed `to` (admin notifications).
    if (!template.to && effectiveRecipient !== authedUserEmail) {
      return jsonResponse(
        { error: 'Recipient must match the authenticated user' },
        403,
      )
    }
  }
  // isInternalCall → no further recipient restriction.

  // ---- Anonymous rate limit (per email + per IP) ----
  if (isAnonymous) {
    const since = new Date(
      Date.now() - ANON_RATE_WINDOW_SECONDS * 1000,
    ).toISOString()

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      'unknown'

    // Email-scoped: same recipient + template within window.
    const { count: emailCount } = await supabase
      .from('email_send_log')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_email', effectiveRecipient)
      .eq('template_name', templateName)
      .gte('created_at', since)

    if ((emailCount ?? 0) > 0) {
      // Neutral 200 — never confirm whether the email exists.
      return jsonResponse(
        { success: true, queued: false, reason: 'rate_limited' },
        200,
      )
    }

    // IP-scoped: cap any single IP from spraying many distinct addresses.
    if (ip !== 'unknown') {
      const { count: ipCount } = await supabase
        .from('email_send_log')
        .select('id', { count: 'exact', head: true })
        .eq('template_name', templateName)
        .eq('error_message', `ip:${ip}`) // see note below
        .gte('created_at', since)
      // Note: we record the IP marker in error_message on the pending row
      // below to keep schema unchanged. If 5+ sends from same IP in window,
      // throttle.
      if ((ipCount ?? 0) >= 5) {
        return jsonResponse(
          { success: true, queued: false, reason: 'rate_limited' },
          200,
        )
      }
    }
  }

  // ---- Suppression check (fail-closed) ----
  const { data: suppressed, error: suppressionError } = await supabase
    .from('suppressed_emails')
    .select('id')
    .eq('email', effectiveRecipient)
    .maybeSingle()

  if (suppressionError) {
    console.error('Suppression check failed', { templateName })
    return jsonResponse({ error: 'Failed to verify suppression status' }, 500)
  }

  if (suppressed) {
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
    })
    // Anonymous callers must never learn the recipient is suppressed.
    if (isAnonymous) {
      return jsonResponse({ success: true, queued: false }, 200)
    }
    return jsonResponse({ success: false, reason: 'email_suppressed' }, 200)
  }

  // ---- Get or create unsubscribe token ----
  const normalizedEmail = effectiveRecipient
  let unsubscribeToken: string

  const { data: existingToken, error: tokenLookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (tokenLookupError) {
    console.error('Token lookup failed', { templateName })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to look up unsubscribe token',
    })
    return jsonResponse({ error: 'Failed to prepare email' }, 500)
  }

  if (existingToken && !existingToken.used_at) {
    unsubscribeToken = existingToken.token
  } else if (!existingToken) {
    unsubscribeToken = generateToken()
    const { error: tokenError } = await supabase
      .from('email_unsubscribe_tokens')
      .upsert(
        { token: unsubscribeToken, email: normalizedEmail },
        { onConflict: 'email', ignoreDuplicates: true },
      )

    if (tokenError) {
      console.error('Failed to create unsubscribe token', { templateName })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to create unsubscribe token',
      })
      return jsonResponse({ error: 'Failed to prepare email' }, 500)
    }

    const { data: storedToken, error: reReadError } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (reReadError || !storedToken) {
      console.error('Failed to read back unsubscribe token', { templateName })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to confirm unsubscribe token storage',
      })
      return jsonResponse({ error: 'Failed to prepare email' }, 500)
    }
    unsubscribeToken = storedToken.token
  } else {
    // Token used but email not in suppression list — safety fallback.
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
      error_message:
        'Unsubscribe token used but email missing from suppressed list',
    })
    if (isAnonymous) {
      return jsonResponse({ success: true, queued: false }, 200)
    }
    return jsonResponse({ success: false, reason: 'email_suppressed' }, 200)
  }

  // ---- Render template (server-controlled) ----
  const html = await renderAsync(
    React.createElement(template.component, templateData),
  )
  const plainText = await renderAsync(
    React.createElement(template.component, templateData),
    { plainText: true },
  )

  const resolvedSubject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  // Log pending row. For anonymous calls, stash the IP marker in
  // error_message so the IP rate limiter above can count subsequent attempts.
  let pendingErrorMessage: string | null = null
  if (isAnonymous) {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      'unknown'
    if (ip !== 'unknown') pendingErrorMessage = `ip:${ip}`
  }

  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: templateName,
    recipient_email: effectiveRecipient,
    status: 'pending',
    error_message: pendingErrorMessage,
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: effectiveRecipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: resolvedSubject,
      html,
      text: plainText,
      purpose: 'transactional',
      label: templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue email', { templateName })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    return jsonResponse({ error: 'Failed to enqueue email' }, 500)
  }

  console.log('Transactional email enqueued', {
    templateName,
    mode: isInternalCall ? 'internal' : authedUserEmail ? 'user' : 'anon',
  })

  return jsonResponse({ success: true, queued: true }, 200)
})
