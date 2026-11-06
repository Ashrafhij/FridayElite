import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  History,
  Loader2,
  Lock,
  MapPin,
  RotateCcw,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { useMatches } from '../hooks/useMatches'
import { toArabicError } from '../lib/errorMessages'

const STATUS_LABELS = {
  scheduled: 'مقررة',
  registration_open: 'التسجيل مفتوح',
  registration_closed: 'أُغلق التسجيل',
  teams_published: 'تم توزيع الفرق',
  completed: 'اكتملت',
  cancelled: 'أُلغيت',
  draft: 'مسودة',
}

function formatMatchDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  }).format(new Date(value))
}

function formatMatchDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  }).format(new Date(value))
}

export default function Matches() {
  const {
    activeMatch,
    pastMatches,
    statsByMatchId,
    myRegistration,
    isLoading,
    error,
    refetch,
    actionBusy,
    actionError,
    actionSuccess,
    registerForActiveMatch,
    cancelMyRegistration,
  } = useMatches()

  const activeStats = activeMatch ? statsByMatchId.get(activeMatch.id) : undefined
  const activeRegistrationOpen = Boolean(
    activeMatch &&
      new Date(activeMatch.registration_open_at) <= new Date() &&
      new Date() < new Date(activeMatch.registration_close_at),
  )

  return (
    <div>
      <PageHeader
        eyebrow="الموسم الأول"
        title="المباريات"
        description="جدول المباريات الأسبوعية وحالة التسجيل في كل موعد."
      />

      <div className="space-y-6">
          {isLoading ? (
            <EmptyState
              icon={Loader2}
              title="جارٍ تحميل المباريات…"
              description="نجهّز المباراة الأسبوعية الحالية وإحصائيات الأسابيع السابقة."
            />
          ) : error ? (
            <EmptyState
              icon={Lock}
              title="تعذر تحميل جدول المباريات"
              description={toArabicError(error, 'تحقق من اتصالك وحاول مرة أخرى.')}
              action={
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/70 transition-colors hover:text-white"
                >
                  <RotateCcw className="size-4" />
                  إعادة المحاولة
                </button>
              }
            />
          ) : activeMatch ? (
            <Card className="overflow-hidden p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-brand-300">المباراة الحالية / القادمة</p>
                  <h2 className="mt-2 text-xl font-extrabold text-sand-100">
                    {formatMatchDate(activeMatch.local_date)}
                  </h2>
                  <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/55">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-4 text-brand-400/80" />
                      {formatMatchDateTime(activeMatch.kickoff_at)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-4 text-brand-400/80" />
                      {activeMatch.venue}
                    </span>
                  </p>
                </div>
                <Badge variant={activeRegistrationOpen ? 'brand' : 'warning'}>
                  {STATUS_LABELS[activeMatch.status] ?? activeMatch.status}
                </Badge>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white/[0.03] p-3 text-center">
                  <p className="text-lg font-extrabold tabular-nums text-sand-100">{activeStats?.confirmed_count ?? 0}</p>
                  <p className="mt-0.5 text-[11px] text-white/45">مؤكدون</p>
                </div>
                <div className="rounded-2xl bg-white/[0.03] p-3 text-center">
                  <p className="text-lg font-extrabold tabular-nums text-sand-100">{activeStats?.waitlisted_count ?? 0}</p>
                  <p className="mt-0.5 text-[11px] text-white/45">انتظار</p>
                </div>
                <div className="rounded-2xl bg-white/[0.03] p-3 text-center">
                  <p className="text-lg font-extrabold tabular-nums text-sand-100">{activeMatch.capacity}</p>
                  <p className="mt-0.5 text-[11px] text-white/45">السعة</p>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <p className="text-xs leading-6 text-white/50">
                  التسجيل يفتح {formatMatchDateTime(activeMatch.registration_open_at)} ويغلق {formatMatchDateTime(activeMatch.registration_close_at)}.
                </p>

                {actionError ? (
                  <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-red-200">
                    {actionError}
                  </p>
                ) : null}
                {actionSuccess ? (
                  <p role="status" className="rounded-xl border border-brand-400/20 bg-brand-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-brand-200">
                    {actionSuccess}
                  </p>
                ) : null}

                {myRegistration ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Badge variant={myRegistration.status === 'confirmed' ? 'brand' : 'warning'}>
                        {myRegistration.status === 'confirmed' ? 'مقعد مؤكد' : 'قائمة الانتظار'}
                      </Badge>
                      {myRegistration.status === 'waitlisted' ? (
                        <p className="mt-2 text-[11px] text-white/45">ترتيبك في الانتظار: {myRegistration.queue_position}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void cancelMyRegistration()}
                      disabled={actionBusy || !activeRegistrationOpen}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-red-400/25 bg-red-400/[0.06] px-4 py-2.5 text-xs font-bold text-red-200 transition-colors hover:bg-red-400/10 disabled:opacity-60"
                    >
                      <UserMinus className="size-4" />
                      إلغاء التسجيل
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void registerForActiveMatch()}
                    disabled={actionBusy || !activeRegistrationOpen}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-4 py-3 text-sm font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60"
                  >
                    {actionBusy ? <Loader2 className="size-4 animate-spin" /> : activeRegistrationOpen ? <UserPlus className="size-4" /> : <Lock className="size-4" />}
                    {activeRegistrationOpen ? 'التسجيل في المباراة' : 'التسجيل مغلق الآن'}
                  </button>
                )}
                <Link
                  to={`/matches/${activeMatch.id}`}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/75 transition-colors hover:border-white/20 hover:text-white"
                >
                  فتح تفاصيل المباراة
                  <ArrowLeft className="size-4" />
                </Link>
              </div>
            </Card>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="لا توجد مباريات منشورة بعد"
              description="تُنشأ المباراة الأسبوعية تلقائيًا كل خميس ١٠:٠٠ صباحًا، ويُغلق التسجيل الجمعة ٢٠:٠٠ مساءً. ستظهر هنا أول مباراة وأرشيف الأسابيع السابقة."
            />
          )}
      </div>

      <section className="mt-8" aria-label="إحصائيات الأسابيع السابقة">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-sand-100">إحصائيات الأسابيع السابقة</h2>
            <p className="mt-1 text-sm text-white/45">تبقى نتائج كل أسبوع محفوظة وقابلة للرجوع إليها.</p>
          </div>
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-400/10 text-brand-300">
            <History className="size-5" />
          </span>
        </div>

        {pastMatches.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pastMatches.map((match) => {
              const stats = statsByMatchId.get(match.id)
              return (
                <Card key={match.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-extrabold text-sand-100">{formatMatchDate(match.local_date)}</h3>
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-white/45">
                        <MapPin className="size-3.5 shrink-0" />
                        <span className="truncate">{match.venue}</span>
                      </p>
                    </div>
                    <Badge variant={match.status === 'completed' ? 'brand' : match.status === 'cancelled' ? 'warning' : 'neutral'}>
                      {STATUS_LABELS[match.status] ?? match.status}
                    </Badge>
                  </div>

                  <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                    <div className="rounded-xl bg-white/[0.03] p-2.5">
                      <p className="text-base font-extrabold tabular-nums text-sand-100">{stats?.confirmed_count ?? 0}</p>
                      <p className="mt-0.5 text-[10px] text-white/40">مؤكدون</p>
                    </div>
                    <div className="rounded-xl bg-white/[0.03] p-2.5">
                      <p className="text-base font-extrabold tabular-nums text-sand-100">{stats?.waitlisted_count ?? 0}</p>
                      <p className="mt-0.5 text-[10px] text-white/40">انتظار</p>
                    </div>
                    <div className="rounded-xl bg-white/[0.03] p-2.5">
                      <p className="text-base font-extrabold tabular-nums text-sand-100">{stats?.team_a_count ?? 0}</p>
                      <p className="mt-0.5 text-[10px] text-white/40">فريق أ</p>
                    </div>
                    <div className="rounded-xl bg-white/[0.03] p-2.5">
                      <p className="text-base font-extrabold tabular-nums text-sand-100">{stats?.team_b_count ?? 0}</p>
                      <p className="mt-0.5 text-[10px] text-white/40">فريق ب</p>
                    </div>
                  </div>

                  <Link
                    to={`/matches/${match.id}`}
                    className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-brand-300 transition-colors hover:text-brand-200"
                  >
                    فتح تفاصيل المباراة
                    <ArrowLeft className="size-3.5" />
                  </Link>
                </Card>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={History}
            title="لا توجد أسابيع سابقة بعد"
            description="عند اكتمال أول مباراة، ستظهر إحصائياتها هنا وتبقى محفوظة لأي أسبوع لاحق."
          />
        )}
      </section>
    </div>
  )
}
