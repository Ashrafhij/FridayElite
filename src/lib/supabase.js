import { createClient } from '@supabase/supabase-js'

/**
 * Backend connection — the single place where the app talks to Supabase.
 * Only the public (publishable / anon) key belongs here.
 * Never put the database password or a service_role / secret key in a VITE_* variable:
 * Vite inlines every VITE_* value into the public browser bundle.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

if (!isSupabaseConfigured) {
  throw new Error(
    'إعدادات Supabase غير مكتملة: تأكد من ضبط VITE_SUPABASE_URL و VITE_SUPABASE_PUBLISHABLE_KEY في ملف .env.local'
  )
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
