// -------------------------------------------------
// Edge Function: registerPhone
// -------------------------------------------------
// Input (JSON body):
//   { phone: "<E.164>", password: "<string>", fullName?: "<string>" }
// Output (JSON on success):
//   { success: true, userId: "<auth.uid>" }
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

function validatePhone(inp) {
  const normalized = normalizePhone(inp);
  if (!normalized) return { ok: false, normalized: '', error: 'Invalid phone' };
  if (!/^\+[1-9][0-9]{6,14}$/.test(normalized)) {
    return { ok: false, normalized, error: 'Invalid phone format' };
  }
  return { ok: true, normalized, error: '' };
}

const allowedOrigins = [
  'http://localhost:5173',
  'https://fridayelite.io', // replace with your production domain
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
  const { phone, password, fullName } = body || {};

  if (!phone || !password) {
    response.status(400).json({ error: 'Missing phone or password' });
    return;
  }

  // 3️⃣  Validate phone
  const phoneCheck = validatePhone(phone);
  if (!phoneCheck.ok) {
    response.status(400).json({ error: 'Invalid phone number' });
    return;
  }
  const normalized = phoneCheck.normalized;

  // 4️⃣  Validate password length
  if (password.length < 8) {
    response.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  // 5️⃣  Create Supabase client with service-role key
  // (Edge Functions run with the service-role key automatically)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // 6️⃣  Check mapping table – if phone already registered → error
  const { data: existingMap, error: mapErr } = await supabase
    .from('phone_email_map')
    .select('internal_email')
    .eq('phone', normalized);

  if (mapErr) {
    console.error('Mapping table error:', mapErr);
    response.status(500).json({ error: 'Could not check phone registry' });
    return;
  }

  if (existingMap && existingMap.length > 0) {
    response.status(409).json({ error: 'Account already exists' });
    return;
  }

  // 7️⃣  Generate a unique internal email (UUID-based, collision-resistant)
  const generateInternalEmail = () => {
    const suffix = crypto.randomUUID().slice(0, 12); // 12-char hex
    return `int-${suffix}@fridayelite.internal`;
  };
  const internalEmail = generateInternalEmail();

  // 8️⃣  Create the Supabase Auth user with that internal email
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: internalEmail,
    password,
    options: {
      data: {
        full_name: fullName || null,
      },
    },
  });

  if (authError) {
    console.error('Auth sign-up error:', authError);
    response.status(400).json({ error: 'Registration failed' });
    return;
  }

  // 9️⃣  Insert the phone ↔ internal_email mapping
  const { error: mapError } = await supabase
    .from('phone_email_map')
    .insert({
      id: authData.user.id,
      phone: normalized,
      internal_email: internalEmail,
    });

  if (mapError) {
    console.error('Failed to insert mapping:', mapError);
    // Optional: try to delete the auth user to keep consistency
    await supabase.auth.admin.deleteUser(authData.user.id);
    response.status(500).json({ error: 'Could not save phone mapping' });
    return;
  }

  // 10️⃣  Return success – do NOT send the internal email back
  response.status(200).json({ success: true, userId: authData.user.id });
}