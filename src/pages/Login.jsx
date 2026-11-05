import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, LogIn, Phone } from 'lucide-react'
import AuthLayout from '../components/auth/AuthLayout'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { formatPhoneForDisplay, normalizePhone, validatePhone } from '../lib/phone'
import { toArabicError } from '../lib/errorMessages'

const inputClass =
  'mt-2 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { syncSession } = useAuth()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const normalizedPhone = normalizePhone(phone)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    const phoneCheck = validatePhone(phone)
    if (!phoneCheck.ok) {
      setError(phoneCheck.error)
      return
    }

    if (!password) {
      setError('أدخل كلمة المرور.')
      return
    }

    setSubmitting(true)

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('loginPhone', {
        body: { phone, password },
      })
      if (invokeError) throw invokeError
      if (!data || !data.success) throw new Error('Login failed')

      // Establish session from the edge function response
      await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      })

      await syncSession()

      const from = location.state?.from
      navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (signInError) {
      setError(toArabicError(signInError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="تسجيل الدخول"
      description="استخدم رقم هاتفك وكلمة المرور للوصول إلى حسابك في فرايدي إيليت."
      footer={
        <p className="text-sm text-white/45">
          ليس لديك حساب؟{' '}
          <Link to="/signup" className="font-bold text-brand-300 hover:text-brand-200">
            أنشئ حسابًا جديدًا
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="login-phone" className="text-xs font-bold text-white/55">
            رقم الهاتف
          </label>
          <div className="relative">
            <Phone className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-brand-400/70" />
            <input
              id="login-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="05X-XXXXXXX"
              className={`${inputClass} pe-11 text-left`}
              disabled={submitting}
              aria-describedby="login-phone-hint"
            />
          </div>
          <p id="login-phone-hint" className="mt-2 text-[11px] leading-5 text-white/35">
            {normalizedPhone
              ? `سيُستخدم الرقم: ${formatPhoneForDisplay(normalizedPhone)}`
              : 'يمكنك إدخال رقم إسرائيلي محلي أو رقم دولي بصيغة E.164.'}
          </p>
        </div>

        <div>
          <label htmlFor="login-password" className="text-xs font-bold text-white/55">
            كلمة المرور
          </label>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-brand-400/70" />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              dir="ltr"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className={`${inputClass} ps-11 pe-11 text-left`}
              disabled={submitting}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute start-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/40 transition-colors hover:text-white/75"
              aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[12px] leading-6 text-red-200"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3.5 text-sm font-extrabold text-pitch-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
          {submitting ? 'جارٍ تسجيل الدخول…' : 'دخول'}
        </button>

        <p className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3 text-[11px] leading-6 text-white/35">
          لا توجد حاليًا إعادة تعيين ذاتية لكلمة المرور دون قناة تحقق (رسالة نصية أو بريد). إذا
          نسيت كلمة المرور، تواصل مع إدارة المجموعة.
        </p>
      </form>
    </AuthLayout>
  )
}