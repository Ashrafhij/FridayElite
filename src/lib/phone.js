const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const EASTERN_ARABIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const LATIN_DIGITS = '0123456789'

function toLatinDigits(value) {
  return String(value)
    .replace(/[٠-٩]/g, (digit) => LATIN_DIGITS[ARABIC_INDIC_DIGITS.indexOf(digit)])
    .replace(/[۰-۹]/g, (digit) => LATIN_DIGITS[EASTERN_ARABIC_DIGITS.indexOf(digit)])
}

/**
 * Normalizes user input to E.164.
 *
 * Israeli local mobile numbers (05X-XXXXXXX) become +9725XXXXXXXX.
 * International numbers must be entered with "+", "00", or their country code.
 * This is a formatting helper only; it never proves phone ownership.
 */
export function normalizePhone(input) {
  if (!input) return ''

  let value = toLatinDigits(input).trim()
  if (!value) return ''

  value = value.replace(/[\s().-]/g, '')

  if (value.startsWith('00')) {
    value = `+${value.slice(2)}`
  }

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

  // Israeli mobile number entered without the leading zero.
  if (value.startsWith('5') && /^\d{9}$/.test(value)) {
    return `+972${value}`
  }

  const digits = value.replace(/\D/g, '')
  if (digits.length >= 7 && digits.length <= 15) {
    return `+${digits}`
  }

  return ''
}

export function validatePhone(input) {
  const normalized = normalizePhone(input)

  if (!normalized) {
    return {
      ok: false,
      normalized: '',
      error: 'أدخل رقم هاتف صالحًا مع رمز الدولة، مثل 0501234567 أو +972501234567.',
    }
  }

  if (!/^\+[1-9][0-9]{6,14}$/.test(normalized)) {
    return {
      ok: false,
      normalized,
      error: 'رقم الهاتف غير صالح. استخدم الصيغة الدولية E.164.',
    }
  }

  return { ok: true, normalized, error: '' }
}

export function formatPhoneForDisplay(phone) {
  if (!phone) return '—'

  const israeli = /^\+972(\d{2})(\d{3})(\d{4})$/.exec(phone)
  if (israeli) {
    return `+972 ${israeli[1]}-${israeli[2]}-${israeli[3]}`
  }

  return phone
}
