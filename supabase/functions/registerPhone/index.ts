// ============================================================================
// Supabase Edge Function: registerPhone
// ----------------------------------------------------------------------------
// Creates a phone + password account without SMS/OTP. Supabase Auth stores the
// account under a random internal email; the public phone number is mapped to
// that email in public.phone_email_map (service-role only).
//
// Request  (POST JSON): { phone: string, password: string, fullName?: string }
// Response (200):       { success: true, access_token, refresh_token }
// Errors:               { success: false, error: CODE }
//
// Deploy with JWT verification disabled:
//   supabase functions deploy registerPhone --no-verify-jwt
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const PHONE_RE = /^\+[1-9][0-9]{6,14}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

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

// Best-effort, per-instance burst protection. Supabase Auth also applies its
// own rate limits; this stops repeated calls from one client in a hot instance.
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

function makeInternalEmail(): string {
  const token = crypto.randomUUID().replace(/-/g, '')
  const email = `int-${token}@phone-auth.fridayelite.app`
  if (!EMAIL_RE.test(email)) throw new Error('INTERNAL_EMAIL_INVALID')
  return email
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error ?? '')
}

function isDuplicate(message: string): boolean {
  const value = message.toLowerCase()
  return (
    value.includes('already') ||
    value.includes('duplicate') ||
    value.includes('registered') ||
    value.includes('unique constraint')
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return json(req, { success: false, error: 'METHOD_NOT_ALLOWED' }, 405)
  }

  const ipLimit = allow(`register:ip:${clientIp(req)}`, 5, 10 * 60 * 1000)
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
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : ''

  if (!PHONE_RE.test(phone)) {
    return json(req, { success: false, error: 'INVALID_PHONE' }, 400)
  }

  if (password.length < 8 || password.length > 72) {
    return json(req, { success: false, error: 'WEAK_PASSWORD' }, 400)
  }

  if (fullName && (fullName.length < 2 || fullName.length > 80)) {
    return json(req, { success: false, error: 'INVALID_NAME' }, 400)
  }

  const phoneLimit = allow(`register:phone:${phone}`, 3, 10 * 60 * 1000)
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
    console.error('registerPhone: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return json(req, { success: false, error: 'SERVER_ERROR' }, 500)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  try {
    // Reject duplicates before creating an Auth user. The unique indexes are
    // still the final guard against concurrent requests.
    const [{ data: mapped, error: mapLookupError }, { data: profile, error: profileLookupError }] =
      await Promise.all([
        admin.from('phone_email_map').select('id').eq('phone', phone).maybeSingle(),
        admin.from('profiles').select('id').eq('phone', phone).maybeSingle(),
      ])

    if (mapLookupError) throw mapLookupError
    if (profileLookupError) throw profileLookupError

    if (mapped || profile) {
      return json(req, { success: false, error: 'ACCOUNT_EXISTS' }, 409)
    }

    const internalEmail = makeInternalEmail()

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: {
        phone,
        full_name: fullName || 'لاعب جديد',
      },
    })

    if (createError || !created?.user) {
      const message = messageOf(createError)
      const lower = message.toLowerCase()

      if (lower.includes('password')) {
        return json(req, { success: false, error: 'WEAK_PASSWORD' }, 400)
      }
      if (isDuplicate(message)) {
        return json(req, { success: false, error: 'ACCOUNT_EXISTS' }, 409)
      }
      console.error('registerPhone: createUser failed', message)
      return json(req, { success: false, error: 'SERVER_ERROR' }, 500)
    }

    const userId = created.user.id

    const { error: mappingError } = await admin.from('phone_email_map').insert({
      id: userId,
      phone,
      internal_email: internalEmail,
    })

    if (mappingError) {
      console.error('registerPhone: mapping insert failed', messageOf(mappingError))
      await admin.auth.admin.deleteUser(userId)
      if (isDuplicate(messageOf(mappingError))) {
        return json(req, { success: false, error: 'ACCOUNT_EXISTS' }, 409)
      }
      return json(req, { success: false, error: 'SERVER_ERROR' }, 500)
    }

    // Start a session immediately so the app can open /account-status.
    const { data: signIn, error: signInError } = await admin.auth.signInWithPassword({
      email: internalEmail,
      password,
    })

    if (signInError || !signIn?.session) {
      // The account was created successfully; the user can still log in.
      console.error('registerPhone: post-signup sign-in failed', messageOf(signInError))
      return json(req, { success: true, access_token: null, refresh_token: null })
    }

    return json(req, {
      success: true,
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    })
  } catch (error) {
    console.error('registerPhone: unexpected error', messageOf(error))
    return json(req, { success: false, error: 'SERVER_ERROR' }, 500)
  }
})
