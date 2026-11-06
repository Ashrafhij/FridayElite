// ============================================================================
// Supabase Edge Function: loginPhone
// ----------------------------------------------------------------------------
// Logs a user in with phone + password. The phone is resolved to the internal
// email through public.phone_email_map, then Supabase Auth verifies the
// password. Only session tokens are returned; the internal email never is.
//
// Request  (POST JSON): { phone: string, password: string }
// Response (200):       { success: true, access_token, refresh_token }
// Errors:               { success: false, error: CODE }  (generic auth errors)
//
// Deploy with JWT verification disabled:
//   supabase functions deploy loginPhone --no-verify-jwt
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const PHONE_RE = /^\+[1-9][0-9]{6,14}$/

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://ashrafhij.github.io',
  'https://fridayelite.io',
  'https://www.fridayelite.io',
])

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const extra = (Deno.env.get('APP_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }

  if (origin && (ALLOWED_ORIGINS.has(origin) || extra.includes(origin))) {
    headers['Access-Control-Allow-Origin'] = origin
  }

  return headers
}

function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      ...extra,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
}

const buckets = new Map<string, { count: number; resetAt: number }>()

function allow(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    if (buckets.size > 5000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey)
      }
    }
    return { ok: true, retryAfter: 0 }
  }

  bucket.count += 1
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) }
  }
  return { ok: true, retryAfter: 0 }
}

// Must stay in sync with src/lib/phone.js.
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const EASTERN_ARABIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const LATIN_DIGITS = '0123456789'

function normalizePhone(input: unknown): string {
  if (typeof input !== 'string' || !input) return ''

  let value = input
    .replace(/[٠-٩]/g, (digit) => LATIN_DIGITS[ARABIC_INDIC_DIGITS.indexOf(digit)])
    .replace(/[۰-۹]/g, (digit) => LATIN_DIGITS[EASTERN_ARABIC_DIGITS.indexOf(digit)])
    .trim()

  if (!value) return ''

  value = value.replace(/[\s().-]/g, '')

  if (value.startsWith('00')) value = `+${value.slice(2)}`

  if (value.startsWith('+')) {
    const digits = value.slice(1).replace(/\D/g, '')
    return digits ? `+${digits}` : ''
  }

  if (value.startsWith('972')) {
    const digits = value.replace(/\D/g, '')
    return digits.length >= 8 ? `+${digits}` : ''
  }

  if (value.startsWith('0')) {
    const digits = value.replace(/\D/g, '')
    if (digits.length >= 8 && digits.length <= 10) {
      return `+972${digits.slice(1)}`
    }
    return ''
  }

  if (value.startsWith('5') && /^\d{9}$/.test(value)) {
    return `+972${value}`
  }

  const digits = value.replace(/\D/g, '')
  if (digits.length >= 7 && digits.length <= 15) {
    return `+${digits}`
  }

  return ''
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error ?? '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return json(req, { success: false, error: 'METHOD_NOT_ALLOWED' }, 405)
  }

  const ipLimit = allow(`login:ip:${clientIp(req)}`, 10, 5 * 60 * 1000)
  if (!ipLimit.ok) {
    return json(
      req,
      { success: false, error: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(ipLimit.retryAfter) },
    )
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json(req, { success: false, error: 'INVALID_INPUT' }, 400)
  }

  const phone = normalizePhone(body?.phone)
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!PHONE_RE.test(phone) || !password) {
    // Same generic answer for every credential problem.
    return json(req, { success: false, error: 'INVALID_CREDENTIALS' }, 401)
  }

  const phoneLimit = allow(`login:phone:${phone}`, 8, 5 * 60 * 1000)
  if (!phoneLimit.ok) {
    return json(
      req,
      { success: false, error: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(phoneLimit.retryAfter) },
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('loginPhone: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return json(req, { success: false, error: 'SERVER_ERROR' }, 500)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  try {
    const { data: mapping, error: lookupError } = await admin
      .from('phone_email_map')
      .select('internal_email')
      .eq('phone', phone)
      .maybeSingle()

    if (lookupError) throw lookupError

    // Unknown phone and wrong password intentionally produce the same answer,
    // so an attacker cannot enumerate registered phone numbers. The short
    // delay narrows the timing gap against a real password hash check.
    if (!mapping?.internal_email) {
      await new Promise((resolve) => setTimeout(resolve, 350))
      return json(req, { success: false, error: 'INVALID_CREDENTIALS' }, 401)
    }

    const { data: signIn, error: signInError } = await admin.auth.signInWithPassword({
      email: mapping.internal_email,
      password,
    })

    if (signInError || !signIn?.session) {
      return json(req, { success: false, error: 'INVALID_CREDENTIALS' }, 401)
    }

    return json(req, {
      success: true,
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    })
  } catch (error) {
    console.error('loginPhone: unexpected error', messageOf(error))
    return json(req, { success: false, error: 'SERVER_ERROR' }, 500)
  }
})
