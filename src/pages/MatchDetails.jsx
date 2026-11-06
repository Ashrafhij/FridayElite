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
  Plus,
  RotateCcw,
  Shuffle,
  Star,
  Trash2,
  Trophy,
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
  const { isAdmin, profile } = useAuth()
  const queryClient = useQueryClient()
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  const [generateSuccess, setGenerateSuccess] = useState('')
  const [resultFormOpen, setResultFormOpen] = useState(false)
  const [teamAScore, setTeamAScore] = useState('')
  const [teamBScore, setTeamBScore] = useState('')
  const [resultNotes, setResultNotes] = useState('')
  const [scorersDraft, setScorersDraft] = useState([{ player_id: '', goals: '1', assists: '0' }])
  const [resultBusy, setResultBusy] = useState(false)
  const [resultError, setResultError] = useState('')
  const [resultSuccess, setResultSuccess] = useState('')
  const [ratingBusyPlayerId, setRatingBusyPlayerId] = useState(null)
  const [ratingError, setRatingError] = useState('')
  const [ratingSuccess, setRatingSuccess] = useState('')

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

  const resultQuery = useQuery({
    queryKey: ['match-result', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_results')
        .select('match_id,team_a_score,team_b_score,notes,created_at,updated_at')
        .eq('match_id', matchId)
        .maybeSingle()
      if (error) {
        console.debug('match_results unavailable', error)
        return null
      }
      return data ?? null
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const scorersQuery = useQuery({
    queryKey: ['match-scorers', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_scorers')
        .select('id,player_id,team_id,goals,assists,created_at')
        .eq('match_id', matchId)
        .order('goals', { ascending: false })
        .order('assists', { ascending: false })
      if (error) {
        console.debug('match_scorers unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const myRatingsQuery = useQuery({
    queryKey: ['my-match-ratings', matchId, profile?.id],
    enabled: Boolean(matchQuery.data && profile?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_ratings')
        .select('rated_player_id,rating,created_at,updated_at')
        .eq('match_id', matchId)
        .eq('rater_id', profile.id)
      if (error) {
        console.debug('player_ratings unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const ratingStatsQuery = useQuery({
    queryKey: ['match-rating-stats', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_player_rating_stats')
        .select('player_id,average_rating,rating_count,updated_at')
        .eq('match_id', matchId)
        .order('average_rating', { ascending: false })
      if (error) {
        console.debug('match_player_rating_stats unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
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
  const result = resultQuery.data ?? null
  const matchScorers = scorersQuery.data ?? []
  const myRatingsByPlayer = new Map((myRatingsQuery.data ?? []).map((item) => [item.rated_player_id, item.rating]))
  const ratingStatsByPlayer = new Map((ratingStatsQuery.data ?? []).map((item) => [item.player_id, item]))
  const currentUserRegistration = confirmedPlayers.find((item) => item.player_id === profile?.id)
  const canRate = Boolean(match?.status === 'completed' && currentUserRegistration)
  const teams = teamsQuery.data ?? []
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const assignedPlayerOptions = assignments.map((assignment) => ({
    assignment,
    player: directoryById.get(assignment.player_id),
    team: teamById.get(assignment.team_id),
  }))
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

  function openResultForm() {
    setTeamAScore(result ? String(result.team_a_score) : '')
    setTeamBScore(result ? String(result.team_b_score) : '')
    setResultNotes(result?.notes ?? '')
    setScorersDraft(
      matchScorers.length
        ? matchScorers.map((scorer) => ({
            player_id: scorer.player_id,
            goals: String(scorer.goals),
            assists: String(scorer.assists ?? 0),
          }))
        : [{ player_id: '', goals: '1', assists: '0' }],
    )
    setResultError('')
    setResultSuccess('')
    setResultFormOpen(true)
  }

  function updateScorerDraft(index, field, value) {
    setScorersDraft((current) =>
      current.map((scorer, scorerIndex) =>
        scorerIndex === index ? { ...scorer, [field]: value } : scorer,
      ),
    )
  }

  async function handleSubmitResult(event) {
    event.preventDefault()
    if (!match) return
    setResultError('')
    setResultSuccess('')

    const scoreA = Number(teamAScore)
    const scoreB = Number(teamBScore)
    const scorerPayload = scorersDraft
      .filter((scorer) => scorer.player_id)
      .map((scorer) => ({
        player_id: scorer.player_id,
        goals: Number(scorer.goals),
        assists: Number(scorer.assists ?? 0),
      }))

    const playerIds = scorerPayload.map((scorer) => scorer.player_id)
    if (new Set(playerIds).size !== playerIds.length) {
      setResultError('لا يمكن تكرار اللاعب نفسه في قائمة الهدافين.')
      return
    }
    if (
      !Number.isInteger(scoreA) ||
      !Number.isInteger(scoreB) ||
      scoreA < 0 ||
      scoreB < 0 ||
      scoreA > 99 ||
      scoreB > 99 ||
      scorerPayload.some((scorer) => scorer.goals < 1 || scorer.goals > 30 || scorer.assists < 0 || scorer.assists > 30)
    ) {
      setResultError('تحقق من النتيجة وعدد الأهداف/التمريرات.')
      return
    }

    const assignmentByPlayer = new Map(assignments.map((assignment) => [assignment.player_id, assignment]))
    let computedA = 0
    let computedB = 0
    for (const scorer of scorerPayload) {
      const assignment = assignmentByPlayer.get(scorer.player_id)
      const team = assignment ? teamById.get(assignment.team_id) : null
      if (team?.side === 'A') computedA += scorer.goals
      if (team?.side === 'B') computedB += scorer.goals
    }

    if (computedA !== scoreA || computedB !== scoreB) {
      setResultError('أهداف الهدافين لا تطابق النتيجة النهائية. راجع اللاعبين والفرق.')
      return
    }

    setResultBusy(true)
    const { error } = await supabase.rpc('set_match_result', {
      p_match_id: match.id,
      p_team_a_score: scoreA,
      p_team_b_score: scoreB,
      p_scorers: scorerPayload,
      p_notes: resultNotes.trim() || null,
    })
    setResultBusy(false)

    if (error) {
      setResultError(toArabicError(error, 'تعذر حفظ نتيجة المباراة.'))
      return
    }

    setResultSuccess('تم حفظ نتيجة المباراة والهدافين.')
    setResultFormOpen(false)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['match-details', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-result', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-scorers', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] }),
    ])
  }

  async function handleRatePlayer(ratedPlayerId, rating) {
    if (!match || !profile || ratedPlayerId === profile.id) return
    setRatingBusyPlayerId(ratedPlayerId)
    setRatingError('')
    setRatingSuccess('')

    const { error } = await supabase.rpc('rate_player', {
      p_match_id: match.id,
      p_rated_player_id: ratedPlayerId,
      p_rating: rating,
    })
    setRatingBusyPlayerId(null)

    if (error) {
      setRatingError(toArabicError(error, 'تعذر حفظ التقييم.'))
      return
    }

    setRatingSuccess('تم حفظ تقييمك.')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-match-ratings', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-rating-stats', matchId] }),
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

      <section className="mt-8" aria-label="نتيجة المباراة">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-sand-100">
              <Trophy className="size-5 text-brand-300" />
              نتيجة المباراة
            </h2>
            <p className="mt-1 text-sm text-white/45">النتيجة النهائية وهدافو المباراة.</p>
          </div>
          <Badge variant={result ? 'brand' : 'neutral'}>{result ? 'منشورة' : 'غير منشورة'}</Badge>
        </div>

        {result ? (
          <Card className="overflow-hidden p-5 sm:p-6">
            <div className="grid items-center gap-5 md:grid-cols-[1fr_auto_1fr]">
              {['A', 'B'].map((side) => {
                const team = teams.find((item) => item.side === side)
                const score = side === 'A' ? result.team_a_score : result.team_b_score
                const teamScorers = matchScorers.filter((scorer) => scorer.team_id === team?.id)
                return (
                  <div key={side} className="min-w-0 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="size-3.5 rounded-full" style={{ backgroundColor: team?.color ?? '#d2ff4d' }} aria-hidden="true" />
                      <p className="text-sm font-extrabold text-sand-100">{team?.name_ar ?? (side === 'A' ? 'الفريق أ' : 'الفريق ب')}</p>
                    </div>
                    <p className="mt-3 text-5xl font-black tabular-nums text-sand-100">{score}</p>
                    <div className="mt-4 space-y-2">
                      {teamScorers.length ? (
                        teamScorers.map((scorer) => {
                          const player = directoryById.get(scorer.player_id)
                          return (
                            <div key={scorer.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2 text-start">
                              <span className="min-w-0 truncate text-xs font-bold text-white/75">{player?.full_name ?? 'لاعب'}</span>
                              <span className="shrink-0 text-[11px] font-extrabold text-brand-200">
                                {scorer.goals} هدف{scorer.assists ? ` · ${scorer.assists} تمريرة` : ''}
                              </span>
                            </div>
                          )
                        })
                      ) : (
                        <p className="text-[11px] text-white/35">لا يوجد هدافون مسجلون.</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {result.notes ? <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-7 text-white/55">{result.notes}</p> : null}
          </Card>
        ) : (
          <EmptyState icon={Trophy} title="لم تُنشر النتيجة بعد" description="ستظهر هنا النتيجة النهائية والهدافون بعد إدخال الإدارة لها." />
        )}

        {isAdmin ? (
          <Card className="mt-4 border-brand-400/20 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-extrabold text-sand-100">{result ? 'تعديل نتيجة المباراة' : 'إدخال نتيجة المباراة'}</h3>
                <p className="mt-1 text-xs leading-6 text-white/50">
                  {teams.length
                    ? 'أدخل النتيجة النهائية والهدافين لكل فريق؛ يجب أن يطابق مجموع الأهداف النتيجة.'
                    : 'أنشئ توزيع الفريقين أولًا لاختيار الهدافين حسب الفريق.'}
                </p>
              </div>
              <button
                type="button"
                onClick={openResultForm}
                disabled={!teams.length}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60"
              >
                <Trophy className="size-4" />
                {result ? 'تعديل النتيجة' : 'إدخال النتيجة'}
              </button>
            </div>

            {resultFormOpen ? (
              <form onSubmit={handleSubmitResult} className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="result-score-a" className="text-xs font-bold text-white/55">أهداف {teams.find((team) => team.side === 'A')?.name_ar ?? 'الفريق أ'}</label>
                  <input id="result-score-a" type="number" min="0" max="99" value={teamAScore} onChange={(event) => setTeamAScore(event.target.value)} required disabled={resultBusy} className="mt-2 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50" />
                </div>
                <div>
                  <label htmlFor="result-score-b" className="text-xs font-bold text-white/55">أهداف {teams.find((team) => team.side === 'B')?.name_ar ?? 'الفريق ب'}</label>
                  <input id="result-score-b" type="number" min="0" max="99" value={teamBScore} onChange={(event) => setTeamBScore(event.target.value)} required disabled={resultBusy} className="mt-2 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50" />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="result-notes" className="text-xs font-bold text-white/55">ملاحظات النتيجة (اختياري)</label>
                  <textarea id="result-notes" value={resultNotes} onChange={(event) => setResultNotes(event.target.value)} rows={3} disabled={resultBusy} className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50" />
                </div>

                <div className="md:col-span-2">
                  <p className="text-xs font-bold text-white/55">الهدافون</p>
                  <div className="mt-3 space-y-3">
                    {scorersDraft.map((scorer, index) => (
                      <div key={index} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3 md:grid-cols-[1fr_110px_110px_auto]">
                        <select
                          value={scorer.player_id}
                          onChange={(event) => updateScorerDraft(index, 'player_id', event.target.value)}
                          disabled={resultBusy}
                          required
                          className="w-full rounded-xl border border-white/10 bg-pitch-950/60 px-3 py-2.5 text-sm font-semibold text-sand-100 outline-none focus:border-brand-400/50"
                          aria-label="اللاعب الهداف"
                        >
                          <option value="">اختر لاعبًا</option>
                          {assignedPlayerOptions.map(({ assignment, player, team }) => (
                            <option key={assignment.id} value={assignment.player_id}>
                              {player?.full_name ?? 'لاعب'} — {team?.name_ar ?? ''}
                            </option>
                          ))}
                        </select>
                        <label className="grid gap-1 text-[11px] font-bold text-white/45">
                          أهداف
                          <input type="number" min="1" max="30" value={scorer.goals} onChange={(event) => updateScorerDraft(index, 'goals', event.target.value)} disabled={resultBusy} required className="w-full rounded-xl border border-white/10 bg-pitch-950/60 px-3 py-2.5 text-sm font-semibold text-sand-100 outline-none focus:border-brand-400/50" />
                        </label>
                        <label className="grid gap-1 text-[11px] font-bold text-white/45">
                          تمريرات
                          <input type="number" min="0" max="30" value={scorer.assists} onChange={(event) => updateScorerDraft(index, 'assists', event.target.value)} disabled={resultBusy} required className="w-full rounded-xl border border-white/10 bg-pitch-950/60 px-3 py-2.5 text-sm font-semibold text-sand-100 outline-none focus:border-brand-400/50" />
                        </label>
                        <button
                          type="button"
                          onClick={() => setScorersDraft((current) => current.filter((_, scorerIndex) => scorerIndex !== index))}
                          disabled={resultBusy}
                          className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-red-400/25 text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-50"
                          aria-label="إزالة الهداف"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setScorersDraft((current) => [...current, { player_id: '', goals: '1', assists: '0' }])} disabled={resultBusy} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white/70 transition-colors hover:text-white disabled:opacity-60">
                    <Plus className="size-4" />
                    إضافة هداف
                  </button>
                </div>

                {resultError ? <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[12px] leading-6 text-red-200 md:col-span-2">{resultError}</p> : null}
                {resultSuccess ? <p role="status" className="rounded-2xl border border-brand-400/20 bg-brand-400/[0.06] px-4 py-3 text-[12px] leading-6 text-brand-200 md:col-span-2">{resultSuccess}</p> : null}

                <div className="flex flex-wrap gap-2 md:col-span-2">
                  <button type="submit" disabled={resultBusy} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-brand-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60">
                    {resultBusy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    حفظ النتيجة
                  </button>
                  <button type="button" onClick={() => setResultFormOpen(false)} disabled={resultBusy} className="inline-flex min-h-11 items-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/60 transition-colors hover:text-white disabled:opacity-60">
                    إلغاء
                  </button>
                </div>
              </form>
            ) : null}
          </Card>
        ) : null}
      </section>

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

      <section className="mt-8" aria-label="تقييمات اللاعبين">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-sand-100">
              <Star className="size-5 text-brand-300" />
              تقييمات اللاعبين
            </h2>
            <p className="mt-1 text-sm text-white/45">
              بعد اكتمال المباراة، قيّم كل لاعب آخر من 1 إلى 10. لا يمكنك تقييم نفسك.
            </p>
          </div>
          <Badge variant={canRate ? 'brand' : 'neutral'}>{canRate ? 'يمكنك التقييم الآن' : 'التقييم غير متاح'}</Badge>
        </div>

        {ratingError ? <p role="alert" className="mb-4 rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[12px] leading-6 text-red-200">{ratingError}</p> : null}
        {ratingSuccess ? <p role="status" className="mb-4 rounded-2xl border border-brand-400/20 bg-brand-400/[0.06] px-4 py-3 text-[12px] leading-6 text-brand-200">{ratingSuccess}</p> : null}

        {match.status !== 'completed' ? (
          <EmptyState icon={Star} title="التقييم يبدأ بعد نهاية المباراة" description="عند اكتمال المباراة، ستظهر هنا إمكانية تقييم اللاعبين الآخرين." />
        ) : !currentUserRegistration ? (
          <EmptyState icon={Star} title="التقييم للمشاركين فقط" description="فقط اللاعبون المؤكدون في هذه المباراة يمكنهم التقييم." />
        ) : confirmedPlayers.length > 1 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {confirmedPlayers
              .filter((registration) => registration.player_id !== profile?.id)
              .map((registration) => {
                const player = directoryById.get(registration.player_id)
                const stat = ratingStatsByPlayer.get(registration.player_id)
                const myRating = myRatingsByPlayer.get(registration.player_id) ?? 0
                return (
                  <Card key={registration.id} className="p-4">
                    <div className="flex items-center gap-3">
                      <Avatar player={player} size={42} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-extrabold text-sand-100">{player?.full_name ?? 'لاعب'}</p>
                        <p className="mt-0.5 text-[11px] text-white/45">
                          {stat ? `متوسط ${stat.average_rating} من 10 · ${stat.rating_count} تقييم` : 'لا توجد تقييمات بعد'}
                        </p>
                      </div>
                      {myRating ? <Badge variant="brand">قيّمتك: {myRating}</Badge> : null}
                    </div>
                    <div className="mt-4 grid grid-cols-5 gap-1.5 sm:grid-cols-10" aria-label={`تقييم ${player?.full_name ?? 'لاعب'}`}>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => {
                        const active = value <= myRating
                        const busy = ratingBusyPlayerId === registration.player_id
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => void handleRatePlayer(registration.player_id, value)}
                            disabled={busy || !canRate}
                            aria-label={`تقييم ${value} من 10`}
                            className={`grid min-h-11 min-w-9 place-items-center rounded-xl border text-sm font-black transition-colors disabled:opacity-60 ${active ? 'border-brand-400/40 bg-brand-400/15 text-brand-300' : 'border-white/10 bg-white/[0.03] text-white/40 hover:text-brand-200'}`}
                          >
                            {value}
                          </button>
                        )
                      })}
                    </div>
                  </Card>
                )
              })}
          </div>
        ) : (
          <EmptyState icon={Star} title="لا يوجد لاعبون آخرون للتقييم" description="يلزم مشاركة لاعب آخر على الأقل في هذه المباراة." />
        )}
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

    </div>
  )
}
