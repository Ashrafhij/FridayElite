// -------------------------------------------------
// Edge Function: loginPhone
// -------------------------------------------------
// Input (JSON body):
//   { phone: "<E.164>", password: "<string>" }
// Output (JSON on success):
//   { success: true, access_token: "<jwt>", refresh_token: "<jwt>" }
// Output (JSON on error):
//   { error: "<generic message>" }
// -------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Helper: normalize phone (identical to src/lib/phone.js)
function normalizePhone(inp) {
  if (!inp) return '';
  const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const EASTERN_ARABIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const LATIN_DIGITS = '0123456789';
  let value = String(inp)
    .replace(/[٠-٩]/g, (digit) => LATIN_DIGITS[ARABIC_INDIC_DIGITS.indexOf(digit)])
    .replace(/[۰-۹]/g, (digit) => LATIN_DIGITS[EASTERN_ARABIC_DIGITS.indexOf(digit)])
    .trim();
  if (!value) return '';
  value = value.replace(/[\s().-]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (value.startsWith('+')) {
    const digits = value.slice(1).replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }
  if (value.startsWith('972')) {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 8 ? `+${digits}` : '';
  }
  if (value.startsWith('0')) {
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 10) {
      return `+972${digits.slice(1)}`;
    }
    return '';
  }
  if (value.startsWith('5') && /^\d{9}$/.test(value)) {
    return `+972${value}`;
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 7 && digits.length <= 15) {
    return `+${digits}`;
  }
  return '';
}

const allowedOrigins = [
  'http://localhost:5173',
  'https://fridayelite.io',
];

export default async function handler(request, response) {
  // 1️⃣  CORS
  const origin = request.headers.get('origin') || '';
  if (allowedOrigins.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  }

  // Handle preflight
  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }

  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // 2️⃣  Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    response.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }
  const { phone, password } = body || {};

  if (!phone || !password) {
    response.status(400).json({ error: 'Missing phone or password' });
    return;
  }

  // 3️⃣  Normalise phone
  const normalized = normalizePhone(phone);
  if (!normalized) {
    response.status(400).json({ error: 'Invalid phone number' });
    return;
  }

  // 4️⃣  Create Supabase client with service-role key
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // 5️⃣  Look up the internal email for this phone
  const { data: mapRow, error: mapErr } = await supabase
    .from('phone_email_map')
    .select('internal_email')
    .eq('phone', normalized)
    .single();

  if (mapErr || !mapRow) {
    // No mapping → phone not registered – give generic error
    response.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const internalEmail = mapRow.internal_email;

  // 6️⃣  Authenticate with Supabase using the internal email
  const { data, error } = await supabase.auth.signInWithPassword({
    email: internalEmail,
    password,
  });

  if (error) {
    // Wrong password or other auth error → generic message
    response.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // 7️⃣  Return the session tokens so the frontend can call supabase.auth.setSession()
  response.status(200).json({
    success: true,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}