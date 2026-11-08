import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import AuthLayout from '../components/auth/AuthLayout'
import Badge from '../components/ui/Badge'
import { useAuth } from '../context/AuthContext'
import { toArabicError } from '../lib/errorMessages'
import { formatPhoneForDisplay, validatePhone } from '../lib/phone'
import { supabase } from '../lib/supabase'

const TIME_ZONE = 'Asia/Jerusalem'

function formatDay(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TIME_ZONE,
  }).format(date)
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  }).format(date)
}

function formatDateTime(value) {
  if (!value) return '—'
  return `${formatDay(value)} · ${formatTime(value)}`
}

function stateLabel(invite) {
  if (!invite) return null
  switch (invite.registration_state) {
    case 'open':
      return { variant: 'brand', text: 'التسجيل مفتوح' }
    case 'not_open':
      return { variant: 'warning', text: 'لم يفتح التسجيل بعد' }
    case 'locked':
      return { variant: 'warning', text: 'التسجيل موقوف' }
    default:
      return { variant: 'neutral', text: 'التسجيل مغلق' }
  }
}

function stateMessage(invite) {
  if (!invite) return ''
  switch (invite.registration_state) {
    case 'open': {
      // Per-pool counts arrive with migration 0026. Until then, fall back to
      // the original total-seat message so the page keeps working.
      if (invite.gk_confirmed === undefined || invite.outfield_confirmed === undefined) {
        const left = Math.max(0, invite.capacity - invite.confirmed_count)
        return left > 0
          ? `متبقي ${left} مقعدًا من أصل ${invite.capacity}.`
          : `اكتمل العدد — التسجيل الآن في قائمة الانتظار (${invite.waitlist_count} منتظر).`
      }

      const capacity = Number(invite.capacity ?? 18)
      const gkLimit = Math.min(2, capacity)
      const outfieldLimit = Math.min(16, Math.max(capacity - gkLimit, 0))
      const gkLeft = Math.max(0, gkLimit - Number(invite.gk_confirmed ?? 0))
      const outfieldLeft = Math.max(0, outfieldLimit - Number(invite.outfield_confirmed ?? 0))

      if (outfieldLeft <= 0 && gkLeft <= 0) {
        return `اكتمل العدد — التسجيل الآن في قائمة الانتظار (${invite.waitlist_count} منتظر).`
      }
      if (outfieldLeft <= 0) {
        return `اكتمل عدد لاعبي الميدان — ما زال هناك ${gkLeft} مقعد لحراس المرمى. اللاعبون الجدد يدخلون قائمة الانتظار.`
      }
      if (gkLeft <= 0) {
        return `اكتمل عدد حراس المرمى — ما زال هناك ${outfieldLeft} مقعد للاعبين الميدان. حراس المرمى الجدد يدخلون قائمة الانتظار.`
      }
      return `متبقي ${outfieldLeft} مقعدًا للاعبين و${gkLeft} لحراس المرمى.`
    }
    case 'not_open':
      return `يفتح التسجيل ${formatDateTime(invite.registration_open_at)}.`
    case 'locked':
      return 'أوقف المدير التسجيل لهذه المباراة مؤقتًا.'
    default:
      return 'انتهت فترة التسجيل لهذه المباراة.'
  }
}

function StepDots({ phase }) {
  const steps = ['الرقم', 'التأكيد', 'تم']
  const activeIndex = phase === 'confirm' ? 1 : phase === 'done' ? 2 : 0
  return (
    <ol className="mb-5 flex items-center justify-center gap-2 text-[11px] font-bold">
      {steps.map((label, index) => {
        const done = index < activeIndex || phase === 'done'
        const active = index === activeIndex && phase !== 'done'
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`grid size-6 place-items-center rounded-full border text-[10px] ${
                done
                  ? 'border-brand-400/40 bg-brand-400/15 text-brand-200'
                  : active
                    ? 'border-brand-400 bg-brand-400 text-pitch-950'
                    : 'border-white/10 bg-white/5 text-white/35'
              }`}
            >
              {done ? <CheckCircle2 className="size-3.5" /> : index + 1}
            </span>
            <span className={done || active ? 'text-white/70' : 'text-white/35'}>{label}</span>
            {index < steps.length - 1 ? <span className="h-px w-4 bg-white/10" aria-hidden="true" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

export default function JoinMatch() {
  const { matchId } = useParams()
  const { session, profile } = useAuth()

  const [phone, setPhone] = useState('')
  const [phase, setPhase] = useState('phone')
  const [lookup, setLookup] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const inviteQuery = useQuery({
    queryKey: ['match-invite', matchId],
    enabled: Boolean(matchId),
    retry: 0,
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc('get_match_invite', {
        p_match_id: matchId,
      })
      if (rpcError) throw rpcError
      return data?.[0] ?? null
    },
  })

  const invite = inviteQuery.data
  const badge = stateLabel(invite)
  const registrationOpen = invite?.registration_state === 'open'
  const fromPath = `/join/${matchId}`

  async function handleLookup(event) {
    event.preventDefault()
    if (busy) return

    setError('')
    const check = validatePhone(phone)
    if (!check.ok) {
      setError(check.error)
      return
    }

    setBusy(true)
    const { data, error: rpcError } = await supabase.rpc('lookup_player_for_registration', {
      p_match_id: matchId,
      p_phone: check.normalized,
    })
    setBusy(false)

    if (rpcError) {
      setError(toArabicError(rpcError, 'تعذر التحقق من الرقم. حاول مرة أخرى.'))
      return
    }

    const row = data?.[0]
    if (!row) {
      setLookup({ phone: check.normalized })
      setPhase('unknown')
      return
    }

    setLookup({ ...row, phone: check.normalized })

    if (row.registration_status) {
      setResult({
        name: row.player_name,
        status: row.registration_status,
        queuePosition: row.queue_position,
        rosterRole: row.roster_role,
        already: true,
      })
      setPhase('done')
      return
    }

    setPhase('confirm')
  }

  async function handleRegister() {
    if (!lookup?.phone || busy) return

    setBusy(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('quick_register_for_match', {
      p_match_id: matchId,
      p_phone: lookup.phone,
    })
    setBusy(false)

    if (rpcError) {
      setError(toArabicError(rpcError, 'تعذر إكمال التسجيل. حاول مرة أخرى.'))
      return
    }

    const row = data?.[0]
    if (!row) {
      setError('تعذر إكمال التسجيل. حاول مرة أخرى.')
      return
    }

    setResult({
      name: row.player_name,
      status: row.registration_status,
      queuePosition: row.queue_position,
      rosterRole: row.roster_role,
      already: row.already_registered,
    })
    setPhase('done')
    void inviteQuery.refetch()
  }

  function resetFlow() {
    setPhone('')
    setLookup(null)
    setResult(null)
    setError('')
    setPhase('phone')
  }

  const title =
    phase === 'done' ? 'تم التسجيل بنجاح' : phase === 'unknown' ? 'الرقم غير مسجل' : 'التسجيل في المباراة'

  return (
    <AuthLayout
      title={title}
      description={
        phase === 'phone'
          ? 'أدخل رقم هاتفك، سنعرض اسمك، ثم تؤكد التسجيل — دون الحاجة لتسجيل الدخول.'
          : undefined
      }
      footer={
        session ? (
          <p className="text-xs leading-6 text-white/40">
            أنت مسجل الدخول باسم{' '}
            <span className="font-bold text-white/70">{profile?.full_name ?? 'لاعب'}</span>
            {profile?.status === 'approved' ? (
              <>
                {' · '}
                <Link to={`/matches/${matchId}`} className="font-bold text-brand-300 hover:text-brand-200">
                  فتح تفاصيل المباراة
                </Link>
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-white/45">
            لديك حساب بالفعل؟{' '}
            <Link
              to="/login"
              state={{ from: fromPath }}
              className="inline-flex min-h-11 items-center font-bold text-brand-300 hover:text-brand-200"
            >
              سجّل الدخول
            </Link>
          </p>
        )
      }
    >
      {inviteQuery.isLoading ? (
        <div className="flex flex-col items-center justify-center py-10 text-center" role="status">
          <Loader2 className="size-7 animate-spin text-brand-400" />
          <p className="mt-3 text-sm font-semibold text-white/50">جارٍ تحميل المباراة…</p>
        </div>
      ) : inviteQuery.isError || !invite ? (
        <div className="py-4 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
            <AlertCircle className="size-6" />
          </span>
          <p className="mt-4 text-base font-extrabold text-sand-100">الرابط غير صالح</p>
          <p className="mt-2 text-sm leading-7 text-white/50">
            لم نعثر على هذه المباراة. تأكد من الرابط الذي أرسله لك المدير.
          </p>
          <Link
            to="/"
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950"
          >
            العودة للرئيسية
            <ArrowLeft className="size-4" />
          </Link>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-brand-400/20 bg-brand-400/[0.06] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-brand-300">مباراة فرايدي إيليت</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-extrabold text-sand-100">
                  <CalendarDays className="size-4 shrink-0 text-brand-300" />
                  {formatDay(invite.kickoff_at)}
                </p>
              </div>
              {badge ? <Badge variant={badge.variant}>{badge.text}</Badge> : null}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-semibold text-white/60">
              <span className="flex items-center gap-1.5">
                <Clock className="size-3.5 text-brand-300/80" />
                {formatTime(invite.kickoff_at)}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5 text-brand-300/80" />
                {invite.venue}
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5 text-brand-300/80" />
                {invite.confirmed_count}/{invite.capacity} مؤكد
              </span>
            </div>

            <p className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-6 text-white/45">
              {stateMessage(invite)}
            </p>
          </div>

          <div className="mt-5">
            <StepDots phase={phase} />

            {error ? (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[12px] leading-6 text-red-200"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            {phase === 'phone' ? (
              <form onSubmit={handleLookup} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="join-phone" className="text-xs font-bold text-white/55">
                    رقم الهاتف
                  </label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-brand-400/70" />
                    <input
                      id="join-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      dir="ltr"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="05X-XXXXXXX"
                      disabled={busy}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 pe-11 text-left text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50"
                    />
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-white/35">
                    اكتب رقمك كما هو معروف لدى الإدارة (مثال: 0501234567).
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3.5 text-sm font-extrabold text-pitch-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  {busy ? 'جارٍ التحقق…' : 'متابعة'}
                </button>
              </form>
            ) : null}

            {phase === 'confirm' && lookup ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
                  <p className="text-[11px] font-bold text-white/40">الرقم</p>
                  <p dir="ltr" className="mt-1 text-sm font-bold text-white/70">
                    {formatPhoneForDisplay(lookup.phone)}
                  </p>
                  <p className="mt-3 text-[11px] font-bold text-white/40">الاسم المسجل</p>
                  <p className="mt-1 text-xl font-black text-sand-100">{lookup.player_name}</p>
                  <p className="mt-2 text-[11px] leading-6 text-white/40">هل هذا أنت؟</p>
                </div>

                <button
                  type="button"
                  onClick={() => void handleRegister()}
                  disabled={busy || !registrationOpen}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3.5 text-sm font-extrabold text-pitch-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                  {busy ? 'جارٍ التسجيل…' : registrationOpen ? 'نعم، سجّلني في المباراة' : 'التسجيل مغلق'}
                </button>

                {!registrationOpen ? (
                  <p className="text-center text-[11px] leading-6 text-amber-200/80">{stateMessage(invite)}</p>
                ) : null}

                <button
                  type="button"
                  onClick={resetFlow}
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-xs font-bold text-white/60 transition-colors hover:text-white disabled:opacity-60"
                >
                  ليس أنا — استخدم رقمًا آخر
                </button>
              </div>
            ) : null}

            {phase === 'unknown' && lookup ? (
              <div className="space-y-4 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
                  <ShieldCheck className="size-6" />
                </span>
                <div>
                  <p className="text-base font-extrabold text-sand-100">هذا الرقم غير مسجل لدينا</p>
                  <p className="mt-2 text-sm leading-7 text-white/50">
                    الرقم{' '}
                    <span dir="ltr" className="font-bold text-white/75">
                      {formatPhoneForDisplay(lookup.phone)}
                    </span>{' '}
                    غير مرتبط بأي حساب. أنشئ حسابًا سريعًا ثم عد لهذه الصفحة وسجّل مباشرة.
                  </p>
                </div>

                <Link
                  to={`/signup?from=${encodeURIComponent(fromPath)}&phone=${encodeURIComponent(lookup.phone)}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3.5 text-sm font-extrabold text-pitch-950 transition-opacity hover:opacity-90"
                >
                  <UserPlus className="size-4" />
                  إنشاء حساب بهذا الرقم
                </Link>

                <button
                  type="button"
                  onClick={resetFlow}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-xs font-bold text-white/60 transition-colors hover:text-white"
                >
                  جرّب رقمًا آخر
                </button>
              </div>
            ) : null}

            {phase === 'done' && result ? (
              <div className="space-y-4 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-brand-400/25 bg-brand-400/10 text-brand-300">
                  <CheckCircle2 className="size-7" />
                </span>

                <div>
                  <p className="text-xl font-black text-sand-100">{result.name}</p>
                  {result.status === 'confirmed' ? (
                    <p className="mt-2 text-sm font-bold leading-7 text-brand-200">
                      تم تأكيد مقعدك في المباراة. نراك {formatDay(invite.kickoff_at)}.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm font-bold leading-7 text-amber-200">
                      {result.rosterRole === 'gk' ? 'اكتمل عدد حراس المرمى' : 'اكتمل عدد لاعبي الميدان'}، وأنت الآن في{' '}
                      {result.rosterRole === 'gk' ? 'قائمة انتظار حراس المرمى' : 'قائمة انتظار اللاعبين'}
                      {result.queuePosition ? ` (ترتيب التسجيل ${result.queuePosition})` : ''}. سيتم ترقيتك تلقائيًا عند
                      توفر مقعد.
                    </p>
                  )}
                  {result.already ? (
                    <p className="mt-1 text-[11px] text-white/40">كنت مسجلًا مسبقًا في هذه المباراة.</p>
                  ) : null}
                </div>

                {!session ? (
                  <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[11px] leading-6 text-white/45">
                    احتفظ بالرابط. لتعديل تسجيلك أو إلغائه لاحقًا سجّل الدخول برقمك وكلمة المرور.
                  </p>
                ) : null}

                <div className="flex flex-col gap-2">
                  {session && profile?.status === 'approved' ? (
                    <Link
                      to={`/matches/${matchId}`}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3.5 text-sm font-extrabold text-pitch-950 transition-opacity hover:opacity-90"
                    >
                      فتح تفاصيل المباراة
                      <ArrowLeft className="size-4" />
                    </Link>
                  ) : null}

                  <button
                    type="button"
                    onClick={resetFlow}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-xs font-bold text-white/60 transition-colors hover:text-white"
                  >
                    تسجيل رقم آخر
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </AuthLayout>
  )
}
