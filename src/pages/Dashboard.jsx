import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  ListOrdered,
  Lock,
  MapPin,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import StatTile from '../components/ui/StatTile'
import { useAuth } from '../context/AuthContext'
import { useMatches } from '../hooks/useMatches'
import { useRegistrationWindow } from '../hooks/useRegistrationWindow'
import { formatRegistrationDateTime } from '../lib/registrationWindow'

export default function Dashboard() {
  const { profile } = useAuth()
  const registrationWindow = useRegistrationWindow()
  const registrationOpen = registrationWindow.isOpen
  const { activeMatch, statsByMatchId } = useMatches()
  const activeStats = activeMatch ? statsByMatchId.get(activeMatch.id) : undefined
  const availableSeats = activeMatch
    ? Math.max(0, (activeMatch.capacity ?? 18) - (activeStats?.confirmed_count ?? 0))
    : undefined
  const activeMatchDate = activeMatch?.local_date
    ? new Intl.DateTimeFormat('ar', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'Asia/Jerusalem',
      }).format(new Date(`${activeMatch.local_date}T12:00:00Z`))
    : 'الجمعة · ٦ نوفمبر'

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* Next match hero */}
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-pitch-900/70 p-6 sm:p-8 lg:p-10">
        <div className="bg-turf pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-l from-pitch-950/95 via-pitch-900/50 to-transparent"
          aria-hidden="true"
        />
        {/* Pitch markings */}
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-2/5 sm:block" aria-hidden="true">
          <div className="absolute left-6 top-1/2 size-64 -translate-y-1/2 rounded-full border border-white/10" />
          <div className="absolute left-6 top-1/2 size-3 -translate-y-1/2 rounded-full bg-white/15" />
          <div className="absolute inset-y-0 left-6 w-px bg-white/10" />
          <div className="absolute left-6 top-1/2 h-40 w-16 -translate-y-1/2 rounded-e-md border border-white/10" />
        </div>

        <div className="relative max-w-xl">
          <Badge variant="brand">
            <Sparkles className="size-3.5" />
            الموسم الأول
          </Badge>

          <p className="mt-6 text-sm font-semibold text-white/55">
            أهلًا، {profile?.full_name || 'لاعب فرايدي إيليت'}
          </p>
          <p className="mt-1 text-sm font-semibold text-white/45">المباراة القادمة</p>
          <h2 className="mt-2 text-3xl font-black leading-[1.25] tracking-tight text-sand-100 sm:text-4xl">
            الجمعة <span className="text-brand-400">٢٠:٠٠</span>
            <br />
            كرة القدم الأسبوعية
          </h2>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/60">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="size-4 text-brand-400/80" />
              {activeMatchDate}
            </span>
            <span className="inline-flex items-center gap-2">
              <MapPin className="size-4 text-brand-400/80" />
              {activeMatch?.venue ?? 'ملعب وحيد — العشب الصناعي'}
            </span>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            {registrationOpen ? (
              <Link
                to={activeMatch ? `/matches/${activeMatch.id}` : '/matches'}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 transition-colors hover:bg-brand-300"
              >
                <Clock className="size-4" />
                التسجيل مفتوح الآن
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 opacity-60"
              >
                <Lock className="size-4" />
                التسجيل لم يفتح بعد
              </button>
            )}
            <Link
              to={activeMatch ? `/matches/${activeMatch.id}` : '/matches'}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-white/75 transition-colors hover:border-white/20 hover:text-white"
            >
              تفاصيل المباراة
              <ArrowLeft className="size-4" />
            </Link>
          </div>

          <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-pitch-950/50 px-3 py-1.5 text-[11px] font-semibold text-white/50">
            <Clock className="size-3.5 text-brand-400/80" />
            {registrationOpen && registrationWindow.currentWindow
              ? `التسجيل مفتوح الآن — يغلق ${formatRegistrationDateTime(registrationWindow.currentWindow.closeAt)}`
              : `يفتح التسجيل ${formatRegistrationDateTime(registrationWindow.nextWindow.openAt)}`}
          </p>
        </div>
      </section>

      {/* Live numbers */}
      <section aria-label="أرقام المباراة">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile icon={Users} label="المقاعد المتاحة" value={availableSeats ?? '١٨'} hint={activeMatch ? formatRegistrationDateTime(activeMatch.kickoff_at) : 'لكل مباراة أسبوعية'} />
          <StatTile icon={UserCheck} label="اللاعبون المؤكدون" value={activeStats?.confirmed_count ?? '—'} hint={activeStats ? `من أصل ${activeMatch?.capacity ?? 18}` : 'تُحدَّث بعد ربط قاعدة البيانات'} />
          <StatTile icon={ListOrdered} label="قائمة الانتظار" value={activeStats?.waitlisted_count ?? '—'} hint={activeStats ? 'بحسب ترتيب التسجيل' : 'تُحدَّث بعد ربط قاعدة البيانات'} />
        </div>
      </section>

      <Card className="border-brand-400/15 bg-brand-400/[0.035] p-6">
            <span className="grid size-10 place-items-center rounded-2xl bg-brand-400/10 text-brand-300">
              <CheckCircle2 className="size-5" />
            </span>
            <h2 className="mt-4 text-base font-extrabold text-sand-100">حسابك موثّق</h2>
            <p className="mt-2 text-[13px] leading-7 text-white/55">
              تمت الموافقة على حسابك. يمكنك الوصول إلى المباريات والتسجيل في المواعيد المتاحة،
              وإدارة ملفك ومراكزك المفضلة.
            </p>
            <Link
              to="/profile"
              className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-brand-300 hover:text-brand-200"
            >
              مراجعة بياناتي
              <ArrowLeft className="size-3.5" />
            </Link>
          </Card>
    </div>
  )
}
