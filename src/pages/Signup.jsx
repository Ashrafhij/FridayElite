import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Phone,
  ShieldCheck,
  UserPlus,
  UserRound,
} from 'lucide-react'
import AuthLayout from '../components/auth/AuthLayout'
import { useAuth } from '../context/AuthContext'
import { establishSession, registerPhone } from '../lib/phoneAuth'
import { formatPhoneForDisplay, normalizePhone, validatePhone } from '../lib/phone'
import { toArabicError } from '../lib/errorMessages'

const inputClass =
  'mt-2 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50'

export default function Signup() {
  const navigate = useNavigate()
  const { syncSession } = useAuth()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const normalizedPhone = normalizePhone(phone)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    const name = fullName.trim()
    if (name.length < 2) {
      setError('أدخل الاسم الكامل (حرفان على الأقل).')
      return
    }

    const phoneCheck = validatePhone(phone)
    if (!phoneCheck.ok) {
      setError(phoneCheck.error)
      return
    }

    if (password.length < 8) {
      setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.')
      return
    }

    if (password !== passwordConfirm) {
      setError('كلمتا المرور غير متطابقتين.')
      return
    }

    setSubmitting(true)

    try {
      const data = await registerPhone({ phone, password, fullName: name })
      const hasSession = await establishSession(data)

      await syncSession()

      if (hasSession) {
        navigate('/account-status', { replace: true })
      } else {
        navigate('/login', {
          replace: true,
          state: { notice: 'تم إنشاء حسابك بنجاح. سجّل الدخول للمتابعة.' },
        })
      }
    } catch (signUpError) {
      setError(toArabicError(signUpError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="إنشاء حساب جديد"
      description="سجّل برقم هاتفك وكلمة مرور. تتم مراجعة كل حساب من قبل الإدارة قبل تفعيل التسجيل في المباريات."
      footer={
        <p className="text-sm text-white/45">
          لديك حساب بالفعل؟{' '}
          <Link to="/login" className="font-bold text-brand-300 hover:text-brand-200">
            تسجيل الدخول
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="signup-name" className="text-xs font-bold text-white/55">
            الاسم الكامل
          </label>
          <div className="relative">
            <UserRound className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-brand-400/70" />
            <input
              id="signup-name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="مثال: محمد أحمد"
              className={`${inputClass} pe-11`}
              disabled={submitting}
              maxLength={80}
            />
          </div>
        </div>

        <div>
          <label htmlFor="signup-phone" className="text-xs font-bold text-white/55">
            رقم الهاتف
          </label>
          <div className="relative">
            <Phone className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-brand-400/70" />
            <input
              id="signup-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="05X-XXXXXXX"
              className={`${inputClass} pe-11 text-left`}
              disabled={submitting}
              aria-describedby="signup-phone-hint"
            />
          </div>
          <p id="signup-phone-hint" className="mt-2 text-[11px] leading-5 text-white/35">
            {normalizedPhone
              ? `سيُحفظ الرقم بصيغة E.164: ${formatPhoneForDisplay(normalizedPhone)}`
              : 'الرقم الإسرائيلي المحلي يُحوَّل تلقائيًا إلى +972. الأرقام الدولية تُدخل مع رمز الدولة.'}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-amber-300/70">
            رقم الهاتف ليس إثباتًا لملكيته. تتحقق الإدارة من الرقم خارجيًا قبل الموافقة.
          </p>
        </div>

        <div>
          <label htmlFor="signup-password" className="text-xs font-bold text-white/55">
            كلمة المرور
          </label>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-brand-400/70" />
            <input
              id="signup-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              dir="ltr"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="8 أحرف على الأقل"
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

        <div>
          <label htmlFor="signup-password-confirm" className="text-xs font-bold text-white/55">
            تأكيد كلمة المرور
          </label>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-brand-400/70" />
            <input
              id="signup-password-confirm"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              dir="ltr"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              placeholder="أعد إدخال كلمة المرور"
              className={`${inputClass} pe-11 text-left`}
              disabled={submitting}
            />
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
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {submitting ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب'}
        </button>

        <p className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3 text-[11px] leading-6 text-white/35">
          لا نطلب بريدًا إلكترونيًا. لا يتم تخزين كلمة المرور في جداول التطبيق؛ تتم إدارتها بواسطة
          Supabase Auth فقط.
        </p>
      </form>
    </AuthLayout>
  )
}