import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  Lock,
  MapPin,
  RotateCcw,
  Shuffle,
  Users,
  UserCheck,
  UserRound,
  XCircle,
} from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { useAuth } from '../context/AuthContext'
import { useMatchRealtime } from '../hooks/useRealtimeMatches'
import { supabase } from '../lib/supabase'
import { toArabicError } from '../lib/errorMessages'

const MATCH_COLUMNS =
  'id,kickoff_at,registration_open_at,registration_close_at,local_date,venue,address,notes,capacity,team_size,formation,status,registration_locked,teams_generated_at,teams_seed,teams_stale'

const STATUS_LABELS = {
  scheduled: 'مقررة',
  registration_open: 'التسجيل مفتوح',
  registration_closed: 'أُغلق التسجيل',
  teams_published: 'تم توزيع الفرق',
  completed: 'اكتملت',
  cancelled: 'أُلغيت',
  draft: 'مسودة',
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  }).format(date)
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  }).format(date)
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  }).format(date)
}

function roleLabel(role) {
  if (role === 'gk') return 'حارس مرمى'
  if (role === 'outfield') return 'لاعب ميدان'
  return '—'
}

function Avatar({ player, size = 40 }) {
  const initial = player?.full_name?.trim()?.charAt(0) || '؟'
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand-400/15 text-sm font-black text-brand-300"
      style={{ width: size, height: size }}
    >
      {initial}
      {player?.avatar_url ? (
        <img
          src={player.avatar_url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : null}
    </span>
  )
}

function InfoItem({ icon: Icon, label, value, dir }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] font-bold text-white/40">
        <Icon className="size-3.5 text-brand-400/70" />
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm font-bold leading-6 text-sand-100" dir={dir}>
        {value}
      </dd>
    </div>
  )
}

function RegistrationPlayerRow({ registration, directoryById, positionByCode }) {
  const player = directoryById.get(registration.player_id)
  const name = player?.full_name ?? 'لاعب'
  const details = []

  if (player?.jersey_number) details.push(`رقم ${player.jersey_number}`)
  if (registration.roster_role) details.push(roleLabel(registration.roster_role))
  if (registration.status === 'waitlisted') details.push(`الترتيب ${registration.queue_position}`)
  if (registration.status === 'confirmed') details.push(`رقم التسجيل ${registration.queue_position}`)

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <Avatar player={player} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-sand-100">{name}</p>
        <p className="mt-0.5 truncate text-[11px] text-white/45">{details.join(' · ') || '—'}</p>
      </div>
      <Badge variant={registration.status === 'confirmed' ? 'brand' : 'warning'}>
        {registration.status === 'confirmed' ? 'مؤكد' : 'انتظار'}
      </Badge>
    </div>
  )
}

function AssignmentRow({ assignment, directoryById, positionByCode }) {
  const player = directoryById.get(assignment.player_id)
  const position = positionByCode.get(assignment.assigned_position_code)
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <Avatar player={player} size={38} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-sand-100">{player?.full_name ?? 'لاعب'}</p>
        <p className="mt-0.5 truncate text-[11px] text-white/45">
          {position?.name_ar ?? assignment.assigned_position_code}
          {assignment.is_out_of_position ? ' · خارج مركزه' : ''}
        </p>
      </div>
      {player?.jersey_number ? (
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-black text-white/60">
          {player.jersey_number}
        </span>
      ) : null}
    </div>
  )
}

export default function MatchDetails() {
  const { matchId } = useParams()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  const [generateSuccess, setGenerateSuccess] = useState('')

  useMatchRealtime(matchId)

  const matchQuery = useQuery({
    queryKey: ['match-details', matchId],
    enabled: Boolean(matchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select(MATCH_COLUMNS)
        .eq('id', matchId)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('MATCH_NOT_FOUND')
      return data
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const registrationsQuery = useQuery({
    queryKey: ['match-registrations', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registrations')
        .select('id,player_id,status,roster_role,queue_position,registered_at,created_at')
        .eq('match_id', matchId)
        .order('queue_position', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const statsQuery = useQuery({
    queryKey: ['match-history-stats', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_history_stats')
        .select('*')
        .eq('match_id', matchId)
        .maybeSingle()
      if (error) {
        console.debug('match_history_stats unavailable', error)
        return null
      }
      return data ?? null
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const teamsQuery = useQuery({
    queryKey: ['match-teams', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_teams')
        .select('*')
        .eq('match_id', matchId)
        .order('side', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const assignmentsQuery = useQuery({
    queryKey: ['team-assignments', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_assignments')
        .select('id,team_id,player_id,assigned_position_code,slot_index,is_out_of_position')
        .eq('match_id', matchId)
        .order('slot_index', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const positionsQuery = useQuery({
    queryKey: ['positions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('positions')
        .select('code,name_ar,category,sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 10 * 60 * 1000,
  })

  const registrations = registrationsQuery.data ?? []
  const assignments = assignmentsQuery.data ?? []

  const playerIds = useMemo(
    () => [...new Set([...registrations.map((item) => item.player_id), ...assignments.map((item) => item.player_id)])],
    [registrations, assignments],
  )

  const directoryQuery = useQuery({
    queryKey: ['match-player-directory', matchId, playerIds.join('|')],
    enabled: playerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_directory')
        .select('id,full_name,avatar_url,jersey_number,preferred_foot')
        .in('id', playerIds)
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })

  const directoryById = useMemo(
    () => new Map((directoryQuery.data ?? []).map((player) => [player.id, player])),
    [directoryQuery.data],
  )

  const positionByCode = useMemo(
    () => new Map((positionsQuery.data ?? []).map((position) => [position.code, position])),
    [positionsQuery.data],
  )

  const confirmedPlayers = useMemo(
    () => registrations.filter((item) => item.status === 'confirmed'),
    [registrations],
  )
  const waitlistedPlayers = useMemo(
    () => registrations.filter((item) => item.status === 'waitlisted'),
    [registrations],
  )
  const cancelledCount =
    statsQuery.data?.cancelled_count ?? registrations.filter((item) => item.status === 'cancelled').length
  const confirmedCount = statsQuery.data?.confirmed_count ?? confirmedPlayers.length
  const waitlistedCount = statsQuery.data?.waitlisted_count ?? waitlistedPlayers.length
  const totalRegistrationCount =
    statsQuery.data?.total_registration_count ?? registrations.length
  const match = matchQuery.data
  const teams = teamsQuery.data ?? []
  const canGenerateTeams = Boolean(
    isAdmin && match && confirmedCount === 18 && !['cancelled', 'completed'].includes(match.status),
  )

  async function handleGenerateTeams() {
    if (!match || !canGenerateTeams) return
    setGenerating(true)
    setGenerateError('')
    setGenerateSuccess('')

    const { error } = await supabase.rpc('generate_teams', { p_match_id: match.id })
    if (error) {
      setGenerateError(toArabicError(error, 'تعذر توليد الفرق. تحقق من اكتمال اللاعبين وتركيبة المراكز.'))
      setGenerating(false)
      return
    }

    setGenerating(false)
    setGenerateSuccess('تم توليد توزيع الفريقين ونشره للاعبين.')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['match-details', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-teams', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['team-assignments', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] }),
    ])
  }

  if (matchQuery.isLoading) {
    return (
      <div>
        <PageHeader eyebrow="تفاصيل المباراة" title="جارٍ التحميل…" />
        <EmptyState icon={Loader2} title="جارٍ تحميل بيانات المباراة" description="نجهّز القوائم والإحصائيات والفرق." />
      </div>
    )
  }

  if (matchQuery.error || !match) {
    return (
      <div>
        <PageHeader eyebrow="تفاصيل المباراة" title="تعذر تحميل المباراة" />
        <EmptyState
          icon={XCircle}
          title="المباراة غير متاحة"
          description={toArabicError(matchQuery.error ?? new Error('MATCH_NOT_FOUND'), 'لم يتم العثور على هذه المباراة.')}
          action={
            <Link to="/matches" className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/75">
              <ArrowLeft className="size-4" />
              العودة للجدول
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="تفاصيل المباراة"
        title={formatDate(match.local_date)}
        description="كل بيانات هذه المباراة: الموعد، حالة التسجيل، اللاعبون المؤكدون، قائمة الانتظار، والفرق."
        actions={
          <Link to="/matches" className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/75 transition-colors hover:text-white">
            <ArrowLeft className="size-4" />
            كل المباريات
          </Link>
        }
      />

      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-pitch-900/70 p-6 sm:p-8">
        <div className="bg-turf pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-l from-pitch-950/95 via-pitch-900/50 to-transparent" aria-hidden="true" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Badge variant={match.status === 'registration_open' ? 'brand' : 'warning'}>
                {STATUS_LABELS[match.status] ?? match.status}
              </Badge>
              <h2 className="mt-3 text-2xl font-black text-sand-100 sm:text-3xl">
                {formatDateTime(match.kickoff_at)}
              </h2>
              <p className="mt-2 text-sm text-white/55">{match.venue}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-pitch-950/50 px-4 py-3 text-center">
              <p className="text-2xl font-black tabular-nums text-sand-100">{match.team_size * 2}</p>
              <p className="mt-1 text-[11px] text-white/45">لاعبًا في التوزيع</p>
            </div>
          </div>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem icon={CalendarDays} label="يوم المباراة" value={formatDate(match.local_date)} />
            <InfoItem icon={Clock} label="وقت الانطلاق" value={formatTime(match.kickoff_at)} />
            <InfoItem icon={MapPin} label="الملعب" value={match.venue} />
            <InfoItem icon={Users} label="التشكيلة" value={match.formation} dir="ltr" />
            <InfoItem icon={CalendarDays} label="فتح التسجيل" value={formatDateTime(match.registration_open_at)} />
            <InfoItem icon={Clock} label="إغلاق التسجيل" value={formatDateTime(match.registration_close_at)} />
            <InfoItem icon={MapPin} label="العنوان" value={match.address ?? '—'} />
            <InfoItem icon={CheckCircle2} label="توزيع الفرق" value={match.teams_generated_at ? formatDateTime(match.teams_generated_at) : 'لم يُنشأ بعد'} />
          </dl>

          {match.notes ? (
            <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-7 text-white/55">{match.notes}</p>
          ) : null}
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="إحصائيات المباراة">
        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-400/10 text-brand-300"><CheckCircle2 className="size-4" /></span>
          <p className="mt-3 text-2xl font-extrabold tabular-nums text-sand-100">{confirmedCount}</p>
          <p className="mt-1 text-xs text-white/45">مؤكدون</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
          <span className="grid size-9 place-items-center rounded-xl bg-amber-400/10 text-amber-300"><History className="size-4" /></span>
          <p className="mt-3 text-2xl font-extrabold tabular-nums text-sand-100">{waitlistedCount}</p>
          <p className="mt-1 text-xs text-white/45">قائمة الانتظار</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
          <span className="grid size-9 place-items-center rounded-xl bg-white/5 text-brand-300"><Users className="size-4" /></span>
          <p className="mt-3 text-2xl font-extrabold tabular-nums text-sand-100">{totalRegistrationCount}</p>
          <p className="mt-1 text-xs text-white/45">إجمالي التسجيلات</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
          <span className="grid size-9 place-items-center rounded-xl bg-white/5 text-white/60"><XCircle className="size-4" /></span>
          <p className="mt-3 text-2xl font-extrabold tabular-nums text-sand-100">{cancelledCount}</p>
          <p className="mt-1 text-xs text-white/45">ملغاة</p>
        </div>
      </section>

      {isAdmin ? (
        <Card className="mt-6 border-brand-400/20 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-extrabold text-sand-100">
                <Shuffle className="size-5 text-brand-300" />
                توزيع الفريقين
              </h2>
              <p className="mt-1 text-xs leading-6 text-white/50">
                {teams.length
                  ? 'يمكنك إعادة التوزيع؛ سيُستبدل التوزيع السابق ويُرسل تحديث للاعبين.'
                  : `يُفعّل الزر عند اكتمال 18 لاعبًا مؤكدًا. الحالي ${confirmedCount}/18.`}
              </p>
              {generateError ? <p role="alert" className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-red-200">{generateError}</p> : null}
              {generateSuccess ? <p role="status" className="mt-3 rounded-xl border border-brand-400/20 bg-brand-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-brand-200">{generateSuccess}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => void handleGenerateTeams()}
              disabled={!canGenerateTeams || generating}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60"
            >
              {generating ? <Loader2 className="size-4 animate-spin" /> : <Shuffle className="size-4" />}
              {teams.length ? 'إعادة توزيع الفريقين' : 'توليد توزيع الفريقين'}
            </button>
          </div>
        </Card>
      ) : null}

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-extrabold text-sand-100">
              <UserCheck className="size-5 text-brand-300" />
              اللاعبون المؤكدون
            </h2>
            <span className="text-xs font-bold text-white/35">{confirmedCount}/{match.capacity}</span>
          </div>

          {registrationsQuery.isLoading ? (
            <Card className="flex items-center gap-3 p-5 text-sm text-white/45"><Loader2 className="size-4 animate-spin text-brand-300" /> جارٍ تحميل اللاعبين…</Card>
          ) : registrationsQuery.error ? (
            <Card className="p-5 text-sm text-red-300">{toArabicError(registrationsQuery.error)}</Card>
          ) : confirmedPlayers.length ? (
            <div className="space-y-2.5">
              {confirmedPlayers.map((registration) => (
                <RegistrationPlayerRow key={registration.id} registration={registration} directoryById={directoryById} positionByCode={positionByCode} />
              ))}
            </div>
          ) : (
            <EmptyState icon={UserCheck} title="لا يوجد لاعبون مؤكدون بعد" description="ستظهر هنا أسماء اللاعبين فور اكتمال تسجيلهم." />
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-extrabold text-sand-100">
              <History className="size-5 text-amber-300" />
              قائمة الانتظار
            </h2>
            <span className="text-xs font-bold text-white/35">{waitlistedCount} لاعب</span>
          </div>

          {waitlistedPlayers.length ? (
            <div className="space-y-2.5">
              {waitlistedPlayers.map((registration) => (
                <RegistrationPlayerRow key={registration.id} registration={registration} directoryById={directoryById} positionByCode={positionByCode} />
              ))}
            </div>
          ) : (
            <EmptyState icon={History} title="لا يوجد لاعبون في الانتظار" description="عند اكتمال السعة، سينتقل التسجيل الجديد إلى هنا حسب الترتيب." />
          )}
        </div>
      </section>

      <section className="mt-8" aria-label="فرق المباراة">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-sand-100">
              <Users className="size-5 text-brand-300" />
              تشكيلة الفريقين
            </h2>
            <p className="mt-1 text-sm text-white/45">فريقان × 9 لاعبين بتشكيلة {match.formation}</p>
          </div>
          {match.teams_stale ? (
            <Badge variant="warning">
              <RotateCcw className="size-3.5" />
              يحتاج إعادة توزيع
            </Badge>
          ) : null}
        </div>

        {teams.length === 0 ? (
          <EmptyState
            icon={Shuffle}
            title="لم تُوزَّع الفرق بعد"
            description={canGenerateTeams ? 'يمكن للإدارة الضغط على زر توليد التوزيع لتشكيل الفريقين.' : 'يتم إنشاء الفرق بعد اكتمال 18 لاعبًا مؤكدًا بنفس التركيبة المطلوبة.'}
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {teams.map((team) => {
              const teamAssignments = assignments.filter((assignment) => assignment.team_id === team.id)
              return (
                <Card key={team.id} className="p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="size-3.5 rounded-full" style={{ backgroundColor: team.color ?? '#d2ff4d', boxShadow: '0 0 18px 0 currentColor' }} aria-hidden="true" />
                      <h3 className="text-base font-extrabold text-sand-100">{team.name_ar}</h3>
                    </div>
                    <Badge variant="neutral">{teamAssignments.length}/9</Badge>
                  </div>
                  <div className="space-y-2.5">
                    {teamAssignments.map((assignment) => (
                      <AssignmentRow key={assignment.id} assignment={assignment} directoryById={directoryById} positionByCode={positionByCode} />
                    ))}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <section className="mt-8" aria-label="معلومات إضافية">
        <Card className="p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-sand-100">
            <CalendarDays className="size-5 text-brand-300" />
            البيانات الكاملة
          </h2>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoItem icon={CalendarDays} label="تاريخ الانطلاق" value={formatDate(match.kickoff_at)} />
            <InfoItem icon={Clock} label="وقت الانطلاق" value={formatTime(match.kickoff_at)} />
            <InfoItem icon={CalendarDays} label="فتح التسجيل" value={formatDateTime(match.registration_open_at)} />
            <InfoItem icon={Clock} label="إغلاق التسجيل" value={formatDateTime(match.registration_close_at)} />
            <InfoItem icon={MapPin} label="الملعب" value={match.venue} />
            <InfoItem icon={MapPin} label="العنوان" value={match.address ?? '—'} />
            <InfoItem icon={Users} label="السعة" value={`${match.capacity} لاعبًا`} />
            <InfoItem icon={Users} label="حجم الفريق" value={`${match.team_size} لاعبين`} />
            <InfoItem icon={UserRound} label="التشكيلة" value={match.formation} dir="ltr" />
            <InfoItem icon={Lock} label="قفل التسجيل" value={match.registration_locked ? 'مقفل' : 'غير مقفل'} />
            <InfoItem icon={CheckCircle2} label="تاريخ إنشاء الفرق" value={match.teams_generated_at ? formatDateTime(match.teams_generated_at) : '—'} />
            <InfoItem icon={History} label="حالة الفرق الحالية" value={match.teams_stale ? 'تحتاج إعادة توزيع' : match.teams_generated_at ? 'منشورة' : 'غير منشورة'} />
          </dl>
          {match.notes ? <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-7 text-white/55">{match.notes}</p> : null}
        </Card>
      </section>
    </div>
  )
}
